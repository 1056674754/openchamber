import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { withSettingsLock, defaultSettingsLockPath } from './settings-lock';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'settings-lock-test-'));

describe('settings-lock', () => {
  test('creates the lock parent directory on first use', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 'nested', 'settings.json.lock');

    await expect(withSettingsLock(lock, async () => fs.existsSync(lock))).resolves.toBe(true);
    expect(fs.existsSync(path.dirname(lock))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('acquires and releases a fresh lock', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    const result = await withSettingsLock(lock, async () => {
      expect(fs.existsSync(lock)).toBe(true);
      return 'inside';
    });
    expect(result).toBe('inside');
    expect(fs.existsSync(lock)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('serializes concurrent critical sections in the same process', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    const log = [];

    await Promise.all([
      withSettingsLock(lock, async () => {
        log.push('A-start');
        await new Promise((r) => setTimeout(r, 20));
        log.push('A-end');
      }),
      withSettingsLock(lock, async () => {
        log.push('B-start');
        await new Promise((r) => setTimeout(r, 5));
        log.push('B-end');
      }),
    ]);

    const sequences = ['A-start,A-end,B-start,B-end', 'B-start,B-end,A-start,A-end'];
    expect(sequences).toContain(log.join(','));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('steals a stale lock whose holder pid is dead', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    const bogusPid = 999_999;
    await fs.promises.writeFile(
      lock,
      JSON.stringify({ pid: bogusPid, ownerToken: 'stale', startedAt: Date.now() }),
    );

    const result = await withSettingsLock(lock, async () => 'recovered', { timeoutMs: 1000 });
    expect(result).toBe('recovered');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('never steals an old lock while its owner pid is alive', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    await fs.promises.writeFile(
      lock,
      JSON.stringify({ pid: process.pid, ownerToken: 'live', startedAt: Date.now() - 120_000 }),
    );

    await expect(withSettingsLock(lock, async () => 'unsafe', { timeoutMs: 60, staleMs: 10 }))
      .rejects.toHaveProperty('code', 'SETTINGS_LOCK_TIMEOUT');
    expect(JSON.parse(await fs.promises.readFile(lock, 'utf8')).ownerToken).toBe('live');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('serializes concurrent contenders after reclaiming one stale lock', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    await fs.promises.writeFile(
      lock,
      JSON.stringify({ pid: 999_999, ownerToken: 'stale', startedAt: Date.now() - 60_000 }),
    );
    let active = 0;
    let maxActive = 0;

    await Promise.all(Array.from({ length: 8 }, (_, index) => withSettingsLock(lock, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3 + (index % 2)));
      active -= 1;
    }, { timeoutMs: 1_000 })));

    expect(maxActive).toBe(1);
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.existsSync(`${lock}.cleanup`)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('preserves independent keys across separate writer processes', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 'settings.json.lock');
    const settings = path.join(dir, 'settings.json');
    const moduleUrl = pathToFileURL(path.join(import.meta.dir, 'settings-lock.js')).href;
    const worker = `
      import fs from 'node:fs/promises';
      import { withSettingsLock } from ${JSON.stringify(moduleUrl)};
      const [lockPath, settingsPath, key] = process.argv.slice(-3);
      for (let index = 0; index < 10; index += 1) {
        await withSettingsLock(lockPath, async () => {
          let current = {};
          try { current = JSON.parse(await fs.readFile(settingsPath, 'utf8')); } catch {}
          await new Promise((resolve) => setTimeout(resolve, 2));
          current[key] = index;
          const tmp = settingsPath + '.tmp-' + process.pid + '-' + index;
          await fs.writeFile(tmp, JSON.stringify(current));
          await fs.rename(tmp, settingsPath);
        }, { timeoutMs: 5000 });
      }
    `;
    const run = (key) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', worker, lock, settings, key], { stdio: 'pipe' });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker exited ${code}`)));
    });

    await Promise.all([run('electron'), run('vscode')]);

    expect(JSON.parse(await fs.promises.readFile(settings, 'utf8'))).toEqual({
      electron: 9,
      vscode: 9,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('throws typed SETTINGS_LOCK_TIMEOUT when a live pid holds the lock past the deadline', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');
    await fs.promises.writeFile(
      lock,
      JSON.stringify({ pid: process.pid, ownerToken: 'held', startedAt: Date.now() }),
    );

    let caught = null;
    try {
      await withSettingsLock(lock, async () => 'should-not-happen', { timeoutMs: 80, staleMs: 60_000 });
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(caught.code).toBe('SETTINGS_LOCK_TIMEOUT');
    expect(caught.lockPath).toBe(lock);
    expect(typeof caught.waitedMs).toBe('number');
    expect(caught.waitedMs).toBeGreaterThanOrEqual(80);
    expect(caught.ownerPid).toBe(process.pid);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('defaultSettingsLockPath puts the lock beside the file', () => {
    expect(defaultSettingsLockPath('/home/u/.config/openchamber/settings.json'))
      .toBe('/home/u/.config/openchamber/settings.json.lock');
  });

  test('release does not unlink a lock that was stolen and reacquired by someone else', async () => {
    const dir = tmpDir();
    const lock = path.join(dir, 's.json.lock');

    // Acquire, then overwrite the lockfile from inside the critical section
    // to simulate someone stealing it. release() should refuse to unlink
    // because the ownerToken no longer matches.
    await withSettingsLock(lock, async () => {
      await fs.promises.writeFile(
        lock,
        JSON.stringify({ pid: 999_999, ownerToken: 'someone-else', startedAt: Date.now() }),
      );
    });

    const content = JSON.parse(await fs.promises.readFile(lock, 'utf8'));
    expect(content.ownerToken).toBe('someone-else');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
