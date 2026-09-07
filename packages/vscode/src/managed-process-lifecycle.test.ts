import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import { observeManagedProcess } from './managed-process-lifecycle';

class FakeChildProcess extends EventEmitter {
  public killCount = 0;
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killCount += 1;
    this.emit('exit', null, signal === 'SIGTERM' ? 'SIGTERM' : null);
    return true;
  }
}

describe('managed process lifecycle', () => {
  test('reports an unexpected process exit', async () => {
    const child = new FakeChildProcess();
    const lifecycle = observeManagedProcess(child);

    child.emit('exit', 17, null);

    assert.deepEqual(await lifecycle.exited, {
      code: 17,
      signal: null,
      intentional: false,
    });
  });

  test('marks an owner-requested close as intentional and idempotent', async () => {
    const child = new FakeChildProcess();
    const lifecycle = observeManagedProcess(child);

    lifecycle.close();
    lifecycle.close();

    assert.equal(child.killCount, 1);
    assert.deepEqual(await lifecycle.exited, {
      code: null,
      signal: 'SIGTERM',
      intentional: true,
    });
  });

  test('keeps both output pipes drained until the process exits', async () => {
    const child = new FakeChildProcess();
    const lifecycle = observeManagedProcess(child);

    assert.equal(child.stdout.listenerCount('data'), 1);
    assert.equal(child.stderr.listenerCount('data'), 1);

    child.stdout.emit('data', Buffer.from('late stdout'));
    child.stderr.emit('data', Buffer.from('late stderr'));
    child.emit('exit', 0, null);
    await lifecycle.exited;

    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  });

  test('prevents real child output pipes from blocking on sustained writes', async () => {
    const child = spawn(process.execPath, [
      '-e',
      'process.stdout.write("x".repeat(1024 * 1024)); process.stderr.write("y".repeat(1024 * 1024));',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const lifecycle = observeManagedProcess(child);

    const exit = await Promise.race([
      lifecycle.exited,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('child output remained blocked')), 5000);
      }),
    ]);

    assert.equal(exit.code, 0);
    assert.equal(exit.intentional, false);
  });
});