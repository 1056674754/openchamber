import fs from 'node:fs';
import path from 'node:path';

const WORKTREE_INDEX_LOCK_RETRY_DELAY_MS = 250;
const WORKTREE_INDEX_LOCK_STALE_DELAY_MS = 750;

export type GitCommandResult = {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly message?: string;
};

type RunGitCommand = (cwd: string, args: string[]) => Promise<GitCommandResult>;

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const getErrorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
};

const getFileIdentity = async (filePath: string): Promise<string | null> => {
  try {
    const stat = await fs.promises.stat(filePath);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const getWorktreeIndexLockPath = async (
  directory: string,
  runGitCommand: RunGitCommand,
): Promise<string | null> => {
  const result = await runGitCommand(directory, ['rev-parse', '--git-path', 'index.lock']);
  if (result.success) {
    const value = result.stdout.trim();
    if (value) {
      return path.isAbsolute(value) ? value : path.resolve(directory, value);
    }
  }

  const dotGitPath = path.join(directory, '.git');
  const dotGitStat = await fs.promises.stat(dotGitPath).catch(() => null);
  if (dotGitStat?.isDirectory()) {
    return path.join(dotGitPath, 'index.lock');
  }
  if (!dotGitStat?.isFile()) {
    return null;
  }

  const dotGitValue = await fs.promises.readFile(dotGitPath, 'utf8').catch(() => '');
  const gitDirectoryValue = dotGitValue.replace(/^gitdir:\s*/i, '').trim();
  if (!gitDirectoryValue) {
    return null;
  }
  const gitDirectory = path.isAbsolute(gitDirectoryValue)
    ? gitDirectoryValue
    : path.resolve(directory, gitDirectoryValue);
  return path.join(gitDirectory, 'index.lock');
};

const isIndexLockError = async (
  result: GitCommandResult,
  directory: string,
  runGitCommand: RunGitCommand,
): Promise<boolean> => {
  const message = [result.message, result.stderr, result.stdout].filter(Boolean).join('\n');
  if (/index\.lock['"]?: File exists|another git process seems to be running/i.test(message)) {
    return true;
  }
  const lockPath = await getWorktreeIndexLockPath(directory, runGitCommand);
  return lockPath ? await getFileIdentity(lockPath) !== null : false;
};

const createPopulateError = (result: GitCommandResult): Error => (
  new Error(result.message || 'Failed to populate worktree')
);

export const populateWorktreeWithLockRecovery = async (
  directory: string,
  runGitCommand: RunGitCommand,
): Promise<void> => {
  let result = await runGitCommand(directory, ['reset', '--hard']);
  if (result.success) {
    return;
  }
  if (!await isIndexLockError(result, directory, runGitCommand)) {
    throw createPopulateError(result);
  }

  await wait(WORKTREE_INDEX_LOCK_RETRY_DELAY_MS);
  result = await runGitCommand(directory, ['reset', '--hard']);
  if (result.success) {
    return;
  }
  if (!await isIndexLockError(result, directory, runGitCommand)) {
    throw createPopulateError(result);
  }

  const lockPath = await getWorktreeIndexLockPath(directory, runGitCommand);
  const identity = lockPath ? await getFileIdentity(lockPath) : null;
  await wait(WORKTREE_INDEX_LOCK_STALE_DELAY_MS);

  result = await runGitCommand(directory, ['reset', '--hard']);
  if (result.success) {
    return;
  }
  if (!await isIndexLockError(result, directory, runGitCommand)) {
    throw createPopulateError(result);
  }
  if (!lockPath) {
    throw createPopulateError(result);
  }
  if (!identity) {
    throw createPopulateError(result);
  }
  if (await getFileIdentity(lockPath) !== identity) {
    throw createPopulateError(result);
  }

  await fs.promises.unlink(lockPath).catch((error) => {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  });

  const finalResult = await runGitCommand(directory, ['reset', '--hard']);
  if (!finalResult.success) {
    throw createPopulateError(finalResult);
  }
};
