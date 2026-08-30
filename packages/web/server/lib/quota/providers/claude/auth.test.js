import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.fn();
const files = new Map();
const openCodeAuth = vi.fn(() => ({}));

vi.mock('node:child_process', () => ({ execFileSync: (...args) => execFileSync(...args) }));
vi.mock('node:fs', () => {
  const fs = {
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => {
      if (!files.has(filePath)) throw new Error('ENOENT');
      return files.get(filePath);
    },
  };
  return { ...fs, default: fs };
});
vi.mock('../../../opencode/auth.js', () => ({ readAuthFile: () => openCodeAuth() }));

import { loadClaudeCredential } from './auth.js';

const claudeCodeBlob = (accessToken) => JSON.stringify({
  mcpOAuth: { 'linear|abc': { accessToken: 'unrelated' } },
  claudeAiOauth: {
    accessToken,
    refreshToken: `${accessToken}-refresh`,
    expiresAt: 1786735755912,
    subscriptionType: 'max',
  },
});

const withPlatform = (platform, run) => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
};

beforeEach(() => {
  files.clear();
  execFileSync.mockReset();
  execFileSync.mockImplementation(() => { throw new Error('missing'); });
  openCodeAuth.mockReturnValue({});
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

describe('Claude credential discovery', () => {
  it('prefers the macOS Keychain over the credentials file', () => {
    execFileSync.mockReturnValue(claudeCodeBlob('keychain-token'));
    files.set(`${process.env.HOME}/.claude/.credentials.json`, claudeCodeBlob('file-token'));
    expect(withPlatform('darwin', loadClaudeCredential)).toMatchObject({
      accessToken: 'keychain-token',
      planLabel: 'max',
      source: 'keychain',
    });
  });

  it('reads the credentials file and honors CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude-home';
    files.set('/tmp/claude-home/.credentials.json', claudeCodeBlob('file-token'));
    expect(withPlatform('linux', loadClaudeCredential)).toMatchObject({
      accessToken: 'file-token',
      source: 'credentials-file',
    });
  });

  it('falls back through OpenCode auth and then the environment', () => {
    openCodeAuth.mockReturnValue({ anthropic: { access: 'opencode-token' } });
    expect(withPlatform('linux', loadClaudeCredential).source).toBe('opencode-auth');
    openCodeAuth.mockReturnValue({});
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-token';
    expect(withPlatform('linux', loadClaudeCredential)).toMatchObject({ accessToken: 'env-token', source: 'env' });
  });

  it('ignores unrelated Keychain data and returns null when all sources are empty', () => {
    execFileSync.mockReturnValue(JSON.stringify({ mcpOAuth: { x: { accessToken: 'unrelated' } } }));
    expect(withPlatform('darwin', loadClaudeCredential)).toBeNull();
  });
});
