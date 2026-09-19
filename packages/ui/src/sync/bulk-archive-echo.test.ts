import { describe, expect, test } from 'bun:test';
import type { Event } from '@opencode-ai/sdk/v2/client';
import {
  registerBulkArchiveEchoes,
  releaseBulkArchiveEchoes,
  shouldConsumeBulkArchiveEcho,
} from './bulk-archive-echo';

const sessionUpdated = (id: string, archivedAt: number): Event => ({
  type: 'session.updated',
  properties: {
    info: { id, time: { archived: archivedAt } },
  },
} as unknown as Event);

describe('bulk archive echo suppression', () => {
  test('consumes an echo whose archived timestamp matches the batch', () => {
    registerBulkArchiveEchoes('runtime-a', [{ id: 'ses_1', archivedAt: 100 }], 1_000);

    expect(shouldConsumeBulkArchiveEcho(sessionUpdated('ses_1', 100), 'runtime-a', 2_000)).toBe(true);
    releaseBulkArchiveEchoes('runtime-a', ['ses_1']);
    expect(shouldConsumeBulkArchiveEcho(sessionUpdated('ses_1', 100), 'runtime-a', 3_000)).toBe(false);
  });

  test('ignores events for other sessions and non-matching timestamps', () => {
    registerBulkArchiveEchoes('runtime-b', [{ id: 'ses_2', archivedAt: 200 }], 1_000);

    expect(shouldConsumeBulkArchiveEcho(sessionUpdated('ses_other', 200), 'runtime-b', 2_000)).toBe(false);
    expect(shouldConsumeBulkArchiveEcho(sessionUpdated('ses_2', 999), 'runtime-b', 2_000)).toBe(false);
  });

  test('expires echoes past the ttl', () => {
    registerBulkArchiveEchoes('runtime-c', [{ id: 'ses_3', archivedAt: 300 }], 1_000);

    expect(shouldConsumeBulkArchiveEcho(sessionUpdated('ses_3', 300), 'runtime-c', 1_000 + 60_000)).toBe(false);
  });

  test('ignores non session.updated events', () => {
    const removed = {
      type: 'session.deleted',
      properties: { info: { id: 'ses_4' } },
    } as unknown as Event;

    registerBulkArchiveEchoes('runtime-d', [{ id: 'ses_4', archivedAt: 400 }], 1_000);
    expect(shouldConsumeBulkArchiveEcho(removed, 'runtime-d', 2_000)).toBe(false);
  });
});
