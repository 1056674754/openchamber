// Conversation context for session assist, fork-adapted from upstream
// a16d947a0. Upstream pages the SDK client until three complete human turns
// are in view; the fork reads one bounded window (the runtime's message
// fetch) and applies the same turn-collection semantics to it. Message
// records here are the fork's `{ info, parts }` SDK v2 rows.

const TURN_LIMIT = 3;
const USER_CHAR_LIMIT = 8_000;
const ANSWER_CHAR_LIMIT = 16_000;

// Mirrors the persisted context contract owned by UI lib/messages/contextParts.ts.
// Read only the fields needed for model context; malformed attached text fails
// this generation instead of silently dropping the user's comment.
const QUOTE_FIELDS = new Map([
  ['code-comment', 'code'], ['file-quote', 'quote'], ['chat-quote', 'quote'],
  ['browser-annotation', 'prompt'], ['pr-comment', 'body'], ['pr-check', 'output'],
  ['terminal', 'output'],
]);
const LINK_KINDS = new Set(['github-issue', 'github-pr', 'linear-issue']);

export function excerpt(text, limit) {
  if (text.length <= limit) return text;
  const marker = '\n[Content omitted]\n';
  if (limit <= marker.length) return text.slice(0, Math.max(0, limit));
  const head = Math.ceil((limit - marker.length) / 2);
  const tail = limit - marker.length - head;
  return text.slice(0, head) + marker + (tail > 0 ? text.slice(-tail) : '');
}

function attachedText(part) {
  const context = part.metadata?.openchamberContext;
  if (QUOTE_FIELDS.has(context?.kind)) {
    const source = (context[QUOTE_FIELDS.get(context.kind)] ?? '').trim();
    const authored = (context.text ?? '').trim();
    const label = excerpt((context.fileLabel ?? context.label ?? context.pageUrl ?? context.terminalLabel ?? '').trim(), 300);
    const location = Number.isInteger(context.startLine) ? `, lines ${context.startLine}-${context.endLine ?? context.startLine}` : '';
    const quote = excerpt(source, 4_000).split('\n').map((line) => `> ${line}`).join('\n');
    return { text: `Attached ${context.kind}${label ? ` (${label}${location})` : ''}:\n${quote}\n\nUser comment:\n${excerpt(authored, USER_CHAR_LIMIT)}`, authored };
  }
  if (LINK_KINDS.has(context?.kind)) return { text: excerpt(part.text, USER_CHAR_LIMIT), authored: '' };
  const comment = part.metadata?.opencodeComment;
  if (comment) {
    const authored = comment.comment.trim();
    const source = (comment.preview ?? '').trim();
    const label = excerpt((comment.path ?? '').trim(), 300);
    return { text: `Attached file context (${label}):\n${excerpt(source, 4_000)}\n\nUser comment:\n${excerpt(authored, USER_CHAR_LIMIT)}`, authored };
  }
  return null;
}

/** SDK message records are chronological; tool payloads never enter this view. */
function readMessage(record) {
  const info = record?.info ?? record ?? {};
  const parts = Array.isArray(record?.parts) ? record.parts : (Array.isArray(info.parts) ? info.parts : []);
  const blocks = [];
  const authored = [];
  for (const part of parts) {
    if (part?.type !== 'text' || part.ignored) continue;
    const attached = info.role === 'user' ? attachedText(part) : null;
    if (attached) {
      blocks.push(attached.text);
      authored.push(attached.authored);
    } else if (!part.synthetic) {
      blocks.push(part.text);
      if (info.role === 'user') {
        // Legacy terminal selections are source material, not a language sample.
        authored.push(String(part.text ?? '').replace(/\n*<terminal_context>\n[\s\S]*?\n<\/terminal_context>\s*$/, ''));
      }
    }
  }
  return {
    id: info.id, role: info.role, parentID: info.parentID,
    providerID: info.providerID ?? info.providerId, modelID: info.modelID ?? info.modelId,
    complete: info.role === 'assistant' && info.finish === 'stop' && Boolean(info.time?.completed) && !info.error && !info.summary,
    summary: Boolean(info.summary),
    text: excerpt(blocks.join('\n\n').trim(), info.role === 'user' ? USER_CHAR_LIMIT : ANSWER_CHAR_LIMIT),
    authored: excerpt(authored.filter(Boolean).join('\n\n').trim(), USER_CHAR_LIMIT),
  };
}

function collectTurns(messages) {
  const turns = [];
  let active = null;
  let parents = new Set();
  for (const message of messages) {
    if (message.role === 'user' && message.text) {
      active = { user: message, assistant: null, complete: false };
      parents = new Set([message.id]);
      turns.push(active);
    } else if (active && message.role === 'user') {
      parents.add(message.id);
    } else if (active && message.role === 'assistant' && (message.parentID == null || parents.has(message.parentID)) && !message.summary) {
      // Compaction's synthetic continuation users belong to the same human
      // turn. Parent IDs alone would lose its eventual final answer. A
      // missing parentID (older rows) stays in the active turn rather than
      // dropping the answer entirely — the fork's pre-port behavior.
      if (message.text) active.assistant = message;
      active.complete = message.complete && Boolean(message.text);
    }
  }
  return turns.slice(-TURN_LIMIT);
}

/**
 * Collect the last human turns with annotation-aware context from a bounded,
 * chronological message window. Failure never throws here (the window either
 * holds the data or it does not); null means no eligible final answer.
 */
export function collectRecentTurns(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const messages = records.map(readMessage);
  const turns = collectTurns(messages);
  const last = messages.at(-1);
  if (!last?.complete || !last.text) return null;
  if (!turns.length || !turns.at(-1).complete || turns.at(-1).assistant.id !== last.id) return null;
  return { turns, last };
}
