import fs from 'fs';
import os from 'os';
import path from 'path';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { createWorktree } from '../git/index.js';
import { OpenChamberControlError } from '../openchamber-control/error.js';
import { expandSnippets } from '../opencode/snippets.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from '../opencode/protocol-mode.js';
import { isV2PromptTrack, postV2PromptDispatch } from '../opencode/v2-prompt-dispatch.js';
import { parseScheduledCommandPrompt } from '../scheduled-tasks/runtime.js';
import { buildGoalIntroText, createSessionGoal } from '../session-goal/create.js';
import { createArchiveStore } from './archive-store.js';
import {
  createSessionMetadataStore,
  createUpstreamSessionMetadataReader,
  createV1UpstreamSessionMetadataReader,
} from './session-metadata-store.js';
import { createOpenCodeClient as defaultCreateOpenCodeClient } from './opencode-client.js';

const FALLBACK_PROVIDER_ID = 'opencode';
const FALLBACK_MODEL_ID = 'big-pickle';
const MIN_GOAL_TOKEN_BUDGET = 1_000;
const MAX_GOAL_TOKEN_BUDGET = 100_000_000;

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const splitModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) return null;
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) return null;
  return { providerID: model.slice(0, slashIndex), modelID: model.slice(slashIndex + 1) };
};

// The Auto routing sentinel (see ../routing/defaults.js). As a session default
// it never reaches OpenCode directly: resolvePromptBody rewrites it before the
// dispatch leaves, so it is allowed through the default resolution here while
// every real model stays provider-validated.
const isAutoModelRef = (model) => model?.providerID === 'openchamber' && model?.modelID === 'auto';

const resolveRequestedModel = (payload) => {
  const model = splitModel(payload?.model);
  if (model) return model;
  const providerID = asNonEmptyString(payload?.providerID);
  const modelID = asNonEmptyString(payload?.modelID);
  return providerID && modelID ? { providerID, modelID } : null;
};

const resolveGoalInput = (payload, prompt) => {
  const enabled = payload?.goal === true;
  if (payload?.goalTokenBudget !== undefined && !enabled) {
    return { ok: false, error: 'goalTokenBudget requires goal' };
  }
  if (enabled && !prompt) return { ok: false, error: 'prompt is required when goal is enabled' };
  if (payload?.goalTokenBudget === undefined) return { ok: true, enabled, tokenBudget: null };
  const tokenBudget = payload.goalTokenBudget;
  if (!Number.isSafeInteger(tokenBudget)
    || tokenBudget < MIN_GOAL_TOKEN_BUDGET
    || tokenBudget > MAX_GOAL_TOKEN_BUDGET) {
    return {
      ok: false,
      error: `goalTokenBudget must be an integer from ${MIN_GOAL_TOKEN_BUDGET} to ${MAX_GOAL_TOKEN_BUDGET}`,
    };
  }
  return { ok: true, enabled, tokenBudget };
};

const providerModels = (provider) => {
  if (Array.isArray(provider?.models)) return provider.models;
  if (provider?.models && typeof provider.models === 'object') return Object.values(provider.models);
  return [];
};

const hasProviderModel = (providers, providerID, modelID) => providers.some(
  (provider) => provider?.id === providerID
    && providerModels(provider).some((model) => model?.id === modelID),
);

const resolveVariant = (providers, providerID, modelID, variant) => {
  const normalized = asNonEmptyString(variant);
  if (!normalized) return undefined;
  const provider = providers.find((entry) => entry?.id === providerID);
  const model = providerModels(provider).find((entry) => entry?.id === modelID);
  return model?.variants && Object.prototype.hasOwnProperty.call(model.variants, normalized)
    ? normalized
    : undefined;
};

const isPrimaryAgentMode = (mode) => !mode || mode === 'primary' || mode === 'all';

const PROMPT_LANDED_TIMEOUT_MS = 5_000;
const PROMPT_LANDED_POLL_MS = 150;

const latestUserMessageID = async ({ client, sessionID, directory }) => {
  let response;
  try {
    response = await client.session.messages({ sessionID, directory, limit: 100 });
  } catch {
    return { ok: false, messageID: null };
  }
  const messages = Array.isArray(response?.data) ? response.data : [];
  let latest = null;
  for (const message of messages) {
    const info = message?.info;
    if (info?.role !== 'user') continue;
    if (!latest || (info.time?.created || 0) >= (latest.time?.created || 0)) latest = info;
  }
  return { ok: true, messageID: asNonEmptyString(latest?.id) };
};

const waitForPromptLanded = async ({ client, sessionID, directory, baselineUserMessageID }) => {
  const deadline = Date.now() + PROMPT_LANDED_TIMEOUT_MS;
  for (;;) {
    const latest = await latestUserMessageID({ client, sessionID, directory });
    if (!latest.ok) return true;
    if (latest.messageID && latest.messageID !== baselineUserMessageID) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, PROMPT_LANDED_POLL_MS));
  }
};

const fetchJson = async (url, authHeaders, fallback, directory) => {
  const response = await fetch(url.toString(), {
    headers: {
      ...authHeaders,
      'x-opencode-directory': directory,
      accept: 'application/json',
    },
  });
  if (!response.ok) return fallback;
  return response.json().catch(() => fallback);
};

const fetchSelectionInputs = async ({
  buildOpenCodeUrl,
  authHeaders,
  directory,
  readSettingsFromDiskMigrated,
}) => {
  const settings = await readSettingsFromDiskMigrated();
  const providersUrl = new URL(buildOpenCodeUrl('/config/providers', ''));
  const agentsUrl = new URL(buildOpenCodeUrl('/agent', ''));
  const configUrl = new URL(buildOpenCodeUrl('/config', ''));
  for (const url of [providersUrl, agentsUrl, configUrl]) url.searchParams.set('directory', directory);
  const [providersBody, agentsBody, configBody] = await Promise.all([
    fetchJson(providersUrl, authHeaders, { providers: [] }, directory),
    fetchJson(agentsUrl, authHeaders, [], directory),
    fetchJson(configUrl, authHeaders, {}, directory),
  ]);
  return {
    settings,
    providers: Array.isArray(providersBody?.providers) ? providersBody.providers : [],
    agents: Array.isArray(agentsBody) ? agentsBody : [],
    opencodeDefaultAgent: asNonEmptyString(configBody?.default_agent)
      || asNonEmptyString(configBody?.defaultAgent),
    opencodeDefaultModel: asNonEmptyString(configBody?.model),
  };
};

const resolveDefaultSelection = ({
  agents,
  providers,
  settings,
  opencodeDefaultAgent,
  opencodeDefaultModel,
}) => {
  const primaryAgents = agents.filter(
    (agent) => (!agent?.mode || agent.mode === 'primary' || agent.mode === 'all') && agent?.hidden !== true,
  );
  let resolvedAgent = agents.find((agent) => agent?.name === asNonEmptyString(settings?.defaultAgent)) || null;
  if (!resolvedAgent && opencodeDefaultAgent) {
    const candidate = agents.find((agent) => agent?.name === opencodeDefaultAgent) || null;
    if (candidate && primaryAgents.includes(candidate)) resolvedAgent = candidate;
  }
  if (!resolvedAgent) {
    resolvedAgent = primaryAgents.find((agent) => agent?.name === 'build')
      || primaryAgents[0]
      || agents[0]
      || null;
  }

  let model = null;
  let variant;
  const settingsModel = splitModel(settings?.defaultModel);
  if (settingsModel && (isAutoModelRef(settingsModel) || hasProviderModel(providers, settingsModel.providerID, settingsModel.modelID))) {
    model = settingsModel;
    variant = resolveVariant(providers, model.providerID, model.modelID, settings?.defaultVariant);
  }
  if (!model && resolvedAgent?.model?.providerID && resolvedAgent?.model?.modelID
    && hasProviderModel(providers, resolvedAgent.model.providerID, resolvedAgent.model.modelID)) {
    model = { providerID: resolvedAgent.model.providerID, modelID: resolvedAgent.model.modelID };
    variant = resolveVariant(providers, model.providerID, model.modelID, resolvedAgent.variant);
  }
  const opencodeModel = splitModel(opencodeDefaultModel);
  if (!model && opencodeModel && hasProviderModel(providers, opencodeModel.providerID, opencodeModel.modelID)) {
    model = opencodeModel;
  }
  if (!model && hasProviderModel(providers, FALLBACK_PROVIDER_ID, FALLBACK_MODEL_ID)) {
    model = { providerID: FALLBACK_PROVIDER_ID, modelID: FALLBACK_MODEL_ID };
  }
  if (!model) {
    const provider = providers[0];
    const firstModel = providerModels(provider)[0];
    if (provider?.id && firstModel?.id) model = { providerID: provider.id, modelID: firstModel.id };
  }
  return { agent: resolvedAgent?.name, model, variant };
};

const runPromptAsync = async ({ baseUrl, authHeaders, sessionID, directory, payload }) => {
  // The v2 track maps the (resolvePromptBody-rewritten) v1 payload onto the
  // flat OpenCode 2 dispatch: selection switches, parked synthetics, then
  // `POST /api/session/:id/prompt`. The `x-opencode-directory` header scopes
  // the v2 location middleware, so the header set below carries over.
  if (isV2PromptTrack()) {
    const post = async (path, body) => {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'x-opencode-directory': directory,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`v2 prompt dispatch failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
    };
    await postV2PromptDispatch({ sessionId: sessionID, body: payload, post });
    return;
  }
  const url = new URL(`${baseUrl}/session/${encodeURIComponent(sessionID)}/prompt_async`);
  url.searchParams.set('directory', directory);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeaders,
      'x-opencode-directory': directory,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`prompt_async failed (${response.status})${body ? `: ${body}` : ''}`);
  }
};

const createSession = async ({ baseUrl, authHeaders, directory, title }) => {
  const url = new URL(`${baseUrl}/session`);
  url.searchParams.set('directory', directory);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeaders,
      'x-opencode-directory': directory,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ directory, ...(title ? { title } : {}) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`session create failed (${response.status})${body ? `: ${body}` : ''}`);
  }
  const body = await response.json().catch(() => null);
  const sessionID = body?.id || body?.data?.id;
  if (!sessionID) throw new Error('failed to create session');
  return sessionID;
};

const resolveWorktreeInput = (payload) => {
  if (!payload?.worktree || typeof payload.worktree !== 'object') return null;
  const name = asNonEmptyString(payload.worktree.name);
  if (!name) return null;
  return {
    mode: 'new',
    name,
    ...(asNonEmptyString(payload.worktree.branchName)
      ? { branchName: payload.worktree.branchName.trim() }
      : {}),
    ...(asNonEmptyString(payload.worktree.startRef) ? { startRef: payload.worktree.startRef.trim() } : {}),
    ...(typeof payload.setUpstream === 'boolean' ? { setUpstream: payload.setUpstream } : {}),
  };
};

export const createOpenChamberSessionService = (dependencies) => {
  const {
    readSettingsFromDiskMigrated,
    sanitizeProjects,
    validateDirectoryPath,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    waitForOpenCodeReady,
    emitSessionCreatedEvent,
    createSessionGoal: createSessionGoalOverride,
    sessionKnowledgeRuntime = null,
    // Auto routing. Prompts dispatched here go straight to OpenCode, not
    // through the proxy that rewrites the Auto sentinel, so the same hook runs
    // on the body before it is sent. Null when routing is not wired in.
    resolvePromptBody = null,
    createClient = createOpencodeClient,
    createWorktree: createWorktreeOverride = createWorktree,
    localServerId = 'default',
    // OC2 spine S4 [spine 654705f7d]: OpenChamber-owned session state. The
    // v1 archive path (session.update below) is untouched; the stores are the
    // storage base the v2 track switches onto, and the metadata routes
    // (routes.js) are the single owner of OpenChamber-namespaced metadata.
    dataDir = null,
    archiveStore: injectedArchiveStore = null,
    sessionMetadataStore: injectedSessionMetadataStore = null,
    // Injected by the server so every metadata write takes the same path:
    // store, broadcast, and tell the goal loop. Falls back to store+broadcast
    // when it is absent, which is what module tests use.
    persistSessionMetadata = null,
    broadcastGlobalUiEvent = null,
    createOpenCodeClient = defaultCreateOpenCodeClient,
  } = dependencies;

  const assertLocalAuthority = (payload) => {
    const serverId = asNonEmptyString(payload?.serverId);
    if (!serverId) throw new OpenChamberControlError('serverId is required', 400);
    if (serverId !== localServerId) {
      throw new OpenChamberControlError(`Managed Session control does not support server '${serverId}'`, 409);
    }
    return serverId;
  };

  // --- OpenChamber-owned session state [spine 654705f7d, spine S4] ---
  // Same data dir convention as the rest of the server: `OPENCHAMBER_DATA_DIR`
  // or `~/.config/openchamber`. Stores are built lazily so a service that only
  // dispatches prompts never touches the filesystem.
  const resolveDataDir = () => dataDir
    ?? (process.env.OPENCHAMBER_DATA_DIR
      ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
      : path.join(os.homedir(), '.config', 'openchamber'));

  let archiveStoreInstance = injectedArchiveStore;
  let sessionMetadataStoreInstance = injectedSessionMetadataStore;

  const getArchiveStore = () => {
    if (!archiveStoreInstance) archiveStoreInstance = createArchiveStore({ dataDir: resolveDataDir() });
    return archiveStoreInstance;
  };

  /**
   * Seeding reads the OpenCode record through the client of the active track:
   * the v1 SDK client while the managed instance speaks v1, `@opencode/client`
   * once it speaks v2. Chosen per call so a mode recorded after construction
   * (lifecycle probe) is honoured.
   */
  const readUpstreamMetadataV1 = createV1UpstreamSessionMetadataReader({
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    createClient,
  });
  const readUpstreamMetadataV2 = createUpstreamSessionMetadataReader({
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    createOpenCodeClient,
  });
  const defaultReadUpstreamMetadata = (sessionID, scope) => {
    const v2Track = resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2';
    return v2Track ? readUpstreamMetadataV2(sessionID, scope) : readUpstreamMetadataV1(sessionID, scope);
  };

  const getSessionMetadataStore = () => {
    if (!sessionMetadataStoreInstance) {
      sessionMetadataStoreInstance = createSessionMetadataStore({
        dataDir: resolveDataDir(),
        readUpstreamMetadata: defaultReadUpstreamMetadata,
      });
    }
    return sessionMetadataStoreInstance;
  };

  const broadcastMetadata = (sessionID, metadata) => {
    broadcastGlobalUiEvent?.({
      type: 'openchamber:session-metadata',
      properties: { sessionID, metadata },
    });
  };

  /**
   * Merge-patch a session's OpenChamber-owned metadata — the single owner.
   * Every writer goes through here so the same-transaction seed of a session
   * OpenCode still holds metadata for always happens first. The broadcast
   * carries the full merged object, because a client that missed an earlier
   * patch must not have to reconstruct it.
   */
  const writeMetadata = async (sessionID, patch, directory = '') => {
    if (typeof persistSessionMetadata === 'function') {
      return persistSessionMetadata(sessionID, patch, { directory });
    }
    const metadata = await getSessionMetadataStore().setSessionMetadata(sessionID, patch, { directory });
    broadcastMetadata(sessionID, metadata);
    return metadata;
  };

  const setMetadata = async (sessionID, payload = {}) => {
    const id = asNonEmptyString(sessionID);
    if (!id) throw new OpenChamberControlError('a session id is required', 400);
    const patch = payload?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new OpenChamberControlError('patch must be an object', 400);
    }

    return { metadata: await writeMetadata(id, patch, asNonEmptyString(payload?.directory) || '') };
  };

  const getMetadata = async (sessionID, directory = '') => {
    const id = asNonEmptyString(sessionID);
    if (!id) throw new OpenChamberControlError('a session id is required', 400);
    return { metadata: await getSessionMetadataStore().get(id, { directory }) };
  };

  const validateRequestedSelection = async ({ directory, requestedModel, requestedAgent, requestedVariant }) => {
    if (!requestedModel && !requestedAgent && !requestedVariant) return;
    const authHeaders = getOpenCodeAuthHeaders();
    const { providers, agents } = await fetchSelectionInputs({
      buildOpenCodeUrl,
      authHeaders,
      directory,
      readSettingsFromDiskMigrated,
    });

    if (requestedAgent && agents.length > 0) {
      const agent = agents.find((entry) => entry?.name === requestedAgent) || null;
      if (!agent) {
        throw new OpenChamberControlError(`Unknown agent '${requestedAgent}' for ${directory}`, 400);
      }
      if (!isPrimaryAgentMode(agent.mode)) {
        throw new OpenChamberControlError(`Agent '${requestedAgent}' is a subagent and cannot receive a prompt directly`, 400);
      }
    }

    if (requestedModel && providers.length > 0) {
      if (!hasProviderModel(providers, requestedModel.providerID, requestedModel.modelID)) {
        throw new OpenChamberControlError(
          `Unknown model '${requestedModel.providerID}/${requestedModel.modelID}' for ${directory}`,
          400,
        );
      }
      if (requestedVariant
        && !resolveVariant(providers, requestedModel.providerID, requestedModel.modelID, requestedVariant)) {
        throw new OpenChamberControlError(
          `Unknown variant '${requestedVariant}' for model '${requestedModel.providerID}/${requestedModel.modelID}'`,
          400,
        );
      }
    }
  };

  const resolveDirectory = async (payload) => {
    const projectID = asNonEmptyString(payload?.projectId);
    if (projectID) {
      const settings = await readSettingsFromDiskMigrated();
      const project = sanitizeProjects(settings?.projects || []).find((entry) => entry.id === projectID);
      if (!project?.path) throw new OpenChamberControlError('Project not found', 404);
      const validated = await validateDirectoryPath(project.path);
      if (!validated.ok) {
        throw new OpenChamberControlError(validated.error || 'Invalid project directory', 400);
      }
      return { directory: validated.directory, projectId: projectID };
    }
    const requested = asNonEmptyString(payload?.directory);
    if (!requested) throw new OpenChamberControlError('directory or projectId is required', 400);
    const validated = await validateDirectoryPath(requested);
    if (!validated.ok) throw new OpenChamberControlError(validated.error || 'Invalid directory', 400);
    return { directory: validated.directory };
  };

  const fetchLastUserSelection = async ({ client, sessionID, directory }) => {
    try {
      const response = await client.session.messages({ sessionID, directory, limit: 20 });
      const records = Array.isArray(response?.data) ? response.data : [];
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const info = records[index]?.info;
        if (info?.role !== 'user') continue;
        const providerID = asNonEmptyString(info.model?.providerID);
        const modelID = asNonEmptyString(info.model?.modelID);
        if (!providerID || !modelID) continue;
        return {
          model: { providerID, modelID },
          agent: asNonEmptyString(info.agent),
          variant: asNonEmptyString(info.model?.variant),
        };
      }
    } catch {
    }
    return null;
  };

  const latestAssistantMessageID = async ({ client, sessionID, directory }) => {
    try {
      const response = await client.session.messages({ sessionID, directory, limit: 100 });
      const records = Array.isArray(response?.data) ? response.data : [];
      let latest = null;
      for (const record of records) {
        const info = record?.info;
        if (info?.role !== 'assistant' || !Number.isFinite(info?.time?.completed)) continue;
        if (!latest || (info.time.created || 0) >= (latest.time?.created || 0)) latest = info;
      }
      return asNonEmptyString(latest?.id);
    } catch {
      return null;
    }
  };

  const dispatchPrompt = async ({
    client,
    baseUrl,
    authHeaders,
    sessionID,
    directory,
    prompt,
    goalInput,
    requestedModel,
    requestedAgent,
    requestedVariant,
    reuseSessionSelection,
  }) => {
    let model = requestedModel;
    let agent = requestedAgent;
    let variant = requestedVariant;
    if (reuseSessionSelection && (!model || !agent)) {
      const previous = await fetchLastUserSelection({ client, sessionID, directory });
      if (previous) {
        if (!model) {
          model = previous.model;
          if (variant == null) variant = previous.variant ?? undefined;
        }
        if (!agent) agent = previous.agent;
      }
    }
    if (!model || !agent) {
      const defaults = resolveDefaultSelection(await fetchSelectionInputs({
        buildOpenCodeUrl,
        authHeaders,
        directory,
        readSettingsFromDiskMigrated,
      }));
      if (!model) {
        model = defaults.model;
        if (variant == null) variant = defaults.variant;
      }
      if (!agent) agent = defaults.agent;
    }
    if (!model) {
      throw new OpenChamberControlError('No model is configured or available for the requested directory', 400);
    }

    const expandedPrompt = expandSnippets(prompt, directory);
    if (goalInput.enabled) {
      await (createSessionGoalOverride || createSessionGoal)({
        baseUrl,
        authHeaders,
        sessionID,
        directory,
        objective: expandedPrompt,
        tokenBudget: goalInput.tokenBudget,
        providerID: model.providerID,
        modelID: model.modelID,
        onWarning: (message, error) => {
          console.warn(`[OpenChamberSessions] ${message}:`, error?.message || error);
        },
      });
    }

    const markGoalPartial = (error) => {
      if (goalInput.enabled && error && typeof error === 'object') error.goalConfigured = true;
      return error;
    };
    let dispatchedAsCommand = false;
    const parsedCommand = parseScheduledCommandPrompt(prompt);
    if (parsedCommand) {
      try {
        const response = await client.command.list({ directory });
        const commands = Array.isArray(response?.data) ? response.data : [];
        if (commands.some((command) => command?.name === parsedCommand.command)) {
          const commandBody = {
            command: parsedCommand.command,
            arguments: parsedCommand.arguments,
            ...(agent ? { agent } : {}),
            model: `${model.providerID}/${model.modelID}`,
            ...(variant ? { variant } : {}),
          };
          // Same sentinel rule as the prompt route: rewrite before the send.
          await resolvePromptBody?.(commandBody, { sessionId: sessionID, directory });
          await client.session.command({
            sessionID,
            directory,
            ...commandBody,
          });
          dispatchedAsCommand = true;
        }
      } catch (error) {
        throw markGoalPartial(error);
      }
    }
    if (!dispatchedAsCommand) {
      const baseline = await latestUserMessageID({ client, sessionID, directory });
      const knowledge = sessionKnowledgeRuntime
        ? await sessionKnowledgeRuntime.resolvePendingForSession(sessionID, directory)
          .catch(() => ({ text: '', signature: '' }))
        : { text: '', signature: '' };
      const payload = {
        model,
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        parts: [
          ...(knowledge.text ? [{ type: 'text', text: knowledge.text, synthetic: true }] : []),
          { type: 'text', text: expandedPrompt },
          ...(goalInput.enabled
            ? [{ type: 'text', text: buildGoalIntroText(goalInput.tokenBudget), synthetic: true }]
            : []),
        ],
      };
      await resolvePromptBody?.(payload, { sessionId: sessionID, directory });
      try {
        await runPromptAsync({ baseUrl, authHeaders, sessionID, directory, payload });
      } catch (error) {
        throw markGoalPartial(error);
      }
      if (knowledge.text && sessionKnowledgeRuntime) {
        await sessionKnowledgeRuntime.recordDelivered(sessionID, directory, knowledge.signature)
          .catch(() => undefined);
      }
      const landed = await waitForPromptLanded({
        client,
        sessionID,
        directory,
        baselineUserMessageID: baseline.messageID,
      });
      if (!landed) {
        return {
          model,
          agent,
          variant,
          promptDispatched: false,
          dispatchedAsCommand: false,
          promptError: 'OpenCode accepted the prompt but it never appeared in the session',
        };
      }
    }
    return { model, agent, variant, promptDispatched: true, dispatchedAsCommand };
  };

  const create = async (payload = {}) => {
    const serverId = assertLocalAuthority(payload);
    const title = asNonEmptyString(payload.title);
    const prompt = asNonEmptyString(payload.prompt);
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) throw new OpenChamberControlError(goalInput.error, 400);
    const resolved = await resolveDirectory(payload);
    const worktreeInput = resolveWorktreeInput(payload);
    if (payload.worktree && !worktreeInput) {
      throw new OpenChamberControlError('worktree.name is required when worktree is provided', 400);
    }

    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

    if (prompt) {
      await validateRequestedSelection({
        directory: resolved.directory,
        requestedModel: resolveRequestedModel(payload),
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
      });
    }

    let worktree = null;
    let sessionDirectory = resolved.directory;
    if (worktreeInput) {
      worktree = await createWorktreeOverride(resolved.directory, worktreeInput);
      sessionDirectory = worktree.path;
    }

    const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
    const authHeaders = getOpenCodeAuthHeaders();
    const client = createClient({ baseUrl, headers: authHeaders });
    const sessionID = await createSession({
      baseUrl,
      authHeaders,
      directory: sessionDirectory,
      title,
    });
    let dispatch = { promptDispatched: false, dispatchedAsCommand: false };
    if (prompt) {
      dispatch = await dispatchPrompt({
        client,
        baseUrl,
        authHeaders,
        sessionID,
        directory: sessionDirectory,
        prompt,
        goalInput,
        requestedModel: resolveRequestedModel(payload),
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
        reuseSessionSelection: false,
      });
    }
    const result = {
      serverId,
      sessionId: sessionID,
      directory: sessionDirectory,
      ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      ...(title ? { title } : {}),
      ...(worktree ? { worktree } : {}),
      ...(prompt && dispatch.model ? { model: dispatch.model } : {}),
      ...(prompt && dispatch.agent ? { agent: dispatch.agent } : {}),
      ...(prompt && dispatch.variant ? { variant: dispatch.variant } : {}),
      promptDispatched: dispatch.promptDispatched,
      ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
      dispatchedAsCommand: dispatch.dispatchedAsCommand,
      ...(goalInput.enabled ? { goalEnabled: true } : {}),
      ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
    };
    try {
      emitSessionCreatedEvent?.({
        serverId,
        sessionID,
        directory: sessionDirectory,
        ...(resolved.projectId ? { projectID: resolved.projectId } : {}),
        ...result,
        createdAt: Date.now(),
      });
    } catch {
    }
    return result;
  };

  const runExisting = async (action, sourceSessionId, payload = {}) => {
    const serverId = assertLocalAuthority(payload);
    const sourceSessionID = asNonEmptyString(sourceSessionId);
    const prompt = asNonEmptyString(payload.prompt);
    if (!sourceSessionID) throw new OpenChamberControlError('sessionId is required', 400);
    if (!prompt) throw new OpenChamberControlError('prompt is required', 400);
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) throw new OpenChamberControlError(goalInput.error, 400);
    let targetSessionID = sourceSessionID;
    let targetSession = null;
    let directory = null;
    try {
      directory = (await resolveDirectory(payload)).directory;
      if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

      await validateRequestedSelection({
        directory,
        requestedModel: resolveRequestedModel(payload),
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
      });

      const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
      const authHeaders = getOpenCodeAuthHeaders();
      const client = createClient({ baseUrl, headers: authHeaders });
      if (action === 'fork') {
        const response = await client.session.fork({
          sessionID: sourceSessionID,
          directory,
          ...(asNonEmptyString(payload.messageId) ? { messageID: payload.messageId.trim() } : {}),
        });
        targetSession = response?.data;
        if (!targetSession?.id) throw new Error('failed to fork session');
        targetSessionID = targetSession.id;
      }
      const baselineAssistantMessageId = await latestAssistantMessageID({
        client,
        sessionID: targetSessionID,
        directory,
      });
      const dispatch = await dispatchPrompt({
        client,
        baseUrl,
        authHeaders,
        sessionID: targetSessionID,
        directory,
        prompt,
        goalInput,
        requestedModel: resolveRequestedModel(payload),
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
        reuseSessionSelection: true,
      });
      const result = {
        serverId,
        action,
        sessionId: targetSessionID,
        directory,
        ...(action === 'fork' ? { sourceSessionId: sourceSessionID } : {}),
        ...(targetSession?.title ? { title: targetSession.title } : {}),
        ...(baselineAssistantMessageId ? { baselineAssistantMessageId } : {}),
        model: dispatch.model,
        ...(dispatch.agent ? { agent: dispatch.agent } : {}),
        ...(dispatch.variant ? { variant: dispatch.variant } : {}),
        promptDispatched: dispatch.promptDispatched,
        ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
        dispatchedAsCommand: dispatch.dispatchedAsCommand,
        ...(goalInput.enabled ? { goalEnabled: true } : {}),
        ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
      };
      if (action === 'fork') {
        try {
          emitSessionCreatedEvent?.({
            serverId,
            sessionID: targetSessionID,
            sourceSessionID,
            directory,
            ...result,
            createdAt: Date.now(),
          });
        } catch {
        }
      }
      return result;
    } catch (error) {
      const forkCreated = action === 'fork' && targetSessionID !== sourceSessionID;
      const goalConfigured = error?.goalConfigured === true;
      throw new OpenChamberControlError(
        error instanceof Error ? error.message : `Failed to ${action} session`,
        Number(error?.statusCode) || 500,
        forkCreated || goalConfigured
          ? {
            partial: true,
            partialAction: forkCreated ? 'fork-created' : 'goal-configured',
            sessionId: targetSessionID,
            directory,
          }
          : {},
      );
    }
  };

  /**
   * Archive a batch of sessions in one request.
   *
   * The UI archives every session linked to a worktree before removing it.
   * Doing that from the browser costs one request per session plus a store
   * reconciliation between each of them, which is what made deleting a
   * worktree with many sessions take tens of seconds. Here the batch stays on
   * the server, next to OpenCode, and the client reconciles once.
   *
   * Sessions are updated one at a time on purpose: they are archived against a
   * single OpenCode instance, and a fan-out of concurrent writes would trade a
   * UI stall for server event-loop starvation. One failed session never stops
   * the batch — it is reported in `failedIds` while the rest still archive, so
   * callers keep the partial-failure behaviour they already show.
   */
  const archive = async (payload = {}) => {
    assertLocalAuthority(payload);

    const rawIds = payload?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new OpenChamberControlError('ids must be a non-empty array of session ids', 400);
    }
    if (rawIds.length > 500) {
      throw new OpenChamberControlError('ids must contain at most 500 session ids', 400);
    }
    const ids = [];
    for (const value of rawIds) {
      const id = asNonEmptyString(value);
      if (!id) throw new OpenChamberControlError('ids must contain non-empty session ids', 400);
      ids.push(id);
    }

    const requestedArchivedAt = payload?.archivedAt;
    if (requestedArchivedAt !== undefined
      && (!Number.isSafeInteger(requestedArchivedAt) || requestedArchivedAt <= 0)) {
      throw new OpenChamberControlError('archivedAt must be a positive integer timestamp', 400);
    }
    const archivedAt = requestedArchivedAt ?? Date.now();

    const resolved = await resolveDirectory(payload);

    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

    const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
    const authHeaders = getOpenCodeAuthHeaders();
    const client = createClient({ baseUrl, headers: authHeaders });

    const archived = [];
    const failedIds = [];
    for (const sessionID of ids) {
      try {
        const response = await client.session.update({
          sessionID,
          directory: resolved.directory,
          time: { archived: archivedAt },
        });
        const session = response?.data;
        if (session?.id) archived.push(session);
        else failedIds.push(sessionID);
      } catch (error) {
        console.warn('[OpenChamberSessions] failed to archive session', sessionID, error);
        failedIds.push(sessionID);
      }
    }

    return { directory: resolved.directory, archived, failedIds };
  };

  return {
    create,
    send: (sessionID, payload) => runExisting('send', sessionID, payload),
    fork: (sessionID, payload) => runExisting('fork', sessionID, payload),
    archive,
    // Lazily-built stores, exposed for the v2-track switch and server wiring.
    get archiveStore() {
      return getArchiveStore();
    },
    get sessionMetadataStore() {
      return getSessionMetadataStore();
    },
    setMetadata,
    getMetadata,
  };
};
