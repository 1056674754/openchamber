import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import simpleGit from 'simple-git';

import {
  applyHunk,
  checkoutBranch,
  checkoutCommit,
  cherryPick,
  createWorktree,
  fetch,
  getDiff,
  getTrackingBranch,
  getFileDiff,
  getRemotes,
  getStatus,
  getWorktreeBootstrapStatus,
  getBranchBase,
  getUnpushedBranchCounts,
  getRangeFiles,
  parseBranchCreationSource,
  populateWorktreeWithLockRecovery,
  runPostCheckoutHook,
  resetToCommit,
  resolveBaseRefForLog,
  revertCommit,
  setLocalIdentity,
  stageFiles,
  unstageFiles,
  validateWorktreeCreate,
} from './service.js';

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const tempDirs = [];

/** Create a temp dir and register it for afterEach cleanup. */
const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-git-service-'));
  tempDirs.push(dir);
  return dir;
};

const runGit = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const canRunGit = () => {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('worktree population', () => {
  const createLockedWorktree = () => {
    const repo = createTempDir();
    const worktree = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
    runGit(repo, ['add', 'README.md']);
    runGit(repo, ['commit', '-m', 'Initial commit']);
    fs.rmSync(worktree, { recursive: true, force: true });
    runGit(repo, ['worktree', 'add', '--no-checkout', '-b', `feature/lock-${Date.now()}`, worktree, 'HEAD']);

    const gitDirValue = fs.readFileSync(path.join(worktree, '.git'), 'utf8').replace(/^gitdir:\s*/, '').trim();
    const gitDir = path.isAbsolute(gitDirValue)
      ? gitDirValue
      : path.resolve(worktree, gitDirValue);
    const lockPath = path.join(gitDir, 'index.lock');
    fs.writeFileSync(lockPath, 'stale');
    return { lockPath, worktree };
  };

  it('recovers from an unchanged stale index lock', async () => {
    if (!canRunGit()) return;

    const { lockPath, worktree } = createLockedWorktree();

    await populateWorktreeWithLockRecovery(worktree);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.readFileSync(path.join(worktree, 'README.md'), 'utf8')).toBe('# Test\n');
    expect(runGit(worktree, ['config', '--get', 'core.longpaths']).trim()).toBe('true');
  });

  it('preserves an index lock that changes during the stale observation window', async () => {
    if (!canRunGit()) return;

    const { lockPath, worktree } = createLockedWorktree();
    let updateCount = 0;
    const updateTimer = setInterval(() => {
      updateCount += 1;
      fs.writeFileSync(lockPath, `active-lock-${updateCount}`);
    }, 100);

    try {
      await expect(populateWorktreeWithLockRecovery(worktree)).rejects.toThrow();
      expect(fs.readFileSync(lockPath, 'utf8')).toMatch(/^active-lock-/);
    } finally {
      clearInterval(updateTimer);
    }
  });
});

describe('worktree checkout bootstrap', () => {
  it('runs the post-checkout hook after population', async () => {
    if (!canRunGit()) return;

    const previousXdgDataHome = process.env.XDG_DATA_HOME;
    const dataHome = createTempDir();
    process.env.XDG_DATA_HOME = dataHome;

    try {
      const repo = createTempDir();
      runGit(repo, ['init', '-b', 'main']);
      runGit(repo, ['config', 'user.email', 'test@example.com']);
      runGit(repo, ['config', 'user.name', 'Test User']);
      fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
      runGit(repo, ['add', 'README.md']);
      runGit(repo, ['commit', '-m', 'Initial commit']);
      const head = runGit(repo, ['rev-parse', 'HEAD']).trim();
      const hookLog = path.join(dataHome, 'post-checkout.log');
      const hookPath = path.join(repo, '.git', 'hooks', 'post-checkout');
      fs.writeFileSync(
        hookPath,
        `#!/bin/sh\nprintf '%s|%s|%s|%s' "$1" "$2" "$3" "$(pwd -P)" > ${JSON.stringify(hookLog)}\n`,
      );
      fs.chmodSync(hookPath, 0o755);

      const worktree = createTempDir();
      fs.rmSync(worktree, { recursive: true, force: true });
      runGit(repo, ['worktree', 'add', '--no-checkout', '-b', 'openchamber/hook-test', worktree, 'HEAD']);
      await populateWorktreeWithLockRecovery(worktree);
      await runPostCheckoutHook(worktree);

      const [previousHead, newHead, flag, cwd] = fs.readFileSync(hookLog, 'utf8').split('|');
      expect(previousHead).toBe('0000000000000000000000000000000000000000');
      expect(newHead).toBe(head);
      expect(flag).toBe('1');
      expect(cwd).toBe(fs.realpathSync(worktree));
    } finally {
      if (previousXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = previousXdgDataHome;
      }
    }
  });
});

describe('fork PR worktree sources', () => {
  const withDataHome = async (test) => {
    const previousXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = createTempDir();
    try {
      await test();
    } finally {
      if (previousXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = previousXdgDataHome;
      }
    }
  };

  const createRepository = () => {
    const repository = createTempDir();
    runGit(repository, ['init', '-b', 'main']);
    runGit(repository, ['config', 'user.email', 'test@example.com']);
    runGit(repository, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repository, 'README.md'), '# Test\n');
    runGit(repository, ['add', 'README.md']);
    runGit(repository, ['commit', '-m', 'Initial commit']);
    return repository;
  };

  const publishForkHead = (repository, fork, branchName) => {
    fs.writeFileSync(path.join(repository, 'FORK.md'), `# ${branchName}\n`);
    runGit(repository, ['add', 'FORK.md']);
    runGit(repository, ['commit', '-m', `fork ${branchName}`]);
    const sha = runGit(repository, ['rev-parse', 'HEAD']).trim();
    runGit(repository, ['reset', '--hard', 'HEAD~1']);
    runGit(repository, ['push', fork, `${sha}:refs/heads/${branchName}`]);
    return sha;
  };

  const forkInput = (fork, worktreeName) => ({
    mode: 'existing',
    branchName: 'feature/login',
    worktreeName,
    existingBranch: 'remotes/pr-alice/feature/login',
    setUpstream: true,
    upstreamRemote: 'pr-alice',
    upstreamBranch: 'feature/login',
    ensureRemoteName: 'pr-alice',
    ensureRemoteUrl: fork,
  });

  const waitForBootstrap = async (directory) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await getWorktreeBootstrapStatus(directory);
      if (status.status === 'ready' || status.status === 'failed') {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for worktree bootstrap');
  };

  it('validates and creates from the same reachable fork head', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepository();
      const fork = createTempDir();
      runGit(fork, ['init', '--bare']);
      const sha = publishForkHead(repository, fork, 'feature/login');
      const input = forkInput(fork, 'pr-42');

      const validation = await validateWorktreeCreate(repository, input);
      expect(validation.ok).toBe(true);

      const created = await createWorktree(repository, input);
      expect(created.branch).toBe('feature/login');
      expect(runGit(created.path, ['rev-parse', 'HEAD']).trim()).toBe(sha);
      expect(runGit(repository, ['remote', 'get-url', 'pr-alice']).trim()).toBe(fork);
      expect((await waitForBootstrap(created.path)).status).toBe('ready');
      expect(runGit(created.path, ['config', '--get', 'branch.feature/login.remote']).trim()).toBe('pr-alice');
    });
  }, 30_000);

  it('rejects an unreachable fork before creating a worktree', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepository();
      const missingFork = path.join(createTempDir(), 'missing.git');
      const input = forkInput(missingFork, 'pr-42-missing');
      const before = runGit(repository, ['worktree', 'list', '--porcelain']);

      const validation = await validateWorktreeCreate(repository, input);
      expect(validation.ok).toBe(false);
      expect(validation.errors.some((error) => /Unable to reach remote/i.test(error.message))).toBe(true);
      await expect(createWorktree(repository, input)).rejects.toThrow(/Unable to fetch/i);
      expect(runGit(repository, ['worktree', 'list', '--porcelain'])).toBe(before);
    });
  }, 30_000);

  it('leaves tracking unset when the requested upstream cannot be fetched', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepository();
      runGit(repository, ['branch', 'feature/tracking']);
      const emptyRemote = createTempDir();
      runGit(emptyRemote, ['init', '--bare']);
      runGit(repository, ['remote', 'add', 'broken-upstream', emptyRemote]);

      const created = await createWorktree(repository, {
        mode: 'existing',
        worktreeName: 'feature-tracking',
        existingBranch: 'feature/tracking',
        setUpstream: true,
        upstreamRemote: 'broken-upstream',
        upstreamBranch: 'does-not-exist',
      });

      expect((await waitForBootstrap(created.path)).status).toBe('ready');
      expect(() => runGit(created.path, ['config', '--get', 'branch.feature/tracking.remote'])).toThrow();
    });
  }, 30_000);
});

describe('branch diff source', () => {
  it('parses only authoritative named refs from branch creation reflogs', () => {
    expect(parseBranchCreationSource('commit: later\nbranch: Created from origin/main')).toBe('origin/main');
    expect(parseBranchCreationSource('branch: Created from HEAD@{0}')).toBeNull();
    expect(parseBranchCreationSource('branch: Created from 9a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b')).toBeNull();
    expect(parseBranchCreationSource('reset: moving to HEAD')).toBeNull();
  });

  it('detects the base branch from a real reflog', async () => {
    if (!canRunGit()) return;

    const repository = createTempDir();
    runGit(repository, ['init', '-b', 'main']);
    runGit(repository, ['config', 'user.email', 'test@example.com']);
    runGit(repository, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repository, 'README.md'), '# Test\n');
    runGit(repository, ['add', 'README.md']);
    runGit(repository, ['commit', '-m', 'initial']);
    runGit(repository, ['branch', 'feature']);

    expect(await getBranchBase(repository, 'feature')).toEqual({ base: 'main' });
  });

  it('returns rename destination paths and status letters for branch ranges', async () => {
    if (!canRunGit()) return;

    const repository = createTempDir();
    runGit(repository, ['init', '-b', 'main']);
    runGit(repository, ['config', 'user.email', 'test@example.com']);
    runGit(repository, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repository, 'old name.md'), '# Test\n');
    runGit(repository, ['add', 'old name.md']);
    runGit(repository, ['commit', '-m', 'initial']);
    runGit(repository, ['checkout', '-b', 'feature']);
    fs.renameSync(path.join(repository, 'old name.md'), path.join(repository, 'new name.md'));
    runGit(repository, ['add', '-A']);
    runGit(repository, ['commit', '-m', 'rename']);

    const files = await getRangeFiles(repository, { base: 'main', head: 'feature' });

    expect(files).toContainEqual({ path: 'new name.md', status: 'R' });
    expect(files.some((file) => file.path === 'old name.md')).toBe(false);
  });
});

/**
 * Create a temp repo using simple-git (for tests that need its assertion API).
 * The dir is registered in tempDirs so afterEach handles cleanup automatically.
 */
async function createTempRepo() {
  const tmpDir = createTempDir();
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.name', 'Test User', false, 'local');
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { tmpDir, git };
}

async function createTempRepoWithRemoteBranch(branch = 'react') {
  const { tmpDir, git } = await createTempRepo();
  const remoteDir = createTempDir();
  runGit(remoteDir, ['init', '--bare']);

  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
  await git.add('README.md');
  await git.commit('Initial commit');
  await git.addRemote('origin', remoteDir);
  await git.checkoutLocalBranch(branch);
  await git.push(['--set-upstream', 'origin', branch]);
  await git.checkout('main');
  await git.deleteLocalBranch(branch);

  return { repository: tmpDir, git };
}

// ---------------------------------------------------------------------------
// resolveBaseRefForLog
// ---------------------------------------------------------------------------

describe('resolveBaseRefForLog', () => {
  it('returns the local ref unchanged when it exists, even if origin also exists', async () => {
    const checkRef = async (ref) => ref === 'main' || ref === 'refs/remotes/origin/main';
    expect(await resolveBaseRefForLog('main', checkRef)).toBe('main');
  });

  it('falls back to origin/<from> when local ref cannot be resolved but origin can', async () => {
    const checkRef = async (ref) => ref === 'refs/remotes/origin/main';
    expect(await resolveBaseRefForLog('main', checkRef)).toBe('origin/main');
  });

  it('returns the original ref when neither local nor origin ref can be resolved', async () => {
    const checkRef = async () => false;
    expect(await resolveBaseRefForLog('nonexistent-branch', checkRef)).toBe('nonexistent-branch');
  });

  it('returns undefined when from is undefined', async () => {
    const checkRef = async () => true;
    expect(await resolveBaseRefForLog(undefined, checkRef)).toBeUndefined();
  });

  it('returns undefined when from is an empty string', async () => {
    const checkRef = async () => true;
    expect(await resolveBaseRefForLog('', checkRef)).toBeUndefined();
  });

  it('returns undefined when from is a whitespace-only string', async () => {
    const checkRef = async () => true;
    expect(await resolveBaseRefForLog('   ', checkRef)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// git index path validation
// ---------------------------------------------------------------------------

describe('git index path validation', () => {
  it('rejects stage paths outside the repository before invoking git', async () => {
    await expect(stageFiles('/repo', ['../secret.txt'])).rejects.toThrow(
      'Path is outside repository: ../secret.txt'
    );
  });

  it('rejects unstage paths outside the repository before invoking git', async () => {
    await expect(unstageFiles('/repo', ['../secret.txt'])).rejects.toThrow(
      'Path is outside repository: ../secret.txt'
    );
  });
});

// ---------------------------------------------------------------------------
// applyHunk (per-hunk stage / unstage / discard)
// ---------------------------------------------------------------------------

// Upstream exercises the client splitter (ui patchFileDiff) directly, but that
// module imports @pierre/diffs, which needs a DOM at import time. Mirror the
// upstream CRLF-preserving splitter algorithm here instead — the ui package
// keeps its own tests for it.
const splitHunks = (patch) => {
  if (!patch) return [];

  // Git's structural newlines are LF. A CR before LF inside a hunk belongs
  // to the file contents and must survive an apply/reverse round trip.
  const starts = [...patch.matchAll(/^@@\s/gm)].map((match) => match.index);
  if (starts.length === 0) return [];
  const header = patch.slice(0, starts[0]);
  return starts.map((start, index) => {
    const hunk = header + patch.slice(start, starts[index + 1] ?? patch.length);
    return hunk.endsWith('\n') ? hunk : `${hunk}\n`;
  });
};

const writeFile = (repo, name, contents) =>
  fs.promises.writeFile(path.join(repo, name), contents, 'utf8');

// Build a 20-line file so changes on line 1 and line 20 stay in separate hunks
// (default 3-line diff context would merge closer edits into one hunk).
const makeFile = (first, last) =>
  [first, ...Array.from({ length: 18 }, (_, i) => `line${i + 2}`), last].join('\n') + '\n';
const ORIGINAL_FILE = makeFile('line1', 'line20');
const EDITED_FILE = makeFile('TOP', 'BOTTOM');

const readWorking = (repo) => fs.promises.readFile(path.join(repo, 'file.txt'), 'utf8').then((c) => c.replace(/\r\n/g, '\n'));
const readStaged = async (git) => (await git.raw(['show', ':file.txt'])).replace(/\r\n/g, '\n');

describe('applyHunk', () => {
  it('stages successive hunks and never discards a stale staged or committed patch', async () => {
    if (!canRunGit()) return;
    const { tmpDir, git } = await createTempRepo();
    const original = Array.from({ length: 60 }, (_, index) => `line${index}`);
    const changed = [...original];
    changed[1] = 'FIRST'; changed[25] = 'SECOND'; changed[50] = 'THIRD';
    await writeFile(tmpDir, 'file.txt', original.join('\n') + '\n');
    await git.add('file.txt'); await git.commit('Initial');
    await writeFile(tmpDir, 'file.txt', changed.join('\n') + '\n');
    const historical = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }));
    expect(historical).toHaveLength(3);
    await applyHunk(tmpDir, 'file.txt', { patch: historical[0], action: 'stage' });
    const remaining = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }));
    expect(remaining).toHaveLength(2);
    await applyHunk(tmpDir, 'file.txt', { patch: remaining[0], action: 'stage' });
    const stalePath = path.join(tmpDir, 'stale.patch');
    await fs.promises.writeFile(stalePath, historical[0]);
    // Git's reverse applicability check accepts it, but it is no longer an
    // unstaged hunk. The server must reject it before touching the working file.
    await git.raw(['apply', '--reverse', '--check', stalePath]);
    await expect(applyHunk(tmpDir, 'file.txt', { patch: historical[0], action: 'discard' })).rejects.toThrow('refresh and try again');
    expect(await readWorking(tmpDir)).toBe(changed.join('\n') + '\n');
    const last = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }));
    expect(last).toHaveLength(1);
    await applyHunk(tmpDir, 'file.txt', { patch: last[0], action: 'discard' });
    changed[50] = original[50];
    expect(await readWorking(tmpDir)).toBe(changed.join('\n') + '\n');
    expect(await readStaged(git)).toBe(changed.join('\n') + '\n');
    const staged = splitHunks(await getDiff(tmpDir, { path: 'file.txt', staged: true }));
    await applyHunk(tmpDir, 'file.txt', { patch: staged[0], action: 'unstage' });
    expect(await readWorking(tmpDir)).toBe(changed.join('\n') + '\n');
    await git.add('file.txt'); await git.commit('Committed changes');
    await expect(applyHunk(tmpDir, 'file.txt', { patch: historical[0], action: 'discard' })).rejects.toThrow('refresh and try again');
  });

  it.each(['crlf', 'mixed'])('preserves %s file bytes through stage, unstage and discard', async (endings) => {
    if (!canRunGit()) return;
    const { tmpDir, git } = await createTempRepo();
    await git.addConfig('core.autocrlf', 'false');
    const serialize = (first, last) => Array.from({ length: 30 }, (_, index) => {
      const text = index === 0 ? first : index === 29 ? last : `line${index}`;
      return text + (endings === 'crlf' || index % 2 === 0 ? '\r\n' : '\n');
    }).join('');
    const original = serialize('first', 'last');
    const edited = serialize('FIRST', 'LAST');
    await writeFile(tmpDir, 'file.txt', original);
    await git.add('file.txt'); await git.commit('Initial');
    await writeFile(tmpDir, 'file.txt', edited);
    const hunks = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }));
    await applyHunk(tmpDir, 'file.txt', { patch: hunks[0], action: 'stage' });
    expect(await git.raw(['show', ':file.txt'])).toBe(serialize('FIRST', 'last'));
    const staged = splitHunks(await getDiff(tmpDir, { path: 'file.txt', staged: true }));
    await applyHunk(tmpDir, 'file.txt', { patch: staged[0], action: 'unstage' });
    expect(await git.raw(['show', ':file.txt'])).toBe(original);
    const working = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }));
    await applyHunk(tmpDir, 'file.txt', { patch: working[0], action: 'discard' });
    expect(await fs.promises.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).toBe(serialize('first', 'LAST'));
  });

  it('rejects extra files hidden before the requested patch', async () => {
    if (!canRunGit()) return;
    const { tmpDir, git } = await createTempRepo();
    for (const name of ['file.txt', 'other.txt']) await writeFile(tmpDir, name, ORIGINAL_FILE);
    await git.add('.'); await git.commit('Initial');
    for (const name of ['file.txt', 'other.txt']) await writeFile(tmpDir, name, EDITED_FILE);
    const other = splitHunks(await getDiff(tmpDir, { path: 'other.txt' }))[0];
    const requested = splitHunks(await getDiff(tmpDir, { path: 'file.txt' }))[0];
    await expect(applyHunk(tmpDir, 'file.txt', { patch: requested + other, action: 'stage' })).rejects.toThrow('refresh and try again');
    expect(await git.raw(['diff', '--cached'])).toBe('');
  });

  it('rejects an invalid action or a patch without a hunk header', async () => {
    const { tmpDir } = await createTempRepo();
    await expect(applyHunk(tmpDir, 'file.txt', { patch: '@@ -1 +1 @@\n a\n', action: 'bogus' })).rejects.toThrow(
      'Invalid hunk action'
    );
    await expect(applyHunk(tmpDir, 'file.txt', { patch: 'no hunk here', action: 'stage' })).rejects.toThrow(
      'hunk header'
    );
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  it('handles repositories without upstream tracking', async () => {
    if (!canRunGit()) return;

    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);

    fs.writeFileSync(path.join(repo, 'README.md'), 'hello', 'utf8');
    runGit(repo, ['add', 'README.md']);
    runGit(repo, ['commit', '-m', 'Initial commit']);

    await expect(getStatus(repo)).resolves.toMatchObject({ current: 'main' });
  });

  it('does not log an error when the directory no longer exists', async () => {
    if (!canRunGit()) return;

    const missingDir = createTempDir();
    fs.rmSync(missingDir, { recursive: true, force: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(getStatus(missingDir)).rejects.toThrow();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rejects a non-git folder without using process.cwd()', async () => {
    if (!canRunGit()) return;

    const nonGit = createTempDir();
    const previousCwd = process.cwd();
    process.chdir(nonGit);
    try {
      await expect(getStatus(nonGit)).rejects.toThrow(/not a git repository/i);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('reads status for a git repo when process.cwd() is elsewhere', async () => {
    if (!canRunGit()) return;

    const repo = createTempDir();
    const neutralCwd = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
    runGit(repo, ['add', 'README.md']);
    runGit(repo, ['commit', '-m', 'Initial commit']);

    const previousCwd = process.cwd();
    process.chdir(neutralCwd);
    try {
      await expect(getStatus(repo)).resolves.toBeDefined();
    } finally {
      process.chdir(previousCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// getRemotes
// ---------------------------------------------------------------------------

describe('getRemotes', () => {
  it('returns an empty list for non-git directories', async () => {
    if (!canRunGit()) return;

    const dir = createTempDir();
    await expect(getRemotes(dir)).resolves.toEqual([]);
  });
});

describe('symlink diffs', () => {
  it('treats an untracked directory symlink as a link in patch and split diffs', async () => {
    if (!canRunGit() || process.platform === 'win32') return;
    const { tmpDir } = await createTempRepo();
    fs.mkdirSync(path.join(tmpDir, 'source'));
    fs.symlinkSync('source', path.join(tmpDir, 'linked-source'));

    const patch = await getDiff(tmpDir, { path: 'linked-source' });
    const split = await getFileDiff(tmpDir, { path: 'linked-source' });

    expect(patch).toContain('new file mode 120000');
    expect(patch).toContain('+source');
    expect(split).toMatchObject({
      original: '',
      modified: 'source',
      isBinary: false,
    });
  });
});

describe('setLocalIdentity', () => {
  it('configures SSH commit signing in the repository only', async () => {
    if (!canRunGit()) return;

    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);

    await setLocalIdentity(repo, {
      userName: 'Signing User',
      userEmail: 'signing@example.com',
      signCommits: true,
      signingKey: '~/.ssh/id_ed25519.pub',
    });

    expect(runGit(repo, ['config', '--local', '--get', 'gpg.format']).trim()).toBe('ssh');
    expect(runGit(repo, ['config', '--local', '--get', 'user.signingkey']).trim()).toBe('~/.ssh/id_ed25519.pub');
    expect(runGit(repo, ['config', '--local', '--get', 'commit.gpgsign']).trim()).toBe('true');
  });

  it('clears signing config when the selected identity disables signing', async () => {
    if (!canRunGit()) return;

    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', '--local', 'gpg.format', 'ssh']);
    runGit(repo, ['config', '--local', 'user.signingkey', '~/.ssh/old.pub']);
    runGit(repo, ['config', '--local', 'commit.gpgsign', 'true']);

    await setLocalIdentity(repo, {
      userName: 'Unsigned User',
      userEmail: 'unsigned@example.com',
      signCommits: false,
      signingKey: null,
    });

    expect(() => runGit(repo, ['config', '--local', '--get', 'gpg.format'])).toThrow();
    expect(() => runGit(repo, ['config', '--local', '--get', 'user.signingkey'])).toThrow();
    expect(() => runGit(repo, ['config', '--local', '--get', 'commit.gpgsign'])).toThrow();
  });
});

describe('fetch', () => {
  it('preserves an explicit remote when branch is omitted', async () => {
    if (!canRunGit()) return;

    const upstream = createTempDir();
    runGit(upstream, ['init', '--bare']);

    const other = createTempDir();
    runGit(other, ['init', '--bare']);

    const source = createTempDir();
    runGit(source, ['init', '-b', 'main']);
    runGit(source, ['config', 'user.name', 'Test User']);
    runGit(source, ['config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(source, 'README.md'), 'upstream', 'utf8');
    runGit(source, ['add', 'README.md']);
    runGit(source, ['commit', '-m', 'Initial upstream commit']);
    runGit(source, ['remote', 'add', 'upstream', upstream]);
    runGit(source, ['push', 'upstream', 'main']);

    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['remote', 'add', 'origin', other]);
    runGit(repo, ['remote', 'add', 'upstream', upstream]);

    await expect(fetch(repo, { remote: 'upstream' })).resolves.toEqual({ success: true });

    const upstreamMain = runGit(repo, ['rev-parse', '--verify', 'refs/remotes/upstream/main']).trim();
    expect(upstreamMain).toMatch(/^[0-9a-f]{40}$/);
    expect(() => runGit(repo, ['rev-parse', '--verify', 'refs/remotes/origin/main'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// checkoutCommit
// ---------------------------------------------------------------------------

describe('checkoutCommit', () => {
  it('checks out a valid commit and puts the repo in detached HEAD state', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    const result = await checkoutCommit(tmpDir, firstCommit.commit);
    expect(result).toEqual({ success: true });

    const status = await git.status();
    expect(status.detached).toBe(true);
  });

  it('throws an error for an invalid/nonexistent hash', async () => {
    const { tmpDir } = await createTempRepo();
    await expect(checkoutCommit(tmpDir, 'invalidhash123')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// checkoutBranch
// ---------------------------------------------------------------------------

describe('checkoutBranch', () => {
  it('checks out a local branch by name', async () => {
    const { tmpDir, git } = await createTempRepo();
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    await git.add('README.md');
    await git.commit('Initial commit');
    await git.branch(['feature']);

    const result = await checkoutBranch(tmpDir, 'feature');

    expect(result).toEqual({ success: true, branch: 'feature' });
    expect(runGit(tmpDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature');
  });

  it('creates a tracking local branch instead of detaching at a remote ref', async () => {
    const { repository } = await createTempRepoWithRemoteBranch();

    const result = await checkoutBranch(repository, 'origin/react');

    expect(result).toEqual({ success: true, branch: 'react' });
    expect(runGit(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('react');
    expect(runGit(repository, ['rev-parse', '--abbrev-ref', 'react@{upstream}']).trim()).toBe('origin/react');
  });

  it('accepts the remotes/ prefixed form', async () => {
    const { repository } = await createTempRepoWithRemoteBranch();

    const result = await checkoutBranch(repository, 'remotes/origin/react');

    expect(result).toEqual({ success: true, branch: 'react' });
    expect(runGit(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('react');
  });

  it('uses an existing local branch when the remote ref is selected', async () => {
    const { repository } = await createTempRepoWithRemoteBranch();
    runGit(repository, ['branch', 'react', 'origin/react']);

    const result = await checkoutBranch(repository, 'origin/react');

    expect(result).toEqual({ success: true, branch: 'react' });
    expect(runGit(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('react');
  });

  it('prefers a local branch whose name looks like a remote ref', async () => {
    const { repository } = await createTempRepoWithRemoteBranch();
    runGit(repository, ['branch', 'origin/react']);

    const result = await checkoutBranch(repository, 'origin/react');

    expect(result).toEqual({ success: true, branch: 'origin/react' });
    expect(runGit(repository, ['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/origin/react');
  });

  it('rejects an unknown branch', async () => {
    const { tmpDir, git } = await createTempRepo();
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    await git.add('README.md');
    await git.commit('Initial commit');

    await expect(checkoutBranch(tmpDir, 'does-not-exist')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cherryPick
// ---------------------------------------------------------------------------

describe('cherryPick', () => {
  it('cherry-picks a commit that applies cleanly', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'line1\nline2\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Initial commit');

    await git.checkoutBranch('feature', 'HEAD');
    await fs.promises.writeFile(filePath, 'line1\nline2\nline3\n', 'utf8');
    await git.add('file.txt');
    const featureCommit = await git.commit('Add line3');

    await git.checkout('main');
    const result = await cherryPick(tmpDir, featureCommit.commit);
    expect(result).toEqual({ success: true, conflict: false });

    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('line1\nline2\nline3\n');
  });

  it('returns conflict info when cherry-picking a conflicting commit', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'line1\nline2\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Initial commit');

    await git.checkoutBranch('feature', 'HEAD');
    await fs.promises.writeFile(filePath, 'line1\nfeature-line2\n', 'utf8');
    await git.add('file.txt');
    const featureCommit = await git.commit('Change line2 in feature');

    await git.checkout('main');
    await fs.promises.writeFile(filePath, 'line1\nmain-line2\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Change line2 in main');

    const result = await cherryPick(tmpDir, featureCommit.commit);
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(Array.isArray(result.conflictFiles)).toBe(true);
    expect(result.conflictFiles.length).toBeGreaterThan(0);
  });

  it('throws for an invalid/nonexistent hash', async () => {
    const { tmpDir } = await createTempRepo();
    await expect(cherryPick(tmpDir, 'deadbeef00000000')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// revertCommit
// ---------------------------------------------------------------------------

describe('revertCommit', () => {
  it('reverts a commit and stages the revert changes', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'line1\nline2\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Initial commit');

    await fs.promises.writeFile(filePath, 'line1\nline2\nline3\n', 'utf8');
    await git.add('file.txt');
    const changeCommit = await git.commit('Add line3');

    const result = await revertCommit(tmpDir, changeCommit.commit);
    expect(result).toEqual({ success: true, conflict: false });

    const status = await git.status();
    expect(status.staged.length).toBeGreaterThan(0);
    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('line1\nline2\n');
  });

  it('returns conflict info when reverting causes a conflict', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'line1\nline2\nline3\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Initial commit');

    await fs.promises.writeFile(filePath, 'line1\nchanged-a\nline3\n', 'utf8');
    await git.add('file.txt');
    const commitA = await git.commit('Change line2 to changed-a');

    await fs.promises.writeFile(filePath, 'line1\nchanged-b\nline3\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Change line2 to changed-b');

    const result = await revertCommit(tmpDir, commitA.commit);
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(Array.isArray(result.conflictFiles)).toBe(true);
    expect(result.conflictFiles.length).toBeGreaterThan(0);
  });

  it('throws for an invalid/nonexistent hash', async () => {
    const { tmpDir } = await createTempRepo();
    await expect(revertCommit(tmpDir, 'deadbeef00000000')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resetToCommit
// ---------------------------------------------------------------------------

describe('resetToCommit', () => {
  it('soft reset moves HEAD without touching the working tree', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first\n', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    const result = await resetToCommit(tmpDir, firstCommit.commit, 'soft');
    expect(result).toEqual({ success: true });

    const log = await git.log();
    expect(log.latest.hash).toBe(firstCommit.commit);
    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('second\n');

    const status = await git.status();
    expect(status.staged.length).toBeGreaterThan(0);
  });

  it('mixed reset moves HEAD and unstages changes', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first\n', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    const result = await resetToCommit(tmpDir, firstCommit.commit, 'mixed');
    expect(result).toEqual({ success: true });

    const log = await git.log();
    expect(log.latest.hash).toBe(firstCommit.commit);
    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('second\n');

    const status = await git.status();
    expect(status.staged.length).toBe(0);
    expect(status.modified.length).toBeGreaterThan(0);
  });

  it('hard reset with clean working tree succeeds', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first\n', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    const result = await resetToCommit(tmpDir, firstCommit.commit, 'hard');
    expect(result).toEqual({ success: true });

    const log = await git.log();
    expect(log.latest.hash).toBe(firstCommit.commit);
    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('first\n');

    const status = await git.status();
    expect(status.isClean()).toBe(true);
  });

  it('hard reset with dirty working tree without force throws', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first\n', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    await fs.promises.writeFile(filePath, 'dirty\n', 'utf8');

    await expect(resetToCommit(tmpDir, firstCommit.commit, 'hard')).rejects.toThrow(
      'Cannot hard reset: uncommitted changes in working tree'
    );
  });

  it('hard reset with dirty working tree with force succeeds', async () => {
    const { tmpDir, git } = await createTempRepo();
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.promises.writeFile(filePath, 'first\n', 'utf8');
    await git.add('file.txt');
    const firstCommit = await git.commit('First commit');

    await fs.promises.writeFile(filePath, 'second\n', 'utf8');
    await git.add('file.txt');
    await git.commit('Second commit');

    await fs.promises.writeFile(filePath, 'dirty\n', 'utf8');

    const result = await resetToCommit(tmpDir, firstCommit.commit, 'hard', true);
    expect(result).toEqual({ success: true });

    const log = await git.log();
    expect(log.latest.hash).toBe(firstCommit.commit);
    const content = await fs.promises.readFile(filePath, 'utf8');
    expect(content).toBe('first\n');
  });
});

// ---------------------------------------------------------------------------
// hash validation
// ---------------------------------------------------------------------------

describe('hash validation', () => {
  it('checkoutCommit rejects non-hex hash', async () => {
    await expect(checkoutCommit('/tmp', '--hard')).rejects.toThrow('Invalid commit hash');
  });

  it('checkoutCommit rejects ref name', async () => {
    await expect(checkoutCommit('/tmp', 'HEAD')).rejects.toThrow('Invalid commit hash');
  });

  it('checkoutCommit accepts valid 40-char hex format', async () => {
    await expect(
      checkoutCommit('/tmp', '1234567890abcdef1234567890abcdef12345678')
    ).rejects.not.toThrow('Invalid commit hash');
  });

  it('cherryPick rejects non-hex hash', async () => {
    await expect(cherryPick('/tmp', '--hard')).rejects.toThrow('Invalid commit hash');
  });

  it('cherryPick rejects ref name', async () => {
    await expect(cherryPick('/tmp', 'HEAD')).rejects.toThrow('Invalid commit hash');
  });

  it('cherryPick accepts valid 40-char hex format', async () => {
    await expect(
      cherryPick('/tmp', '1234567890abcdef1234567890abcdef12345678')
    ).rejects.not.toThrow('Invalid commit hash');
  });

  it('revertCommit rejects non-hex hash', async () => {
    await expect(revertCommit('/tmp', '--hard')).rejects.toThrow('Invalid commit hash');
  });

  it('revertCommit rejects ref name', async () => {
    await expect(revertCommit('/tmp', 'HEAD')).rejects.toThrow('Invalid commit hash');
  });

  it('revertCommit accepts valid 40-char hex format', async () => {
    await expect(
      revertCommit('/tmp', '1234567890abcdef1234567890abcdef12345678')
    ).rejects.not.toThrow('Invalid commit hash');
  });

  it('resetToCommit rejects non-hex hash', async () => {
    await expect(resetToCommit('/tmp', '--hard', 'soft')).rejects.toThrow('Invalid commit hash');
  });

  it('resetToCommit rejects ref name', async () => {
    await expect(resetToCommit('/tmp', 'HEAD', 'soft')).rejects.toThrow('Invalid commit hash');
  });

  it('resetToCommit accepts valid 40-char hex format', async () => {
    await expect(
      resetToCommit('/tmp', '1234567890abcdef1234567890abcdef12345678', 'soft')
    ).rejects.not.toThrow('Invalid commit hash');
  });
});

describe('getUnpushedBranchCounts', () => {
  const createRepositoryWithRemote = () => {
    const repository = createTempDir();
    const remote = createTempDir();
    runGit(remote, ['init', '--bare']);
    runGit(repository, ['init', '-b', 'main']);
    runGit(repository, ['config', 'user.email', 'test@example.com']);
    runGit(repository, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repository, 'README.md'), '# Test\n');
    runGit(repository, ['add', 'README.md']);
    runGit(repository, ['commit', '-m', 'Initial commit']);
    runGit(repository, ['remote', 'add', 'origin', remote]);
    runGit(repository, ['push', '-u', 'origin', 'main']);
    return repository;
  };

  it('counts only commits ahead of a locally known upstream', async () => {
    if (!canRunGit()) return;

    const repository = createRepositoryWithRemote();
    fs.writeFileSync(path.join(repository, 'ahead.txt'), 'ahead\n');
    runGit(repository, ['add', 'ahead.txt']);
    runGit(repository, ['commit', '-m', 'ahead']);
    runGit(repository, ['checkout', '-b', 'no-upstream']);

    await expect(getUnpushedBranchCounts(repository, ['main', 'no-upstream', 'remotes/origin/main'])).resolves.toEqual({
      counts: { main: 1 },
    });
  });

  it('omits branches that are in sync with their upstream', async () => {
    if (!canRunGit()) return;

    const repository = createRepositoryWithRemote();

    await expect(getUnpushedBranchCounts(repository, ['main'])).resolves.toEqual({ counts: {} });
  });
});

describe('createWorktree remote source refs', () => {
  const withDataHome = async (test) => {
    const previousXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = createTempDir();
    try {
      await test();
    } finally {
      if (previousXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = previousXdgDataHome;
      }
    }
  };

  const createRepositoryWithRemote = ({ defaultBranch = 'main' } = {}) => {
    const remote = createTempDir();
    runGit(remote, ['init', '--bare', `-b${defaultBranch}`]);
    const repository = createTempDir();
    runGit(repository, ['init', '-b', defaultBranch]);
    runGit(repository, ['config', 'user.email', 'test@example.com']);
    runGit(repository, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repository, 'README.md'), '# Test\n');
    runGit(repository, ['add', 'README.md']);
    runGit(repository, ['commit', '-m', 'Initial commit']);
    runGit(repository, ['remote', 'add', 'origin', remote]);
    runGit(repository, ['push', 'origin', defaultBranch]);
    runGit(repository, ['update-ref', `refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`]);
    return repository;
  };

  const readBranchConfig = (cwd, branch, key) => {
    try {
      return runGit(cwd, ['config', '--get', `branch.${branch}.${key}`]).trim();
    } catch {
      return '';
    }
  };

  const waitForBootstrap = async (directory) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await getWorktreeBootstrapStatus(directory);
      if (status.status === 'ready' || status.status === 'failed') {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for worktree bootstrap');
  };

  it('does not auto-track the remote start ref when creating a new branch from it with explicit keys', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepositoryWithRemote({ defaultBranch: 'main' });

      const created = await createWorktree(repository, {
        mode: 'new',
        branchName: 'openchamber/feature',
        worktreeName: 'feature-wt',
        startRef: 'remotes/origin/main',
        setUpstream: true,
        upstreamRemote: 'origin',
        upstreamBranch: 'openchamber/feature',
      });

      expect(created.branch).toBe('openchamber/feature');
      await waitForBootstrap(created.path);
      expect(readBranchConfig(created.path, 'openchamber/feature', 'remote')).toBe('');
      expect(readBranchConfig(created.path, 'openchamber/feature', 'merge')).toBe('');
    });
  }, 30_000);

  it('falls back to the tracked local branch when the source fetch fails', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepositoryWithRemote({ defaultBranch: 'main' });
      runGit(repository, ['branch', '--set-upstream-to=origin/main', 'main']);
      runGit(repository, ['remote', 'set-url', 'origin', '/nonexistent/openchamber-unreachable.git']);

      const created = await createWorktree(repository, {
        mode: 'new',
        branchName: 'openchamber/stale-ref-wt',
        worktreeName: 'stale-ref-wt',
        startRef: 'remotes/origin/main',
      });

      expect(created.branch).toBe('openchamber/stale-ref-wt');
      expect(created.sourceFetchFailed).toBe(true);
      const expectedHead = runGit(repository, ['rev-parse', 'main']).trim();
      expect(runGit(created.path, ['rev-parse', 'HEAD']).trim()).toBe(expectedHead);
    });
  }, 30_000);

  it('rejects creation from a remote start ref that was never fetched and cannot be fetched', async () => {
    if (!canRunGit()) return;

    await withDataHome(async () => {
      const repository = createRepositoryWithRemote({ defaultBranch: 'main' });
      runGit(repository, ['update-ref', '-d', 'refs/remotes/origin/main']);
      runGit(repository, ['remote', 'set-url', 'origin', '/nonexistent/openchamber-unreachable.git']);

      await expect(createWorktree(repository, {
        mode: 'new',
        branchName: 'openchamber/never-fetched-wt',
        worktreeName: 'never-fetched-wt',
        startRef: 'remotes/origin/main',
      })).rejects.toThrow(/does not appear to be a git repository|Could not read from remote repository|Failed to fetch/i);
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// getTrackingBranch
// ---------------------------------------------------------------------------

describe('getTrackingBranch', () => {
  const createCommittedRepo = () => {
    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    runGit(repo, ['commit', '--allow-empty', '-m', 'Initial commit']);
    return repo;
  };

  it('reports the same upstream name as status, including a gone upstream', async () => {
    if (!canRunGit()) return;

    const repo = createCommittedRepo();
    await expect(getTrackingBranch(repo)).resolves.toBeNull();

    runGit(repo, ['remote', 'add', 'origin', 'https://example.invalid/repo.git']);
    runGit(repo, ['config', 'branch.main.remote', 'origin']);
    runGit(repo, ['config', 'branch.main.merge', 'refs/heads/main']);
    await expect(getTrackingBranch(repo)).resolves.toBe('origin/main');
    expect((await getStatus(repo)).tracking).toBe('origin/main');

    runGit(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await expect(getTrackingBranch(repo)).resolves.toBe('origin/main');
  });

  it('is null for a detached HEAD and outside a repository', async () => {
    if (!canRunGit()) return;

    const repo = createCommittedRepo();
    runGit(repo, ['checkout', '--detach']);
    await expect(getTrackingBranch(repo)).resolves.toBeNull();
    await expect(getTrackingBranch(createTempDir())).resolves.toBeNull();
  });
});

describe('getStatus concurrency', () => {
  it('answers overlapping reads of one repository and reflects changes made while a read ran', async () => {
    if (!canRunGit()) return;

    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    runGit(repo, ['commit', '--allow-empty', '-m', 'Initial commit']);

    const first = getStatus(repo);
    fs.writeFileSync(path.join(repo, 'late.txt'), 'added after the first read was admitted\n');
    const second = getStatus(repo, { mode: 'light' });
    const third = getStatus(repo);

    const [firstStatus, secondStatus, thirdStatus] = await Promise.all([first, second, third]);
    expect(firstStatus.current).toBe('main');
    expect(secondStatus.files.map((file) => file.path)).toContain('late.txt');
    expect(thirdStatus.files.map((file) => file.path)).toContain('late.txt');
    // The follow-up run served both later callers at the widest requested mode.
    expect(secondStatus.diffStats).toBeDefined();
    expect(thirdStatus.diffStats).toBeDefined();
  });
});

describe('getStatus untracked directories', () => {
  const createCommittedRepo = () => {
    const repo = createTempDir();
    runGit(repo, ['init', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
    runGit(repo, ['add', 'README.md']);
    runGit(repo, ['commit', '-m', 'Initial commit']);
    return repo;
  };

  const writeFiles = (root, count) => {
    fs.mkdirSync(root, { recursive: true });
    for (let index = 0; index < count; index += 1) {
      fs.writeFileSync(path.join(root, `file-${String(index).padStart(5, '0')}.txt`), `${index}\n`);
    }
  };

  it('lists the files of an ordinary new directory one by one', async () => {
    if (!canRunGit()) return;

    const repo = createCommittedRepo();
    writeFiles(path.join(repo, 'feature', 'deep'), 3);
    fs.writeFileSync(path.join(repo, 'loose.txt'), 'loose\n');

    const paths = (await getStatus(repo)).files.map((file) => file.path);
    expect(paths).toEqual([
      'feature/deep/file-00000.txt',
      'feature/deep/file-00001.txt',
      'feature/deep/file-00002.txt',
      'loose.txt',
    ]);
  });

  it('keeps a directory with more than a thousand new files as one entry and rejects per-path diffs on it', async () => {
    if (!canRunGit()) return;

    const repo = createCommittedRepo();
    writeFiles(path.join(repo, 'node_modules', 'pkg'), 1001);
    writeFiles(path.join(repo, 'small'), 2);

    const status = await getStatus(repo);
    expect(status.files.map((file) => file.path)).toEqual([
      'node_modules/',
      'small/file-00000.txt',
      'small/file-00001.txt',
    ]);
    expect(status.files[0]).toMatchObject({ index: '?', working_dir: '?' });

    // The fork has not adopted the upstream path-error code routes; the
    // per-path diff still fails fast, with the directory explanation.
    await expect(getDiff(repo, { path: 'node_modules/' })).rejects.toThrow(
      'Path is a directory of untracked files: node_modules/'
    );
    await expect(getFileDiff(repo, { path: 'node_modules/' })).rejects.toThrow(
      'Path is a directory of untracked files: node_modules/'
    );
  });
});
