import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../opencode/auth.js', () => ({ readAuthFile: () => ({}) }));
vi.mock('../opencode/shared.js', () => ({ readConfigLayers: () => ({ mergedConfig: {} }) }));
vi.mock('./catalog.js', () => ({ getModelCatalog: async () => ({}) }));
const callSmallModel = vi.fn();
vi.mock('./call.js', () => ({
  DEDICATED_WIRE_FORMAT_PROVIDERS: new Set(['openai', 'anthropic', 'google', 'github-copilot', 'copilot']),
  callSmallModel: (...args) => callSmallModel(...args),
  resolveProviderLogin: async () => null,
}));

import { generateSmallModelText, listAuthenticatedProviders } from './index.js';
import { configureOpenCodeRuntimeProviders } from './runtime-providers.js';

describe('Small Model runtime provider resolution', () => {
  beforeEach(() => {
    callSmallModel.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      all: [
        { id: 'plugin', options: { apiKey: 'key', baseURL: 'https://plugin.test/v1' }, models: {} },
        { id: 'claude-code', options: { apiKey: 'claude', baseURL: 'http://localhost:9090' }, models: {} },
      ],
      connected: ['plugin', 'claude-code'],
    })));
    configureOpenCodeRuntimeProviders({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
    });
  });
  afterEach(() => {
    configureOpenCodeRuntimeProviders(null);
    vi.unstubAllGlobals();
  });

  it('lists callable plugin providers but never Claude Code', async () => {
    expect(await listAuthenticatedProviders()).toEqual(['plugin']);
  });

  it('refuses an explicit Claude Code background request', async () => {
    await expect(generateSmallModelText({ prompt: 'title this', model: 'claude-code/sonnet' }))
      .rejects.toMatchObject({ code: 'small-model-provider-unsupported' });
    expect(callSmallModel).not.toHaveBeenCalled();
  });
});
