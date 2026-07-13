import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadDefaultSqliteConstructors } from './sqlite-runtime.js';

const ACTIVE_TOOL_STATUSES = new Set([
  'pending',
  'running',
  'started',
  'inprogress',
  'processing',
  'executing',
]);

const INTERRUPTED_BY_OPENCHAMBER = 'managed_opencode_restart';
const INTERRUPTED_DETAIL = 'OpenChamber restarted its managed OpenCode process before this response completed.';
const INTERRUPTION_OUTPUT = [
  '<shell_metadata>',
  INTERRUPTED_DETAIL,
  '</shell_metadata>',
].join('\n');

const getOpenCodeDataPath = () => {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'opencode');
};

const defaultOpenCodeDbPath = () => path.join(getOpenCodeDataPath(), 'opencode.db');

const openDatabase = (dbPath, Database) => {
  const constructors = Database ? [Database] : loadDefaultSqliteConstructors();
  const errors = [];

  for (const DatabaseConstructor of constructors) {
    try {
      return new DatabaseConstructor(dbPath);
    } catch (error) {
      errors.push(error);
    }
  }

  const message = errors
    .map((error) => error instanceof Error ? error.message : String(error))
    .filter(Boolean)
    .join('; ');
  throw new Error(`SQLite runtime unavailable for OpenCode DB recovery: ${message || 'unknown error'}`);
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const parseJsonObject = (value) => {
  if (isPlainObject(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readTableColumns = (db, tableName) => {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
};

const hasRequiredColumns = (columns, required) => required.every((column) => columns.has(column));

const normalizeStatus = (status) => {
  if (typeof status !== 'string') {
    return '';
  }
  return status.toLowerCase().trim().replace(/[\s_-]+/g, '');
};

const readTimestamp = (value) => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const computeEndTime = (partData, fallbackNow) => {
  const start = readTimestamp(partData?.state?.time?.start);
  return typeof start === 'number' ? Math.max(start, fallbackNow) : fallbackNow;
};

const appendInterruptionOutput = (existingOutput) => {
  if (typeof existingOutput === 'string' && existingOutput.trim().length > 0) {
    return `${existingOutput.trimEnd()}\n\n${INTERRUPTION_OUTPUT}`;
  }
  return INTERRUPTION_OUTPUT;
};

const createInterruptedPartData = (partData, interruptedAt, reason) => {
  const state = isPlainObject(partData.state) ? { ...partData.state } : {};
  const time = isPlainObject(state.time) ? { ...state.time } : {};
  if (typeof readTimestamp(time.start) !== 'number') {
    time.start = interruptedAt;
  }
  time.end = interruptedAt;

  const output = appendInterruptionOutput(state.output);
  const metadata = isPlainObject(state.metadata) ? { ...state.metadata } : {};
  metadata.output = output;
  if (!Object.prototype.hasOwnProperty.call(metadata, 'exit')) {
    metadata.exit = null;
  }
  metadata.interruptedByOpenChamber = true;
  metadata.interruptionCause = INTERRUPTED_BY_OPENCHAMBER;
  metadata.interruptionReason = reason;

  return {
    ...partData,
    state: {
      status: 'error',
      input: isPlainObject(state.input) ? state.input : {},
      error: INTERRUPTED_DETAIL,
      metadata,
      time,
    },
  };
};

const isTerminalMessage = (messageData) => {
  if (!isPlainObject(messageData)) {
    return false;
  }
  if (isPlainObject(messageData.error) || messageData.error) {
    return true;
  }
  if (messageData.finish) {
    return true;
  }
  const completed = readTimestamp(messageData.time?.completed);
  return typeof completed === 'number' && completed > 0;
};

const createInterruptedMessageData = (messageData, interruptedAt, reason) => {
  const time = isPlainObject(messageData.time) ? { ...messageData.time } : {};
  time.completed = interruptedAt;

  return {
    ...messageData,
    time,
    error: {
      name: 'MessageAbortedError',
      data: {
        message: 'aborted',
        cause: INTERRUPTED_BY_OPENCHAMBER,
        detail: INTERRUPTED_DETAIL,
        reason,
      },
    },
  };
};

const makeUpdateStatement = (db, tableName, columns) => {
  if (columns.has('time_updated')) {
    return db.prepare(`UPDATE ${tableName} SET data = ?, time_updated = ? WHERE id = ?`);
  }
  return db.prepare(`UPDATE ${tableName} SET data = ? WHERE id = ?`);
};

const runUpdate = (statement, columns, data, updatedAt, id) => {
  if (columns.has('time_updated')) {
    return statement.run(data, updatedAt, id);
  }
  return statement.run(data, id);
};

export const finalizeInterruptedOpenCodeRuns = ({
  dbPath = defaultOpenCodeDbPath(),
  now = Date.now,
  reason = 'managed OpenCode process restarted',
  Database,
} = {}) => {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return {
      dbPath,
      skipped: true,
      reason: 'db_missing',
      candidateParts: 0,
      updatedParts: 0,
      updatedMessages: 0,
    };
  }

  const db = openDatabase(dbPath, Database);
  try {
    const partColumns = readTableColumns(db, 'part');
    const messageColumns = readTableColumns(db, 'message');
    if (
      !hasRequiredColumns(partColumns, ['id', 'message_id', 'data']) ||
      !hasRequiredColumns(messageColumns, ['id', 'data'])
    ) {
      return {
        dbPath,
        skipped: true,
        reason: 'schema_unsupported',
        candidateParts: 0,
        updatedParts: 0,
        updatedMessages: 0,
      };
    }

    const activeStatusValues = [...ACTIVE_TOOL_STATUSES];
    const activeStatusPlaceholders = activeStatusValues.map(() => '?').join(', ');
    const candidateParts = db.prepare(`
      SELECT id, message_id AS messageId, data
      FROM part
      WHERE json_valid(data)
        AND lower(
          replace(
            replace(
              replace(trim(CAST(json_extract(data, '$.state.status') AS TEXT)), ' ', ''),
              '_',
              ''
            ),
            '-',
            ''
          )
        ) IN (${activeStatusPlaceholders})
    `).all(...activeStatusValues);
    if (candidateParts.length === 0) {
      return {
        dbPath,
        skipped: false,
        reason: null,
        candidateParts: 0,
        updatedParts: 0,
        updatedMessages: 0,
      };
    }

    const selectMessage = db.prepare('SELECT id, data FROM message WHERE id = ?');
    const updatePart = makeUpdateStatement(db, 'part', partColumns);
    const updateMessage = makeUpdateStatement(db, 'message', messageColumns);
    const messagesToFinalize = new Map();

    let updatedParts = 0;

    const transaction = db.transaction(() => {
      for (const row of candidateParts) {
        const partData = parseJsonObject(row.data);
        const status = normalizeStatus(partData?.state?.status);
        if (!ACTIVE_TOOL_STATUSES.has(status)) {
          continue;
        }

        const messageRow = selectMessage.get(row.messageId);
        const messageData = parseJsonObject(messageRow?.data);
        if (!messageData || isTerminalMessage(messageData)) {
          continue;
        }

        const interruptedAt = computeEndTime(partData, now());
        const nextPartData = createInterruptedPartData(partData, interruptedAt, reason);
        runUpdate(updatePart, partColumns, JSON.stringify(nextPartData), interruptedAt, row.id);
        updatedParts += 1;

        const existing = messagesToFinalize.get(row.messageId);
        if (!existing || interruptedAt > existing.interruptedAt) {
          messagesToFinalize.set(row.messageId, {
            messageData,
            interruptedAt,
          });
        }
      }

      for (const [messageId, record] of messagesToFinalize) {
        const nextMessageData = createInterruptedMessageData(record.messageData, record.interruptedAt, reason);
        runUpdate(updateMessage, messageColumns, JSON.stringify(nextMessageData), record.interruptedAt, messageId);
      }
    });

    transaction();

    return {
      dbPath,
      skipped: false,
      reason: null,
      candidateParts: candidateParts.length,
      updatedParts,
      updatedMessages: messagesToFinalize.size,
    };
  } finally {
    db.close();
  }
};
