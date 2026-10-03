import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { resolveProtocolModeFromVersion } from './compatibility.js';

// Fork dual-stack protocol-mode store (spine plan §2). The web server is the
// single authoritative probe point: managed instances record after spawn (S3
// wires lifecycle), remote instances record from their health checks (S3/S8).
// S1 ships only this store so later sub-batches share one source of truth.
//
// Recorded modes are durable across process restarts (spine finale): the
// plugin overlay and the proxy mapping must know the managed child's protocol
// BEFORE the first spawn of a fresh server process, so every record is
// mirrored into `<dataDir>/protocol-mode.json` and reloaded at module init.
// Writes are failure-isolated and skipped under test runners; the in-memory
// store stays the single source of truth within a process.
//
// Recorded modes are inert on the v1 track by design: nothing reads them on a
// behavior path that changes v1 behavior, and the managed default stays v1
// until activation flips it. `OPENCHAMBER_PROTOCOL_MODE=v1|v2` force-overrides
// resolution for joint debugging and rollback; an invalid value is ignored
// (resolution falls back) and warned about once so a typo cannot silently
// masquerade as a default.

const PROTOCOL_MODE_VALUES = new Set(['v1', 'v2']);
export const PROTOCOL_MODE_ENV_KEY = 'OPENCHAMBER_PROTOCOL_MODE';
export const DEFAULT_PROTOCOL_MODE_SERVER_ID = 'default';
export const PROTOCOL_MODE_FILE_NAME = 'protocol-mode.json';

const persistenceEnabled = () => process.env.NODE_ENV !== 'test';

const resolvePersistenceFile = (env = process.env, homeDirectory = homedir()) => {
  const dataDir = env.OPENCHAMBER_DATA_DIR
    ? resolve(env.OPENCHAMBER_DATA_DIR)
    : resolve(homeDirectory, '.config', 'openchamber');
  return resolve(dataDir, PROTOCOL_MODE_FILE_NAME);
};

const isModeEntryShape = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && PROTOCOL_MODE_VALUES.has(value.mode);

let warnedPersistenceFailure = false;

const persistModeEntries = (entries) => {
  if (!persistenceEnabled()) return;
  const file = resolvePersistenceFile();
  try {
    mkdirSync(resolve(file, '..'), { recursive: true });
    const payload = `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, payload, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    if (!warnedPersistenceFailure) {
      warnedPersistenceFailure = true;
      console.warn(`[protocol-mode] failed to persist recorded modes to ${file}:`, error?.message || error);
    }
  }
};

const loadPersistedModeEntries = () => {
  if (!persistenceEnabled()) return [];
  const file = resolvePersistenceFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).filter(([, entry]) => isModeEntryShape(entry));
  } catch {
    return [];
  }
};

const modeEntries = new Map(loadPersistedModeEntries());
let warnedInvalidOverride = false;

const normalizeServerId = (serverId) => {
  const trimmed = typeof serverId === 'string' ? serverId.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_PROTOCOL_MODE_SERVER_ID;
};

export const readProtocolModeOverride = (env = process.env) => {
  const raw = typeof env?.[PROTOCOL_MODE_ENV_KEY] === 'string'
    ? env[PROTOCOL_MODE_ENV_KEY].trim().toLowerCase()
    : '';
  if (raw.length === 0) return null;
  if (!PROTOCOL_MODE_VALUES.has(raw)) {
    if (!warnedInvalidOverride) {
      warnedInvalidOverride = true;
      console.warn(`[protocol-mode] ignoring invalid ${PROTOCOL_MODE_ENV_KEY}='${env[PROTOCOL_MODE_ENV_KEY]}'`);
    }
    return null;
  }
  return raw;
};

export const recordProtocolMode = (serverId, { mode, version = null, source = 'probe' } = {}) => {
  if (!PROTOCOL_MODE_VALUES.has(mode)) {
    throw new TypeError(`protocol mode must be 'v1' or 'v2', received: ${String(mode)}`);
  }
  const entry = Object.freeze({
    mode,
    version: typeof version === 'string' ? version : null,
    source: typeof source === 'string' && source.length > 0 ? source : 'probe',
    recordedAt: Date.now(),
  });
  modeEntries.set(normalizeServerId(serverId), entry);
  persistModeEntries(modeEntries);
  return entry;
};

/**
 * Probe-result convenience: judge `v1 | v2` from a version string (CLI stdout,
 * `/api/info`, or legacy `/global/health`) and store it. Unparseable versions
 * deliberately record the conservative `v1` default.
 */
export const recordProtocolModeFromVersion = (serverId, version, source = 'probe') => (
  recordProtocolMode(serverId, { mode: resolveProtocolModeFromVersion(version), version, source })
);

export const getStoredProtocolModeEntry = (serverId) => {
  const entry = modeEntries.get(normalizeServerId(serverId));
  return entry ? { ...entry } : undefined;
};

/**
 * Effective mode for a server instance: env override, then the recorded probe
 * result, then the `v1` default. Cheap enough for per-event call sites; the
 * override parse is two string ops.
 */
export const resolveProtocolMode = (serverId, env = process.env) => {
  const override = readProtocolModeOverride(env);
  if (override) return override;
  return modeEntries.get(normalizeServerId(serverId))?.mode ?? 'v1';
};

export const snapshotProtocolModes = () => Object.fromEntries(
  Array.from(modeEntries.entries(), ([serverId, entry]) => [serverId, { ...entry }]),
);

export const resetProtocolModes = () => {
  modeEntries.clear();
  warnedInvalidOverride = false;
  persistModeEntries(modeEntries);
};
