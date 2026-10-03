import {
  V2_DIRECTORY_PARAM,
  V2_PROMPT_PATHS,
  isV2PromptTrack,
} from '../opencode/v2-prompt-dispatch.js';

const FETCH_TIMEOUT_MS = 15_000;
const MESSAGE_FETCH_LIMIT = 20;
const LOCAL_SERVER_ID = 'default';

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readContextState = (session) => {
  const metadata = isRecord(session?.metadata) ? session.metadata : {};
  const openchamber = isRecord(metadata.openchamber) ? metadata.openchamber : {};
  const messages = Array.isArray(openchamber.context_obligatory_messages)
    ? openchamber.context_obligatory_messages.filter((item) =>
      isRecord(item)
      && typeof item.id === 'string'
      && typeof item.createdAt === 'number'
      && (item.role === 'user' || item.role === 'assistant'))
    : [];
  return { metadata, openchamber, messages };
};

const buildContextPrompt = (entries) => {
  const timeline = entries.map(({ pinned, text }) => {
    const timestamp = new Date(pinned.createdAt).toISOString();
    return `## ${pinned.role} — ${timestamp}\n\n${text}`;
  }).join('\n\n---\n\n');
  return [
    'The following messages are from the compacted conversation. The user explicitly marked them as important and required in your context. Pay close attention to them; they may have been sent by either the user or you before compaction.',
    'Use them while continuing the pre-compaction work. Do not treat this context restoration as a new standalone task.',
    'If any tasks or next steps remain, do not acknowledge, summarize, or mention this restored context in a separate response. Simply continue the work and use it silently as background context. Do not append a recap of it after completing those tasks. Only if no tasks or next steps remain, give the user a very brief summary of the important restored context in no more than one short paragraph, without lists or a detailed recap.',
    '',
    timeline,
  ].join('\n');
};

const resolveDirectory = (directoryHint, payload) => {
  const fromPayload = typeof payload?.properties?.directory === 'string'
    ? payload.properties.directory.trim()
    : '';
  if (fromPayload && fromPayload !== 'global') return fromPayload;
  const hint = typeof directoryHint === 'string' ? directoryHint.trim() : '';
  if (hint && hint !== 'global') return hint;
  return '';
};

export const createContextObligatoryRuntime = ({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  resolveRemoteUpstream = null,
  sessionKnowledgeRuntime = null,
}) => {
  const inflight = new Set();
  let stopped = false;
  let remoteFanout = null;
  let unsubscribeRemote = null;

  const openCodeFetch = async (serverId, fetchPath, { directory, method = 'GET', body, query } = {}) => {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw new Error('directory is required for context-obligatory OpenCode calls');
    }

    const params = new URLSearchParams(query || {});
    params.set(isV2PromptTrack(serverId) ? V2_DIRECTORY_PARAM : 'directory', directory);
    const search = params.toString();
    let url;
    let authHeaders = {};

    if (serverId && serverId !== LOCAL_SERVER_ID) {
      const remote = typeof resolveRemoteUpstream === 'function'
        ? resolveRemoteUpstream(serverId)
        : null;
      if (!remote?.baseUrl) {
        throw new Error(`remote server ${serverId} is unavailable`);
      }
      const base = String(remote.baseUrl).replace(/\/$/, '');
      const normalizedPath = fetchPath.startsWith('/') ? fetchPath : `/${fetchPath}`;
      url = `${base}/api${normalizedPath}${search ? `?${search}` : ''}`;
      authHeaders = isRecord(remote.headers) ? remote.headers : {};
    } else {
      url = `${buildOpenCodeUrl(fetchPath, '')}${search ? `?${search}` : ''}`;
      authHeaders = typeof getOpenCodeAuthHeaders === 'function' ? getOpenCodeAuthHeaders() : {};
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenCode ${method} ${fetchPath} failed with ${response.status}`);
    return response.json().catch(() => null);
  };

  const tick = async (sessionId, directory, serverId) => {
    const session = await openCodeFetch(serverId, `/session/${encodeURIComponent(sessionId)}`, { directory });
    if (session?.parentID) return;
    const state = readContextState(session);
    const knowledge = serverId === LOCAL_SERVER_ID && sessionKnowledgeRuntime
      ? await sessionKnowledgeRuntime
        .resolvePending(directory, sessionKnowledgeRuntime.readDeliveredSignature(session), sessionKnowledgeRuntime.readPins(session))
        .catch(() => ({ text: '', signature: '' }))
      : { text: '', signature: '' };
    if (state.messages.length === 0 && !knowledge.text) return;

    const recent = await openCodeFetch(serverId, `/session/${encodeURIComponent(sessionId)}/message`, {
      directory,
      query: { limit: String(MESSAGE_FETCH_LIMIT) },
    });
    if (!Array.isArray(recent) || recent.length === 0) return;
    const summary = recent.toReversed().find((message) =>
      message?.info?.role === 'assistant' && message.info.summary === true)?.info;
    if (!summary?.id || !summary?.time?.completed) return;
    if (state.openchamber.context_obligatory_last_compaction_message_id === summary.id) return;

    const fetched = await Promise.allSettled(state.messages.map(async (pinned) => {
      const message = await openCodeFetch(
        serverId,
        `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(pinned.id)}`,
        { directory },
      );
      const text = Array.isArray(message?.parts)
        ? message.parts.filter((part) => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text.trim()).filter(Boolean).join('\n\n')
        : '';
      return { pinned, text };
    }));
    const entries = fetched
      .filter((result) => result.status === 'fulfilled' && result.value.text)
      .map((result) => result.value)
      .sort((left, right) => left.pinned.createdAt - right.pinned.createdAt);
    if (entries.length === 0 && !knowledge.text) return;

    const executionInfo = recent.toReversed().find((message) =>
      message?.info?.role === 'assistant' && message.info.summary !== true)?.info;
    const providerID = typeof executionInfo?.providerID === 'string' ? executionInfo.providerID : '';
    const modelID = typeof executionInfo?.modelID === 'string' ? executionInfo.modelID : '';
    if (!providerID || !modelID) throw new Error('no pre-compaction assistant provider/model');
    const agent = typeof executionInfo.agent === 'string' ? executionInfo.agent : executionInfo.mode;
    const restoreText = [knowledge.text, entries.length > 0 ? buildContextPrompt(entries) : '']
      .filter(Boolean)
      .join('\n\n---\n\n');
    if (isV2PromptTrack(serverId)) {
      // The restore text IS the dispatch: v2 has no synthetic-only prompt, so
      // the selection is switched onto the session record and the text is
      // admitted as one waking synthetic (resume defaults to true — the turn
      // must start, unlike the parked pre-prompts other senders admit).
      await openCodeFetch(serverId, V2_PROMPT_PATHS.switchModel(sessionId), {
        directory,
        method: 'POST',
        body: { model: { providerID, id: modelID } },
      });
      if (typeof agent === 'string' && agent) {
        await openCodeFetch(serverId, V2_PROMPT_PATHS.switchAgent(sessionId), {
          directory,
          method: 'POST',
          body: { agent },
        });
      }
      await openCodeFetch(serverId, V2_PROMPT_PATHS.synthetic(sessionId), {
        directory,
        method: 'POST',
        body: { text: restoreText },
      });
    } else {
      await openCodeFetch(serverId, `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        directory,
        method: 'POST',
        body: {
          model: { providerID, modelID },
          ...(typeof agent === 'string' && agent ? { agent } : {}),
          parts: [{
            type: 'text',
            text: restoreText,
            synthetic: true,
          }],
        },
      });
    }

    const fresh = await openCodeFetch(serverId, `/session/${encodeURIComponent(sessionId)}`, { directory });
    const freshState = readContextState(fresh);
    await openCodeFetch(serverId, `/session/${encodeURIComponent(sessionId)}`, {
      directory,
      method: 'PATCH',
      body: {
        metadata: {
          ...freshState.metadata,
          openchamber: {
            ...freshState.openchamber,
            context_obligatory_last_compaction_message_id: summary.id,
            ...(knowledge.signature
              ? { [sessionKnowledgeRuntime.metadataKey]: knowledge.signature }
              : {}),
          },
        },
      },
    });
  };

  const processPayload = (payload, directoryHint = '', serverIdHint = LOCAL_SERVER_ID) => {
    if (stopped || payload?.type !== 'session.compacted') return;
    const sessionId = payload?.properties?.sessionID;
    if (typeof sessionId !== 'string' || !sessionId) return;

    const serverId = typeof serverIdHint === 'string' && serverIdHint.trim()
      ? serverIdHint.trim()
      : LOCAL_SERVER_ID;
    const directory = resolveDirectory(directoryHint, payload);
    if (!directory) {
      console.warn(`[context-obligatory] missing directory for session ${sessionId} on ${serverId}`);
      return;
    }

    const inflightKey = `${serverId}::${sessionId}`;
    if (inflight.has(inflightKey)) return;
    inflight.add(inflightKey);
    return tick(sessionId, directory, serverId)
      .catch((error) => console.warn('[context-obligatory] injection failed:', error?.message || error))
      .finally(() => inflight.delete(inflightKey));
  };

  const bindRemoteFanout = (fanout) => {
    if (unsubscribeRemote) {
      unsubscribeRemote();
      unsubscribeRemote = null;
    }
    remoteFanout = fanout || null;
    if (!remoteFanout || typeof remoteFanout.subscribe !== 'function') {
      return;
    }
    unsubscribeRemote = remoteFanout.subscribe((event) => {
      if (stopped) return;
      const raw = event?.payload;
      const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
      if (!payload || typeof payload !== 'object') return;
      const serverId = typeof event?.serverId === 'string' && event.serverId.trim()
        ? event.serverId.trim()
        : '';
      if (!serverId || serverId === LOCAL_SERVER_ID) return;
      const directory = typeof event?.directory === 'string' && event.directory && event.directory !== 'global'
        ? event.directory
        : '';
      processPayload(payload, directory, serverId);
    });
  };

  const stop = () => {
    stopped = true;
    if (unsubscribeRemote) {
      unsubscribeRemote();
      unsubscribeRemote = null;
    }
    if (remoteFanout && typeof remoteFanout.close === 'function') {
      remoteFanout.close();
    }
    remoteFanout = null;
    inflight.clear();
  };

  return { processPayload, bindRemoteFanout, stop };
};
