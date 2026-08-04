import { describe, expect, test } from 'bun:test';
import {
  RPC_CLASS,
  RPC_CLASS_DEFAULT_TIMEOUT_MS,
  classifyRpcPath,
  getRpcClassTimeoutMs,
} from './rpc-classes.js';

describe('classifyRpcPath', () => {
  test('stream paths classify as stream', () => {
    expect(classifyRpcPath('/api/event')).toBe(RPC_CLASS.STREAM);
    expect(classifyRpcPath('/api/global/event')).toBe(RPC_CLASS.STREAM);
    expect(classifyRpcPath('/api/event/ws')).toBe(RPC_CLASS.STREAM);
    expect(classifyRpcPath('/api/global/event/ws')).toBe(RPC_CLASS.STREAM);
    expect(classifyRpcPath('/api/remote-rpc/ws')).toBe(RPC_CLASS.STREAM);
  });

  test('critical paths classify as critical', () => {
    expect(classifyRpcPath('/api/global/health')).toBe(RPC_CLASS.CRITICAL);
    expect(classifyRpcPath('/api/session/status')).toBe(RPC_CLASS.CRITICAL);
    expect(classifyRpcPath('/api/opencode/health')).toBe(RPC_CLASS.CRITICAL);
  });

  test('fast paths classify as fast', () => {
    expect(classifyRpcPath('/api/fs/list')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('/api/fs/list?path=/repo')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('/api/fs/stat')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('/api/session')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('/api/config/settings')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('/api/quota/providers')).toBe(RPC_CLASS.FAST);
  });

  test('io paths classify as io', () => {
    expect(classifyRpcPath('/api/git/push')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/git/status?directory=/repo')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/fs/clone')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/github/pr/create')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/remote-instances/abc/connect')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/config/skills/install')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/session/ses_123/shell')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/session/ses_123/summarize')).toBe(RPC_CLASS.IO);
    expect(classifyRpcPath('/api/session/ses_123/compact')).toBe(RPC_CLASS.IO);
  });

  test('ai paths classify as ai', () => {
    expect(classifyRpcPath('/api/text/session-title-candidates')).toBe(RPC_CLASS.AI);
    expect(classifyRpcPath('/api/text/summarize')).toBe(RPC_CLASS.AI);
    expect(classifyRpcPath('/api/small-model/generate')).toBe(RPC_CLASS.AI);
    expect(classifyRpcPath('/api/tts/speak')).toBe(RPC_CLASS.AI);
    expect(classifyRpcPath('/api/stt/transcribe')).toBe(RPC_CLASS.AI);
  });

  test('unknown paths fall back to normal', () => {
    expect(classifyRpcPath('/api/unknown/route')).toBe(RPC_CLASS.NORMAL);
    expect(classifyRpcPath('/api/session/ses_123/prompt_async')).toBe(RPC_CLASS.NORMAL);
    expect(classifyRpcPath('/api/terminal/shells')).toBe(RPC_CLASS.NORMAL);
  });

  test('query strings and malformed input do not break classification', () => {
    expect(classifyRpcPath('/api/fs/list?path=%2Ftmp&respectGitignore=false')).toBe(RPC_CLASS.FAST);
    expect(classifyRpcPath('')).toBe(RPC_CLASS.NORMAL);
    expect(classifyRpcPath(null)).toBe(RPC_CLASS.NORMAL);
  });
});

describe('getRpcClassTimeoutMs', () => {
  test('returns per-class budgets', () => {
    expect(getRpcClassTimeoutMs('/api/global/health')).toBe(3_000);
    expect(getRpcClassTimeoutMs('/api/fs/list')).toBe(15_000);
    expect(getRpcClassTimeoutMs('/api/unknown/route')).toBe(30_000);
    expect(getRpcClassTimeoutMs('/api/git/push')).toBe(120_000);
    expect(getRpcClassTimeoutMs('/api/text/summarize')).toBe(120_000);
  });

  test('stream class returns null (no hard timeout)', () => {
    expect(getRpcClassTimeoutMs('/api/event')).toBeNull();
  });

  test('timeout table matches class keys exactly', () => {
    expect(Object.keys(RPC_CLASS_DEFAULT_TIMEOUT_MS).sort()).toEqual(
      ['ai', 'critical', 'fast', 'io', 'normal', 'stream'],
    );
  });
});
