import { describe, expect, it, vi } from 'vitest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';

const createDependencies = () => ({
  createTerminalRuntime: () => ({ stop: vi.fn() }),
  createMessageStreamWsRuntime: () => ({ stop: vi.fn() }),
  createServerStartupRuntime: () => ({
    resolveBindHost: () => '127.0.0.1',
    startListeningAndMaybeTunnel: vi.fn(async () => ({ activePort: 5190 })),
    attachProcessHandlers: vi.fn(),
  }),
});

const createOptions = (overrides = {}) => ({
  app: {},
  server: {},
  express: {},
  fs: {},
  path: {},
  uiAuthController: {},
  buildAugmentedPath: vi.fn(),
  searchPathFor: vi.fn(),
  isExecutable: vi.fn(),
  isRequestOriginAllowed: vi.fn(),
  rejectWebSocketUpgrade: vi.fn(),
  buildOpenCodeUrl: vi.fn(),
  getOpenCodeAuthHeaders: vi.fn(),
  globalEventHub: {},
  processForwardedEventPayload: vi.fn(),
  messageStreamWsClients: new Set(),
  triggerHealthCheck: vi.fn(),
  upstreamStallTimeoutMs: 30_000,
  terminalHeartbeatIntervalMs: 10_000,
  terminalRebindWindowMs: 60_000,
  terminalMaxRebindsPerWindow: 10,
  setupProxy: vi.fn(),
  scheduleOpenCodeApiDetection: vi.fn(),
  bootstrapOpenCodeAtStartup: vi.fn(async () => {}),
  staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
  process: {},
  crypto: {},
  normalizeTunnelBootstrapTtlMs: vi.fn(),
  readSettingsFromDiskMigrated: vi.fn(),
  tunnelAuthController: {},
  startTunnelWithNormalizedRequest: vi.fn(),
  gracefulShutdown: vi.fn(),
  getSignalsAttached: vi.fn(),
  setSignalsAttached: vi.fn(),
  syncToHmrState: vi.fn(),
  TUNNEL_MODE_QUICK: 'quick',
  TUNNEL_MODE_MANAGED_LOCAL: 'managed-local',
  TUNNEL_MODE_MANAGED_REMOTE: 'managed-remote',
  host: '127.0.0.1',
  port: 0,
  startupTunnelRequest: null,
  onTunnelReady: vi.fn(),
  tunnelRuntimeContext: { setActivePort: vi.fn() },
  attachSignals: vi.fn(),
  remoteInstancesRuntime: {},
  listenBacklog: 511,
  ...overrides,
});

describe('startup pipeline runtime', () => {
  it('starts the listener before bootstrapping managed OpenCode', async () => {
    // Given
    const order = [];
    const dependencies = createDependencies();
    dependencies.createServerStartupRuntime = () => ({
      resolveBindHost: () => '127.0.0.1',
      startListeningAndMaybeTunnel: vi.fn(async () => {
        order.push('listen');
        return { activePort: 5190 };
      }),
      attachProcessHandlers: vi.fn(),
    });
    const options = createOptions({
      bootstrapOpenCodeAtStartup: vi.fn(async () => {
        order.push('bootstrap');
      }),
    });

    // When
    await createStartupPipelineRuntime(dependencies).run(options);
    await vi.waitFor(() => expect(order).toContain('bootstrap'));

    // Then
    expect(order).toEqual(['listen', 'bootstrap']);
    expect(options.tunnelRuntimeContext.setActivePort).toHaveBeenCalledWith(5190);
  });
});
