import { afterEach, describe, expect, test } from 'bun:test';

import { serverRegistry } from '@/lib/opencode/server-registry';

import { resolveSessionKnowledgeApiUrl } from './sessionKnowledgeApi';

const REMOTE = 'session-knowledge-dev3';

afterEach(() => {
  serverRegistry.unregister(REMOTE);
});

describe('session knowledge request authority', () => {
  test('keeps local requests local', () => {
    expect(resolveSessionKnowledgeApiUrl('/api/session-knowledge')).toBe('/api/session-knowledge');
  });

  test('routes pins and delivery records to the explicit remote instance', () => {
    expect(resolveSessionKnowledgeApiUrl('/api/session-knowledge/pin', REMOTE))
      .toBe(`/api/remote/${REMOTE}/session-knowledge/pin`);
  });
});
