import { describe, expect, it, vi } from 'vitest';
import { runCliEntryIfMain } from './cli-entry-runtime.js';

const createDependencies = (overrides = {}) => {
  const startServer = vi.fn(async () => {});
  const setExitOnShutdown = vi.fn();
  const parseServeCliOptions = vi.fn(() => ({
    port: 3000,
    host: '127.0.0.1',
    tryCfTunnel: false,
    tunnelProvider: undefined,
    tunnelMode: undefined,
    tunnelConfigPath: undefined,
    tunnelToken: undefined,
    tunnelHostname: undefined,
    uiPassword: null,
    apiOnly: false,
  }));

  return {
    dependencies: {
      process: {
        argv: ['/usr/bin/node', '/repo/packages/web/server/index.js'],
        env: {},
        versions: {},
        exit: vi.fn(),
      },
      currentFilename: '/repo/packages/web/server/index.js',
      parseServeCliOptions,
      defaultPort: 3000,
      cloudflareProvider: 'cloudflare',
      managedLocalMode: 'managed-local',
      setExitOnShutdown,
      startServer,
      ...overrides,
    },
    parseServeCliOptions,
    setExitOnShutdown,
    startServer,
  };
};

describe('runCliEntryIfMain', () => {
  it('starts the server for direct CLI execution', () => {
    const { dependencies, parseServeCliOptions, setExitOnShutdown, startServer } = createDependencies();

    runCliEntryIfMain(dependencies);

    expect(parseServeCliOptions).toHaveBeenCalledWith(expect.objectContaining({
      argv: [],
      defaultPort: 3000,
    }));
    expect(setExitOnShutdown).toHaveBeenCalledWith(true);
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      port: 3000,
      host: '127.0.0.1',
      attachSignals: true,
      exitOnShutdown: true,
      apiOnly: false,
    }));
  });

  it('does not self-start when imported by the desktop runtime', () => {
    const { dependencies, parseServeCliOptions, setExitOnShutdown, startServer } = createDependencies({
      process: {
        argv: ['/Applications/OpenChamber.app/Contents/MacOS/OpenChamber', '/repo/packages/web/server/index.js'],
        env: { OPENCHAMBER_RUNTIME: 'desktop' },
        versions: {},
        exit: vi.fn(),
      },
    });

    runCliEntryIfMain(dependencies);

    expect(parseServeCliOptions).not.toHaveBeenCalled();
    expect(setExitOnShutdown).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  it('does not self-start inside Electron even if argv matches the server module', () => {
    const { dependencies, parseServeCliOptions, setExitOnShutdown, startServer } = createDependencies({
      process: {
        argv: ['/Applications/OpenChamber.app/Contents/MacOS/OpenChamber', '/repo/packages/web/server/index.js'],
        env: {},
        versions: { electron: '41.2.1' },
        exit: vi.fn(),
      },
    });

    runCliEntryIfMain(dependencies);

    expect(parseServeCliOptions).not.toHaveBeenCalled();
    expect(setExitOnShutdown).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });
});
