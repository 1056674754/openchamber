import https from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const middleware = vi.hoisted(() => vi.fn());
vi.mock('http-proxy-middleware', () => ({ createProxyMiddleware: middleware }));

const { registerOpenCodeProxy } = await import('./proxy.js');

const createApp = () => {
  const settings = new Map();
  const noop = () => undefined;
  return {
    get: (...args) => args.length === 1 ? settings.get(args[0]) : undefined,
    set: (key, value) => settings.set(key, value),
    use: noop,
    post: noop,
  };
};

const createDeps = (state) => ({
  fs: { promises: { realpath: async (value) => value } },
  os: {}, path: {}, OPEN_CODE_READY_GRACE_MS: 0,
  getRuntime: () => ({ openCodePort: state.port, openCodeBaseUrl: state.baseUrl }),
  getOpenCodeAuthHeaders: () => ({}),
  buildOpenCodeUrl: (pathname) => {
    if (!state.baseUrl) throw new Error('not ready');
    return `${state.baseUrl}${pathname}`;
  },
  ensureOpenCodeApiPrefix: (pathname) => pathname,
});

describe('OpenCode proxy agent wiring', () => {
  beforeEach(() => {
    middleware.mockReset();
    middleware.mockImplementation(() => (_req, _res, next) => next?.());
  });

  it('shares one keep-alive pool across API and OAuth proxies', () => {
    registerOpenCodeProxy(createApp(), createDeps({ port: 4096, baseUrl: 'http://127.0.0.1:4096' }));
    const agents = middleware.mock.calls.map(([options]) => options.agent);
    expect(agents.length).toBeGreaterThan(1);
    expect(new Set(agents).size).toBe(1);
    expect(agents[0].options.keepAlive).toBe(true);
  });

  it('resolves HTTPS lazily after cold registration', () => {
    const state = { port: null, baseUrl: null };
    registerOpenCodeProxy(createApp(), createDeps(state));
    state.port = 4096;
    state.baseUrl = 'https://opencode.example.com';
    for (const [options] of middleware.mock.calls) expect(options.agent).toBeInstanceOf(https.Agent);
  });
});
