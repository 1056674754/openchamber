import type { Message, Part } from '@opencode-ai/sdk/v2/client';
import type { DirectoryStore } from './child-store';

export type InterruptedTurnState = Pick<
  DirectoryStore,
  'session_status' | 'message' | 'part' | 'question' | 'permission'
>;

export type InterruptedTurnSettlement = {
  messageID: string;
  messages: Message[];
  parts?: Part[];
};

export const settleInterruptedTurn = (
  state: InterruptedTurnState,
  sessionID: string,
  now = Date.now(),
): InterruptedTurnSettlement | null => {
  if (state.session_status?.[sessionID]?.type !== 'idle') return null;
  if ((state.question?.[sessionID] ?? []).length > 0) return null;
  if ((state.permission?.[sessionID] ?? []).length > 0) return null;

  const messages = state.message[sessionID] ?? [];
  let messageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === 'user') return null;
    if (candidate.role === 'assistant') {
      messageIndex = index;
      break;
    }
  }
  if (messageIndex < 0) return null;

  const message = messages[messageIndex];
  if (message.role !== 'assistant' || message.time.completed !== undefined) return null;

  const nextMessages = [...messages];
  nextMessages[messageIndex] = {
    ...message,
    time: { ...message.time, completed: now },
    error: {
      name: 'MessageAbortedError',
      data: { message: 'aborted' },
    },
  };

  let partsChanged = false;
  const currentParts = state.part[message.id];
  const nextParts = currentParts?.map((part) => {
    if (part.type !== 'tool') return part;
    if (part.state.status !== 'pending' && part.state.status !== 'running') return part;
    partsChanged = true;
    const partTime = 'time' in part.state ? part.state.time : undefined;
    const start = typeof partTime?.start === 'number' ? partTime.start : now;
    return {
      ...part,
      state: {
        ...part.state,
        status: 'error' as const,
        error: 'Interrupted',
        time: { start, end: now },
      },
    };
  });

  return {
    messageID: message.id,
    messages: nextMessages,
    parts: partsChanged ? nextParts : undefined,
  };
};
