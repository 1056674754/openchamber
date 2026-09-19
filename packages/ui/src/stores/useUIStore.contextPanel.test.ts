import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import {
  normalizeContextPanelDirectoryKey,
  resolveContextPanelStorageKey,
  setContextPanelSessionIdProvider,
  useUIStore,
} from './useUIStore';

describe('useUIStore context panel file tabs', () => {
  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [] });
  });

  test('opens absolute file paths under their owning directory when the caller directory is unrelated', () => {
    useUIStore.getState().openContextFile('/local/project', '/root/remote/project/docs/readme.md');

    const byDirectory = useUIStore.getState().contextPanelByDirectory;
    expect(byDirectory['/local/project']).toBe(undefined);
    expect(byDirectory['/root/remote/project/docs']?.tabs[0]?.targetPath).toBe('/root/remote/project/docs/readme.md');
  });

  test('keeps absolute file paths under the requested directory when they belong to it', () => {
    useUIStore.getState().openContextFile('/root/remote/project', '/root/remote/project/docs/readme.md');

    const byDirectory = useUIStore.getState().contextPanelByDirectory;
    expect(byDirectory['/root/remote/project']?.tabs[0]?.targetPath).toBe('/root/remote/project/docs/readme.md');
  });

  test('opens and toggles singleton surfaces without discarding other surface tabs', () => {
    const store = useUIStore.getState();
    store.openContextSurface('/root/remote/project', 'git');
    store.openContextSurface('/root/remote/project', 'notes');

    let panel = useUIStore.getState().contextPanelByDirectory['/root/remote/project'];
    expect(panel?.isOpen).toBe(true);
    expect(panel?.tabs.map((tab) => tab.mode)).toEqual(['git', 'notes']);
    expect(panel?.tabs.find((tab) => tab.id === panel?.activeTabId)?.mode).toBe('notes');

    useUIStore.getState().openContextSurface('/root/remote/project', 'notes');
    panel = useUIStore.getState().contextPanelByDirectory['/root/remote/project'];
    expect(panel?.isOpen).toBe(false);
    expect(panel?.tabs.map((tab) => tab.mode)).toEqual(['git', 'notes']);
  });

  test('does not create content-driven preview or chat tabs without a target', () => {
    useUIStore.getState().openContextSurface('/root/remote/project', 'preview');
    useUIStore.getState().openContextSurface('/root/remote/project', 'chat');

    expect(useUIStore.getState().contextPanelByDirectory['/root/remote/project']).toBe(undefined);
  });

  test('keeps one width across surface modes', () => {
    const store = useUIStore.getState();
    store.setContextPanelWidth('/root/remote/project', 480);
    store.setContextPanelWidth('/root/remote/project', 760);

    const panel = useUIStore.getState().contextPanelByDirectory['/root/remote/project'];
    expect(panel?.width).toBe(760);
    expect((panel as { widthByMode?: unknown } | undefined)?.widthByMode).toBeUndefined();
  });

  test('deduplicates persisted rail order', () => {
    useUIStore.getState().setContextRailOrder(['git', 'diff', 'git', '', 'terminal']);
    expect(useUIStore.getState().contextRailOrder).toEqual(['git', 'diff', 'terminal']);
  });
});

describe('useUIStore closeContextPanelTab file surface stability', () => {
  const directory = '/root/remote/project';

  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [] });
  });

  test('closing the last file tab keeps the file surface on its empty file tab', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });
    useUIStore.getState().openContextFile(directory, `${directory}/a.ts`);

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    const fileTabId = stateBefore?.tabs.find((tab) => tab.mode === 'file')?.id;
    if (!fileTabId) throw new Error('expected a file tab');
    useUIStore.getState().closeContextPanelTab(directory, fileTabId);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
    expect(state?.isOpen).toBe(true);
    expect(activeTab?.mode).toBe('file');
    expect(activeTab?.targetPath).toBe(null);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['terminal', 'file']);
  });

  test('closing the empty file tab itself still closes the surface', () => {
    useUIStore.getState().openContextSurface(directory, 'file');

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    const fileTabId = stateBefore?.tabs.find((tab) => tab.mode === 'file')?.id;
    if (!fileTabId) throw new Error('expected a file tab');
    useUIStore.getState().closeContextPanelTab(directory, fileTabId);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs).toHaveLength(0);
  });

  test('closing the last tab of a non-file surface still closes the panel', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    const terminalTabId = stateBefore?.activeTabId;
    if (!terminalTabId) throw new Error('expected a terminal tab');
    useUIStore.getState().closeContextPanelTab(directory, terminalTabId);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs).toHaveLength(0);
  });
});

describe('context panel storage key resolution', () => {
  test('directory scope keys by the normalized directory', () => {
    expect(resolveContextPanelStorageKey('/root/proj/', 'directory', 'sess-1')).toBe('/root/proj');
    expect(resolveContextPanelStorageKey('', 'directory', 'sess-1')).toBe('');
    expect(resolveContextPanelStorageKey(null, 'directory', null)).toBe('');
  });

  test('session scope keys by the conversation id and falls back without one', () => {
    expect(resolveContextPanelStorageKey('/root/proj', 'session', 'sess-1')).toBe('session:sess-1');
    expect(resolveContextPanelStorageKey('/root/proj', 'session', '  sess-1  ')).toBe('session:sess-1');
    expect(resolveContextPanelStorageKey('/root/proj', 'session', '')).toBe('/root/proj');
    expect(resolveContextPanelStorageKey('/root/proj', 'session', null)).toBe('/root/proj');
  });

  test('directory keys pass normalization untouched, including session-prefixed ones', () => {
    // sanitizeContextPanelByDirectory normalizes every record key on rehydrate;
    // session keys must survive that pass verbatim.
    expect(normalizeContextPanelDirectoryKey('/root/proj///')).toBe('/root/proj');
    expect(normalizeContextPanelDirectoryKey('session:sess-1')).toBe('session:sess-1');
  });
});

describe('useUIStore context panel session scope', () => {
  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [], contextPanelScope: 'directory' });
    setContextPanelSessionIdProvider(null);
  });

  afterEach(() => {
    setContextPanelSessionIdProvider(null);
  });

  test('defaults to the directory scope', () => {
    expect(useUIStore.getState().contextPanelScope).toBe('directory');
  });

  test('session scope writes panel state under the active conversation key', () => {
    setContextPanelSessionIdProvider(() => 'sess-1');
    useUIStore.getState().setContextPanelScope('session');
    useUIStore.getState().openContextSurface('/root/remote/project', 'git');

    const byKey = useUIStore.getState().contextPanelByDirectory;
    expect(byKey['/root/remote/project']).toBe(undefined);
    expect(byKey['session:sess-1']?.isOpen).toBe(true);
    expect(byKey['session:sess-1']?.tabs.map((tab) => tab.mode)).toEqual(['git']);
  });

  test('each conversation keeps an isolated panel state', () => {
    setContextPanelSessionIdProvider(() => 'sess-1');
    useUIStore.getState().setContextPanelScope('session');
    useUIStore.getState().openContextSurface('/root/remote/project', 'git');

    setContextPanelSessionIdProvider(() => 'sess-2');
    expect(useUIStore.getState().contextPanelByDirectory['session:sess-2']).toBe(undefined);
    useUIStore.getState().openContextSurface('/root/remote/project', 'notes');

    const byKey = useUIStore.getState().contextPanelByDirectory;
    expect(byKey['session:sess-2']?.tabs.map((tab) => tab.mode)).toEqual(['notes']);
    expect(byKey['session:sess-1']?.tabs.map((tab) => tab.mode)).toEqual(['git']);
  });

  test('without an active conversation the panel falls back to the directory key', () => {
    useUIStore.getState().setContextPanelScope('session');
    setContextPanelSessionIdProvider(() => null);
    useUIStore.getState().openContextSurface('/root/remote/project', 'git');

    expect(useUIStore.getState().contextPanelByDirectory['/root/remote/project']?.isOpen).toBe(true);
  });

  test('switching scope back to directory leaves both states intact', () => {
    setContextPanelSessionIdProvider(() => 'sess-1');
    useUIStore.getState().setContextPanelScope('session');
    useUIStore.getState().openContextSurface('/root/remote/project', 'git');

    useUIStore.getState().setContextPanelScope('directory');
    useUIStore.getState().openContextSurface('/root/remote/project', 'notes');

    const byKey = useUIStore.getState().contextPanelByDirectory;
    expect(byKey['session:sess-1']?.tabs.map((tab) => tab.mode)).toEqual(['git']);
    expect(byKey['/root/remote/project']?.tabs.map((tab) => tab.mode)).toEqual(['notes']);
  });

  test('panel key passed back into actions is idempotent under session scope', () => {
    setContextPanelSessionIdProvider(() => 'sess-1');
    useUIStore.getState().setContextPanelScope('session');
    useUIStore.getState().openContextSurface('/root/remote/project', 'git');

    // Components re-pass the resolved key (session-prefixed) into actions;
    // resolution must not mangle it into a bogus directory entry.
    useUIStore.getState().closeContextPanel('session:sess-1');

    const panel = useUIStore.getState().contextPanelByDirectory['session:sess-1'];
    expect(panel?.isOpen).toBe(false);
    expect(useUIStore.getState().contextPanelByDirectory['/root/remote/project']).toBe(undefined);
  });

  test('session scope sanitizes invalid scope values back to directory', () => {
    useUIStore.getState().setContextPanelScope('bogus' as 'session');
    expect(useUIStore.getState().contextPanelScope).toBe('directory');
  });
});

describe('useUIStore mobile workspace drawer state', () => {
  beforeEach(() => {
    useUIStore.setState({ isRightSidebarOpen: false });
  });

  test('keeps the mobile right drawer open state after desktop sidebar removal', () => {
    useUIStore.getState().setRightSidebarOpen(true);
    expect(useUIStore.getState().isRightSidebarOpen).toBe(true);

    useUIStore.getState().setRightSidebarOpen(false);
    expect(useUIStore.getState().isRightSidebarOpen).toBe(false);
  });

  test('removes legacy desktop right sidebar state during v17 migration', async () => {
    const migrate = useUIStore.persist.getOptions().migrate;
    expect(typeof migrate).toBe('function');

    const migrated = await migrate?.({
      isRightSidebarOpen: true,
      rightSidebarWidth: 520,
      hasManuallyResizedRightSidebar: true,
      rightSidebarTab: 'files',
      shortcutOverrides: {
        toggle_right_sidebar: 'mod+b',
        open_right_sidebar_git: 'mod+shift+g',
        open_right_sidebar_files: 'mod+shift+f',
        cycle_right_sidebar_tab: 'mod+shift+]',
        toggle_terminal: 'mod+j',
      },
    }, 16) as Record<string, unknown>;

    expect(migrated.isRightSidebarOpen).toBe(true);
    expect('rightSidebarWidth' in migrated).toBe(false);
    expect('hasManuallyResizedRightSidebar' in migrated).toBe(false);
    expect('rightSidebarTab' in migrated).toBe(false);
    expect(migrated.shortcutOverrides).toEqual({ toggle_terminal: 'mod+j' });
  });
});
