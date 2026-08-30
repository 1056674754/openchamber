import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Cross-process exclusive lock for settings.json.
//
// GUI-grade short bounded wait: a healthy RMW takes milliseconds; if the lock
// can't be acquired within ~250ms, something is wrong and the caller should
// see a typed error immediately rather than mask it with multi-second retry.

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_STALE_MS = 30_000;
const BACKOFF_MIN_MS = 10;
const BACKOFF_MAX_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomOwnerToken = () => crypto.randomBytes(16).toString('hex');
const jitteredDelay = () => BACKOFF_MIN_MS + Math.floor(Math.random() * (BACKOFF_MAX_MS - BACKOFF_MIN_MS + 1));

const isPidAlive = (pid) => {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = process exists but is not ours; ESRCH = no such process.
    return error?.code === 'EPERM';
  }
};

const parseLockPayload = (content) => {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  return null;
};

const busyError = (ownerPid) => {
  const err = new Error('LOCK_BUSY');
  err.code = 'LOCK_BUSY';
  if (typeof ownerPid === 'number') err.ownerPid = ownerPid;
  return err;
};

// Returns lock content, or null for ENOENT (lock disappeared between EEXIST
// and read — retryable). Any other read error (EACCES, EBADF, ...) propagates
// so the caller fails loudly instead of misclassifying as stale.
const readLockContent = async (lockPath) => {
  try {
    return await fs.promises.readFile(lockPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const lockIsStale = async (lockPath, payload, staleMs) => {
  if (typeof payload?.pid === 'number') {
    // A live owner remains authoritative even if its critical section runs
    // longer than expected. Age alone must never break mutual exclusion.
    return !isPidAlive(payload.pid);
  }

  const startedAt = typeof payload?.startedAt === 'number' ? payload.startedAt : null;
  if (startedAt !== null) return Date.now() - startedAt > staleMs;

  try {
    const stat = await fs.promises.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const sameLockSnapshot = (beforeContent, beforePayload, currentContent, currentPayload) => {
  if (typeof beforePayload?.ownerToken === 'string') {
    return currentPayload?.ownerToken === beforePayload.ownerToken;
  }
  return currentContent === beforeContent;
};

const acquireCleanupGuard = async (lockPath, staleMs) => {
  const cleanupPath = `${lockPath}.cleanup`;
  const ownerPath = path.join(cleanupPath, 'owner.json');
  const create = async () => {
    await fs.promises.mkdir(cleanupPath, { mode: 0o700 });
    try {
      await fs.promises.writeFile(ownerPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    } catch (error) {
      await fs.promises.rm(cleanupPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return cleanupPath;
  };
  try {
    return await create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let owner = null;
  try {
    owner = parseLockPayload(await fs.promises.readFile(ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (typeof owner?.pid === 'number' && isPidAlive(owner.pid)) return null;

  const stat = await fs.promises.stat(cleanupPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && Date.now() - stat.mtimeMs <= staleMs) return null;

  await fs.promises.rm(cleanupPath, { recursive: true, force: true });
  try {
    return await create();
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
};

const acquire = async (lockPath, staleMs) => {
  const ownerToken = randomOwnerToken();
  const payload = JSON.stringify({ pid: process.pid, ownerToken, startedAt: Date.now() });

  // temp+link(2) instead of bare O_EXCL: avoids the create-then-write window
  // where another reader could see an empty file and misclassify it as stale.
  const tmp = `${lockPath}.acquire-${process.pid}-${ownerToken.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;
  await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
  try {
    await fs.promises.link(tmp, lockPath);
    await fs.promises.unlink(tmp);
    return ownerToken;
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  }

  // Lock busy — inspect for staleness.
  const content = await readLockContent(lockPath);
  if (content === null) {
    throw busyError();
  }
  const existing = parseLockPayload(content);
  if (!(await lockIsStale(lockPath, existing, staleMs))) {
    throw busyError(existing?.pid);
  }

  // Only one contender may remove a stale lock. It re-reads under the cleanup
  // guard before unlinking, so a newly acquired lock is never deleted based on
  // an earlier stale snapshot.
  const cleanupPath = await acquireCleanupGuard(lockPath, staleMs);
  if (!cleanupPath) throw busyError(existing?.pid);
  try {
    const currentContent = await readLockContent(lockPath);
    if (currentContent === null) throw busyError();
    const current = parseLockPayload(currentContent);
    if (!sameLockSnapshot(content, existing, currentContent, current)) {
      throw busyError(current?.pid);
    }
    if (!(await lockIsStale(lockPath, current, staleMs))) {
      throw busyError(current?.pid);
    }

    const replacementTmp = `${lockPath}.reclaim-${process.pid}-${ownerToken.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;
    await fs.promises.writeFile(replacementTmp, payload, { mode: 0o600 });
    await fs.promises.unlink(lockPath);
    try {
      await fs.promises.link(replacementTmp, lockPath);
      return ownerToken;
    } catch (error) {
      if (error?.code === 'EEXIST') throw busyError();
      throw error;
    } finally {
      await fs.promises.unlink(replacementTmp).catch(() => {});
    }
  } finally {
    await fs.promises.rm(cleanupPath, { recursive: true, force: true }).catch(() => {});
  }
};

const release = async (lockPath, ownerToken) => {
  // Only unlink if the lock still carries our ownerToken; protects against
  // releasing a lock that was already stolen and re-acquired by someone else.
  try {
    const parsed = parseLockPayload(await fs.promises.readFile(lockPath, 'utf8'));
    if (parsed && parsed.ownerToken === ownerToken) {
      await fs.promises.unlink(lockPath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

/**
 * Run `fn` while holding an exclusive cross-process lock at `lockPath`.
 *
 * Bounded short wait (default 250ms total, 10-25ms fixed jitter between
 * attempts) absorbs normal cross-process RMW contention while failing
 * predictably on abnormal lock holding. On timeout, throws a typed
 * `SETTINGS_LOCK_TIMEOUT` error with `lockPath`, `waitedMs`, and `ownerPid`.
 *
 * @template T
 * @param {string} lockPath Absolute path to the lock file.
 * @param {() => (T | Promise<T>)} fn Critical section.
 * @param {{ timeoutMs?: number, staleMs?: number }} [options]
 * @returns {Promise<T>}
 */
export const withSettingsLock = async (lockPath, fn, options = {}) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastOwnerPid;

  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    let ownerToken;
    try {
      ownerToken = await acquire(lockPath, staleMs);
    } catch (error) {
      if (error?.code !== 'LOCK_BUSY') throw error;
      if (typeof error.ownerPid === 'number') lastOwnerPid = error.ownerPid;
      if (Date.now() >= deadline) {
        const timeoutErr = new Error(
          `withSettingsLock: failed to acquire ${lockPath} within ${timeoutMs}ms`,
        );
        timeoutErr.code = 'SETTINGS_LOCK_TIMEOUT';
        timeoutErr.lockPath = lockPath;
        timeoutErr.waitedMs = Date.now() - startedAt;
        if (typeof lastOwnerPid === 'number') timeoutErr.ownerPid = lastOwnerPid;
        throw timeoutErr;
      }
      await sleep(jitteredDelay());
      continue;
    }

    try {
      return await fn();
    } finally {
      await release(lockPath, ownerToken);
    }
  }
};

export const defaultSettingsLockPath = (settingsFilePath) => {
  const dir = path.dirname(settingsFilePath);
  const base = path.basename(settingsFilePath);
  return path.join(dir, `${base}.lock`);
};
