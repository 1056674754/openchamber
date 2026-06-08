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
