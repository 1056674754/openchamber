import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenCodeLifecycleJournal } from './lifecycle-journal.js';

const tempDirectories = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('OpenCode lifecycle journal', () => {
  it('persists ordered structured lifecycle events', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'openchamber-lifecycle-'));
    tempDirectories.push(dataDir);
    const journal = createOpenCodeLifecycleJournal({
      dataDir,
      now: () => '2026-07-28T00:00:00.000Z',
      processId: 4321,
    });

    await journal.record('process_spawn', { pid: 12345, port: 45678 });
    await journal.record('process_exit', { pid: 12345, code: 1, signal: null });
    await journal.flush();

    const lines = (await readFile(journal.path, 'utf8')).trim().split('\n').map(JSON.parse);
    expect(lines).toEqual([
      {
        timestamp: '2026-07-28T00:00:00.000Z',
        event: 'process_spawn',
        openChamberPid: 4321,
        details: { pid: 12345, port: 45678 },
      },
      {
        timestamp: '2026-07-28T00:00:00.000Z',
        event: 'process_exit',
        openChamberPid: 4321,
        details: { pid: 12345, code: 1, signal: null },
      },
    ]);
  });

  it('rotates the journal before it exceeds its size limit', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'openchamber-lifecycle-'));
    tempDirectories.push(dataDir);
    const journal = createOpenCodeLifecycleJournal({
      dataDir,
      maxBytes: 180,
      now: () => '2026-07-28T00:00:00.000Z',
      processId: 4321,
    });

    await journal.record('first_event', { value: 'a'.repeat(70) });
    await journal.record('second_event', { value: 'b'.repeat(70) });
    await journal.flush();

    const rotated = await readFile(`${journal.path}.1`, 'utf8');
    const current = await readFile(journal.path, 'utf8');
    expect(rotated).toContain('"event":"first_event"');
    expect(current).toContain('"event":"second_event"');
  });
});
