import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenCodeConfigFileWatcherRuntime } from './config-file-watcher.js';

const tempDirectories = [];

const createFixture = (overrides = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-config-watch-'));
  tempDirectories.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const configDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const configPath = path.join(configDir, 'opencode.jsonc');
  fs.writeFileSync(configPath, '{ "model": "test/one" }');
  const markPendingConfigRestart = vi.fn(() => ({}));
  const state = { activeSessions: 0 };
  const runtime = createOpenCodeConfigFileWatcherRuntime({
    osModule: { homedir: () => home },
    getWorkingDirectory: () => project,
    getActiveSessionCount: () => state.activeSessions,
    markPendingConfigRestart,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    debounceMs: 20,
    idlePollIntervalMs: 20,
    ...overrides,
  });
  return { runtime, configPath, markPendingConfigRestart, state };
};

const waitFor = async (condition, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenCode config file watcher', () => {
  it('defers a valid change until active sessions become idle', async () => {
    const fixture = createFixture();
    fixture.runtime.start();
    fixture.state.activeSessions = 2;
    fs.writeFileSync(fixture.configPath, '{ "model": "test/two" }');

    expect(await fixture.runtime.checkNow()).toBe(false);
    expect(fixture.markPendingConfigRestart).not.toHaveBeenCalled();

    fixture.state.activeSessions = 0;
    expect(await fixture.runtime.checkNow()).toBe(true);
    expect(fixture.markPendingConfigRestart).toHaveBeenCalledTimes(1);
    fixture.runtime.stop();
  });

  it('keeps the running server on invalid JSONC and applies the next valid edit', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fixture = createFixture({ logger });
    fixture.runtime.start();
    fs.writeFileSync(fixture.configPath, '{ "model": }');

    expect(await fixture.runtime.checkNow()).toBe(false);
    expect(fixture.markPendingConfigRestart).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring invalid configuration change'));

    fs.writeFileSync(fixture.configPath, '{ "model": "test/valid" }');
    expect(await fixture.runtime.checkNow()).toBe(true);
    expect(fixture.markPendingConfigRestart).toHaveBeenCalledTimes(1);
    fixture.runtime.stop();
  });

  it('observes a filesystem edit without a manual reload request', async () => {
    const fixture = createFixture();
    fixture.runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.writeFileSync(fixture.configPath, '{ "model": "test/automatic" }');

    await waitFor(() => fixture.markPendingConfigRestart.mock.calls.length === 1);
    expect(fixture.markPendingConfigRestart).toHaveBeenCalledWith(
      'configuration file change',
      { scope: 'external-config' },
    );
    fixture.runtime.stop();
  });

  it('does not start for an external OpenCode server', () => {
    const fixture = createFixture({ isManagedOpenCode: () => false });

    expect(fixture.runtime.start()).toBe(false);
    fixture.runtime.stop();
  });

  it('can acknowledge a route-managed edit to avoid a second reload', async () => {
    const fixture = createFixture();
    fixture.runtime.start();
    fs.writeFileSync(fixture.configPath, '{ "model": "test/manual" }');
    fixture.runtime.acknowledgeCurrentConfig();

    expect(await fixture.runtime.checkNow()).toBe(false);
    expect(fixture.markPendingConfigRestart).not.toHaveBeenCalled();
    fixture.runtime.stop();
  });
});
