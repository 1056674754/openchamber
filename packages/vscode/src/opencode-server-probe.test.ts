import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOpenCodeVersion, type OpenCodeProbeFetch } from './opencode-server-probe';

type MockResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
};

type RecordedCall = { url: string; init?: RequestInit };

const createFetchMock = (handlers: Array<{ match: string; respond: MockResponse | Error }>) => {
  const calls: RecordedCall[] = [];
  const fetchMock: OpenCodeProbeFetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = handlers.find((entry) => url.endsWith(entry.match))
      ?? handlers.find((entry) => entry.match === '*');
    if (!handler) {
      throw new Error(`unexpected probe URL: ${url}`);
    }
    if (handler.respond instanceof Error) {
      throw handler.respond;
    }
    const response = handler.respond;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: response.statusText ?? '',
      json: response.json ?? (async () => null),
    } as unknown as Response;
  };
  return { calls, fetchMock };
};

const probePaths = (calls: RecordedCall[]) => calls.map((call) => new URL(call.url).pathname);

describe('probeOpenCodeVersion', () => {
  test('answers from /api/info on a v2 server without touching /global/health', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { json: async () => ({ version: '2.0.14-sscity', pid: 4242 }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock);

    assert.deepEqual(probe, { version: '2.0.14-sscity', mode: 'v2' });
    assert.deepEqual(probePaths(calls), ['/api/info']);
    assert.deepEqual(
      (calls[0]?.init?.headers ?? {}) as Record<string, unknown>,
      { Accept: 'application/json' },
    );
  });

  test('falls back to /global/health when /api/info 404s (v1 server)', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { ok: false, status: 404, statusText: 'Not Found', json: async () => null } },
      { match: '/global/health', respond: { json: async () => ({ version: '1.18.8', healthy: true }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock);

    assert.deepEqual(probe, { version: '1.18.8', mode: 'v1', healthy: true });
    assert.deepEqual(probePaths(calls), ['/api/info', '/global/health']);
  });

  test('tolerates a leading v and forwards auth headers on both probes', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { ok: false, status: 404, statusText: 'Not Found' } },
      { match: '/global/health', respond: { json: async () => ({ version: 'v1.18.8-sscity', healthy: false }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096', fetchMock, {
      headers: { Authorization: 'Basic test' },
    });

    assert.deepEqual(probe, { version: '1.18.8-sscity', mode: 'v1', healthy: false });
    for (const call of calls) {
      assert.deepEqual(
        (call.init?.headers ?? {}) as Record<string, unknown>,
        { Accept: 'application/json', Authorization: 'Basic test' },
      );
    }
  });

  test('falls through when /api/info answers off-shape (HTML catch-all)', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { json: async () => '<!doctype html>' } },
      { match: '/global/health', respond: { json: async () => ({ version: '1.18.8', healthy: true }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock);

    assert.deepEqual(probe, { version: '1.18.8', mode: 'v1', healthy: true });
    assert.equal(calls.length, 2);
  });

  test('surfaces the v1 probe error when both endpoints fail', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: 'exploded' }) } },
      { match: '/global/health', respond: { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: 'down' }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock, {
      defaultError: 'Failed to read OpenCode version',
    });

    assert.deepEqual(probe, { version: null, mode: null, error: 'down' });
    assert.equal(calls.length, 2);
  });

  test('uses defaultError when failing responses carry no error detail', async () => {
    const { fetchMock } = createFetchMock([
      { match: '/api/info', respond: { ok: false, status: 404, statusText: '' } },
      { match: '/global/health', respond: { ok: false, status: 503, statusText: '' } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock, {
      defaultError: 'Failed to read OpenCode version',
    });

    assert.deepEqual(probe, { version: null, mode: null, error: 'Failed to read OpenCode version' });
  });

  test('never throws when every probe request rejects', async () => {
    const { fetchMock } = createFetchMock([
      { match: '*', respond: new Error('connect ECONNREFUSED') },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock);

    assert.deepEqual(probe, { version: null, mode: null, error: 'connect ECONNREFUSED' });
  });

  test('ignores an empty version field on /api/info and falls through', async () => {
    const { calls, fetchMock } = createFetchMock([
      { match: '/api/info', respond: { json: async () => ({ pid: 1, version: '   ' }) } },
      { match: '/global/health', respond: { json: async () => ({ version: '2.0.14-sscity', healthy: true }) } },
    ]);

    const probe = await probeOpenCodeVersion('http://127.0.0.1:4096/', fetchMock);

    assert.deepEqual(probe, { version: '2.0.14-sscity', mode: 'v1', healthy: true });
    assert.equal(calls.length, 2);
  });
});
