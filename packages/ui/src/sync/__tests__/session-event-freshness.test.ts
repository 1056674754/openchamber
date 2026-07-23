import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { shouldSkipStaleSessionEvent } from '../session-event-freshness';

const buildSession = (title: string, time: Partial<Session['time']>): Session => ({
  id: 'ses_1',
  title,
  time: time as Session['time'],
} as Session);

describe('shouldSkipStaleSessionEvent', () => {
  test('skips an older update after a newer rename response', () => {
    const current = buildSession('New Title', { created: 1, updated: 20 });
    const incoming = buildSession('Old Title', { created: 1, updated: 10 });

    expect(shouldSkipStaleSessionEvent(current, incoming)).toBe(true);
  });

  test('allows equal or newer updates', () => {
    const current = buildSession('Current', { created: 1, updated: 20 });

    expect(shouldSkipStaleSessionEvent(current, buildSession('Equal', { created: 1, updated: 20 }))).toBe(false);
    expect(shouldSkipStaleSessionEvent(current, buildSession('Newer', { created: 1, updated: 21 }))).toBe(false);
  });

  test('falls back to creation time when updated is absent', () => {
    const current = buildSession('Current', { created: 20 });
    const incoming = buildSession('Incoming', { created: 10 });

    expect(shouldSkipStaleSessionEvent(current, incoming)).toBe(true);
  });
});
