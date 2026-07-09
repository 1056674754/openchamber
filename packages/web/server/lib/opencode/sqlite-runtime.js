import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const defaultIsBunRuntime = () => typeof Bun !== 'undefined';

const defaultIsElectronRuntime = () => (
  typeof process !== 'undefined' && typeof process.versions?.electron === 'string'
);

const createNodeSqliteConstructor = (nodeSqlite) => {
  if (typeof nodeSqlite?.DatabaseSync !== 'function') return null;

  return class NodeSqliteDatabase extends nodeSqlite.DatabaseSync {
    pragma(sql) {
      const trimmed = typeof sql === 'string' ? sql.trim() : '';
      if (!trimmed) return [];
      return this.prepare(`PRAGMA ${trimmed}`).all();
    }

    transaction(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('transaction callback must be a function');
      }

      return (...args) => {
        this.exec('BEGIN');
        try {
          const result = callback(...args);
          this.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            this.exec('ROLLBACK');
          } catch {
          }
          throw error;
        }
      };
    }
  };
};

const tryLoadBunSqlite = (requireFn) => {
  try {
    const bunSqlite = requireFn('bun:sqlite');
    return typeof bunSqlite?.Database === 'function' ? bunSqlite.Database : null;
  } catch {
    return null;
  }
};

const tryLoadNodeSqlite = (requireFn) => {
  try {
    return createNodeSqliteConstructor(requireFn('node:sqlite'));
  } catch {
    return null;
  }
};

const createLazyNodeSqliteConstructor = (requireFn) => {
  return class LazyNodeSqliteDatabase {
    constructor(...args) {
      const Database = tryLoadNodeSqlite(requireFn);
      if (!Database) {
        throw new Error('node:sqlite DatabaseSync unavailable');
      }
      return new Database(...args);
    }
  };
};

const tryLoadBetterSqlite = (requireFn) => {
  try {
    const BetterSqlite = requireFn('better-sqlite3');
    if (typeof BetterSqlite === 'function') return BetterSqlite;
    if (typeof BetterSqlite?.Database === 'function') return BetterSqlite.Database;
    return null;
  } catch (error) {
    return error;
  }
};

export const loadDefaultSqliteConstructors = ({
  requireFn = require,
  isBunRuntime = defaultIsBunRuntime,
  isElectronRuntime = defaultIsElectronRuntime,
} = {}) => {
  const constructors = [];
  const errors = [];

  if (isBunRuntime()) {
    const BunDatabase = tryLoadBunSqlite(requireFn);
    if (BunDatabase) return [BunDatabase];
  }

  if (isElectronRuntime()) {
    const NodeSqliteDatabase = tryLoadNodeSqlite(requireFn);
    if (NodeSqliteDatabase) constructors.push(NodeSqliteDatabase);
  }

  const BetterSqlite = tryLoadBetterSqlite(requireFn);
  if (BetterSqlite instanceof Error) {
    errors.push(BetterSqlite);
  } else if (BetterSqlite) {
    constructors.push(BetterSqlite);
  }

  if (!isElectronRuntime()) {
    constructors.push(createLazyNodeSqliteConstructor(requireFn));
  }

  if (constructors.length === 0) {
    const message = errors
      .map((error) => error.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(`SQLite runtime unavailable: ${message || 'no driver loaded'}`);
  }

  return constructors;
};
