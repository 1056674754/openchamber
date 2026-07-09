import { describe, expect, it } from 'vitest';

import { loadDefaultSqliteConstructors } from './sqlite-runtime.js';

describe('SQLite runtime selection', () => {
  it('prefers node:sqlite in Electron before native better-sqlite3', () => {
    class DatabaseSync {}
    class BetterSqlite {}
    const loaded = [];

    const constructors = loadDefaultSqliteConstructors({
      isBunRuntime: () => false,
      isElectronRuntime: () => true,
      requireFn: (name) => {
        loaded.push(name);
        if (name === 'node:sqlite') return { DatabaseSync };
        if (name === 'better-sqlite3') return BetterSqlite;
        throw new Error(`unexpected require: ${name}`);
      },
    });

    expect(loaded).toEqual(['node:sqlite', 'better-sqlite3']);
    expect(constructors[0].name).toBe('NodeSqliteDatabase');
    expect(constructors[1]).toBe(BetterSqlite);
  });

  it('adds a better-sqlite-compatible transaction wrapper to node:sqlite', () => {
    class DatabaseSync {
      statements = [];

      exec(sql) {
        this.statements.push(sql);
      }
    }

    const constructors = loadDefaultSqliteConstructors({
      isBunRuntime: () => false,
      isElectronRuntime: () => true,
      requireFn: (name) => {
        if (name === 'node:sqlite') return { DatabaseSync };
        throw new Error(`unavailable: ${name}`);
      },
    });
    const db = new constructors[0]();
    const transaction = db.transaction((value) => {
      db.exec(`WORK ${value}`);
      return 'result';
    });

    expect(transaction('commit')).toBe('result');
    expect(db.statements).toEqual(['BEGIN', 'WORK commit', 'COMMIT']);

    const failingTransaction = db.transaction(() => {
      db.exec('WORK rollback');
      throw new Error('boom');
    });

    expect(() => failingTransaction()).toThrow('boom');
    expect(db.statements.slice(-3)).toEqual(['BEGIN', 'WORK rollback', 'ROLLBACK']);
  });

  it('uses bun:sqlite first in Bun and does not touch native addons', () => {
    class BunDatabase {}
    const loaded = [];

    const constructors = loadDefaultSqliteConstructors({
      isBunRuntime: () => true,
      isElectronRuntime: () => false,
      requireFn: (name) => {
        loaded.push(name);
        if (name === 'bun:sqlite') return { Database: BunDatabase };
        throw new Error(`unexpected require: ${name}`);
      },
    });

    expect(loaded).toEqual(['bun:sqlite']);
    expect(constructors).toEqual([BunDatabase]);
  });

  it('does not eagerly load node:sqlite outside Electron when better-sqlite3 is present', () => {
    class BetterSqlite {}
    const loaded = [];

    const constructors = loadDefaultSqliteConstructors({
      isBunRuntime: () => false,
      isElectronRuntime: () => false,
      requireFn: (name) => {
        loaded.push(name);
        if (name === 'better-sqlite3') return BetterSqlite;
        throw new Error(`unexpected eager require: ${name}`);
      },
    });

    expect(loaded).toEqual(['better-sqlite3']);
    expect(constructors[0]).toBe(BetterSqlite);
    expect(constructors[1].name).toBe('LazyNodeSqliteDatabase');
  });
});
