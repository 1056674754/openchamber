import { beforeEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

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

  test('persists widths independently per surface mode', () => {
    const store = useUIStore.getState();
    store.setContextPanelWidth('/root/remote/project', 'git', 480);
    store.setContextPanelWidth('/root/remote/project', 'diff', 760);

    const panel = useUIStore.getState().contextPanelByDirectory['/root/remote/project'];
    expect(panel?.widthByMode.git).toBe(480);
    expect(panel?.widthByMode.diff).toBe(760);
  });

  test('deduplicates persisted rail order', () => {
    useUIStore.getState().setContextRailOrder(['git', 'diff', 'git', '', 'terminal']);
    expect(useUIStore.getState().contextRailOrder).toEqual(['git', 'diff', 'terminal']);
  });
});
