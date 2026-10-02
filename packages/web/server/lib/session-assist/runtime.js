// Session assist: passive recap + suggested-next-message watcher.
//
// Purely event-driven (no scans/backfill): on session idle a single quiet
// timer arms; busy/retry or a fresh user message cancels it. When the timer
// fires the small model produces a recap + suggested next user message from
// the last few human turns, written to metadata.openchamber.assist with the
// targeted assistant message id so the UI can freshness-gate it.
//
// Context collection and prompt construction live in context.js / prompt.js
// (ported from upstream a16d947a0: bounded recent human turns so recaps
// survive short closing exchanges, annotation-aware attached context, and
// prompt budgeting against the small model's input budget).
//
// Fork boundary (sscity): mirrors session-goal's local-hub authority — the
// runtime only processes events whose serverId is the local default hub. A
// remote instance's events never arm a timer here, never fetch through local
// OpenCode, and never patch local metadata. restrictToPreferredProvider is
// set so the assist never silently crosses to another provider subscription
// (owner chose policy A: an explicit small-model override is informed consent
// to cross, see MERGE_V1.12.md batch H).

import { collectRecentTurns } from './context.js';
import { buildAssistPrompt, buildAssistSystemPrompt } from './prompt.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from '../opencode/protocol-mode.js';

const LOCAL_SERVER_ID = 'default';
const IDLE_QUIET_MS = 60_000;
const MESSAGE_FETCH_LIMIT = 12;
// Context window for turn collection: enough for three human turns with
// interleaved closing exchanges, trimmed locally by collectRecentTurns.
const CONTEXT_MESSAGE_LIMIT = 40;
const RECAP_MAX_CHARS = 320;
const SUGGESTION_MAX_CHARS = 500;
const FETCH_TIMEOUT_MS = 10_000;
const ASSIST_NAMESPACE = 'assist';

const extractJsonObject = (value) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const hasDisallowedScript = (text, sourceText) => {
  // Drop a generated field if it introduces a script (e.g. Cyrillic/CJK) the
  // conversation did not use — a common cross-language model failure.
  const collect = (s) => {
    const set = new Set();
    for (const ch of String(s || '')) {
      const code = ch.codePointAt(0);
      if (code >= 0x0400 && code <= 0x04ff) set.add('cyrillic');
      else if (code >= 0x3000 && code <= 0x9fff) set.add('cjk');
      else if (code >= 0xac00 && code <= 0xd7af) set.add('hangul');
    }
    return set;
  };
  const source = collect(sourceText);
  const target = collect(text);
  for (const script of target) {
    if (!source.has(script)) return true;
  }
  return false;
};

const clampText = (value, max) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
};

export const createSessionAssistRuntime = ({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  getSmallModelService,
  readSettings,
  quietMs = IDLE_QUIET_MS,
}) => {
  const timers = new Map();
  const inflight = new Set();
  // Sessions holding an assist this process wrote, keyed to their directory
  // (upstream segb cb7400923). Only the v2 track retires on a new turn; the
  // v1 track keeps today's overwrite-only behavior byte-stable.
  const persisted = new Map();
  let stopped = false;

  const clearTimer = (sessionId) => {
    const existing = timers.get(sessionId);
    if (existing) {
      clearTimeout(existing.timer);
      timers.delete(sessionId);
    }
  };

  const openCodeFetch = async (fetchPath, { directory, method = 'GET', body, query } = {}) => {
    const base = buildOpenCodeUrl(fetchPath, '');
    const params = new URLSearchParams(query || {});
    if (directory) params.set('directory', directory);
    const search = params.toString();
    const url = search ? `${base}?${search}` : base;
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...getOpenCodeAuthHeaders(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenCode ${method} ${fetchPath} failed with ${response.status}`);
    }
    return response.json().catch(() => null);
  };

  const fetchSession = async (sessionId, directory) => {
    const session = await openCodeFetch(`/session/${encodeURIComponent(sessionId)}`, { directory }).catch(() => null);
    return session && typeof session === 'object' ? session : null;
  };

  const fetchRecentMessages = async (sessionId, directory) => {
    const messages = await openCodeFetch(`/session/${encodeURIComponent(sessionId)}/message`, {
      directory,
      query: { limit: String(MESSAGE_FETCH_LIMIT) },
    }).catch(() => null);
    return Array.isArray(messages) ? messages : null;
  };

  // Merge-write assist metadata from a FRESH session read so concurrent writes
  // (goal payloads, UI dismissal, UI goal edits) survive. Returns the written
  // assist, or null when the targeted assistant message is no longer the tail
  // (user sent a new message, or the session advanced while we worked).
  const writeAssist = async (sessionId, directory, expectedMessageId, nextAssist) => {
    const session = await fetchSession(sessionId, directory);
    if (!session) return null;
    const currentMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const currentNamespace = currentMetadata.openchamber && typeof currentMetadata.openchamber === 'object'
      ? currentMetadata.openchamber
      : {};

    // Tail guard: re-read messages and require the latest assistant id to still
    // match. Without this, a recap can land on an already-superseded turn.
    const messages = await fetchRecentMessages(sessionId, directory);
    if (!messages) return null;
    let tailAssistantId = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = messages[i]?.info?.role || messages[i]?.role;
      if (role === 'assistant' || role === 'user') {
        if (role === 'assistant') tailAssistantId = messages[i]?.id || messages[i]?.info?.id || null;
        break;
      }
    }
    if (tailAssistantId !== expectedMessageId) return null;

    const assist = { ...nextAssist, forMessageID: expectedMessageId, generatedAt: Date.now() };
    await openCodeFetch(`/session/${encodeURIComponent(sessionId)}`, {
      directory,
      method: 'PATCH',
      body: {
        metadata: {
          ...currentMetadata,
          openchamber: { ...currentNamespace, [ASSIST_NAMESPACE]: assist },
        },
      },
    });
    persisted.set(sessionId, directory);
    return assist;
  };

  // A new turn makes the stored recap and suggestion describe an older turn:
  // delete them so "has a suggestion" in metadata means the same everywhere
  // (upstream segb cb7400923). v2-gated: the v1 track keeps overwriting until
  // the next assist, exactly as before.
  const retireStored = (sessionId, directory) => {
    if (!persisted.has(sessionId)) return;
    const storedDirectory = persisted.get(sessionId);
    persisted.delete(sessionId);
    void (async () => {
      const session = await fetchSession(sessionId, directory || storedDirectory);
      const currentMetadata = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
      const currentNamespace = currentMetadata.openchamber && typeof currentMetadata.openchamber === 'object'
        ? currentMetadata.openchamber
        : {};
      if (!Object.prototype.hasOwnProperty.call(currentNamespace, ASSIST_NAMESPACE)) return;
      const nextNamespace = { ...currentNamespace };
      delete nextNamespace[ASSIST_NAMESPACE];
      await openCodeFetch(`/session/${encodeURIComponent(sessionId)}`, {
        directory: directory || storedDirectory,
        method: 'PATCH',
        body: {
          metadata: {
            ...currentMetadata,
            openchamber: nextNamespace,
          },
        },
      });
    })().catch(() => console.warn('[session-assist] failed to retire a stale assist'));
  };

  const generateAssist = async (sessionId, directory, armedAt) => {
    if (stopped || inflight.has(sessionId)) return;
    inflight.add(sessionId);
    try {
      // Cancel if the user sent a new message after the timer armed.
      if (!armedAt || Date.now() < armedAt) return;

      let settings = null;
      try {
        settings = await readSettings();
      } catch {
        settings = null;
      }
      const recapEnabled = settings?.sessionRecapEnabled !== false;
      const suggestionEnabled = settings?.sessionSuggestionEnabled !== false;
      if (!recapEnabled && !suggestionEnabled) return;

      const session = await fetchSession(sessionId, directory);
      if (!session) return;
      // Sub-agent / task sessions: skip (parent's conversation drives the recap).
      if (session.parentID) return;

      const messages = await openCodeFetch(`/session/${encodeURIComponent(sessionId)}/message`, {
        directory,
        query: { limit: String(CONTEXT_MESSAGE_LIMIT) },
      }).catch(() => null);
      if (!messages || messages.length === 0) return;

      // Bounded recent human turns with annotation-aware attached context;
      // null when no eligible final answer is inside the window.
      const context = collectRecentTurns(messages);
      if (!context) return;
      const { turns, last } = context;

      const lastAssistantId = last.id;
      const providerID = last.providerID || null;
      const modelID = last.modelID || null;

      const targets = { recap: recapEnabled, suggestion: suggestionEnabled };
      const system = buildAssistSystemPrompt(targets);

      // Budget the prompt against the answering small model's input budget,
      // reserving room for the system prompt and generation.
      let charBudget = 24_000;
      try {
        const smallModelService = await getSmallModelService();
        const described = await smallModelService.describeSmallModel({
          directory,
          preferredProviderID: providerID ?? undefined,
          preferredModelID: modelID ?? undefined,
        });
        if (Number.isFinite(described?.inputCharBudget)) charBudget = described.inputCharBudget;
      } catch {
        // Budgeting is best-effort; the fixed cap keeps generation alive.
      }
      const prompt = buildAssistPrompt(turns, targets, charBudget - system.length - 512);
      if (!prompt) return;

      const smallModelService = await getSmallModelService();
      const result = await smallModelService.generateSmallModelText({
        prompt: prompt.text,
        system,
        directory,
        ...(providerID ? { preferredProviderID: providerID } : {}),
        ...(modelID ? { preferredModelID: modelID } : {}),
        restrictToPreferredProvider: true,
        // The prompt above is pre-budgeted; silent truncation would corrupt
        // the JSON shape contract, so overflow must fail loudly instead.
        onOverflow: 'error',
      });

      const parsed = extractJsonObject(result?.text);
      if (!parsed) return;

      // Script guard: quoted source and assistant replies cannot authorize a
      // different script. With no authored language sample, fall back to the
      // full user-visible text of the collected turns.
      const languageSample = prompt.language
        || turns.map((turn) => turn.user.text).filter(Boolean).join('\n');

      const assist = {};
      if (recapEnabled) {
        const recap = clampText(parsed.recap, RECAP_MAX_CHARS);
        if (recap && !hasDisallowedScript(recap, languageSample)) assist.recap = recap;
      }
      if (suggestionEnabled) {
        const suggestion = clampText(parsed.suggestion, SUGGESTION_MAX_CHARS);
        if (suggestion && !hasDisallowedScript(suggestion, languageSample)) assist.suggestion = suggestion;
      }
      if (!assist.recap && !assist.suggestion) return;

      await writeAssist(sessionId, directory, lastAssistantId, assist);
    } catch (error) {
      console.warn('[session-assist] generation failed:', error?.message || error);
    } finally {
      inflight.delete(sessionId);
    }
  };

  const armTimer = (sessionId, directory) => {
    if (stopped) return;
    clearTimer(sessionId);
    const armedAt = Date.now() + quietMs;
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      void generateAssist(sessionId, directory, armedAt);
    }, quietMs);
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(sessionId, { timer, directory, armedAt });
  };

  const extractSessionStatus = (payload) => {
    const props = payload?.properties || payload;
    const sessionID = props?.sessionID || props?.sessionId || props?.info?.sessionID || props?.info?.sessionId;
    const status = props?.status?.type || props?.info?.type || props?.status || props?.info?.status;
    const directory = props?.directory || props?.info?.directory || '';
    if (!sessionID || !status) return null;
    return { sessionID, status, directory };
  };

  const extractUserMessage = (payload) => {
    const info = payload?.info || payload;
    if (info?.role !== 'user') return null;
    const sessionID = info?.sessionID || info?.sessionId || payload?.properties?.sessionID;
    const createdAt = info?.time?.created || info?.createdAt;
    if (!sessionID) return null;
    return { sessionID, createdAt: typeof createdAt === 'number' ? createdAt : null, directory: info?.directory || '' };
  };

  const processPayload = (payload, directoryHint = '', serverIdHint = LOCAL_SERVER_ID) => {
    if (stopped) return;
    const serverId = typeof serverIdHint === 'string' && serverIdHint.trim()
      ? serverIdHint.trim()
      : LOCAL_SERVER_ID;
    // Fork authority gate: only the local hub's events drive assist generation.
    // Remote instances own their own assist runtimes.
    if (serverId !== LOCAL_SERVER_ID) return;

    const raw = payload?.payload && typeof payload.payload === 'object' ? payload.payload : payload;
    if (!raw || typeof raw !== 'object') return;

    const directory = typeof directoryHint === 'string' && directoryHint && directoryHint !== 'global'
      ? directoryHint
      : '';

    const status = extractSessionStatus(raw);
    if (status) {
      const dir = status.directory || directory;
      if (status.status === 'idle') {
        armTimer(status.sessionID, dir);
      } else {
        clearTimer(status.sessionID);
        if (resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID) === 'v2') {
          retireStored(status.sessionID, dir);
        }
      }
      return;
    }

    const userMessage = extractUserMessage(raw);
    if (userMessage) {
      const existing = timers.get(userMessage.sessionID);
      // Only cancel if the user message landed at/after the arm time — older
      // stragglers must not cancel a fresh idle timer.
      if (existing && (!userMessage.createdAt || userMessage.createdAt >= existing.armedAt)) {
        clearTimer(userMessage.sessionID);
      }
    }
  };

  const stop = () => {
    stopped = true;
    for (const { timer } of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  return { processPayload, stop };
};
