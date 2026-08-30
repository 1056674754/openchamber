import { describe, expect, test } from 'bun:test';
import type { Message } from '@opencode-ai/sdk/v2/client';

import { insertMessageChronologically, messagesBefore, messagesFrom, sortMessagesChronologically } from './message-ordering';

const message = (id: string, created: number) => ({ id, sessionID: 'ses_1', role: 'user', time: { created } }) as Message;

describe('message chronology', () => {
  test('orders by creation time across fixed-width ID rollover', () => {
    const legacy = message('msg_ffffffffffffLegacy', 100);
    const current = message('msg_000000000000Current', 200);
    expect(sortMessagesChronologically([current, legacy])).toEqual([legacy, current]);
    const messages = [legacy];
    insertMessageChronologically(messages, current);
    expect(messages).toEqual([legacy, current]);
  });

  test('uses IDs only as an equal-time tie-breaker', () => {
    expect(sortMessagesChronologically([message('msg_b', 1), message('msg_a', 1)]).map((item) => item.id))
      .toEqual(['msg_a', 'msg_b']);
  });

  test('slices revert boundaries by marker position instead of lexical ID', () => {
    const before = message('msg_ffffffffffffBefore', 100);
    const marker = message('msg_000000000000Marker', 200);
    const after = message('msg_000000000001After', 300);
    expect(messagesBefore([before, marker, after], marker.id)).toEqual([before]);
    expect(messagesFrom([before, marker, after], marker.id)).toEqual([marker, after]);
  });
});
