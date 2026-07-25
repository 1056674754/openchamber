import { describe, expect, test } from 'bun:test';
import type { ChildStoreManager } from './child-store';
import { registerSyncStores } from './multi-server-registry';
import { emitSyncConfigChanged, getSyncConfig, setSyncRefs, subscribeToSyncConfigChanges } from './sync-refs';
import type { State } from './types';

const makeChildStores = (directory: string, config: Record<string, unknown>): ChildStoreManager => {
  const state = { config } as State;
  return {
    children: new Map([[directory, { getState: () => state, setState: () => undefined }]]),
    getState: (dir: string) => (dir === directory ? state : undefined),
    getChild: () => undefined,
  } as unknown as ChildStoreManager;
};

describe('sync-refs OpenCode config bridge', () => {
  test('getSyncConfig scans default and multi-server stores by directory', () => {
    const localDir = '/local/project';
    const remoteDir = '/remote/project';
    const defaultStores = makeChildStores(localDir, { model: 'local/model' });
    const remoteStores = makeChildStores(remoteDir, { model: 'remote/model' });

    setSyncRefs({} as never, defaultStores, localDir);
    const unregister = registerSyncStores('remote-a', remoteStores, () => undefined);

    expect(getSyncConfig(localDir)?.model).toBe('local/model');
    expect(getSyncConfig(remoteDir)?.model).toBe('remote/model');
    expect(getSyncConfig(remoteDir, 'remote-a')?.model).toBe('remote/model');

    unregister();
  });

  test('emitSyncConfigChanged notifies subscribers', () => {
    const events: Array<{ directory: string; model?: string }> = [];
    const unsubscribe = subscribeToSyncConfigChanges((directory, config) => {
      events.push({ directory, model: typeof config.model === 'string' ? config.model : undefined });
    });

    emitSyncConfigChanged('/workspace/project', { model: 'openai/gpt' });
    expect(events).toEqual([{ directory: '/workspace/project', model: 'openai/gpt' }]);
    unsubscribe();
  });
});
