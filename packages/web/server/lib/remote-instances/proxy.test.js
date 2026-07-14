import { describe, expect, it } from 'vitest';

import { getRemoteProxyRequestTimeoutMs } from './proxy.js';

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

  it('keeps a longer timeout for session mutations', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/prompt_async', 'POST')).toBe(15_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/abort', 'POST')).toBe(5_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/message', 'GET')).toBe(5_000);
  });

  it('lets shell execution wait longer than async prompt submission', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/shell', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/session/ses_123/shell', 'GET')).toBe(5_000);
  });

  it('allows OpenCode upgrades to wait for package manager commands', () => {
    expect(getRemoteProxyRequestTimeoutMs('/api/opencode/upgrade', 'POST')).toBe(600_000);
    expect(getRemoteProxyRequestTimeoutMs('/api/opencode/upgrade', 'GET')).toBe(5_000);
  });
});
