import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@openchamber/ui/lib/runtime-auth', () => ({
  getRuntimeExtraHeadersSync: vi.fn(() => ({})),
  refreshLocalRuntimeUrlAuthToken: vi.fn(() => Promise.resolve()),
  refreshRuntimeUrlAuthToken: vi.fn(() => Promise.resolve()),
  setRuntimeBearerToken: vi.fn(),
  setRuntimeExtraHeaders: vi.fn(),
}));
vi.mock('@openchamber/ui/lib/runtime-fetch', () => ({ installRuntimeFetchBridge: vi.fn() }));
vi.mock('@openchamber/ui/lib/runtime-switch', () => ({ initializeRuntimeEndpoint: vi.fn() }));
vi.mock('@openchamber/ui/lib/runtime-url', () => ({ configureRuntimeUrlResolver: vi.fn() }));
vi.mock('@openchamber/ui/lib/desktopBoot', () => ({ getInjectedBootOutcome: vi.fn() }));
vi.mock('./api', () => ({ createWebAPIs: vi.fn(() => ({ ok: true })) }));

import { getInjectedBootOutcome } from '@openchamber/ui/lib/desktopBoot';
import { initializeRuntimeEndpoint } from '@openchamber/ui/lib/runtime-switch';
import { createConfiguredWebAPIs } from './runtimeConfig';

const originalWindow = globalThis.window;

const installWindow = (value: Record<string, unknown>) => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
};

beforeEach(() => {
  vi.clearAllMocks();
  installWindow({});
});

afterAll(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

describe('createConfiguredWebAPIs runtime identity', () => {
  test('keeps the desktop host id when an SSH tunnel receives a new local URL', () => {
    installWindow({
      __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:62545',
      __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:3901',
    });
    vi.mocked(getInjectedBootOutcome).mockReturnValue({
      target: 'remote',
      status: 'ok',
      hostId: 'ssh-castle',
      url: 'http://127.0.0.1:62545',
    });

    createConfiguredWebAPIs();

    expect(initializeRuntimeEndpoint).toHaveBeenCalledWith({
      apiBaseUrl: 'http://127.0.0.1:62545',
      runtimeKey: 'host:ssh-castle',
    });
  });
});
