import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionWorktreeStore } from '@/sync/session-worktree-store';
import { getAttachedSessionDirectory } from '@/sync/session-worktree-contract';
import { useSessionDirectory } from '@/sync/sync-context';
import { CHAT_DRAFT_PROJECT_ID, getChatsRootForHome, isChatDirectoryPath } from '@/lib/chatDirectories';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';

type SearchDraft = {
  open: boolean;
  target?: 'project' | 'chat';
  selectedProjectId?: string | null;
  bootstrapPendingDirectory?: string | null;
  directoryOverride?: string | null;
  preparedChatDirectory?: string | null;
  chatServerId?: string | null;
};

type SearchProject = { id: string; path: string };

export const resolveChatSearchDirectory = (input: {
  currentSessionId?: string | null;
  attachmentDirectory?: string | null;
  worktreeDirectory?: string | null;
  sessionDirectory?: string | null;
  draft?: SearchDraft | null;
  projects: readonly SearchProject[];
  activeProjectId?: string | null;
  fallbackDirectory?: string | null;
  homeDirectory?: string | null;
}): string | undefined => {
  if (input.currentSessionId) {
    return input.attachmentDirectory
      || input.worktreeDirectory
      || input.sessionDirectory
      || undefined;
  }

  const draft = input.draft;
  if (draft?.open && (draft.target === 'chat' || draft.selectedProjectId === CHAT_DRAFT_PROJECT_ID)) {
    const explicitChatDirectory = draft.bootstrapPendingDirectory
      || draft.preparedChatDirectory
      || (isChatDirectoryPath(draft.directoryOverride) ? draft.directoryOverride : null);
    if (explicitChatDirectory) return explicitChatDirectory;
    const chatServerId = draft.chatServerId || DEFAULT_SERVER_ID;
    return chatServerId === DEFAULT_SERVER_ID
      ? getChatsRootForHome(input.homeDirectory) ?? undefined
      : undefined;
  }

  if (draft?.open && (draft.bootstrapPendingDirectory || draft.directoryOverride)) {
    return draft.bootstrapPendingDirectory || draft.directoryOverride || undefined;
  }

  if (draft?.open) {
    const projectId = draft.selectedProjectId || input.activeProjectId;
    const project = projectId ? input.projects.find((entry) => entry.id === projectId) : null;
    if (project?.path) return project.path;
  }

  return input.fallbackDirectory || undefined;
};

export const useChatSearchDirectory = (): string | undefined => {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const sessionDirectory = useSessionDirectory(currentSessionId ?? '');
  const worktreeAttachment = useSessionWorktreeStore((state) =>
    currentSessionId ? state.getAttachment(currentSessionId) : undefined
  );
  const worktreeMap = useSessionUIStore((state) => state.worktreeMetadata);
  const newSessionDraft = useSessionUIStore((state) => state.newSessionDraft);

  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projects = useProjectsStore((state) => state.projects);

  const fallbackDirectory = useDirectoryStore((state) => state.currentDirectory);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);

  return resolveChatSearchDirectory({
    currentSessionId,
    attachmentDirectory: getAttachedSessionDirectory(worktreeAttachment),
    worktreeDirectory: currentSessionId ? worktreeMap.get(currentSessionId)?.path : null,
    sessionDirectory,
    draft: newSessionDraft,
    projects,
    activeProjectId,
    fallbackDirectory,
    homeDirectory,
  });
};
