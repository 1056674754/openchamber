import { beforeEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

describe('useUIStore context panel file tabs', () => {
  beforeEach(() => {
    useUIStore.setState({ contextPanelByDirectory: {} });
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
});
