import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { promisify } from 'node:util';

const originalGitCheckIgnoreTimeout = process.env.OPENCHAMBER_GIT_CHECK_IGNORE_TIMEOUT_MS;
process.env.OPENCHAMBER_GIT_CHECK_IGNORE_TIMEOUT_MS = '1';

const execCalls = [];
const execMock = mock(() => {
  throw new Error('exec should be called through promisify');
});

execMock[promisify.custom] = (command, options) => {
  execCalls.push({ command, options });
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ stdout: '/repo/.git\n/repo/.git\n', stderr: '' });
    }, 10);
  });
};

mock.module('child_process', () => ({
  exec: execMock,
}));

mock.module('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    fs: {},
  },
  Uri: {
    file: (fsPath) => ({ fsPath }),
  },
  FileType: {
    Directory: 2,
  },
  window: {},
}));

const uploadCalls = [];
mock.module('./fs-upload-runtime', () => ({
  writeVSCodeUploadedFile: mock(async (input) => {
    uploadCalls.push(input);
    return { status: 200, body: { success: true, path: input.targetPath } };
  }),
}));

const { clearGitReadCacheForTests, handleFsBridgeMessage } = await import('./bridge-fs-runtime');

afterAll(() => {
  if (originalGitCheckIgnoreTimeout === undefined) {
    delete process.env.OPENCHAMBER_GIT_CHECK_IGNORE_TIMEOUT_MS;
  } else {
    process.env.OPENCHAMBER_GIT_CHECK_IGNORE_TIMEOUT_MS = originalGitCheckIgnoreTimeout;
  }
});

const deps = {
  resolveUserPath: (value) => value,
  listDirectoryEntries: mock(),
  normalizeFsPath: (value) => value,
  execGit: mock(),
  searchDirectory: mock(),
  resolveFileReadPath: mock(),
  parseDroppedFileReference: mock(),
  readUriAsAttachment: mock(),
};

describe('bridge fs exec git read cache', () => {
  beforeEach(() => {
    execCalls.length = 0;
    clearGitReadCacheForTests();
  });

  it('dedupes in-flight cacheable git reads and reuses fresh results', async () => {
    const command = 'git rev-parse --absolute-git-dir --git-common-dir';
    const cwd = '/repo';

    const [first, second] = await Promise.all([
      handleFsBridgeMessage({ id: '1', type: 'api:fs:exec', payload: { commands: [command], cwd } }, deps),
      handleFsBridgeMessage({ id: '2', type: 'api:fs:exec', payload: { commands: [command], cwd } }, deps),
    ]);

    expect(first?.success).toBe(true);
    expect(second?.success).toBe(true);
    expect(execCalls).toHaveLength(1);

    const spacedCommand = 'git   rev-parse   --absolute-git-dir   --git-common-dir';
    const cached = await handleFsBridgeMessage({ id: '3', type: 'api:fs:exec', payload: { commands: [spacedCommand], cwd } }, deps);

    expect(execCalls).toHaveLength(1);
    expect(cached?.data?.results?.[0]).toMatchObject({
      command: spacedCommand,
      success: true,
      stdout: '/repo/.git\n/repo/.git',
    });
  });

  it('does not cache arbitrary exec commands', async () => {
    const command = 'git status --porcelain';
    const cwd = '/repo';

    await handleFsBridgeMessage({ id: '1', type: 'api:fs:exec', payload: { commands: [command], cwd } }, deps);
    await handleFsBridgeMessage({ id: '2', type: 'api:fs:exec', payload: { commands: [command], cwd } }, deps);

    expect(execCalls).toHaveLength(2);
  });

  it('returns unfiltered directory entries when git check-ignore times out', async () => {
    const entries = [
      { name: 'src', path: '/repo/src', isDirectory: true },
      { name: 'dist', path: '/repo/dist', isDirectory: true },
    ];
    const localDeps = {
      ...deps,
      listDirectoryEntries: mock(async () => entries),
      execGit: mock(async () => new Promise(() => {})),
    };

    const result = await handleFsBridgeMessage(
      { id: '3', type: 'api:fs:list', payload: { path: '/repo', respectGitignore: true } },
      localDeps,
    );

    expect(result).toMatchObject({
      id: '3',
      type: 'api:fs:list',
      success: true,
      data: { entries, directory: '/repo', path: '/repo' },
    });
    expect(localDeps.execGit).toHaveBeenCalledTimes(1);
  });
});

describe('bridge binary file reads', () => {
  it('returns a data URL through the same authorized path resolver', async () => {
    const localDeps = {
      ...deps,
      resolveFileReadPath: mock(async () => ({ ok: true, resolvedPath: '/workspace/image.png' })),
      readUriAsAttachment: mock(async () => ({
        file: { name: 'image.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,cG5n' },
      })),
    };

    const result = await handleFsBridgeMessage(
      { id: 'binary-1', type: 'api:fs:read-binary', payload: { path: '/workspace/image.png' } },
      localDeps,
    );

    expect(result).toEqual({
      id: 'binary-1',
      type: 'api:fs:read-binary',
      success: true,
      data: { dataUrl: 'data:image/png;base64,cG5n', path: '/workspace/image.png' },
    });
    expect(localDeps.resolveFileReadPath).toHaveBeenCalledWith('/workspace/image.png');
  });
});

describe('bridge binary uploads', () => {
  beforeEach(() => {
    uploadCalls.length = 0;
  });

  it('forwards explicit workspace authority and bytes to the atomic runtime', async () => {
    const result = await handleFsBridgeMessage({
      id: 'upload-1',
      type: 'api:fs:upload',
      payload: {
        directory: '/workspace/project',
        path: '/workspace/project/image.png',
        bodyBase64: 'cG5n',
        overwrite: true,
      },
    }, deps);

    expect(uploadCalls).toEqual([{
      directory: '/workspace/project',
      targetPath: '/workspace/project/image.png',
      bodyBase64: 'cG5n',
      overwrite: true,
    }]);
    expect(result).toEqual({
      id: 'upload-1',
      type: 'api:fs:upload',
      success: true,
      data: {
        status: 200,
        body: { success: true, path: '/workspace/project/image.png' },
      },
    });
  });

  it('rejects an owning directory outside the VS Code workspace', async () => {
    const result = await handleFsBridgeMessage({
      id: 'upload-2',
      type: 'api:fs:upload',
      payload: {
        directory: '/outside',
        path: '/outside/image.png',
        bodyBase64: 'cG5n',
      },
    }, deps);

    expect(uploadCalls).toEqual([]);
    expect(result).toMatchObject({
      success: true,
      data: {
        status: 403,
        body: { reason: 'outside-workspace' },
      },
    });
  });
});
