import http from 'node:http';
import https from 'node:https';
import { describe, expect, it } from 'vitest';

import { createOpenCodeProxyAgent, createOpenCodeProxyAgentResolver } from './proxy.js';

describe('OpenCode proxy keep-alive agents', () => {
  it('creates scheme-correct keep-alive pools without capping throughput', () => {
    const httpAgent = createOpenCodeProxyAgent('http://127.0.0.1:4096');
    const httpsAgent = createOpenCodeProxyAgent('https://opencode.example.com');
    expect(httpAgent).toBeInstanceOf(http.Agent);
    expect(httpAgent).not.toBeInstanceOf(https.Agent);
    expect(httpsAgent).toBeInstanceOf(https.Agent);
    for (const agent of [httpAgent, httpsAgent]) {
      expect(agent.options.keepAlive).toBe(true);
      expect(agent.maxSockets).toBe(Infinity);
      expect(agent.maxFreeSockets).toBe(256);
    }
    httpAgent.destroy();
    httpsAgent.destroy();
  });

  it('memoizes one pool per scheme while allowing a cold target to become HTTPS', () => {
    let target = 'http://127.0.0.1:3902';
    const resolve = createOpenCodeProxyAgentResolver(() => target);
    const first = resolve();
    expect(resolve()).toBe(first);
    target = 'https://opencode.example.com';
    const secure = resolve();
    expect(secure).toBeInstanceOf(https.Agent);
    expect(secure).not.toBe(first);
    expect(resolve()).toBe(secure);
    first.destroy();
    secure.destroy();
  });
});
