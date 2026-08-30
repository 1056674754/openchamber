import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type OpenCodeGoCredential = { workspaceId: string; authCookie: string };

const targetPath = () => path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'quota',
  'opencode-go.json',
);

export const normalizeOpenCodeGoCredential = (value: unknown): OpenCodeGoCredential | null => {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId.trim() : '';
  let authCookie = typeof data.authCookie === 'string' ? data.authCookie.trim() : '';
  if (authCookie.startsWith('auth=')) authCookie = authCookie.slice(5).trim();
  if (!workspaceId || !authCookie || /[\r\n]/.test(workspaceId) || /[\r\n]/.test(authCookie)) {
    return null;
  }
  return { workspaceId, authCookie };
};

export const readOpenCodeGoCredential = (): OpenCodeGoCredential | null => {
  try {
    return normalizeOpenCodeGoCredential(JSON.parse(fs.readFileSync(targetPath(), 'utf8')));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn('Failed to read OpenCode Go credentials');
    }
    return null;
  }
};

export const getOpenCodeGoCredentialStatus = () => {
  const credential = readOpenCodeGoCredential();
  return credential
    ? { configured: true, workspaceId: credential.workspaceId, secretMasked: '********' }
    : { configured: false };
};

export const writeOpenCodeGoCredential = (credential: OpenCodeGoCredential) => {
  const target = targetPath();
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return getOpenCodeGoCredentialStatus();
};

export const deleteOpenCodeGoCredential = () => {
  try {
    fs.unlinkSync(targetPath());
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
};
export const deleteLegacyOpenCodeGoCredential = deleteOpenCodeGoCredential;

const toWindow = (usedPercent: number, resetAt: string) => {
  const normalizedPercent = Math.min(100, Math.max(0, usedPercent));
  const resetTimestamp = new Date(resetAt).getTime();
  return {
    usedPercent: normalizedPercent,
    remainingPercent: 100 - normalizedPercent,
    windowSeconds: null,
    resetAfterSeconds: Math.max(0, Math.floor((resetTimestamp - Date.now()) / 1000)),
    resetAt: resetTimestamp,
    resetAtFormatted: null,
    resetAfterFormatted: null,
  };
};

export const parseOpenCodeGoUsage = (payload: unknown) => {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const usage = root?.usage && typeof root.usage === 'object' ? root.usage as Record<string, unknown> : null;
  if (!usage) return {};
  const windows: Record<string, ReturnType<typeof toWindow>> = {};

  for (const [key, field] of Object.entries({
    '5h': 'rolling',
    weekly: 'weekly',
    monthly: 'monthly',
  })) {
    const entry = usage[field];
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const used = record.percent;
    const resetAt = record.resetsAt;
    if (typeof used !== 'number' || !Number.isFinite(used)) continue;
    if (typeof resetAt !== 'string' || !Number.isFinite(new Date(resetAt).getTime())) continue;
    windows[key] = toWindow(used, resetAt);
  }
  return windows;
};

export const fetchOpenCodeGoUsage = async (apiKey: string) => {
  const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'OpenChamber quota provider',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('OpenCode Go authentication failed');
  }
  if (!response.ok) throw new Error(`OpenCode Go usage API returned HTTP ${response.status}`);
  const windows = parseOpenCodeGoUsage(await response.json().catch(() => null));
  if (Object.keys(windows).length === 0) {
    throw new Error('OpenCode Go usage data could not be parsed');
  }
  return windows;
};
