import { describe, expect, it, vi } from 'vitest';

import { getClaudeCliAuthStatus } from './claude-cli-auth.js';

describe('Claude CLI auth status', () => {
  it('reads login status without forwarding credential overrides', () => {
    const spawn = vi.fn(() => ({ stdout: JSON.stringify({ loggedIn: true }) }));
    expect(getClaudeCliAuthStatus({
      spawnSyncFn: spawn,
      env: { ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', PATH: '/bin' },
      platform: 'linux',
    })).toEqual({ connected: true, reason: 'logged-in' });
    expect(spawn.mock.calls[0][2].env).toEqual({ PATH: '/bin' });
  });

  it('falls back through the login shell', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ stdout: '', error: new Error('ENOENT') })
      .mockReturnValueOnce({ stdout: '/opt/claude\n' })
      .mockReturnValueOnce({ stdout: JSON.stringify({ loggedIn: false }) });
    expect(getClaudeCliAuthStatus({ spawnSyncFn: spawn, env: { SHELL: '/bin/zsh' }, platform: 'linux' }))
      .toEqual({ connected: false, reason: 'logged-out' });
    expect(spawn.mock.calls[2][0]).toBe('/opt/claude');
  });
});
