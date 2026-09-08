/**
 * Pure protocol helpers for the OpenChamber chat participant (issue #200).
 * No vscode imports so these stay unit-testable under plain node/bun.
 *
 * Wire shapes (mirrors of the OpenCode v2 API used by the web UI):
 * - Send: POST /session/{sessionID}/prompt_async?directory=<enc>
 *     body { messageID, parts: [{ id, type: 'text', text }] }
 * - Events: SSE GET /api/event, each `data:` line is JSON
 *     { type: 'session.idle', properties: { sessionID } }
 *     { type: 'message.part.updated', properties: { sessionID?, part } }
 *     { type: 'message.part.delta', properties: { sessionID?, messageID, partID, field, delta } }
 */

export type ChatEventEnvelope = {
  type: string;
  properties?: unknown;
};

/** Incremental SSE frame parser: feed decoded chunks, get complete `data:` payloads. */
export class SseDataParser {
  private buffer = '';

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];
    let boundary = this.buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = this.buffer.slice(0, boundary).replace(/\r$/, '');
      this.buffer = this.buffer.slice(boundary + 1);
      if (line.startsWith('data:')) {
        payloads.push(line.slice(5).trimStart());
      }
      boundary = this.buffer.indexOf('\n');
    }
    return payloads;
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    if (rest.startsWith('data:')) {
      return [rest.slice(5).trimStart()];
    }
    return [];
  }
}

/** Format a native chat reference/attachment into markdown we can append to the prompt. */
export const formatReferenceForPrompt = (reference: { id?: string; value?: unknown }): string | null => {
  const value = reference.value;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    const uriLike = value as { scheme?: unknown; path?: unknown; fsPath?: unknown; toString?: () => unknown };
    const path = typeof uriLike.fsPath === 'string' ? uriLike.fsPath : typeof uriLike.path === 'string' ? uriLike.path : null;
    if (path && path.length > 0) {
      return `\`${path}\``;
    }
    const asText = typeof uriLike.toString === 'function' ? uriLike.toString() : null;
    if (typeof asText === 'string' && asText.length > 0 && asText !== '[object Object]') {
      return asText;
    }
  }
  return null;
};

export const composePromptText = (prompt: string, references: ReadonlyArray<{ id?: string; value?: unknown }>): string => {
  const blocks: string[] = [];
  for (const reference of references) {
    const formatted = formatReferenceForPrompt(reference);
    if (formatted) {
      blocks.push(formatted);
    }
  }
  const text = prompt.trim();
  if (blocks.length === 0) {
    return text;
  }
  const context = blocks.join('\n\n');
  return text.length > 0
    ? `${text}\n\n---\nAttached context:\n\n${context}`
    : `Review the following attached context.\n\n---\n\n${context}`;
};

type UpdatablePart = {
  id: string;
  messageID?: string;
  type?: string;
  text?: unknown;
};

type PartUpdatedEvent = { sessionID?: string; part: UpdatablePart };
type PartDeltaEvent = { sessionID?: string; messageID: string; partID: string; field: string; delta: string };

const readEventProperties = (event: ChatEventEnvelope): Record<string, unknown> | null => {
  const properties = event.properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : null;
};

export const readIdleSessionId = (event: ChatEventEnvelope): string | null => {
  if (event.type !== 'session.idle') return null;
  const sessionId = (readEventProperties(event) as { sessionID?: unknown } | null)?.sessionID;
  return typeof sessionId === 'string' ? sessionId : null;
};

/**
 * Accumulates the assistant's streamed text for one session and yields only
 * the newly-arrived suffix on each feed — so the participant can push clean
 * incremental markdown chunks into the native chat response stream.
 *
 * The directory event stream carries user messages too (including our own
 * prompt), so parts are gated on the message role learned from
 * `message.updated` events; only assistant messages are streamed.
 */
export class AssistantTextStream {
  private parts = new Map<string, string>();
  private emitted = '';
  private assistantMessageIds = new Set<string>();

  /** Record a message's role from a message.updated event. */
  noteMessage(event: ChatEventEnvelope): void {
    if (event.type !== 'message.updated') return;
    const info = (readEventProperties(event) as { info?: { id?: unknown; role?: unknown } } | null)?.info;
    if (!info || typeof info.id !== 'string') return;
    if (info.role === 'assistant') {
      this.assistantMessageIds.add(info.id);
    }
  }

  /** Feed one event; returns new text to emit, or null. */
  feed(event: ChatEventEnvelope, sessionID: string): string | null {
    if (event.type === 'message.part.updated') {
      const props = readEventProperties(event) as PartUpdatedEvent | null;
      const part = props?.part;
      if (!part || typeof part.id !== 'string') return null;
      const partSession = props?.sessionID;
      if (partSession && partSession !== sessionID) return null;
      if (part.type !== 'text') return null;
      const messageID = typeof part.messageID === 'string' ? part.messageID : '';
      if (!messageID || !this.assistantMessageIds.has(messageID)) return null;
      const text = typeof part.text === 'string' ? part.text : '';
      this.parts.set(part.id, text);
      return this.drain();
    }
    if (event.type === 'message.part.delta') {
      const props = readEventProperties(event) as PartDeltaEvent | null;
      if (!props || props.partID === undefined || props.field !== 'text') return null;
      if (props.sessionID && props.sessionID !== sessionID) return null;
      if (!this.assistantMessageIds.has(props.messageID)) return null;
      const current = this.parts.get(props.partID) ?? '';
      this.parts.set(props.partID, current + (typeof props.delta === 'string' ? props.delta : ''));
      return this.drain();
    }
    return null;
  }

  private drain(): string | null {
    let full = '';
    for (const text of this.parts.values()) {
      full += text;
    }
    if (full.length <= this.emitted.length) return null;
    const delta = full.slice(this.emitted.length);
    this.emitted = full;
    return delta;
  }

  get hasOutput(): boolean {
    return this.emitted.length > 0;
  }
}
