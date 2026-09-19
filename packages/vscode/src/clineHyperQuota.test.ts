import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchClinePassQuota, fetchHyperQuota, listConfiguredQuotaProviders } from './quotaProviders';

const readAuth = () => ({ 'cline-pass': { key: 'test-token' }, hyper: { token: 'hyper-token' } });

describe('ClinePass quota (VS Code parity)', () => {
  it('maps the documented windows from the usage-limits payload', async () => {
    const result = await fetchClinePassQuota({
      readAuth,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.cline.bot/api/v1/users/me/plan/usage-limits');
        assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-token');
        return Response.json({
          data: { limits: [
            { type: 'five_hour', percentUsed: 43, resetsAt: '2026-09-08T17:00:44.598174595Z' },
            { type: 'weekly', percentUsed: '17' },
            { type: 'monthly', percentUsed: 8 },
            { type: 'unknown', percentUsed: 99 },
          ] },
          success: true,
        });
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.usage?.windows ?? {}), ['5h', 'weekly', 'monthly']);
    assert.equal(result.usage?.windows['5h'].usedPercent, 43);
    assert.equal(result.usage?.windows.weekly.usedPercent, 17);
  });

  it('rejects a payload without usable windows', async () => {
    const result = await fetchClinePassQuota({
      readAuth,
      fetchImpl: async () => Response.json({ data: { limits: [{ type: 'unknown', percentUsed: 5 }] } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'No quota data in response');
  });
});

describe('Charm Hyper quota (VS Code parity)', () => {
  it('formats the credit balance without untranslated unit text', async () => {
    const result = await fetchHyperQuota({
      readAuth,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://hyper.charm.land/v1/credits');
        assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer hyper-token');
        return Response.json({ balance: '50' });
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.usage?.windows.credits?.valueLabel, '50');
    assert.equal(result.usage?.windows.credits_balance?.valueLabel, '$2.50');
  });

  it('rejects invalid payloads instead of showing zero', async () => {
    for (const payload of [{}, { balance: '' }, { balance: 'NaN' }, { balance: null }]) {
      const result = await fetchHyperQuota({ readAuth, fetchImpl: async () => Response.json(payload) });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'No quota data in response');
    }
  });
});

describe('configured provider listing', () => {
  it('does not throw while enumerating cline-pass and hyper', () => {
    assert.ok(Array.isArray(listConfiguredQuotaProviders()));
  });
});
