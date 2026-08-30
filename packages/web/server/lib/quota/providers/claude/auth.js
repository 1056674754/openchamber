import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { readAuthFile } from '../../../opencode/auth.js';
import {
  asNonEmptyString,
  asObject,
  getAuthEntry,
  normalizeAuthEntry,
  normalizeTimestamp,
  readJsonFile,
} from '../../utils/index.js';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const OPENCODE_AUTH_ALIASES = ['anthropic', 'claude'];

const claudeConfigDirectory = () => {
  const override = asNonEmptyString(process.env.CLAUDE_CONFIG_DIR);
  return override ? path.resolve(override) : path.join(os.homedir(), '.claude');
};

const parseClaudeCodeBlob = (blob, source) => {
  const oauth = asObject(asObject(blob)?.claudeAiOauth);
  const accessToken = asNonEmptyString(oauth?.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: asNonEmptyString(oauth.refreshToken),
    expiresAt: normalizeTimestamp(oauth.expiresAt),
    planLabel: asNonEmptyString(oauth.subscriptionType),
    source,
  };
};

const readKeychainCredential = () => {
  if (process.platform !== 'darwin') return null;
  let raw;
  try {
    raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  try {
    return parseClaudeCodeBlob(JSON.parse(raw.trim()), 'keychain');
  } catch {
    console.warn('Claude quota: Keychain credentials are not valid JSON');
    return null;
  }
};

const readCredentialsFile = () =>
  parseClaudeCodeBlob(readJsonFile(path.join(claudeConfigDirectory(), '.credentials.json')), 'credentials-file');

const readOpenCodeCredential = () => {
  const entry = normalizeAuthEntry(getAuthEntry(readAuthFile(), OPENCODE_AUTH_ALIASES));
  const accessToken = asNonEmptyString(entry?.access) ?? asNonEmptyString(entry?.token);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: asNonEmptyString(entry.refresh),
    expiresAt: normalizeTimestamp(entry.expires),
    planLabel: null,
    source: 'opencode-auth',
  };
};

const readEnvCredential = () => {
  const accessToken = asNonEmptyString(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  if (!accessToken) return null;
  return { accessToken, refreshToken: null, expiresAt: null, planLabel: null, source: 'env' };
};

export const loadClaudeCredential = () =>
  readKeychainCredential()
  ?? readCredentialsFile()
  ?? readOpenCodeCredential()
  ?? readEnvCredential();
