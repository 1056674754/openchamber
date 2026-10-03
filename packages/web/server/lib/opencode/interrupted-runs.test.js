import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizeInterruptedOpenCodeRuns } from './interrupted-runs.js';

const require = createRequire(import.meta.url);
const loadTestDatabaseConstructor = () => {
  if (typeof Bun !== 'undefined') {
    const bunSqlite = require('bun:sqlite');
    return bunSqlite.Database;
  }
  return require('better-sqlite3');
};

const Database = loadTestDatabaseConstructor();

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

const createTempDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-interrupted-runs-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      time_updated INTEGER
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      data TEXT NOT NULL,
      time_updated INTEGER
    );
  `);
  return { db, dbPath };
};

describe('interrupted OpenCode run finalization', () => {
  it('marks active tool parts and their assistant message as errored', () => {
    const { db, dbPath } = createTempDb();
    try {
      const message = {
        id: 'msg_running',
        role: 'assistant',
        time: { created: 900 },
        finish: null,
        error: null,
      };
      const part = {
        id: 'prt_running',
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'running',
          input: { command: 'sleep 999' },
          time: { start: 1000 },
          metadata: { description: 'sleep' },
        },
      };
      db.prepare('INSERT INTO message (id, data, time_updated) VALUES (?, ?, ?)').run(
        message.id,
        JSON.stringify(message),
        900
      );
      db.prepare('INSERT INTO part (id, message_id, data, time_updated) VALUES (?, ?, ?, ?)').run(
        part.id,
        message.id,
        JSON.stringify(part),
        1000
      );
    } finally {
      db.close();
    }

    const result = finalizeInterruptedOpenCodeRuns({
      dbPath,
      Database,
      now: () => 2000,
      reason: 'test restart',
    });

    expect(result.updatedParts).toBe(1);
    expect(result.updatedMessages).toBe(1);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const partRow = verifyDb.prepare('SELECT data, time_updated FROM part WHERE id = ?').get('prt_running');
      const messageRow = verifyDb.prepare('SELECT data, time_updated FROM message WHERE id = ?').get('msg_running');
      const nextPart = JSON.parse(partRow.data);
      const nextMessage = JSON.parse(messageRow.data);

      expect(nextPart.state.status).toBe('error');
      expect(nextPart.state.time.end).toBe(2000);
      expect(nextPart.state.output).toBeUndefined();
      expect(nextPart.state.metadata.interruptedByOpenChamber).toBe(true);
      expect(nextPart.state.metadata.output).toContain('OpenChamber restarted its managed OpenCode process');
      expect(nextPart.state.error).toContain('OpenChamber restarted its managed OpenCode process');
      expect(partRow.time_updated).toBe(2000);

      expect(nextMessage.time.completed).toBe(2000);
      expect(nextMessage.error.name).toBe('MessageAbortedError');
      expect(nextMessage.error.data.message).toBe('aborted');
      expect(nextMessage.error.data.cause).toBe('managed_opencode_restart');
      expect(messageRow.time_updated).toBe(2000);
    } finally {
      verifyDb.close();
    }
  });

  it('opens the database through the default runtime adapter chain', () => {
    const { db, dbPath } = createTempDb();
    try {
      const message = {
        id: 'msg_default_adapter',
        role: 'assistant',
        time: { created: 900 },
        finish: null,
        error: null,
      };
      const part = {
        id: 'prt_default_adapter',
        type: 'tool',
        tool: 'question',
        state: {
          status: 'running',
          input: { questions: [] },
          time: { start: 1000 },
        },
      };
      db.prepare('INSERT INTO message (id, data, time_updated) VALUES (?, ?, ?)').run(
        message.id,
        JSON.stringify(message),
        900
      );
      db.prepare('INSERT INTO part (id, message_id, data, time_updated) VALUES (?, ?, ?, ?)').run(
        part.id,
        message.id,
        JSON.stringify(part),
        1000
      );
    } finally {
      db.close();
    }

    const result = finalizeInterruptedOpenCodeRuns({
      dbPath,
      now: () => 2000,
      reason: 'default adapter test',
    });

    expect(result.updatedParts).toBe(1);
    expect(result.updatedMessages).toBe(1);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const partRow = verifyDb.prepare('SELECT data FROM part WHERE id = ?').get('prt_default_adapter');
      const nextPart = JSON.parse(partRow.data);
      expect(nextPart.state.status).toBe('error');
      expect(nextPart.state.metadata.interruptedByOpenChamber).toBe(true);
    } finally {
      verifyDb.close();
    }
  });

  it('does not materialize terminal tool parts as interruption candidates', () => {
    const { db, dbPath } = createTempDb();
    try {
      const message = {
        id: 'msg_terminal_part',
        role: 'assistant',
        time: { created: 900, completed: 1200 },
        finish: 'stop',
      };
      const part = {
        id: 'prt_terminal',
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'completed',
          time: { start: 1000, end: 1100 },
          output: 'done',
        },
      };
      db.prepare('INSERT INTO message (id, data, time_updated) VALUES (?, ?, ?)').run(
        message.id,
        JSON.stringify(message),
        1200
      );
      db.prepare('INSERT INTO part (id, message_id, data, time_updated) VALUES (?, ?, ?, ?)').run(
        part.id,
        message.id,
        JSON.stringify(part),
        1100
      );
    } finally {
      db.close();
    }

    const result = finalizeInterruptedOpenCodeRuns({
      dbPath,
      Database,
      now: () => 2000,
      reason: 'test restart',
    });

    expect(result.candidateParts).toBe(0);
    expect(result.updatedParts).toBe(0);
    expect(result.updatedMessages).toBe(0);
  });

  it('beforeMs cutoff exempts parts written after the restart instant', () => {
    const { db, dbPath } = createTempDb();
    try {
      const message = {
        id: 'msg_after_cutoff',
        role: 'assistant',
        time: { created: 1600 },
        finish: null,
        error: null,
      };
      const part = {
        id: 'prt_after_cutoff',
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'running',
          input: { command: 'live command' },
          time: { start: 1700 },
        },
      };
      db.prepare('INSERT INTO message (id, data, time_updated) VALUES (?, ?, ?)').run(
        message.id,
        JSON.stringify(message),
        1600
      );
      db.prepare('INSERT INTO part (id, message_id, data, time_updated) VALUES (?, ?, ?, ?)').run(
        part.id,
        message.id,
        JSON.stringify(part),
        1700
      );
    } finally {
      db.close();
    }

    // Cutoff captured before the new process started: the running part above
    // belongs to the restarted server and must NOT be finalized.
    const result = finalizeInterruptedOpenCodeRuns({
      dbPath,
      Database,
      now: () => 2000,
      reason: 'background finalization',
      beforeMs: 1500,
    });

    expect(result.candidateParts).toBe(0);
    expect(result.updatedParts).toBe(0);
    expect(result.updatedMessages).toBe(0);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const partRow = verifyDb.prepare('SELECT data FROM part WHERE id = ?').get('prt_after_cutoff');
      expect(JSON.parse(partRow.data).state.status).toBe('running');
    } finally {
      verifyDb.close();
    }
  });

  it('does not rewrite terminal messages that still contain a stale active-looking part', () => {
    const { db, dbPath } = createTempDb();
    try {
      const message = {
        id: 'msg_completed',
        role: 'assistant',
        time: { created: 900, completed: 1500 },
        finish: 'stop',
        error: null,
      };
      const part = {
        id: 'prt_stale_running',
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'running',
          time: { start: 1000 },
        },
      };
      db.prepare('INSERT INTO message (id, data, time_updated) VALUES (?, ?, ?)').run(
        message.id,
        JSON.stringify(message),
        1500
      );
      db.prepare('INSERT INTO part (id, message_id, data, time_updated) VALUES (?, ?, ?, ?)').run(
        part.id,
        message.id,
        JSON.stringify(part),
        1000
      );
    } finally {
      db.close();
    }

    const result = finalizeInterruptedOpenCodeRuns({
      dbPath,
      Database,
      now: () => 2000,
      reason: 'test restart',
    });

    expect(result.updatedParts).toBe(0);
    expect(result.updatedMessages).toBe(0);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const partRow = verifyDb.prepare('SELECT data, time_updated FROM part WHERE id = ?').get('prt_stale_running');
      const messageRow = verifyDb.prepare('SELECT data, time_updated FROM message WHERE id = ?').get('msg_completed');
      const nextPart = JSON.parse(partRow.data);
      const nextMessage = JSON.parse(messageRow.data);

      expect(nextPart.state.status).toBe('running');
      expect(partRow.time_updated).toBe(1000);
      expect(nextMessage.time.completed).toBe(1500);
      expect(messageRow.time_updated).toBe(1500);
    } finally {
      verifyDb.close();
    }
  });
});
