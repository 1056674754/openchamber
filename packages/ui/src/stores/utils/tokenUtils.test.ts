import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import {
  contextTokensFromBreakdown,
  extractTokensFromMessage,
  sumTokenBreakdown,
} from './tokenUtils';

const assistantMessage = (tokens: unknown): { info: Message; parts: Part[] } => ({
  info: { tokens } as unknown as Message,
  parts: [],
});

describe('contextTokensFromBreakdown', () => {
  test('prefers the server final-round-trip total', () => {
    const breakdown = {
      total: 232_872,
      input: 0,
      output: 14_523,
      reasoning: 0,
      cache: { read: 3_291_956, write: 0 },
    };
    expect(contextTokensFromBreakdown(breakdown)).toBe(232_872);
    expect(sumTokenBreakdown(breakdown)).toBe(3_306_479);
  });

  test('falls back for older servers and invalid totals', () => {
    expect(contextTokensFromBreakdown({ input: 100, output: 50, cache: { read: 80 } })).toBe(230);
    expect(contextTokensFromBreakdown({ total: 0, input: 40 })).toBe(40);
    expect(contextTokensFromBreakdown({ total: Number.NaN, input: 40 })).toBe(40);
    expect(contextTokensFromBreakdown(undefined)).toBe(0);
  });
});

describe('extractTokensFromMessage', () => {
  test('uses reported totals from message info or parts', () => {
    expect(extractTokensFromMessage(assistantMessage({ total: 500, input: 2_000 }))).toBe(500);
    expect(extractTokensFromMessage({
      info: {} as Message,
      parts: [{ tokens: { total: 300, input: 1_000 } } as unknown as Part],
    })).toBe(300);
  });

  test('keeps numeric and empty legacy payloads compatible', () => {
    expect(extractTokensFromMessage(assistantMessage(1234))).toBe(1234);
    expect(extractTokensFromMessage({ info: {} as Message, parts: [] })).toBe(0);
  });
});
