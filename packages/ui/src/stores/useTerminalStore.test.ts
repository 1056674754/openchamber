import { afterEach, describe, expect, test } from 'bun:test';

import { useTerminalStore } from './useTerminalStore';

const setup = (directory = '/repo', serverId = 'default'): string => {
  useTerminalStore.getState().ensureDirectory(directory, serverId);
  return useTerminalStore.getState().getDirectoryState(directory, serverId)!.tabs[0].id;
};

describe('terminal buffer isolation', () => {
  afterEach(() => useTerminalStore.getState().clearAll());

  test('streaming output preserves persisted session references', () => {
    const tabId = setup();
    const sessionsBefore = useTerminalStore.getState().sessions;
    const directoryBefore = useTerminalStore.getState().getDirectoryState('/repo');

    for (let sequence = 1; sequence <= 90; sequence += 1) {
      useTerminalStore.getState().appendToBuffer('/repo', tabId, `line ${sequence}\n`, 'default', sequence);
    }

    const state = useTerminalStore.getState();
    expect(state.sessions).toBe(sessionsBefore);
    expect(state.getDirectoryState('/repo')).toBe(directoryBefore);
    expect(state.getBuffer('/repo', tabId).chunks).toHaveLength(90);
  });

  test('keeps buffers isolated by server, directory, and tab', () => {
    const localTab = setup('/repo', 'default');
    const remoteTab = setup('/repo', 'remote-a');

    useTerminalStore.getState().appendToBuffer('/repo', localTab, 'local', 'default', 1);
    useTerminalStore.getState().appendToBuffer('/repo', remoteTab, 'remote', 'remote-a', 1);

    expect(useTerminalStore.getState().getBuffer('/repo', localTab, 'default').chunks[0]?.data).toBe('local');
    expect(useTerminalStore.getState().getBuffer('/repo', remoteTab, 'remote-a').chunks[0]?.data).toBe('remote');
  });
});
