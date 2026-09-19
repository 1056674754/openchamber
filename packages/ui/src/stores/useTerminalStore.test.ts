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

  test('snapshot chunks remember the PTY size their history was drawn for', () => {
    const tabId = setup();

    useTerminalStore.getState().replaceBuffer('/repo', tabId, 'sized\n', 1, 'default', { cols: 94, rows: 56 });
    useTerminalStore.getState().appendToBuffer('/repo', tabId, 'live\n', 'default', 2);

    const chunks = useTerminalStore.getState().getBuffer('/repo', tabId).chunks;
    expect(chunks[0]?.size).toEqual({ cols: 94, rows: 56 });
    // Only snapshot history carries a drawn size; live output follows the fitted grid.
    expect(chunks[1]?.size).toBeUndefined();

    useTerminalStore.getState().replaceBuffer('/repo', tabId, 'plain\n', 3);
    const plainChunks = useTerminalStore.getState().getBuffer('/repo', tabId).chunks;
    expect(plainChunks[0]?.data).toBe('plain\n');
    expect(plainChunks[0]?.size).toBeUndefined();
  });
});

describe('default terminal tab labels', () => {
  afterEach(() => useTerminalStore.getState().clearAll());

  const labels = () => useTerminalStore.getState().getDirectoryState('/repo')!.tabs.map((tab) => tab.label);

  test('does not reuse the number of a closed tab', () => {
    const first = setup();
    useTerminalStore.getState().createTab('/repo');
    expect(labels()).toEqual(['Terminal', 'Terminal 2']);

    useTerminalStore.getState().closeTab('/repo', first);
    useTerminalStore.getState().createTab('/repo');

    expect(labels()).toEqual(['Terminal 2', 'Terminal 3']);
  });

  test('numbers past a user-renamed Terminal label', () => {
    const first = setup();
    useTerminalStore.getState().setTabLabel('/repo', first, 'Terminal 5');
    useTerminalStore.getState().createTab('/repo');

    expect(labels()).toEqual(['Terminal 5', 'Terminal 6']);
  });

  test('starts at Terminal when no default labels remain', () => {
    const first = setup();
    useTerminalStore.getState().setTabLabel('/repo', first, 'build');
    useTerminalStore.getState().createTab('/repo');

    expect(labels()).toEqual(['build', 'Terminal']);
  });
});
