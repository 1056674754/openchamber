import * as vscode from 'vscode';
import type { OpenCodeManager } from './opencode';
import {
  AssistantTextStream,
  SseDataParser,
  composePromptText,
  readIdleSessionId,
  type ChatEventEnvelope,
} from './chat-participant-protocol';

export const OPENCHAMBER_PARTICIPANT_ID = 'sscity.openchamber';

const TURN_TIMEOUT_MS = 10 * 60_000;
// An idle event with no assistant activity only settles the turn once this
// much time has passed since the prompt — an unrelated idle from a turn that
// was already running when we sent must not end our stream early.
const IDLE_GRACE_MS = 3_000;

type ParticipantDeps = {
  context: vscode.ExtensionContext;
  manager: OpenCodeManager;
  /** The sidebar webview's active OpenChamber session, if any. */
  getCurrentSessionId: () => string | null;
  /** Directory the managed OpenCode server runs in. */
  getWorkingDirectory: () => string;
};

const apiBase = (manager: OpenCodeManager): string | null => {
  const url = manager.getApiUrl();
  return url ? url.replace(/\/+$/, '') : null;
};

const authHeaders = (manager: OpenCodeManager): Record<string, string> => manager.getOpenCodeAuthHeaders() || {};

const createSession = async (manager: OpenCodeManager, directory: string): Promise<string> => {
  const base = apiBase(manager);
  if (!base) throw new Error('OpenCode API is not ready');
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(manager) },
    body: JSON.stringify({ directory, title: 'VS Code Chat' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`session.create failed: ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
  }
  const data = await response.json().catch(() => null) as { data?: { id?: unknown }; id?: unknown } | null;
  const sessionId = data?.data?.id ?? data?.id;
  if (typeof sessionId !== 'string') {
    throw new Error('session.create returned no session id');
  }
  return sessionId;
};

const sendPrompt = async (
  manager: OpenCodeManager,
  sessionID: string,
  directory: string,
  messageID: string,
  text: string,
): Promise<void> => {
  const base = apiBase(manager);
  if (!base) throw new Error('OpenCode API is not ready');
  const response = await fetch(
    `${base}/session/${encodeURIComponent(sessionID)}/prompt_async?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(manager) },
      body: JSON.stringify({
        messageID,
        parts: [{ id: `prt_${Date.now()}_1`, type: 'text', text }],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`prompt_async failed: ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
  }
};

/**
 * Streams one assistant turn into the native chat response. The event stream
 * is opened before the prompt is sent so no reply events are missed, and the
 * turn ends on the session's idle event once assistant output has been seen
 * (or after a grace window for legitimately empty replies).
 */
const streamAssistantTurn = async (
  manager: OpenCodeManager,
  sessionID: string,
  messageID: string,
  text: string,
  directory: string,
  emit: (chunk: string) => void,
  token: vscode.CancellationToken,
): Promise<boolean> => {
  const base = apiBase(manager);
  if (!base) throw new Error('OpenCode API is not ready');

  const controller = new AbortController();
  const turnTimer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  const cancelSubscription = token.onCancellationRequested(() => controller.abort());

  try {
    // The directory event stream (/event?directory=) is the one that carries
    // assistant message parts and session idle; the global /api/event stream
    // only carries a subset (verified live against the managed server).
    const eventResponse = await fetch(`${base}/event?directory=${encodeURIComponent(directory)}`, {
      headers: { Accept: 'text/event-stream', ...authHeaders(manager) },
      signal: controller.signal,
    });
    if (!eventResponse.ok || !eventResponse.body) {
      throw new Error(`event stream failed: ${eventResponse.status}`);
    }

    const stream = new AssistantTextStream();
    const parser = new SseDataParser();
    let sawAssistantOutput = false;
    let promptSentAt = 0;

    const consumeEvent = (event: ChatEventEnvelope): boolean => {
      if (readIdleSessionId(event) === sessionID && promptSentAt > 0) {
        if (sawAssistantOutput) return true;
        return Date.now() - promptSentAt > IDLE_GRACE_MS;
      }
      stream.noteMessage(event);
      const delta = stream.feed(event, sessionID);
      if (delta) {
        sawAssistantOutput = true;
        emit(delta);
      }
      return false;
    };

    await sendPrompt(manager, sessionID, directory, messageID, text);
    promptSentAt = Date.now();

    const reader = eventResponse.body.getReader();
    const decoder = new TextDecoder();
    // Drain race window: events buffered server-side between the SSE open
    // and the prompt POST arrive here first; consumeEvent filters by session
    // and by the idle/activity rules above.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let settled = false;
      for (const payload of parser.feed(decoder.decode(value, { stream: true }))) {
        let parsed: ChatEventEnvelope | null = null;
        try {
          parsed = JSON.parse(payload) as ChatEventEnvelope;
        } catch {
          continue;
        }
        if (consumeEvent(parsed)) {
          settled = true;
          break;
        }
      }
      if (settled) break;
    }
    return sawAssistantOutput;
  } finally {
    clearTimeout(turnTimer);
    cancelSubscription.dispose();
    controller.abort();
  }
};

export function registerOpenChamberChatParticipant(deps: ParticipantDeps): void {
  const { context, manager } = deps;

  const participant = vscode.chat.createChatParticipant(OPENCHAMBER_PARTICIPANT_ID, async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => {
    if (!apiBase(manager)) {
      response.markdown('OpenChamber is still connecting to the OpenCode server — try again in a moment.');
      return;
    }

    const directory = deps.getWorkingDirectory();
    const promptText = composePromptText(request.prompt ?? '', Array.from(request.references ?? []));
    if (!promptText) {
      response.markdown(
        'Type a message, or attach context (e.g. **Add Element to Chat** from the integrated browser) and send it again.',
      );
      return;
    }

    let sessionID = deps.getCurrentSessionId();
    let createdSession = false;
    if (!sessionID) {
      try {
        sessionID = await createSession(manager, directory);
        createdSession = true;
      } catch (error) {
        response.markdown(`Failed to create an OpenChamber session: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    const messageID = `msg_${Date.now()}_vscodechat_${Math.random().toString(36).slice(2, 6)}`;
    let producedOutput = false;
    try {
      producedOutput = await streamAssistantTurn(
        manager,
        sessionID,
        messageID,
        promptText,
        directory,
        (chunk) => response.markdown(chunk),
        token,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.markdown(`\n\n**OpenChamber turn failed:** ${message}`);
      return;
    }

    if (!producedOutput) {
      response.markdown('_The turn finished without streamed output — open the OpenChamber sidebar for the full transcript._');
    }
    if (createdSession) {
      response.markdown('\n\n_A new OpenChamber conversation was created for this chat._');
    }
  });

  const iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.svg');
  participant.iconPath = { light: iconPath, dark: iconPath };

  context.subscriptions.push(participant);
}
