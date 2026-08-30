import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createServerStartupRuntime } from './server-startup-runtime.js';

const setup = () => {
  const fakeProcess = new EventEmitter();
  let shutdowns = 0;
  const runtime = createServerStartupRuntime({
    process: fakeProcess,
    gracefulShutdown: () => { shutdowns += 1; },
    getSignalsAttached: () => true,
    setSignalsAttached: () => undefined,
    syncToHmrState: () => undefined,
  });
  return { fakeProcess, runtime, shutdowns: () => shutdowns };
};

describe('server uncaught exception policy', () => {
  it('logs a stray exception without making the embedded server unreachable', () => {
    const { fakeProcess, runtime, shutdowns } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runtime.attachProcessHandlers({ attachSignals: false });
    fakeProcess.emit('uncaughtException', new Error('setTypeOfService EINVAL'));
    expect(shutdowns()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('still shuts down after a sustained exception storm', () => {
    const { fakeProcess, runtime, shutdowns } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runtime.attachProcessHandlers({ attachSignals: false });
    for (let index = 0; index < 11; index += 1) {
      fakeProcess.emit('uncaughtException', new Error(`stray ${index}`));
    }
    expect(shutdowns()).toBe(1);
    error.mockRestore();
  });

  it('keeps the existing unhandled rejection policy non-fatal', () => {
    const { fakeProcess, runtime, shutdowns } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runtime.attachProcessHandlers({ attachSignals: false });
    fakeProcess.emit('unhandledRejection', new Error('late failure'), Promise.resolve());
    expect(shutdowns()).toBe(0);
    error.mockRestore();
  });
});
