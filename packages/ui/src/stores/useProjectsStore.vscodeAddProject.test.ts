import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProjectEntry } from '@/lib/api/types';

(mock as unknown as { restore?: () => void }).restore?.();

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __VSCODE_CONFIG__: {
      workspaceFolder: '/workspace/one',
      workspaceFolders: [{ name: 'one', path: '/workspace/one' }],
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { href: 'https://example.test/', search: '', pathname: '/', hash: '' },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { platform: 'linux', userAgent: 'bun-test', language: 'en-US', maxTouchPoints: 0 },
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: (() => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size; },
    };
  })(),
});

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: new Proxy({ setDirectory: () => {} }, { get: (target, property) => (
    property in target ? target[property as keyof typeof target] : () => undefined
  ) }),
}));
mock.module('@/lib/persistence', () => ({ updateDesktopSettings: async () => {} }));

const addWorkspaceFolderCalls: string[] = [];
let addWorkspaceFolderError: Error | null = null;
mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: () => ({
    runtime: { platform: 'vscode', isDesktop: false, isVSCode: true, label: 'VS Code' },
    vscode: {
      async addWorkspaceFolder(path: string) {
        addWorkspaceFolderCalls.push(path);
        if (addWorkspaceFolderError) throw addWorkspaceFolderError;
        return [
          { name: 'one', path: '/workspace/one' },
          { name: 'two', path },
        ];
      },
    },
  }),
  registerRuntimeAPIs: () => {},
}));

const { useProjectsStore } = await import(`./useProjectsStore?mode=vscode-add-${Date.now()}`);

beforeEach(() => {
  addWorkspaceFolderCalls.length = 0;
  addWorkspaceFolderError = null;
});

describe('VS Code add project workspace parity', () => {
  test('hydrates all bootstrap folders and adds a new workspace folder', async () => {
    expect(useProjectsStore.getState().projects.map((project: ProjectEntry) => project.path)).toEqual(['/workspace/one']);
    const added = await useProjectsStore.getState().addProject('/workspace/two');
    expect(addWorkspaceFolderCalls).toEqual(['/workspace/two']);
    expect(added?.path).toBe('/workspace/two');
    expect(useProjectsStore.getState().projects.map((project: ProjectEntry) => project.path)).toEqual([
      '/workspace/one',
      '/workspace/two',
    ]);
  });

  test('dedupes existing folders and fails cleanly when the host rejects the add', async () => {
    const existing = await useProjectsStore.getState().addProject('/workspace/one');
    expect(existing?.path).toBe('/workspace/one');
    expect(addWorkspaceFolderCalls).toEqual([]);

    addWorkspaceFolderError = new Error('rejected');
    expect(await useProjectsStore.getState().addProject('/workspace/rejected')).toBeNull();
    expect(useProjectsStore.getState().projects.some((project: ProjectEntry) => project.path === '/workspace/rejected')).toBe(false);
  });
});
