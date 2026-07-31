import { describe, expect, it } from 'vitest';

import { formatRemoteGateError, getRemoteProxyRequestTimeoutMs } from './proxy.js';

describe('remote instance proxy timeouts', () => {
  it('uses fail-fast timeouts for lightweight remote API reads', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session?directory=/repo', 'GET')).toBe(3_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/project', 'GET')).toBe(3_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/global/health', 'GET')).toBe(3_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/fs/list?path=/repo', 'GET')).toBe(3_000);
  });

  it('allows remote Git status reads to outlive the generic request deadline', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/git/status?directory=/large-repo', 'GET')).toBe(30_000);
  });

  it('keeps longer timeouts for session mutations and large message pages', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/prompt_async', 'POST')).toBe(15_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/abort', 'POST')).toBe(5_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/message', 'GET')).toBe(30_000);
  });

  it('lets shell execution wait longer than async prompt submission', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/shell', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/shell', 'GET')).toBe(5_000);
  });

  it('lets synchronous session compaction finish', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/summarize', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/compact', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/summarize', 'GET')).toBe(5_000);
  });

  it('allows OpenCode upgrades to wait for package manager commands', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/opencode/upgrade', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/opencode/upgrade', 'GET')).toBe(5_000);
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
