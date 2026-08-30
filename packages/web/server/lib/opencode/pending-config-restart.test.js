import { describe, expect, mock, test } from 'bun:test';

import { createPendingConfigRestartRuntime } from './pending-config-restart.js';

describe('pending OpenCode config restart runtime', () => {
  test('marks changes and broadcasts the updated snapshot', () => {
    const broadcastEvent = mock(() => undefined);
    const runtime = createPendingConfigRestartRuntime({
      applyRestart: mock(async () => ({ reloadDelayMs: 25 })),
      broadcastEvent,
      getSessionActivitySnapshot: () => ({
        busy: { type: 'busy' },
        idle: { type: 'idle' },
        retrying: { type: 'retry' },
      }),
    });

    const snapshot = runtime.markPendingConfigRestart('agent update');

    expect(snapshot.count).toBe(1);
    expect(snapshot.reasons).toEqual(['agent update']);
    expect(snapshot.affectedSessions).toEqual([
      { sessionId: 'busy', status: 'busy' },
      { sessionId: 'retrying', status: 'retry' },
    ]);
    expect(broadcastEvent).toHaveBeenCalledWith({
      type: 'openchamber:pending-config-restart',
      properties: snapshot,
    });
  });

  test('apply clears only changes present when the restart began', async () => {
    let finishRestart;
    const applyRestart = mock(() => new Promise((resolve) => {
      finishRestart = resolve;
    }));
    const runtime = createPendingConfigRestartRuntime({
      applyRestart,
      broadcastEvent: mock(() => undefined),
      getSessionActivitySnapshot: () => ({}),
    });
    runtime.markPendingConfigRestart('agent update');

    const applying = runtime.applyPendingConfigRestart();
    runtime.markPendingConfigRestart('plugin update');
    finishRestart({ reloadDelayMs: 25 });
    const result = await applying;

    expect(applyRestart).toHaveBeenCalledWith('pending configuration changes');
    expect(result.appliedCount).toBe(1);
    expect(result.pending.count).toBe(1);
    expect(result.pending.reasons).toEqual(['plugin update']);
  });

  test('concurrent apply requests share one lifecycle restart', async () => {
    const applyRestart = mock(async () => ({ reloadDelayMs: 25 }));
    const runtime = createPendingConfigRestartRuntime({
      applyRestart,
      broadcastEvent: mock(() => undefined),
      getSessionActivitySnapshot: () => ({}),
    });
    runtime.markPendingConfigRestart('command update');

    const [first, second] = await Promise.all([
      runtime.applyPendingConfigRestart(),
      runtime.applyPendingConfigRestart(),
    ]);

    expect(applyRestart).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  test('forces a process restart for managed Agent Memory tool changes', async () => {
    const applyRestart = mock(async () => ({ reloadDelayMs: 25 }));
    const runtime = createPendingConfigRestartRuntime({
      applyRestart,
      broadcastEvent: mock(() => undefined),
      getSessionActivitySnapshot: () => ({}),
    });
    runtime.markPendingConfigRestart('Agent Memory tool setting changed', {
      scope: 'agent-memory',
    });

    await runtime.applyPendingConfigRestart();

    expect(applyRestart).toHaveBeenCalledWith(
      'pending configuration changes',
      { forceRestart: true },
    );
  });

  test('failed apply preserves pending changes', async () => {
    const runtime = createPendingConfigRestartRuntime({
      applyRestart: mock(async () => {
        throw new Error('restart failed');
      }),
      broadcastEvent: mock(() => undefined),
      getSessionActivitySnapshot: () => ({}),
    });
    runtime.markPendingConfigRestart('skill update');

    await expect(runtime.applyPendingConfigRestart()).rejects.toThrow('restart failed');

    expect(runtime.getPendingConfigRestart().count).toBe(1);
  });
});
