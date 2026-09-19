import { beforeEach, describe, expect, mock, test } from 'bun:test';

const executeCommand = mock(async () => undefined);
let currentWorkspaceFolders = [];
const updateWorkspaceFolders = mock((start, _deleteCount, ...foldersToAdd) => {
  currentWorkspaceFolders = [
    ...currentWorkspaceFolders.slice(0, start),
    ...foldersToAdd.map((folder) => ({
      name: folder.uri.fsPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
      uri: { ...folder.uri, fsPath: folder.uri.fsPath.replace(/[\\/]+$/, '') },
    })),
  ];
  return true;
});

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

mock.module('vscode', () => ({
  commands: { executeCommand },
  workspace: {
    get workspaceFolders() {
      return currentWorkspaceFolders;
    },
    updateWorkspaceFolders,
  },
  Uri: {
    file: (fsPath) => ({ scheme: 'file', fsPath }),
  },
  Position,
  Range,
}));

mock.module('./opencodeConfig', () => ({
  removeProviderConfig: mock(),
  getProviderSources: mock(),
}));
mock.module('./opencodeAuth', () => ({
  getProviderAuth: mock(),
  removeProviderAuth: mock(),
  listProviderAuths: mock(),
}));
mock.module('./quotaProviders', () => ({
  fetchQuotaForProvider: mock(),
  listConfiguredQuotaProviders: mock(),
}));
mock.module('./opencodeGoQuota', () => ({
  fetchOpenCodeGoUsage: mock(),
  getOpenCodeGoCredentialStatus: mock(),
  normalizeOpenCodeGoCredential: mock(),
  readOpenCodeGoCredential: mock(),
  writeOpenCodeGoCredential: mock(),
  deleteOpenCodeGoCredential: mock(),
}));
mock.module('./quotaCredentials', () => ({
  credentialStatus: mock(),
  deleteCredential: mock(),
  importCursorCredential: mock(),
  normalizeCredential: mock(),
  readCredential: mock(),
  validateCredential: mock(),
  writeCredential: mock(),
}));
mock.module('./sessionActivityWatcher', () => ({ getSessionActivitySnapshot: mock() }));

const { handleSystemBridgeMessage } = await import('./bridge-system-runtime.ts');

const deps = {
  resolveUserPath: (value) => value,
  fetchModelsMetadata: async () => ({}),
  updateCheckUrl: 'https://example.com/update-check',
  clientReloadDelayMs: 800,
};

describe('VS Code system bridge editor:openFile', () => {
  beforeEach(() => {
    executeCommand.mockClear();
    updateWorkspaceFolders.mockClear();
    currentWorkspaceFolders = [];
  });

  test('uses vscode.open so VS Code can select the notebook editor', async () => {
    const response = await handleSystemBridgeMessage({
      id: 'open-notebook',
      type: 'editor:openFile',
      payload: { path: '/workspace/notebook.ipynb' },
    }, undefined, deps);

    expect(response).toEqual({ id: 'open-notebook', type: 'editor:openFile', success: true });
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { scheme: 'file', fsPath: '/workspace/notebook.ipynb' },
      {},
    );
  });

  test('preserves line and column selection for regular files', async () => {
    await handleSystemBridgeMessage({
      id: 'open-text',
      type: 'editor:openFile',
      payload: { path: '/workspace/source.ts', line: 4, column: 7 },
    }, undefined, deps);

    const position = new Position(3, 7);
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { scheme: 'file', fsPath: '/workspace/source.ts' },
      { selection: new Range(position, position) },
    );
  });
});

describe('VS Code system bridge api:workspace:addFolder', () => {
  beforeEach(() => {
    updateWorkspaceFolders.mockClear();
    currentWorkspaceFolders = [{ name: 'one', uri: { fsPath: '/workspace/one' } }];
  });

  test('adds and returns the complete normalized workspace folder list', async () => {
    const response = await handleSystemBridgeMessage({
      id: 'add-folder',
      type: 'api:workspace:addFolder',
      payload: { path: '/workspace/two/' },
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-folder',
      type: 'api:workspace:addFolder',
      success: true,
      data: {
        workspaceFolders: [
          { name: 'one', path: '/workspace/one' },
          { name: 'two', path: '/workspace/two' },
        ],
      },
    });
    expect(updateWorkspaceFolders).toHaveBeenCalledWith(1, null, {
      uri: { scheme: 'file', fsPath: '/workspace/two/' },
    });
  });

  test('dedupes Windows drive letters and rejects missing paths', async () => {
    currentWorkspaceFolders = [{ name: 'one', uri: { fsPath: 'd:\\work\\one' } }];
    const existing = await handleSystemBridgeMessage({
      id: 'existing',
      type: 'api:workspace:addFolder',
      payload: { path: 'D:\\work\\one' },
    }, undefined, deps);
    expect(existing.success).toBe(true);
    expect(updateWorkspaceFolders).not.toHaveBeenCalled();

    await expect(handleSystemBridgeMessage({
      id: 'missing',
      type: 'api:workspace:addFolder',
      payload: {},
    }, undefined, deps)).resolves.toMatchObject({ success: false, error: 'Directory path is required' });
  });
});

describe('VS Code system bridge api:opencode/health', () => {
  const originalFetch = globalThis.fetch;

  test('normalizes OpenCode /global/health to {healthy:true}', async () => {
    const fetchMock = mock(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ healthy: true, version: '1.0.0' }),
    }));
    globalThis.fetch = fetchMock;

    try {
      const response = await handleSystemBridgeMessage({
        id: 'health-ok',
        type: 'api:opencode/health',
      }, {
        manager: {
          getApiUrl: () => 'http://127.0.0.1:41235',
          getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer token' }),
        },
      }, deps);

      expect(response).toEqual({
        id: 'health-ok',
        type: 'api:opencode/health',
        success: true,
        data: { healthy: true },
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:41235/global/health');
      expect(init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer token' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports healthy:false when the health endpoint fails', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => null,
    }));

    try {
      const response = await handleSystemBridgeMessage({
        id: 'health-down',
        type: 'api:opencode/health',
      }, {
        manager: {
          getApiUrl: () => 'http://127.0.0.1:41235',
          getOpenCodeAuthHeaders: () => ({}),
        },
      }, deps);

      expect(response).toMatchObject({
        id: 'health-down',
        type: 'api:opencode/health',
        success: true,
        data: { healthy: false, error: 'Service Unavailable' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports healthy:false when the manager has no API URL', async () => {
    const response = await handleSystemBridgeMessage({
      id: 'health-no-manager',
      type: 'api:opencode/health',
    }, {
      manager: {
        getApiUrl: () => undefined,
        getOpenCodeAuthHeaders: () => ({}),
      },
    }, deps);

    expect(response).toEqual({
      id: 'health-no-manager',
      type: 'api:opencode/health',
      success: true,
      data: { healthy: false, error: 'OpenCode manager unavailable' },
    });
  });
});
