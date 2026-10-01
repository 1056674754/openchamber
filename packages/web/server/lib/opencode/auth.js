import fs from 'fs';
import path from 'path';
import os from 'os';
import { readCredentialsFromDb, resolveCredentialDbPath } from './credential-db.js';
import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

/**
 * READ-ONLY view of OpenCode's provider credentials.
 *
 * Fork dual-track (spine plan OC2-S2, hook-up point J5): on the v1 track the
 * answer comes from the legacy `auth.json` exactly as before. On the v2 track
 * (`protocolMode: 'v2'`, hook-up point J5's `GET /api/credential` generation),
 * OpenCode imports `auth.json` once into its own SQLite database and never
 * writes the file again; `readAuthFile()` then answers from the database
 * OpenCode actually uses (`credential-db.js`). A successful database read is
 * authoritative, including an empty one: OpenCode never clears `auth.json`
 * after importing it, and a credential the user removed in OpenCode disappears
 * only from the database, so mixing the file back in would hand out the
 * deleted key again. The legacy file is read only when the database cannot be
 * read at all (no sqlite runtime, no file, unknown schema). The shape is the
 * legacy `auth.json` map either way. Nothing here writes: a write would be
 * invisible to the running OpenCode and drift from what it uses.
 */

const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const AUTH_FILE = path.join(OPENCODE_DATA_DIR, 'auth.json');

function readLegacyAuthFile(authFile, fileSystem) {
  if (!fileSystem.existsSync(authFile)) {
    return {};
  }
  try {
    const content = fileSystem.readFileSync(authFile, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed);
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read OpenCode auth configuration');
  }
}

/**
 * The credentials OpenCode uses, keyed by provider id, in the legacy entry
 * shape.
 *
 * @param {{ dbPath?: string, authFile?: string, fileSystem?: typeof fs, protocolMode?: 'v1' | 'v2' }} [options]
 *   test seams; production callers pass nothing and get the recorded mode of
 *   the managed local instance.
 */
function readAuthFile(options = {}) {
  const {
    dbPath = resolveCredentialDbPath({ dataDir: OPENCODE_DATA_DIR, path }),
    authFile = AUTH_FILE,
    fileSystem = fs,
    protocolMode = resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID),
  } = options;
  if (protocolMode === 'v2') {
    const stored = readCredentialsFromDb({ dbPath, fs: fileSystem });
    if (stored) return stored;
  }
  return readLegacyAuthFile(authFile, fileSystem);
}

function writeAuthFile(auth) {
  try {
    if (!fs.existsSync(OPENCODE_DATA_DIR)) {
      fs.mkdirSync(OPENCODE_DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(AUTH_FILE)) {
      const backupFile = `${AUTH_FILE}.openchamber.backup`;
      fs.copyFileSync(AUTH_FILE, backupFile);
      console.log(`Created auth backup: ${backupFile}`);
    }

    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
    console.log('Successfully wrote auth file');
  } catch (error) {
    console.error('Failed to write auth file:', error);
    throw new Error('Failed to write OpenCode auth configuration');
  }
}

function removeProviderAuth(providerId) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const auth = readAuthFile();
  
  if (!auth[providerId]) {
    console.log(`Provider ${providerId} not found in auth file, nothing to remove`);
    return false;
  }

  delete auth[providerId];
  writeAuthFile(auth);
  console.log(`Removed provider auth: ${providerId}`);
  return true;
}

function getProviderAuth(providerId) {
  const auth = readAuthFile();
  return auth[providerId] || null;
}

function listProviderAuths() {
  const auth = readAuthFile();
  return Object.keys(auth);
}

export {
  readAuthFile,
  writeAuthFile,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  AUTH_FILE,
  OPENCODE_DATA_DIR
};
