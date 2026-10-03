import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const credential = vi.fn();
vi.mock('./auth.js', () => ({
  findClaudeCredential: () => credential(),
  loadClaudeCredential: async () => credential(),
}));

import { fetchQuota, resetClaudeQuotaCache } from './index.js';

const CREDENTIAL = {
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  planLabel: 'max',
  source: 'keychain',
};
const PAYLOAD = { limits: [{ kind: 'session', percent: 5, resets_at: '2026-08-14T19:10:00Z' }] };
const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

beforeEach(() => {
  resetClaudeQuotaCache();
  credential.mockReturnValue(CREDENTIAL);
});
afterEach(() => vi.unstubAllGlobals());

describe('Claude quota provider', () => {
  it('returns plan usage and coalesces simultaneous refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);
    const [first, second] = await Promise.all([fetchQuota(), fetchQuota()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ ok: true, planLabel: 'max' });
    expect(second.usage.windows['5h'].usedPercent).toBe(5);
  });

  it('serves the last good payload during rate limiting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(PAYLOAD))
      .mockResolvedValueOnce(response({}, 429, { 'retry-after': '120' }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchQuota();
    expect(await fetchQuota()).toMatchObject({ ok: true, planLabel: 'max' });
    expect(await fetchQuota()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not leak cached usage across credentials', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(PAYLOAD))
      .mockResolvedValueOnce(response({}, 429)));
    await fetchQuota();
    credential.mockReturnValue({ ...CREDENTIAL, accessToken: 'access-b', refreshToken: 'refresh-b' });
    expect(await fetchQuota()).toMatchObject({ ok: false, usage: null });
  });

  it('surfaces missing, expired, and network failures', async () => {
    credential.mockReturnValue(null);
    expect(await fetchQuota()).toMatchObject({ configured: false, ok: false });
    credential.mockReturnValue(CREDENTIAL);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 401)));
    expect((await fetchQuota()).error).toContain('Claude Code');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));
    expect((await fetchQuota()).error).toBe('socket hang up');
  });
});
