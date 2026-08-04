import { describe, expect, it } from 'vitest';

import { formatRemoteGateError, getRemoteProxyRequestTimeoutMs } from './proxy.js';

describe('remote instance proxy timeouts', () => {
  it('keeps fail-fast timeouts for critical lightweight reads', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/global/health', 'GET')).toBe(3_000);
  });

  it('gives fast polling paths a safety net above the old default', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/fs/list?path=/repo', 'GET')).toBe(15_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session?directory=/repo', 'GET')).toBe(15_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/project', 'GET')).toBe(15_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/status', 'GET')).toBe(3_000);
  });

  it('gives IO paths a long network-operation budget', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/git/status?directory=/large-repo', 'GET')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/git/push', 'POST')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/opencode/upgrade', 'POST')).toBe(120_000);
  });

  it('gives AI paths a budget aligned with small-model internal calls', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/text/session-title-candidates', 'POST')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/text/summarize', 'POST')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/small-model/generate', 'POST')).toBe(120_000);
  });

  it('uses the normal budget for unclassified session mutations', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/prompt_async', 'POST')).toBe(30_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/abort', 'POST')).toBe(30_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/message', 'GET')).toBe(30_000);
  });

  it('keeps long-lived session operations (shell, compaction) on the IO budget', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/shell', 'POST')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/summarize', 'POST')).toBe(120_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/compact', 'POST')).toBe(120_000);
  });
});

describe('formatRemoteGateError', () => {
  it('returns a bounded retry hint for HTTP and RPC clients', () => {
    const formatted = formatRemoteGateError({
      message: 'busy',
      statusCode: 429,
      code: 'REMOTE_LANE_BUSY',
      retryAfterMs: 1_200,
    }, 'remote-a');

    expect(formatted).toEqual({
      status: 429,
      headers: { 'Retry-After': '2' },
      body: {
        error: 'busy',
        code: 'REMOTE_LANE_BUSY',
        instanceId: 'remote-a',
        retryAfterMs: 1_200,
      },
    });
  });
});
