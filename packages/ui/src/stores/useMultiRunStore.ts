import { create } from 'zustand';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { devtools } from 'zustand/middleware';
import type { CreateMultiRunParams, CreateMultiRunResult } from '@/types/multirun';
import type { Session } from '@/lib/opencode/client';
import { opencodeClient } from '@/lib/opencode/client';
import { saveWorktreeSetupCommands } from '@/lib/openchamberConfig';
import { fetchSessionKnowledge, reportSessionKnowledgeDelivered } from '@/lib/sessionKnowledgeApi';
import type { ProjectRef } from '@/lib/worktrees/worktreeManager';
import { createWorktreeWithDefaults, resolveRootTrackingRemote } from '@/lib/worktrees/worktreeCreate';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { checkIsGitRepository } from '@/lib/gitApi';
// sessionStore removed — sync bootstrap handles session loading
import { useDirectoryStore } from './useDirectoryStore';
import { useProjectsStore } from './useProjectsStore';
import { useSnippetsStore } from './useSnippetsStore';
import { useGlobalSessionsStore } from './useGlobalSessionsStore';
import { createMultiRunSession } from '@/lib/multirun/createSession';
import { multiRunGroupKey, type MultiRunMembership } from '@/lib/multirun/identity';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { RUN_LAUNCHER_ID } from '@/lib/multirun/launcher';
import { multiRunVariantLabel } from '@/lib/multirun/runs';
import { getSyncChildStores, registerSessionDirectory } from '@/sync/sync-refs';
import { routeMessage } from '@/sync/session-ui-store';

export const toGitSafeSlug = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
};

export const toModelSlug = (providerID: string, modelID: string): string => {
  const provider = toGitSafeSlug(providerID);
  const model = toGitSafeSlug(modelID);
  return `${provider}-${model}`.substring(0, 60);
};

/**
 * Seed name for worktree creation.
 * Uses slashes for readability; create payload will slugify.
 */
const generateWorktreeNameSeed = (groupSlug: string, modelSlug: string): string => {
  return `${groupSlug}/${modelSlug}`;
};

const resolveActiveProject = (): ProjectRef | null => {
  const projectsState = useProjectsStore.getState();
  const activeProjectId = projectsState.activeProjectId;
  if (!activeProjectId) {
    return null;
  }

  const project = projectsState.projects.find((entry) => entry.id === activeProjectId);
  if (project?.path) {
    return { id: project.id, path: project.path, serverId: project.serverId };
  }

  // Fall back to current directory only when active project is missing.
  const currentDirectory = useDirectoryStore.getState().currentDirectory ?? null;
  if (currentDirectory && currentDirectory.trim().length > 0) {
    const normalized = currentDirectory.replace(/\\/g, '/').replace(/\/+$/, '') || currentDirectory;
    return { id: `path:${normalized}`, path: normalized };
  }

  return null;
};

export const registerMultiRunSession = (session: Session, directory: string): Session => {
  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/+$/, '') || directory;
  const sessionWithDirectory = session.directory?.trim()
    ? session
    : { ...session, directory: normalizedDirectory };

  registerSessionDirectory(session.id, normalizedDirectory);
  useSessionUIStore.getState().markSessionAsOpenChamberCreated(session.id);
  useGlobalSessionsStore.getState().upsertSession(sessionWithDirectory);

  try {
    const store = getSyncChildStores().ensureChild(normalizedDirectory, { bootstrap: false });
    store.setState((state) => {
      if (state.session.some((entry) => entry.id === session.id)) return state;
      return { session: [sessionWithDirectory, ...state.session] };
    });
  } catch {
    // The child store may not exist yet; the SSE bootstrap will deliver the session.
  }

  return sessionWithDirectory;
};

/**
 * Sends a lane its prompt. Each lane is a fresh session, so it is owed the
 * project's standing context exactly as a composer send would be. Fork note:
 * the fork's routeMessage carries no per-part `systemContext`, so the
 * knowledge part travels without it.
 */
export async function dispatchRunPrompt(input: {
  assertCurrent: () => void;
  sessionId: string;
  directory: string;
  prompt: string;
  providerID: string;
  modelID: string;
  variant?: string;
  agent?: string;
  files?: Array<{ type: 'file'; mime: string; filename: string; url: string }>;
}): Promise<void> {
  input.assertCurrent();
  const expandText = useSnippetsStore.getState().expandText;
  const [text, knowledge] = await Promise.all([
    expandText(input.prompt).catch(() => input.prompt),
    fetchSessionKnowledge(input.directory, input.sessionId),
  ]);
  input.assertCurrent();
  await routeMessage({
    sessionId: input.sessionId,
    directory: input.directory,
    content: text,
    providerID: input.providerID,
    modelID: input.modelID,
    variant: input.variant,
    agent: input.agent,
    files: input.files,
    additionalParts: knowledge.text
      ? [{ text: knowledge.text, synthetic: true }]
      : undefined,
  });
  if (knowledge.text) {
    void reportSessionKnowledgeDelivered(input.directory, input.sessionId, knowledge.signature);
  }
}

interface MultiRunState {
  isLoading: boolean;
  error: string | null;
}

interface MultiRunActions {
  /** Create worktrees/sessions and immediately start all runs */
  createMultiRun: (params: CreateMultiRunParams) => Promise<CreateMultiRunResult | null>;
  clearError: () => void;
  resetForRuntimeSwitch: () => void;
}

type MultiRunStore = MultiRunState & MultiRunActions;

export const useMultiRunStore = create<MultiRunStore>()(
  devtools(
    (set) => ({
      isLoading: false,
      error: null,

      createMultiRun: async (params: CreateMultiRunParams) => {
        const runtimeKey = getRuntimeKey();
        const client = opencodeClient.getSdkClient();
        const assertCurrent = () => {
          if (getRuntimeKey() !== runtimeKey || opencodeClient.getSdkClient() !== client) throw new Error('Runtime changed');
        };
        const groupName = params.name.trim();
        const runTitle = (params.title ?? params.name).trim().slice(0, 200);
        const { groups, agent, files, setupCommands } = params;

        if (!groupName) {
          set({ error: 'Group name is required' });
          return null;
        }

        if (!groups || groups.length === 0) {
          set({ error: 'At least one run group is required' });
          return null;
        }

        for (let gi = 0; gi < groups.length; gi++) {
          if (!groups[gi].prompt.trim()) {
            set({ error: `Group ${gi + 1}: prompt is required` });
            return null;
          }
          if (groups[gi].models.length < 1) {
            set({ error: `Group ${gi + 1}: select at least 1 model` });
            return null;
          }
        }

        set({ isLoading: true, error: null });

        try {
          const project = resolveActiveProject();
          if (!project) {
            set({ error: 'Select a project', isLoading: false });
            return null;
          }

          const directory = project.path;

          const isGit = await checkIsGitRepository(directory);
          assertCurrent();
          const shouldIsolateRuns = isGit && params.isolateRuns !== false;

          const groupSlug = toGitSafeSlug(groupName) || 'multi-run';
          const membershipGroup: MultiRunMembership['group'] = { kind: 'id', id: crypto.randomUUID() };
          const rootBranch = shouldIsolateRuns ? await getRootBranch(directory) : undefined;
          assertCurrent();
          const rootTrackingRemote = shouldIsolateRuns ? await resolveRootTrackingRemote(directory) : null;
          assertCurrent();

          const createdRuns: Array<{
            sessionId: string;
            worktreePath: string;
            providerID: string;
            modelID: string;
            variant?: string;
            prompt: string;
            files?: CreateMultiRunParams['files'];
          }> = [];
          const autoFusion = params.autoFusion ? { ...params.autoFusion, launcherId: RUN_LAUNCHER_ID } : undefined;

          const commandsToRun = setupCommands?.filter((cmd) => cmd.trim().length > 0) ?? [];

          for (let gi = 0; gi < groups.length; gi++) {
            assertCurrent();
            const group = groups[gi];
            const prompt = group.prompt;

            // Count occurrences of each model to handle duplicates inside this group.
            const modelCounts = new Map<string, number>();
            for (const model of group.models) {
              assertCurrent();
              const key = `${model.providerID}:${model.modelID}`;
              modelCounts.set(key, (modelCounts.get(key) || 0) + 1);
            }

            // Track current index per model during iteration.
            const modelIndexes = new Map<string, number>();

            for (const model of group.models) {
              const key = `${model.providerID}:${model.modelID}`;
              const count = modelCounts.get(key) || 1;
              const index = (modelIndexes.get(key) || 0) + 1;
              modelIndexes.set(key, index);

              const modelSlug = toModelSlug(model.providerID, model.modelID);
              const runGroup = groups.length > 1 ? `g${gi + 1}` : undefined;
              // Append index only when same model is selected multiple times.
              const modelPart = count > 1
                ? generateWorktreeNameSeed(groupSlug, `${modelSlug}/${index}`)
                : generateWorktreeNameSeed(groupSlug, modelSlug);
              const preferredName = runGroup
                ? `${runGroup}/${modelPart}`
                : modelPart;

              const sessionTitle = [
                `${model.displayName || model.modelID}${count > 1 ? ` #${index}` : ''}`,
                ...(runGroup ? [multiRunVariantLabel(runGroup)] : []),
                runTitle,
              ].join(' · ');

              try {
                const createRun = (runDirectory: string) => createMultiRunSession({
                  title: sessionTitle, directory: runDirectory,
                  identity: { group: membershipGroup, groupSlug, runGroup, providerID: model.providerID,
                    modelID: model.modelID, index: count > 1 ? index : undefined, role: 'run', title: runTitle, autoFusion },
                }, assertCurrent);
                if (!shouldIsolateRuns) {
                  const session = await createRun(directory);
                  registerMultiRunSession(session, directory);

                  createdRuns.push({
                    sessionId: session.id,
                    worktreePath: directory,
                    providerID: model.providerID,
                    modelID: model.modelID,
                    variant: model.variant,
                    prompt,
                    files: group.files,
                  });
                  continue;
                }

                assertCurrent();
                const worktreeMetadata = await createWorktreeWithDefaults(project, {
                  preferredName,
                  mode: 'new',
                  branchName: preferredName,
                  worktreeName: preferredName,
                  startRef: params.worktreeBaseBranch || 'HEAD',
                  setupCommands: commandsToRun,
                }, {
                  resolvedRootTrackingRemote: rootTrackingRemote,
                });
                assertCurrent();

                const enrichedMetadata = {
                  ...worktreeMetadata,
                  createdFromBranch: rootBranch,
                  kind: 'standard' as const,
                };

                const session = await createRun(worktreeMetadata.path);
                registerMultiRunSession(session, worktreeMetadata.path);

                useSessionUIStore.getState().setWorktreeMetadata(session.id, enrichedMetadata);

                createdRuns.push({
                  sessionId: session.id,
                  worktreePath: worktreeMetadata.path,
                  providerID: model.providerID,
                  modelID: model.modelID,
                  variant: model.variant,
                  prompt,
                  files: group.files,
                });
              } catch (err) {
                assertCurrent();
                console.warn('[MultiRun] Failed to create session:', err);
              }
            }
          }

          // Save setup commands to config if any were provided (for future worktree creation)
          const commandsToSave = setupCommands?.filter(cmd => cmd.trim().length > 0) ?? [];
          assertCurrent();
          if (commandsToSave.length > 0) {
            saveWorktreeSetupCommands(project, commandsToSave).catch(() => {
              console.warn('[MultiRun] Failed to save worktree setup commands');
            });
          }

          const sessionIds = createdRuns.map((r) => r.sessionId);
          const firstSessionId = createdRuns[0]?.sessionId ?? null;

          if (sessionIds.length === 0) {
            set({ error: 'Failed to create any sessions', isLoading: false });
            return null;
          }

          const filesForMessage = files?.map((f) => ({
            type: 'file' as const,
            mime: f.mime,
            filename: f.filename,
            url: f.url,
          }));

          // Session list refresh handled by sync bootstrap via SSE events

          void Promise.allSettled(createdRuns.map(async (run) => {
            try {
              await dispatchRunPrompt({
                assertCurrent,
                sessionId: run.sessionId,
                directory: run.worktreePath,
                prompt: run.prompt,
                providerID: run.providerID,
                modelID: run.modelID,
                variant: run.variant,
                agent,
                files: [...(filesForMessage ?? []), ...(run.files ?? []).map((f) => ({ type: 'file' as const, mime: f.mime, filename: f.filename, url: f.url }))],
              });
            } catch (err) {
              console.warn('[MultiRun] Failed to start run:', err);
            }
          }));

          set({ isLoading: false });
          const failedCount = groups.reduce((total, group) => total + group.models.length, 0) - sessionIds.length;
          return { groupSlug, groupKey: multiRunGroupKey(membershipGroup, groupSlug), sessionIds, firstSessionId, failedCount };
        } catch (error) {
          if (getRuntimeKey() !== runtimeKey || opencodeClient.getSdkClient() !== client) return null;
          set({
            error: error instanceof Error ? error.message : 'Failed to create Multi-Run',
            isLoading: false,
          });
          return null;
        }
      },

      clearError: () => {
        set({ error: null });
      },
      resetForRuntimeSwitch: () => set({ isLoading: false, error: null }),
    }),
    { name: 'multirun-store' },
  ),
);
