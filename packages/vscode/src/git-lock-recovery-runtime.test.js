import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  populateWorktreeWithLockRecovery,
} from './git-lock-recovery-runtime';

const execFileAsync = promisify(execFile);
const tempDirectories = [];

const runGit = async (cwd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], { cwd });
    return {
      success: true,
      exitCode: 0,
      stdout: String(stdout),
      stderr: String(stderr),
      message: '',
    };
  } catch (error) {
    if (error instanceof Error) {
      const stdout = Reflect.get(error, 'stdout');
      const stderr = Reflect.get(error, 'stderr');
      const code = Reflect.get(error, 'code');
      return {
        success: false,
        exitCode: typeof code === 'number' ? code : 1,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        message: error.message,
      };
    }
    throw error;
  }
};

const runGitOrThrow = async (cwd, args) => {
  const result = await runGit(cwd, args);
  if (!result.success) {
    throw new Error(result.message || result.stderr || 'Git command failed');
  }
  return result.stdout;
};

const createLockedWorktree = async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-git-repo-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-git-worktree-'));
  tempDirectories.push(repo, worktree);

  await runGitOrThrow(repo, ['init', '-b', 'main']);
  await runGitOrThrow(repo, ['config', 'user.email', 'test@example.com']);
  await runGitOrThrow(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
  await runGitOrThrow(repo, ['add', 'README.md']);
  await runGitOrThrow(repo, ['commit', '-m', 'Initial commit']);
  fs.rmSync(worktree, { recursive: true, force: true });
  await runGitOrThrow(repo, [
    'worktree',
    'add',
    '--no-checkout',
    '-b',
    `feature/vscode-lock-${Date.now()}`,
    worktree,
    'HEAD',
  ]);

  const gitDirValue = fs.readFileSync(path.join(worktree, '.git'), 'utf8').replace(/^gitdir:\s*/i, '').trim();
  const gitDirectory = path.isAbsolute(gitDirValue)
    ? gitDirValue
    : path.resolve(worktree, gitDirValue);
  const lockPath = path.join(gitDirectory, 'index.lock');
  fs.writeFileSync(lockPath, 'stale');

  return { lockPath, worktree };
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('VS Code worktree lock recovery', () => {
  test('removes an unchanged stale lock and populates the worktree', async () => {
    const { lockPath, worktree } = await createLockedWorktree();

    await populateWorktreeWithLockRecovery(worktree, runGit);

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.readFileSync(path.join(worktree, 'README.md'), 'utf8')).toBe('# Test\n');
  });

  test('preserves a lock that changes during the stale observation window', async () => {
    const { lockPath, worktree } = await createLockedWorktree();
    const updateTimer = setTimeout(() => {
      fs.writeFileSync(lockPath, 'active-lock');
    }, 500);

    try {
      await expect(populateWorktreeWithLockRecovery(worktree, runGit)).rejects.toThrow();
      expect(fs.readFileSync(lockPath, 'utf8')).toBe('active-lock');
    } finally {
      clearTimeout(updateTimer);
    }
  });
});
