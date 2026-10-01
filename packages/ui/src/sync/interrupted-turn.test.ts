import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2/client';
import { settleInterruptedTurn, type InterruptedTurnState } from './interrupted-turn';

const assistant = (completed?: number): Message => ({
  id: 'msg_1',
  sessionID: 'ses_1',
  role: 'assistant',
  time: { created: 1, ...(completed === undefined ? {} : { completed }) },
}) as Message;

const state = (message = assistant()): InterruptedTurnState => ({
  session_status: { ses_1: { type: 'idle' } },
  message: { ses_1: [message] },
  part: {},
  form: {},
  permission: {},
});

describe('settleInterruptedTurn', () => {
  test('completes an unfinished assistant after authoritative idle', () => {
    const result = settleInterruptedTurn(state(), 'ses_1', 5000);
    const next = result?.messages[0];
    expect(next?.role).toBe('assistant');
    if (next?.role !== 'assistant') throw new Error('Expected assistant');
    expect(next.time.completed).toBe(5000);
    expect(next.error?.name).toBe('MessageAbortedError');
  });

  test('finalizes pending tools while preserving completed tools', () => {
    const pending = {
      id: 'prt_pending', messageID: 'msg_1', sessionID: 'ses_1', type: 'tool', tool: 'bash', callID: 'call_1',
      state: { status: 'running', input: {}, time: { start: 100 } },
    } as Part;
    const completed = {
      id: 'prt_done', messageID: 'msg_1', sessionID: 'ses_1', type: 'tool', tool: 'read', callID: 'call_2',
      state: { status: 'completed', input: {}, output: 'ok', title: 'done', metadata: {}, time: { start: 100, end: 200 } },
    } as Part;
    const input = state();
    input.part.msg_1 = [pending, completed];

    const result = settleInterruptedTurn(input, 'ses_1', 5000);
    expect((result?.parts?.[0] as Extract<Part, { type: 'tool' }>).state.status).toBe('error');
    expect(result?.parts?.[1]).toBe(completed);
  });

  test('does not settle busy, completed, blocked, or user-tailed turns', () => {
    const busy = state();
    busy.session_status.ses_1 = { type: 'busy' };
    expect(settleInterruptedTurn(busy, 'ses_1')).toBeNull();
    expect(settleInterruptedTurn(state(assistant(100)), 'ses_1')).toBeNull();
    const blocked = state();
    blocked.form.ses_1 = [{ id: 'q1' } as never];
    expect(settleInterruptedTurn(blocked, 'ses_1')).toBeNull();
    const userTail = state();
    userTail.message.ses_1.push({ id: 'msg_2', sessionID: 'ses_1', role: 'user', time: { created: 2 } } as Message);
    expect(settleInterruptedTurn(userTail, 'ses_1')).toBeNull();
  });
});
