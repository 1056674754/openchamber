import { beforeEach, describe, expect, mock, test } from 'bun:test';

const responses: Array<Response | Error> = [];

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  }),
}));

mock.module('@/lib/api/serverUrl', () => ({
  resolveApiUrl: (path: string, serverBaseUrl?: string) =>
    serverBaseUrl ? `${serverBaseUrl}${path}` : path,
}));

const { requestSessionArchiveBatch } = await import('./session-archive-batch');

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('requestSessionArchiveBatch', () => {
  beforeEach(() => {
    responses.length = 0;
  });

  test('returns the archived sessions and per-session failures', async () => {
    responses.push(jsonResponse({
      archived: [{ id: 'ses_1', time: { archived: 10 } }, { id: 'ses_2', time: { archived: 10 } }],
      failedIds: ['ses_3'],
    }));

    const result = await requestSessionArchiveBatch('/repo', ['ses_1', 'ses_2', 'ses_3'], 10);

    expect(result).toEqual({
      outcome: 'archived',
      archived: [{ id: 'ses_1', time: { archived: 10 } }, { id: 'ses_2', time: { archived: 10 } }],
      failedIds: ['ses_3'],
    });
  });

  test('tells unavailable apart from archived for transport, status, and shape failures', async () => {
    responses.push(new Error('network down'));
    const transport = await requestSessionArchiveBatch('/repo', ['ses_1'], 10);
    expect(transport.outcome).toBe('unavailable');

    responses.push(jsonResponse({ error: 'nope' }, 501));
    const status = await requestSessionArchiveBatch('/repo', ['ses_1'], 10);
    expect(status.outcome).toBe('unavailable');
    expect(status.outcome === 'unavailable' && status.reason).toBe('archive request failed with 501');

    responses.push(jsonResponse({ archived: 'not-an-array', failedIds: [] }));
    const malformed = await requestSessionArchiveBatch('/repo', ['ses_1'], 10);
    expect(malformed.outcome).toBe('unavailable');
    expect(malformed.outcome === 'unavailable' && malformed.reason).toContain('malformed archive response');
  });
});
