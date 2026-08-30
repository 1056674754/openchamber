import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { deleteLegacyOpenCodeGoCredential, fetchOpenCodeGoUsage } from './opencodeGoQuota';
import { fetchCommandCodeUsage } from './commandCodeQuota';

type AuthEntry = Record<string, unknown> | string;
type AuthFile = Record<string, AuthEntry>;

type UsageWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowSeconds: number | null;
  resetAfterSeconds: number | null;
  resetAt: number | null;
  resetAtFormatted: string | null;
  resetAfterFormatted: string | null;
  valueLabel?: string | null;
};

type ProviderUsage = {
  windows: Record<string, UsageWindow>;
  models?: Record<string, ProviderUsage>;
};

type OpenAiUsagePayload = {
  rate_limit?: {
    primary_window?: {
      used_percent?: number;
      limit_window_seconds?: number;
      reset_at?: number;
    };
    secondary_window?: {
      used_percent?: number;
      limit_window_seconds?: number;
      reset_at?: number;
    };
  };
  credits?: {
    balance?: number | string;
    unlimited?: boolean;
  };
  spend_control?: {
    individual_limit?: {
      limit?: number | string;
      used?: number | string;
      used_percent?: number | string;
    };
  };
};

type GoogleModelsPayload = {
  models?: Record<string, {
    quotaInfo?: {
      remainingFraction?: number;
      resetTime?: string;
    };
  }>;
};

type GoogleQuotaBucketsPayload = {
  buckets?: Array<{
    modelId?: string;
    remainingFraction?: number;
    resetTime?: string;
  }>;
};

type ZaiLimit = {
  type?: string;
  number?: number;
  unit?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  nextResetTime?: number;
  percentage?: number;
};

type ZaiPayload = {
  data?: {
    limits?: ZaiLimit[];
    level?: string;
  };
};

type ZhipuaiTokensLimit = {
  type: 'TOKENS_LIMIT';
  unit?: number;
  number?: number;
  nextResetTime?: number;
  percentage?: number;
};

type ZhipuaiMcpTimeLimit = {
  type: 'TIME_LIMIT';
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
  usageDetails?: Array<{
    modelCode?: string;
    usage?: number;
  }>;
};

type ZhipuaiPayload = {
  data?: {
    limits?: Array<ZhipuaiTokensLimit | ZhipuaiMcpTimeLimit>;
    level?: string;
  };
};

type WaferPayload = {
  remaining_included_requests?: number | string;
  included_request_limit?: number | string;
  overage_request_count?: number | string;
  current_period_used_percent?: number | string;
  window_start?: number | string;
  window_end?: number | string;
  plan_tier?: string;
};

type DeepseekPayload = {
  balance_infos?: Array<{
    currency?: string;
    total_balance?: number | string;
  }>;
};

type ClaudeCredential = {
  accessToken: string;
  refreshToken: string | null;
  planLabel: string | null;
  source: 'keychain' | 'credentials-file' | 'opencode-auth' | 'env';
};

export type ProviderResult = {
  providerId: string;
  providerName: string;
  ok: boolean;
  configured: boolean;
  usage: ProviderUsage | null;
  fetchedAt: number;
  error?: string;
  planLabel?: string | null;
};

const formatZaiCreditAmount = (value: number): string => {
  if (value < 1000) return value.toLocaleString('en-US');
  return `${Math.round(value / 100) / 10}k`;
};

const formatZaiCreditValueLabel = (limit: ZaiLimit): string | null => {
  const used = toNumber(limit.currentValue);
  const total = toNumber(limit.usage);
  if (used === null || total === null) return null;
  return `${formatZaiCreditAmount(used)} / ${formatZaiCreditAmount(total)} credits`;
};

const OPENCODE_CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const AUTH_FILE = path.join(OPENCODE_DATA_DIR, 'auth.json');
const OLLAMA_CLOUD_COOKIE_PATH = path.join(os.homedir(), '.config', 'ollama-quota', 'cookie');


const ANTIGRAVITY_ACCOUNTS_PATHS = [
  path.join(OPENCODE_CONFIG_DIR, 'antigravity-accounts.json'),
  path.join(OPENCODE_DATA_DIR, 'antigravity-accounts.json'),
];

// OAuth Secret value used to init client
// Note: It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
// "The process results in a client ID and, in some cases, a client secret,
// which you embed in the source code of your application. (In this context,
// the client secret is obviously not treated as a secret.)"
// ref: https://github.com/opgginc/opencode-bar

const ANTIGRAVITY_GOOGLE_CLIENT_ID =
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_GOOGLE_CLIENT_SECRET = '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';
const GEMINI_GOOGLE_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINI_GOOGLE_CLIENT_SECRET = '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';
const DEFAULT_PROJECT_ID = 'rising-fact-p41fc';
const GOOGLE_FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
const GOOGLE_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const GOOGLE_PRIMARY_ENDPOINT = 'https://cloudcode-pa.googleapis.com';

const GOOGLE_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  GOOGLE_PRIMARY_ENDPOINT,
];

const GOOGLE_HEADERS = {
  'User-Agent': 'antigravity/1.11.5 windows/amd64',
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'Client-Metadata':
    '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};

const resolveGoogleWindow = (sourceId: GoogleAuthSource['sourceId'], resetAt: number | null) => {
  if (sourceId === 'gemini') {
    return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS } as const;
  }

  if (sourceId === 'antigravity') {
    const remainingSeconds = typeof resetAt === 'number'
      ? Math.max(0, Math.round((resetAt - Date.now()) / 1000))
      : null;

    if (remainingSeconds !== null && remainingSeconds > 10 * 60 * 60) {
      return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS } as const;
    }

    return { label: '5h', seconds: GOOGLE_FIVE_HOUR_WINDOW_SECONDS } as const;
  }

  return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS } as const;
};

const ZAI_TOKEN_WINDOW_SECONDS: Record<number, number> = {
  3: 60 * 60,
  6: 7 * 24 * 60 * 60,
};

const readAuthFile = (): AuthFile => {
  if (!fs.existsSync(AUTH_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed) as AuthFile;
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read OpenCode auth configuration');
  }
};

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.warn(`Failed to read JSON file: ${filePath}`, error);
    return null;
  }
};

const readTextFile = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content || null;
  } catch (error) {
    console.warn(`Failed to read text file: ${filePath}`, error);
    return null;
  }
};

const parseClaudeCodeCredential = (
  value: Record<string, unknown> | null,
  source: ClaudeCredential['source'],
): ClaudeCredential | null => {
  const oauth = asObject(value?.claudeAiOauth);
  const accessToken = asNonEmptyString(oauth?.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: asNonEmptyString(oauth?.refreshToken),
    planLabel: asNonEmptyString(oauth?.subscriptionType),
    source,
  };
};

const loadClaudeCredential = (): ClaudeCredential | null => {
  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const keychain = parseClaudeCodeCredential(JSON.parse(raw.trim()) as Record<string, unknown>, 'keychain');
      if (keychain) return keychain;
    } catch {
      // Fall through to the remaining read-only credential sources.
    }
  }

  const claudeDirectory = process.env.CLAUDE_CONFIG_DIR?.trim()
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), '.claude');
  const credentialsFile = parseClaudeCodeCredential(
    readJsonFile(path.join(claudeDirectory, '.credentials.json')),
    'credentials-file',
  );
  if (credentialsFile) return credentialsFile;

  const entry = normalizeAuthEntry(getAuthEntry(readAuthFile(), ['anthropic', 'claude']));
  const accessToken = asNonEmptyString(entry?.access) ?? asNonEmptyString(entry?.token);
  if (accessToken) {
    return {
      accessToken,
      refreshToken: asNonEmptyString(entry?.refresh),
      planLabel: null,
      source: 'opencode-auth',
    };
  }

  const environmentToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  return environmentToken
    ? { accessToken: environmentToken, refreshToken: null, planLabel: null, source: 'env' }
    : null;
};

const getAuthEntry = (auth: AuthFile, aliases: string[]) => {
  for (const alias of aliases) {
    if (auth[alias]) {
      return auth[alias];
    }
  }
  return null;
};

const normalizeAuthEntry = (entry: AuthEntry | null) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { token: entry } as Record<string, unknown>;
  }
  if (typeof entry === 'object') {
    return entry;
  }
  return null;
};

const asObject = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? value as Record<string, unknown> : null
);

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseGoogleRefreshToken = (rawRefreshToken: unknown) => {
  const refreshToken = asNonEmptyString(rawRefreshToken);
  if (!refreshToken) {
    return { refreshToken: null, projectId: null, managedProjectId: null };
  }

  const [rawToken = '', rawProject = '', rawManagedProject = ''] = refreshToken.split('|');
  return {
    refreshToken: asNonEmptyString(rawToken),
    projectId: asNonEmptyString(rawProject),
    managedProjectId: asNonEmptyString(rawManagedProject),
  };
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestamp = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof value === 'number') {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const formatResetTime = (timestamp: number) => {
  try {
    const resetDate = new Date(timestamp);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();

    if (isToday) {
      // Same day: show time only (e.g., "9:56 PM")
      return resetDate.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
    }

    // Different day: show date + weekday + time (e.g., "Feb 2, Sun 9:56 PM")
    return resetDate.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};

const calculateResetAfterSeconds = (resetAt: number | null) => {
  if (!resetAt) return null;
  const delta = Math.floor((resetAt - Date.now()) / 1000);
  return delta < 0 ? 0 : delta;
};

const toUsageWindow = (data: { usedPercent: number | null; windowSeconds: number | null; resetAt: number | null; valueLabel?: string | null }) => {
  const resetAfterSeconds = calculateResetAfterSeconds(data.resetAt);
  const resetFormatted = data.resetAt ? formatResetTime(data.resetAt) : null;
  return {
    usedPercent: data.usedPercent,
    remainingPercent: data.usedPercent !== null ? Math.max(0, 100 - data.usedPercent) : null,
    windowSeconds: data.windowSeconds ?? null,
    resetAfterSeconds,
    resetAt: data.resetAt,
    resetAtFormatted: resetFormatted,
    resetAfterFormatted: resetFormatted,
    ...(data.valueLabel ? { valueLabel: data.valueLabel } : {}),
  } satisfies UsageWindow;
};

const buildResult = (data: {
  providerId: string;
  providerName: string;
  ok: boolean;
  configured: boolean;
  usage?: ProviderUsage | null;
  error?: string;
  planLabel?: string | null;
}): ProviderResult => ({
  providerId: data.providerId,
  providerName: data.providerName,
  ok: data.ok,
  configured: data.configured,
  usage: data.usage ?? null,
  ...(data.error ? { error: data.error } : {}),
  ...(data.planLabel ? { planLabel: data.planLabel } : {}),
  fetchedAt: Date.now(),
});

const formatMoney = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toFixed(2);
};

const durationToLabel = (duration?: number, unit?: string) => {
  if (!duration || !unit) return 'limit';
  if (unit === 'TIME_UNIT_MINUTE') return `${duration}m`;
  if (unit === 'TIME_UNIT_HOUR') return `${duration}h`;
  if (unit === 'TIME_UNIT_DAY') return `${duration}d`;
  return 'limit';
};

const durationToSeconds = (duration?: number, unit?: string) => {
  if (!duration || !unit) return null;
  if (unit === 'TIME_UNIT_MINUTE') return duration * 60;
  if (unit === 'TIME_UNIT_HOUR') return duration * 3600;
  if (unit === 'TIME_UNIT_DAY') return duration * 86400;
  return null;
};

export const listConfiguredQuotaProviders = () => {
  const auth = readAuthFile();
  const configured = new Set<string>();
  const openCodeGoAuth = normalizeAuthEntry(getAuthEntry(auth, ['opencode-go']));
  if (openCodeGoAuth && (
    typeof openCodeGoAuth.key === 'string'
    || typeof openCodeGoAuth.token === 'string'
  )) configured.add('opencode-go');
  const commandCodeAuth = normalizeAuthEntry(getAuthEntry(auth, ['command-code']));
  if (commandCodeAuth && (
    typeof commandCodeAuth.key === 'string'
    || typeof commandCodeAuth.access === 'string'
    || typeof commandCodeAuth.token === 'string'
  )) configured.add('command-code');
  if (process.env.COMMAND_CODE_API_KEY?.trim()) configured.add('command-code');

  if (loadClaudeCredential()) configured.add('claude');

  const openaiAuth = normalizeAuthEntry(getAuthEntry(auth, ['openai', 'codex', 'chatgpt']));
  if (openaiAuth && ((openaiAuth as Record<string, unknown>).access || (openaiAuth as Record<string, unknown>).token)) {
    configured.add('codex');
  }

  if (resolveGeminiCliAuth(auth) || resolveAntigravityAuth()) {
    configured.add('google');
  }

  const zaiAuth = normalizeAuthEntry(getAuthEntry(auth, ['zai-coding-plan', 'zai', 'z.ai']));
  if (zaiAuth && ((zaiAuth as Record<string, unknown>).key || (zaiAuth as Record<string, unknown>).token)) {
    configured.add('zai-coding-plan');
  }

  const zhipuaiAuth = normalizeAuthEntry(getAuthEntry(auth, ['zhipuai-coding-plan']));
  if (zhipuaiAuth && ((zhipuaiAuth as Record<string, unknown>).key || (zhipuaiAuth as Record<string, unknown>).token)) {
    configured.add('zhipuai-coding-plan');
  }

  const kimiAuth = normalizeAuthEntry(getAuthEntry(auth, ['kimi-for-coding', 'kimi']));
  if (kimiAuth && ((kimiAuth as Record<string, unknown>).key || (kimiAuth as Record<string, unknown>).token)) {
    configured.add('kimi-for-coding');
  }

  const minimaxAuth = normalizeAuthEntry(getAuthEntry(auth, ['minimax-coding-plan']));
  if (minimaxAuth && ((minimaxAuth as Record<string, unknown>).key || (minimaxAuth as Record<string, unknown>).token)) {
    configured.add('minimax-coding-plan');
  }

  const minimaxCnAuth = normalizeAuthEntry(getAuthEntry(auth, ['minimax-cn-coding-plan']));
  if (minimaxCnAuth && ((minimaxCnAuth as Record<string, unknown>).key || (minimaxCnAuth as Record<string, unknown>).token)) {
    configured.add('minimax-cn-coding-plan');
  }

  const openrouterAuth = normalizeAuthEntry(getAuthEntry(auth, ['openrouter']));
  if (openrouterAuth && ((openrouterAuth as Record<string, unknown>).key || (openrouterAuth as Record<string, unknown>).token)) {
    configured.add('openrouter');
  }

  const nanopgAuth = normalizeAuthEntry(getAuthEntry(auth, ['nano-gpt', 'nanogpt', 'nano_gpt']));
  if (nanopgAuth && ((nanopgAuth as Record<string, unknown>).key || (nanopgAuth as Record<string, unknown>).token)) {
    configured.add('nano-gpt');
  }

  const copilotAuth = normalizeAuthEntry(getAuthEntry(auth, ['github-copilot', 'copilot']));
  if (copilotAuth && ((copilotAuth as Record<string, unknown>).access || (copilotAuth as Record<string, unknown>).token)) {
    configured.add('github-copilot');
    configured.add('github-copilot-addon');
  }

  if (readTextFile(OLLAMA_CLOUD_COOKIE_PATH)) {
    configured.add('ollama-cloud');
  }

  const waferAuth = normalizeAuthEntry(getAuthEntry(auth, ['wafer', 'wafer-ai', 'wafer_ai', 'wafer.ai']));
  if (waferAuth && ((waferAuth as Record<string, unknown>).key || (waferAuth as Record<string, unknown>).token)) {
    configured.add('wafer');
  }

  const crofAuth = normalizeAuthEntry(getAuthEntry(auth, ['crof']));
  if (asNonEmptyString(crofAuth?.key) || asNonEmptyString(crofAuth?.token)) {
    configured.add('crof');
  }

  const neuralwattAuth = normalizeAuthEntry(getAuthEntry(auth, ['neuralwatt']));
  if (asNonEmptyString(neuralwattAuth?.key) || asNonEmptyString(neuralwattAuth?.token)) {
    configured.add('neuralwatt');
  }

  const deepseekAuth = normalizeAuthEntry(getAuthEntry(auth, ['deepseek']));
  if (asNonEmptyString(deepseekAuth?.key) || asNonEmptyString(deepseekAuth?.token)) {
    configured.add('deepseek');
  }

  return Array.from(configured);
};

export const parseCodexUsageWindows = (payload: OpenAiUsagePayload): Record<string, UsageWindow> => {
  const primary = payload.rate_limit?.primary_window ?? null;
  const secondary = payload.rate_limit?.secondary_window ?? null;
  const credits = payload.credits ?? null;
  const spendLimit = payload.spend_control?.individual_limit ?? null;
  const windows: Record<string, UsageWindow> = {};

  for (const window of [primary, secondary]) {
    if (!window) continue;
    const windowSeconds = toNumber(window.limit_window_seconds);
    windows[resolveWindowLabel(windowSeconds)] = toUsageWindow({
      usedPercent: toNumber(window.used_percent),
      windowSeconds,
      resetAt: toTimestamp(window.reset_at),
    });
  }

  if (credits) {
    const balance = toNumber(credits.balance);
    const unlimited = Boolean(credits.unlimited);
    const valueLabel = unlimited
      ? 'Unlimited'
      : balance !== null
        ? `$${formatMoney(balance)} remaining`
        : null;
    windows.credits = toUsageWindow({
      usedPercent: null,
      windowSeconds: null,
      resetAt: null,
      valueLabel,
    });
  }

  if (spendLimit) {
    const used = toNumber(spendLimit.used);
    const limit = toNumber(spendLimit.limit);
    const usedPercent = toNumber(spendLimit.used_percent);
    if (used !== null || limit !== null || usedPercent !== null) {
      const valueLabel = used !== null && limit !== null
        ? `${used.toFixed(0)} / ${limit.toFixed(0)} used`
        : null;
      windows.credits = toUsageWindow({
        usedPercent,
        windowSeconds: null,
        resetAt: null,
        valueLabel,
      });
    }
  }

  return windows;
};

export const fetchCodexQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['openai', 'codex', 'chatgpt'])) as Record<string, unknown> | null;
  const accessToken = (entry?.access as string | undefined) ?? (entry?.token as string | undefined);
  const accountId = entry?.accountId as string | undefined;

  if (!accessToken) {
    return buildResult({
      providerId: 'codex',
      providerName: 'Codex',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'codex',
        providerName: 'Codex',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as OpenAiUsagePayload;
    const windows = parseCodexUsageWindows(payload);

    return buildResult({
      providerId: 'codex',
      providerName: 'Codex',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    return buildResult({
      providerId: 'codex',
      providerName: 'Codex',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

type GoogleAuthSource = {
  sourceId: 'gemini' | 'antigravity';
  sourceLabel: string;
  accessToken?: string;
  refreshToken?: string;
  expires?: number;
  projectId?: string;
  email?: string;
};

const resolveGeminiCliAuth = (auth: AuthFile): GoogleAuthSource | null => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['google', 'google.oauth'])) as Record<string, unknown> | null;
  const entryObject = asObject(entry);
  if (!entryObject) {
    return null;
  }

  const oauthObject = asObject(entryObject.oauth) ?? entryObject;
  const accessToken = asNonEmptyString(oauthObject.access) ?? asNonEmptyString(oauthObject.token);
  const refreshParts = parseGoogleRefreshToken(oauthObject.refresh);

  if (!accessToken && !refreshParts.refreshToken) {
    return null;
  }

  return {
    sourceId: 'gemini',
    sourceLabel: 'Gemini',
    accessToken: accessToken ?? undefined,
    refreshToken: refreshParts.refreshToken ?? undefined,
    projectId: (refreshParts.projectId ?? refreshParts.managedProjectId) ?? undefined,
    expires: toTimestamp(oauthObject.expires) ?? undefined,
  };
};

const resolveAntigravityAuth = (): GoogleAuthSource | null => {
  for (const filePath of ANTIGRAVITY_ACCOUNTS_PATHS) {
    const data = readJsonFile(filePath);
    const accounts = data?.accounts;
    if (Array.isArray(accounts) && accounts.length > 0) {
      const index = typeof (data as Record<string, unknown>)?.activeIndex === 'number'
        ? (data as Record<string, unknown>).activeIndex as number
        : 0;
      const account = (accounts[index] as Record<string, unknown> | undefined) ?? (accounts[0] as Record<string, unknown> | undefined);
      if (account?.refreshToken) {
        const refreshParts = parseGoogleRefreshToken(account.refreshToken);
        return {
          sourceId: 'antigravity',
          sourceLabel: 'Antigravity',
          refreshToken: refreshParts.refreshToken ?? undefined,
          projectId: asNonEmptyString(account.projectId)
            ?? asNonEmptyString(account.managedProjectId)
            ?? refreshParts.projectId
            ?? refreshParts.managedProjectId
            ?? undefined,
          email: asNonEmptyString(account.email) ?? undefined,
        };
      }
    }
  }

  return null;
};

const resolveGoogleAuthSources = (): GoogleAuthSource[] => {
  const auth = readAuthFile();
  const sources: GoogleAuthSource[] = [];

  const geminiAuth = resolveGeminiCliAuth(auth);
  if (geminiAuth) {
    sources.push(geminiAuth);
  }

  const antigravityAuth = resolveAntigravityAuth();
  if (antigravityAuth) {
    sources.push(antigravityAuth);
  }

  return sources;
};

const resolveGoogleOAuthClient = (sourceId: GoogleAuthSource['sourceId']) => {
  if (sourceId === 'gemini') {
    return {
      clientId: GEMINI_GOOGLE_CLIENT_ID,
      clientSecret: GEMINI_GOOGLE_CLIENT_SECRET,
    };
  }

  return {
    clientId: ANTIGRAVITY_GOOGLE_CLIENT_ID,
    clientSecret: ANTIGRAVITY_GOOGLE_CLIENT_SECRET,
  };
};

const refreshGoogleAccessToken = async (refreshToken: string, clientId: string, clientSecret: string) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as Record<string, unknown>;
  return typeof data?.access_token === 'string' ? data.access_token : null;
};

const fetchGoogleQuotaBuckets = async (accessToken: string, projectId?: string) => {
  const body = projectId ? { project: projectId } : {};
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const response = await fetch(`${GOOGLE_PRIMARY_ENDPOINT}/v1internal:retrieveUserQuota`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as GoogleQuotaBucketsPayload;
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const fetchGoogleModels = async (accessToken: string, projectId?: string) => {
  const body = projectId ? { project: projectId } : {};

  for (const endpoint of GOOGLE_ENDPOINTS) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
    try {
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...GOOGLE_HEADERS,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });

      if (response.ok) {
        return await response.json() as Record<string, unknown>;
      }
    } catch {
      // fall through
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  return null;
};

export const fetchGoogleQuota = async (): Promise<ProviderResult> => {
  const authSources = resolveGoogleAuthSources();
  if (!authSources.length) {
    return buildResult({
      providerId: 'google',
      providerName: 'Google',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  const models: Record<string, ProviderUsage> = {};
  const sourceErrors: string[] = [];

  for (const source of authSources) {
    const now = Date.now();
    let accessToken = source.accessToken;

    if (!accessToken || (typeof source.expires === 'number' && source.expires <= now)) {
      if (!source.refreshToken) {
        sourceErrors.push(`${source.sourceLabel}: Missing refresh token`);
        continue;
      }
      const { clientId, clientSecret } = resolveGoogleOAuthClient(source.sourceId);
      accessToken = (await refreshGoogleAccessToken(source.refreshToken, clientId, clientSecret)) ?? undefined;
    }

    if (!accessToken) {
      sourceErrors.push(`${source.sourceLabel}: Failed to refresh OAuth token`);
      continue;
    }

    const projectId = source.projectId ?? DEFAULT_PROJECT_ID;
    let mergedAnyModel = false;

    if (source.sourceId === 'gemini') {
      const quotaPayload = await fetchGoogleQuotaBuckets(accessToken, projectId);
      const buckets = Array.isArray(quotaPayload?.buckets) ? quotaPayload.buckets : [];

      for (const bucket of buckets) {
        const modelId = asNonEmptyString(bucket.modelId);
        if (!modelId) {
          continue;
        }

        const scopedName = modelId.startsWith(`${source.sourceId}/`)
          ? modelId
          : `${source.sourceId}/${modelId}`;

        const remainingFraction = toNumber(bucket.remainingFraction);
        const remainingPercent = remainingFraction !== null
          ? Math.round(remainingFraction * 100)
          : null;
        const usedPercent = remainingPercent !== null ? Math.max(0, 100 - remainingPercent) : null;
        const resetAt = toTimestamp(bucket.resetTime);
        const window = resolveGoogleWindow(source.sourceId, resetAt);

        models[scopedName] = {
          windows: {
            [window.label]: toUsageWindow({
              usedPercent,
              windowSeconds: window.seconds,
              resetAt,
            }),
          },
        };
        mergedAnyModel = true;
      }
    }

    const payload = await fetchGoogleModels(accessToken, projectId);
    if (payload && typeof payload === 'object') {
      const payloadModels = (payload as GoogleModelsPayload).models ?? {};
      for (const [modelName, modelData] of Object.entries(payloadModels)) {
        const scopedName = modelName.startsWith(`${source.sourceId}/`)
          ? modelName
          : `${source.sourceId}/${modelName}`;
        const quotaInfo = modelData?.quotaInfo;
        const remainingFraction = quotaInfo?.remainingFraction;
        const remainingPercent = typeof remainingFraction === 'number'
          ? Math.round(remainingFraction * 100)
          : null;
        const usedPercent = remainingPercent !== null ? Math.max(0, 100 - remainingPercent) : null;
        const resetAt = quotaInfo?.resetTime
          ? new Date(quotaInfo.resetTime).getTime()
          : null;
        const window = resolveGoogleWindow(source.sourceId, resetAt);
        models[scopedName] = {
          windows: {
            [window.label]: toUsageWindow({
              usedPercent,
              windowSeconds: window.seconds,
              resetAt,
            }),
          },
        };
        mergedAnyModel = true;
      }
    }

    if (!mergedAnyModel) {
      sourceErrors.push(`${source.sourceLabel}: Failed to fetch models`);
    }
  }

  if (!Object.keys(models).length) {
    return buildResult({
      providerId: 'google',
      providerName: 'Google',
      ok: false,
      configured: true,
      error: sourceErrors[0] ?? 'Failed to fetch models',
    });
  }

  return buildResult({
    providerId: 'google',
    providerName: 'Google',
    ok: true,
    configured: true,
    usage: {
      windows: {},
      models: Object.keys(models).length ? models : undefined,
    },
  });
};

const CLAUDE_SESSION_SECONDS = 5 * 60 * 60;
const CLAUDE_WEEK_SECONDS = 7 * 24 * 60 * 60;
let claudeCredentialFingerprint: string | null = null;
let claudeCachedUsage: ProviderUsage | null = null;
let claudeCachedPlanLabel: string | null = null;
let claudeCooldownUntil = 0;

const claudeFingerprint = (credential: ClaudeCredential) =>
  `${credential.accessToken}\0${credential.refreshToken ?? ''}`;

const claudeRateLimitResult = (planLabel: string | null): ProviderResult => claudeCachedUsage
  ? buildResult({
      providerId: 'claude', providerName: 'Claude', ok: true, configured: true,
      usage: claudeCachedUsage, planLabel: planLabel ?? claudeCachedPlanLabel,
    })
  : buildResult({
      providerId: 'claude', providerName: 'Claude', ok: false, configured: true,
      error: 'Rate limited by Anthropic. Retrying shortly.',
    });

const claudeCooldownFromResponse = (response: Response) => {
  const raw = response.headers.get('retry-after');
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60 * 60 * 1000);
  const retryAt = raw ? Date.parse(raw) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > Date.now()) return Math.min(retryAt - Date.now(), 60 * 60 * 1000);
  return 5 * 60 * 1000;
};

const buildClaudeUsage = (payload: Record<string, unknown>): ProviderUsage => {
  const windows: Record<string, UsageWindow> = {};
  const models: Record<string, ProviderUsage> = {};
  const addWindow = (
    target: Record<string, UsageWindow>,
    key: string,
    usedPercent: number | null,
    resetAt: number | null,
    windowSeconds: number | null,
    valueLabel?: string | null,
  ) => {
    if (usedPercent === null && !valueLabel) return;
    target[key] = toUsageWindow({ usedPercent, resetAt, windowSeconds, valueLabel });
  };

  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  if (limits.length > 0) {
    for (const rawLimit of limits) {
      const limit = asObject(rawLimit);
      if (!limit) continue;
      const percent = toNumber(limit.percent);
      const resetAt = toTimestamp(limit.resets_at);
      if (limit.kind === 'session') {
        addWindow(windows, '5h', percent, resetAt, CLAUDE_SESSION_SECONDS);
      } else if (limit.kind === 'weekly_all') {
        addWindow(windows, '7d', percent, resetAt, CLAUDE_WEEK_SECONDS);
      } else if (limit.kind === 'weekly_scoped') {
        const modelName = asNonEmptyString(asObject(asObject(limit.scope)?.model)?.display_name);
        if (!modelName) continue;
        const modelWindows: Record<string, UsageWindow> = {};
        addWindow(modelWindows, '7d', percent, resetAt, CLAUDE_WEEK_SECONDS);
        if (Object.keys(modelWindows).length > 0) models[modelName] = { windows: modelWindows };
      }
    }
  } else {
    const fiveHour = asObject(payload.five_hour);
    const sevenDay = asObject(payload.seven_day);
    if (fiveHour) addWindow(windows, '5h', toNumber(fiveHour.utilization), toTimestamp(fiveHour.resets_at), CLAUDE_SESSION_SECONDS);
    if (sevenDay) addWindow(windows, '7d', toNumber(sevenDay.utilization), toTimestamp(sevenDay.resets_at), CLAUDE_WEEK_SECONDS);
  }

  const spend = asObject(payload.spend);
  if (spend?.enabled === true) {
    const used = asObject(spend.used);
    const limit = asObject(spend.limit);
    const exponent = toNumber(used?.exponent) ?? 2;
    const usedAmount = toNumber(used?.amount_minor);
    const limitAmount = toNumber(limit?.amount_minor);
    const currency = asNonEmptyString(used?.currency);
    const prefix = currency === 'USD' || !currency ? '$' : `${currency} `;
    const valueLabel = usedAmount === null
      ? null
      : limitAmount === null
        ? `${prefix}${formatMoney(usedAmount / 10 ** exponent)}`
        : `${prefix}${formatMoney(usedAmount / 10 ** exponent)} / ${prefix}${formatMoney(limitAmount / 10 ** (toNumber(limit?.exponent) ?? 2))}`;
    addWindow(windows, 'extra_usage', toNumber(spend.percent), null, null, valueLabel);
  }

  return Object.keys(models).length > 0 ? { windows, models } : { windows };
};

export const fetchClaudeQuota = async (): Promise<ProviderResult> => {
  const credential = loadClaudeCredential();
  if (!credential) {
    return buildResult({ providerId: 'claude', providerName: 'Claude', ok: false, configured: false, error: 'Not configured' });
  }

  const fingerprint = claudeFingerprint(credential);
  if (claudeCredentialFingerprint !== fingerprint) {
    claudeCredentialFingerprint = fingerprint;
    claudeCachedUsage = null;
    claudeCachedPlanLabel = null;
    claudeCooldownUntil = 0;
  }
  if (Date.now() < claudeCooldownUntil) return claudeRateLimitResult(credential.planLabel);

  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
    if (response.status === 429) {
      claudeCooldownUntil = Date.now() + claudeCooldownFromResponse(response);
      return claudeRateLimitResult(credential.planLabel);
    }
    if (response.status === 401 || response.status === 403) {
      return buildResult({
        providerId: 'claude', providerName: 'Claude', ok: false, configured: true,
        error: 'Claude session expired. Open Claude Code to sign in again.',
      });
    }
    if (!response.ok) {
      return buildResult({ providerId: 'claude', providerName: 'Claude', ok: false, configured: true, error: `API error: ${response.status}` });
    }
    const usage = buildClaudeUsage(await response.json() as Record<string, unknown>);
    claudeCachedUsage = usage;
    claudeCachedPlanLabel = credential.planLabel;
    return buildResult({
      providerId: 'claude', providerName: 'Claude', ok: true, configured: true,
      usage, planLabel: credential.planLabel,
    });
  } catch (error) {
    return buildResult({
      providerId: 'claude', providerName: 'Claude', ok: false, configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

const buildCopilotWindows = (payload: Record<string, unknown>) => {
  const quota = (payload.quota_snapshots as Record<string, unknown>) ?? {};
  const resetAt = toTimestamp(payload.quota_reset_date);
  const windows: Record<string, UsageWindow> = {};

  const addWindow = (label: string, snapshot?: Record<string, unknown>) => {
    if (!snapshot) return;
    const entitlement = toNumber(snapshot.entitlement);
    const remaining = toNumber(snapshot.remaining);
    const usedPercent = entitlement && remaining !== null
      ? Math.max(0, Math.min(100, 100 - (remaining / entitlement) * 100))
      : null;
    const valueLabel = entitlement !== null && remaining !== null
      ? `${remaining.toFixed(0)} / ${entitlement.toFixed(0)} left`
      : null;
    windows[label] = toUsageWindow({
      usedPercent,
      windowSeconds: null,
      resetAt,
      valueLabel,
    });
  };

  addWindow('chat', quota.chat as Record<string, unknown> | undefined);
  addWindow('completions', quota.completions as Record<string, unknown> | undefined);
  addWindow('premium', quota.premium_interactions as Record<string, unknown> | undefined);

  return windows;
};

export const fetchCopilotQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['github-copilot', 'copilot'])) as Record<string, unknown> | null;
  const accessToken = (entry?.access as string | undefined) ?? (entry?.token as string | undefined);

  if (!accessToken) {
    return buildResult({
      providerId: 'github-copilot',
      providerName: 'GitHub Copilot',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://api.github.com/copilot_internal/user', {
      method: 'GET',
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/json',
        'Editor-Version': 'vscode/1.96.2',
        'X-Github-Api-Version': '2025-04-01',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'github-copilot',
        providerName: 'GitHub Copilot',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    return buildResult({
      providerId: 'github-copilot',
      providerName: 'GitHub Copilot',
      ok: true,
      configured: true,
      usage: { windows: buildCopilotWindows(payload) },
    });
  } catch (error) {
    return buildResult({
      providerId: 'github-copilot',
      providerName: 'GitHub Copilot',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

export const fetchCopilotAddonQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['github-copilot', 'copilot'])) as Record<string, unknown> | null;
  const accessToken = (entry?.access as string | undefined) ?? (entry?.token as string | undefined);

  if (!accessToken) {
    return buildResult({
      providerId: 'github-copilot-addon',
      providerName: 'GitHub Copilot Add-on',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://api.github.com/copilot_internal/user', {
      method: 'GET',
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/json',
        'Editor-Version': 'vscode/1.96.2',
        'X-Github-Api-Version': '2025-04-01',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'github-copilot-addon',
        providerName: 'GitHub Copilot Add-on',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    const windows = buildCopilotWindows(payload);
    const premium = windows.premium ? { premium: windows.premium } : windows;

    return buildResult({
      providerId: 'github-copilot-addon',
      providerName: 'GitHub Copilot Add-on',
      ok: true,
      configured: true,
      usage: { windows: premium },
    });
  } catch (error) {
    return buildResult({
      providerId: 'github-copilot-addon',
      providerName: 'GitHub Copilot Add-on',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

const computeKimiUsedPercent = (
  total: number | null,
  used: number | null,
  remaining: number | null,
): number | null => {
  if (!total) return null;
  if (used !== null) return Math.max(0, Math.min(100, (used / total) * 100));
  if (remaining !== null) return Math.max(0, Math.min(100, 100 - (remaining / total) * 100));
  return null;
};

export const fetchKimiQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['kimi-for-coding', 'kimi'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'kimi-for-coding',
      providerName: 'Kimi for Coding',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://api.kimi.com/coding/v1/usages', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'kimi-for-coding',
        providerName: 'Kimi for Coding',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    const windows: Record<string, UsageWindow> = {};
    const usage = payload.usage as Record<string, unknown> | undefined;
    if (usage) {
      const limit = toNumber(usage.limit);
      const used = toNumber(usage.used);
      const remaining = toNumber(usage.remaining);
      const usedPercent = computeKimiUsedPercent(limit, used, remaining);
      windows.weekly = toUsageWindow({
        usedPercent,
        windowSeconds: null,
        resetAt: toTimestamp(usage.resetTime),
      });
    }

    const limits = Array.isArray(payload.limits) ? payload.limits : [];
    for (const limit of limits) {
      const window = (limit as Record<string, unknown>)?.window as Record<string, unknown> | undefined;
      const detail = (limit as Record<string, unknown>)?.detail as Record<string, unknown> | undefined;
      const rawLabel = durationToLabel(window?.duration as number | undefined, window?.timeUnit as string | undefined);
      const windowSeconds = durationToSeconds(window?.duration as number | undefined, window?.timeUnit as string | undefined);
      const label = windowSeconds === 5 * 60 * 60 ? `Rate Limit (${rawLabel})` : rawLabel;
      const total = toNumber(detail?.limit);
      const used = toNumber(detail?.used);
      const remaining = toNumber(detail?.remaining);
      const usedPercent = computeKimiUsedPercent(total, used, remaining);
      windows[label] = toUsageWindow({
        usedPercent,
        windowSeconds,
        resetAt: toTimestamp(detail?.resetTime),
      });
    }

    return buildResult({
      providerId: 'kimi-for-coding',
      providerName: 'Kimi for Coding',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    return buildResult({
      providerId: 'kimi-for-coding',
      providerName: 'Kimi for Coding',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

const fetchMiniMaxQuota = async (data: {
  providerId: 'minimax-coding-plan' | 'minimax-cn-coding-plan';
  providerName: string;
  endpoint: string;
  usageFieldsAreRemaining: boolean;
}): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, [data.providerId])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: data.providerId,
      providerName: data.providerName,
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch(data.endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: data.providerId,
        providerName: data.providerName,
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    const baseResp = asObject(payload.base_resp);
    const statusCode = toNumber(baseResp?.status_code);
    if (baseResp && statusCode !== 0) {
      return buildResult({
        providerId: data.providerId,
        providerName: data.providerName,
        ok: false,
        configured: true,
        error: asNonEmptyString(baseResp.status_msg) ?? `API error: ${statusCode}`,
      });
    }

    const modelRemains = Array.isArray(payload.model_remains) ? payload.model_remains : [];
    const firstModel = asObject(modelRemains[0]);
    if (!firstModel) {
      return buildResult({
        providerId: data.providerId,
        providerName: data.providerName,
        ok: false,
        configured: true,
        error: 'No model quota data available',
      });
    }

    const intervalTotal = toNumber(firstModel.current_interval_total_count);
    const intervalUsage = toNumber(firstModel.current_interval_usage_count);
    const intervalStartAt = toTimestamp(firstModel.start_time);
    const intervalResetAt = toTimestamp(firstModel.end_time);
    const weeklyTotal = toNumber(firstModel.current_weekly_total_count);
    const weeklyUsage = toNumber(firstModel.current_weekly_usage_count);
    const weeklyStartAt = toTimestamp(firstModel.weekly_start_time);
    const weeklyResetAt = toTimestamp(firstModel.weekly_end_time);

    const intervalUsed = data.usageFieldsAreRemaining && intervalTotal !== null && intervalUsage !== null
      ? intervalTotal - intervalUsage
      : intervalUsage;
    const weeklyUsed = data.usageFieldsAreRemaining && weeklyTotal !== null && weeklyUsage !== null
      ? weeklyTotal - weeklyUsage
      : weeklyUsage;

    const intervalUsedPercent = intervalTotal !== null && intervalTotal > 0 && intervalUsed !== null
      ? Math.max(0, Math.min(100, (intervalUsed / intervalTotal) * 100))
      : null;
    const intervalWindowSeconds = intervalStartAt && intervalResetAt && intervalResetAt > intervalStartAt
      ? Math.floor((intervalResetAt - intervalStartAt) / 1000)
      : null;
    const weeklyUsedPercent = weeklyTotal !== null && weeklyTotal > 0 && weeklyUsed !== null
      ? Math.max(0, Math.min(100, (weeklyUsed / weeklyTotal) * 100))
      : null;
    const weeklyWindowSeconds = weeklyStartAt && weeklyResetAt && weeklyResetAt > weeklyStartAt
      ? Math.floor((weeklyResetAt - weeklyStartAt) / 1000)
      : null;

    return buildResult({
      providerId: data.providerId,
      providerName: data.providerName,
      ok: true,
      configured: true,
      usage: {
        windows: {
          '5h': toUsageWindow({
            usedPercent: intervalUsedPercent,
            windowSeconds: intervalWindowSeconds,
            resetAt: intervalResetAt,
          }),
          weekly: toUsageWindow({
            usedPercent: weeklyUsedPercent,
            windowSeconds: weeklyWindowSeconds,
            resetAt: weeklyResetAt,
          }),
        },
      },
    });
  } catch (error) {
    return buildResult({
      providerId: data.providerId,
      providerName: data.providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

export const fetchMiniMaxCodingPlanQuota = () => fetchMiniMaxQuota({
  providerId: 'minimax-coding-plan',
  providerName: 'MiniMax Coding Plan (minimax.io)',
  endpoint: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
  usageFieldsAreRemaining: false,
});

export const fetchMiniMaxCnCodingPlanQuota = () => fetchMiniMaxQuota({
  providerId: 'minimax-cn-coding-plan',
  providerName: 'MiniMax Coding Plan (minimaxi.com)',
  endpoint: 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains',
  usageFieldsAreRemaining: true,
});

const parseOllamaSettingsHtml = (html: string) => {
  const windows: Record<string, UsageWindow> = {};
  const sessionMatch = html.match(/Session\s+usage[^0-9]*([0-9.]+)%/i);
  if (sessionMatch) {
    windows.session = toUsageWindow({
      usedPercent: toNumber(sessionMatch[1]),
      windowSeconds: null,
      resetAt: null,
    });
  }

  const weeklyMatch = html.match(/Weekly\s+usage[^0-9]*([0-9.]+)%/i);
  if (weeklyMatch) {
    windows.weekly = toUsageWindow({
      usedPercent: toNumber(weeklyMatch[1]),
      windowSeconds: null,
      resetAt: null,
    });
  }

  const premiumMatch = html.match(/Premium[^0-9]*([0-9]+)\s*\/\s*([0-9]+)/i);
  if (premiumMatch) {
    const used = toNumber(premiumMatch[1]);
    const total = toNumber(premiumMatch[2]);
    const usedPercent = total && used !== null ? Math.min(100, (used / total) * 100) : null;
    windows.premium = toUsageWindow({
      usedPercent,
      windowSeconds: null,
      resetAt: null,
      valueLabel: `${used ?? 0} / ${total ?? 0}`,
    });
  }

  return windows;
};

export const fetchOllamaCloudQuota = async (): Promise<ProviderResult> => {
  const cookie = readTextFile(OLLAMA_CLOUD_COOKIE_PATH);

  if (!cookie) {
    return buildResult({
      providerId: 'ollama-cloud',
      providerName: 'Ollama Cloud',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://ollama.com/settings', {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'ollama-cloud',
        providerName: 'Ollama Cloud',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    return buildResult({
      providerId: 'ollama-cloud',
      providerName: 'Ollama Cloud',
      ok: true,
      configured: true,
      usage: { windows: parseOllamaSettingsHtml(await response.text()) },
    });
  } catch (error) {
    return buildResult({
      providerId: 'ollama-cloud',
      providerName: 'Ollama Cloud',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

export const fetchOpenRouterQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['openrouter'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    const credits = payload.data as Record<string, unknown> | undefined;
    const totalCredits = toNumber(credits?.total_credits);
    const totalUsage = toNumber(credits?.total_usage);
    const remaining = totalCredits !== null && totalUsage !== null
      ? Math.max(0, totalCredits - totalUsage)
      : null;
    let valueLabel: string | null = null;
    if (remaining !== null && totalUsage !== null) {
      valueLabel = `$${formatMoney(remaining)} left · $${formatMoney(totalUsage)} spent`;
    }

    return buildResult({
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      ok: true,
      configured: true,
      usage: {
        windows: {
          credits: toUsageWindow({
            usedPercent: null,
            windowSeconds: null,
            resetAt: null,
            valueLabel,
          }),
        },
      },
    });
  } catch (error) {
    return buildResult({
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};


const normalizeTimestamp = (value: unknown) => {
  if (typeof value !== 'number') return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
};

const resolveWindowSeconds = (limit: Record<string, unknown> | undefined) => {
  if (!limit || typeof limit.number !== 'number') return null;
  const unitSeconds = ZAI_TOKEN_WINDOW_SECONDS[Number(limit.unit)];
  if (!unitSeconds) return null;
  return unitSeconds * limit.number;
};

const resolveWindowLabel = (windowSeconds: number | null) => {
  if (!windowSeconds) return 'tokens';
  if (windowSeconds % 86400 === 0) {
    const days = windowSeconds / 86400;
    return days === 7 ? 'weekly' : `${days}d`;
  }
  if (windowSeconds % 3600 === 0) {
    return `${windowSeconds / 3600}h`;
  }
  return `${windowSeconds}s`;
};

export const fetchZaiQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['zai-coding-plan', 'zai', 'z.ai'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'zai-coding-plan',
      providerName: 'z.ai',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'zai-coding-plan',
        providerName: 'z.ai',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as ZaiPayload;
    const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : [];
    const windows: Record<string, UsageWindow> = {};
    for (const limit of limits.filter((entry) => entry?.type === 'TOKENS_LIMIT' || entry?.type === 'CREDIT_LIMIT')) {
      const windowSeconds = resolveWindowSeconds(limit as Record<string, unknown>);
      const windowLabel = resolveWindowLabel(windowSeconds);
      const resetAt = limit.nextResetTime ? normalizeTimestamp(limit.nextResetTime) : null;
      const usedPercent = typeof limit.percentage === 'number' ? limit.percentage : null;

      windows[windowLabel] = toUsageWindow({
        usedPercent,
        windowSeconds,
        resetAt,
        valueLabel: formatZaiCreditValueLabel(limit),
      });
    }

    const mcpToolsTimeLimit = limits.find((limit) => limit?.type === 'TIME_LIMIT');
    if (mcpToolsTimeLimit) {
      windows['MCP Tools'] = toUsageWindow({
        usedPercent: typeof mcpToolsTimeLimit.percentage === 'number' ? mcpToolsTimeLimit.percentage : null,
        windowSeconds: 30 * 24 * 60 * 60,
        resetAt: mcpToolsTimeLimit.nextResetTime ? normalizeTimestamp(mcpToolsTimeLimit.nextResetTime) : null,
      });
    }

    return buildResult({
      providerId: 'zai-coding-plan',
      providerName: 'z.ai',
      ok: true,
      configured: true,
      usage: { windows },
      planLabel: payload?.data?.level || null,
    });
  } catch (error) {
    return buildResult({
      providerId: 'zai-coding-plan',
      providerName: 'z.ai',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

export const fetchZhipuaiCodingPlanQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['zhipuai-coding-plan'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'zhipuai-coding-plan',
      providerName: 'Zhipu AI Coding Plan',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://open.bigmodel.cn/api/monitor/usage/quota/limit', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'zhipuai-coding-plan',
        providerName: 'Zhipu AI Coding Plan',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as ZhipuaiPayload;
    const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : [];

    const tokensLimit = limits.find((limit): limit is ZhipuaiTokensLimit => limit?.type === 'TOKENS_LIMIT');
    const mcpToolsTimeLimit = limits.find((limit): limit is ZhipuaiMcpTimeLimit => limit?.type === 'TIME_LIMIT');

    const windows: Record<string, UsageWindow> = {};

    // Handle TOKENS_LIMIT (5-hour window for token usage)
    if (tokensLimit) {
      const windowSeconds = resolveWindowSeconds(tokensLimit);
      const resetAt = tokensLimit?.nextResetTime ? normalizeTimestamp(tokensLimit.nextResetTime) : null;
      const usedPercent = typeof tokensLimit?.percentage === 'number' ? tokensLimit.percentage : null;

      windows['Tokens'] = toUsageWindow({
        usedPercent,
        windowSeconds,
        resetAt,
      });
    }

    // Handle TIME_LIMIT (MCP tools monthly window)
    if (mcpToolsTimeLimit) {
      // TIME_LIMIT unit=5 means 1 month (30 days)
      const monthSeconds = 30 * 24 * 60 * 60;
      const resetAt = mcpToolsTimeLimit?.nextResetTime ? normalizeTimestamp(mcpToolsTimeLimit.nextResetTime) : null;
      const usedPercent = typeof mcpToolsTimeLimit?.percentage === 'number' ? mcpToolsTimeLimit.percentage : null;

      windows['MCP Tools'] = toUsageWindow({
        usedPercent,
        windowSeconds: monthSeconds,
        resetAt,
      });
    }

    return buildResult({
      providerId: 'zhipuai-coding-plan',
      providerName: 'Zhipu AI Coding Plan',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    return buildResult({
      providerId: 'zhipuai-coding-plan',
      providerName: 'Zhipu AI Coding Plan',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

const NANO_GPT_DAILY_WINDOW_SECONDS = 86400;

export const fetchNanoGptQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['nano-gpt', 'nanogpt', 'nano_gpt'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'nano-gpt',
      providerName: 'NanoGPT',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  try {
    const response = await fetch('https://nano-gpt.com/api/subscription/v1/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'nano-gpt',
        providerName: 'NanoGPT',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    const windows: Record<string, UsageWindow> = {};
    const period = payload.period as Record<string, unknown> | undefined;
    const daily = payload.daily as Record<string, unknown> | undefined;
    const monthly = payload.monthly as Record<string, unknown> | undefined;
    const state = (payload.state as string) ?? 'active';

    if (daily) {
      let usedPercent: number | null = null;
      const percentUsed = daily.percentUsed as number | undefined;
      if (typeof percentUsed === 'number') {
        usedPercent = Math.max(0, Math.min(100, percentUsed * 100));
      } else {
        const used = toNumber(daily.used);
        const limit = toNumber((daily.limit as number | undefined) ?? (daily.limits as Record<string, unknown>)?.daily);
        if (used !== null && limit !== null && limit > 0) {
          usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
        }
      }
      const resetAt = toTimestamp(daily.resetAt);
      const valueLabel = state !== 'active' ? `(${state})` : null;
      windows['daily'] = toUsageWindow({
        usedPercent,
        windowSeconds: NANO_GPT_DAILY_WINDOW_SECONDS,
        resetAt,
        valueLabel,
      });
    }

    if (monthly) {
      let usedPercent: number | null = null;
      const percentUsed = monthly.percentUsed as number | undefined;
      if (typeof percentUsed === 'number') {
        usedPercent = Math.max(0, Math.min(100, percentUsed * 100));
      } else {
        const used = toNumber(monthly.used);
        const limit = toNumber((monthly.limit as number | undefined) ?? (monthly.limits as Record<string, unknown>)?.monthly);
        if (used !== null && limit !== null && limit > 0) {
          usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
        }
      }
      const resetAt = toTimestamp((monthly.resetAt as string | number | undefined) ?? (period as Record<string, unknown>)?.currentPeriodEnd);
      const valueLabel = state !== 'active' ? `(${state})` : null;
      windows['monthly'] = toUsageWindow({
        usedPercent,
        windowSeconds: null,
        resetAt,
        valueLabel,
      });
    }

    return buildResult({
      providerId: 'nano-gpt',
      providerName: 'NanoGPT',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    return buildResult({
      providerId: 'nano-gpt',
      providerName: 'NanoGPT',
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};

const WAFER_QUOTA_URL = 'https://pass.wafer.ai/v1/inference/quota';
const WAFER_WINDOW_SECONDS = 5 * 3600;

export const fetchWaferQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['wafer', 'wafer-ai', 'wafer_ai', 'wafer.ai'])) as Record<string, unknown> | null;
  const apiKey = (entry?.key as string | undefined) ?? (entry?.token as string | undefined);

  if (!apiKey) {
    return buildResult({
      providerId: 'wafer',
      providerName: 'Wafer.ai',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetch(WAFER_QUOTA_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Encoding': 'identity',
      },
      signal: timeoutSignal,
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'wafer',
        providerName: 'Wafer.ai',
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as WaferPayload;
    const remaining = toNumber(payload?.remaining_included_requests);
    const limit = toNumber(payload?.included_request_limit);
    const overage = toNumber(payload?.overage_request_count);
    const usedPercentRaw = toNumber(payload?.current_period_used_percent);
    const windowStart = toTimestamp(payload?.window_start);
    const windowEnd = toTimestamp(payload?.window_end);
    const planTier = asNonEmptyString(payload?.plan_tier);

    if (remaining === null && limit === null && overage === null && usedPercentRaw === null) {
      return buildResult({
        providerId: 'wafer',
        providerName: 'Wafer.ai',
        ok: false,
        configured: true,
        error: 'No quota data in response',
      });
    }

    const hasOverage = overage !== null && overage > 0;
    const usedPercent = hasOverage
      ? Math.max(0, usedPercentRaw ?? 0)
      : Math.max(0, Math.min(100, usedPercentRaw ?? 0));

    const windowSeconds = windowStart !== null && windowEnd !== null
      ? Math.round((windowEnd - windowStart) / 1000)
      : WAFER_WINDOW_SECONDS;
    const windowLabel = resolveWindowLabel(windowSeconds);

    let valueLabel: string | null = null;
    if (remaining !== null && limit !== null) {
      const parts: string[] = [];
      if (planTier) parts.push(planTier);
      parts.push(`${remaining} / ${limit} left`);
      if (hasOverage) parts.push(`+${overage} overage`);
      valueLabel = parts.join(' · ');
    }

    const windows: Record<string, UsageWindow> = {};
    windows[windowLabel] = toUsageWindow({
      usedPercent,
      windowSeconds,
      resetAt: windowEnd,
      valueLabel,
    });

    return buildResult({
      providerId: 'wafer',
      providerName: 'Wafer.ai',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError' && timeoutSignal.aborted;
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId: 'wafer',
      providerName: 'Wafer.ai',
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed'),
    });
  }
};

const NEURALWATT_QUOTA_URL = 'https://api.neuralwatt.com/v1/quota';

const neuralwattWindowSeconds = (period: string | null): number | null => {
  if (period === 'daily') return 86400;
  if (period === 'weekly') return 604800;
  if (period === 'monthly' || period === 'month') return 30 * 86400;
  if (period === 'yearly' || period === 'year') return 365 * 86400;
  return null;
};

const fetchNeuralwattQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['neuralwatt']));
  const apiKey = asNonEmptyString(entry?.key) ?? asNonEmptyString(entry?.token);

  if (!apiKey) {
    return buildResult({
      providerId: 'neuralwatt',
      providerName: 'NeuralWatt',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetch(NEURALWATT_QUOTA_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Encoding': 'identity',
      },
      signal: timeoutSignal,
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'neuralwatt',
        providerName: 'NeuralWatt',
        ok: false,
        configured: true,
        error: response.status === 401
          ? 'Session expired — please re-authenticate with NeuralWatt'
          : `API error: ${response.status}`,
      });
    }

    const payload = asObject(await response.json());
    const balance = asObject(payload?.balance);
    const subscription = asObject(payload?.subscription);
    const key = asObject(payload?.key);
    const allowance = asObject(key?.allowance);
    const creditsRemaining = toNumber(balance?.credits_remaining_usd);
    const windows: Record<string, UsageWindow> = {};

    if (subscription) {
      const kwhIncluded = toNumber(subscription.kwh_included);
      const kwhUsed = toNumber(subscription.kwh_used);
      const plan = asNonEmptyString(subscription.plan);
      const usedPercent = subscription.in_overage === true
        ? 100
        : (kwhIncluded !== null && kwhIncluded > 0 && kwhUsed !== null
            ? Math.max(0, Math.min(100, (kwhUsed / kwhIncluded) * 100))
            : null);
      windows[plan ?? 'plan_limit'] = toUsageWindow({
        usedPercent,
        windowSeconds: null,
        resetAt: toTimestamp(subscription.kwh_reset_date)
          ?? toTimestamp(subscription.current_period_end),
      });
    }

    if (allowance) {
      const spent = toNumber(allowance.spent_usd);
      const limit = toNumber(allowance.limit_usd);
      const effectiveLimit = limit !== null && creditsRemaining !== null
        ? Math.min(limit, creditsRemaining + (spent ?? 0))
        : (limit ?? creditsRemaining);
      const period = asNonEmptyString(allowance.period);
      const usedPercent = allowance.blocked === true
        ? 100
        : (spent !== null && effectiveLimit !== null && effectiveLimit > 0
            ? Math.max(0, Math.min(100, (spent / effectiveLimit) * 100))
            : null);
      const periodKey = (
        period === 'daily'
        || period === 'weekly'
        || period === 'monthly'
        || period === 'month'
      )
        ? (period === 'month' ? 'monthly' : period)
        : 'billing_cycle';
      const keyName = asNonEmptyString(key?.name);
      windows[periodKey] = toUsageWindow({
        usedPercent,
        windowSeconds: neuralwattWindowSeconds(period),
        resetAt: toTimestamp(allowance.reset_at),
        ...(keyName ? { valueLabel: keyName } : {}),
      });
    } else if (creditsRemaining !== null) {
      windows.credits_balance = toUsageWindow({
        usedPercent: null,
        windowSeconds: null,
        resetAt: null,
        valueLabel: `$${formatMoney(creditsRemaining)}`,
      });
    }

    if (Object.keys(windows).length === 0) {
      return buildResult({
        providerId: 'neuralwatt',
        providerName: 'NeuralWatt',
        ok: false,
        configured: true,
        error: 'No quota data in response',
      });
    }

    return buildResult({
      providerId: 'neuralwatt',
      providerName: 'NeuralWatt',
      ok: true,
      configured: true,
      usage: { windows },
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError' && timeoutSignal.aborted;
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId: 'neuralwatt',
      providerName: 'NeuralWatt',
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed'),
    });
  }
};

const CROF_USAGE_URL = 'https://crof.ai/usage_api/';

const fetchCrofQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['crof']));
  const apiKey = asNonEmptyString(entry?.key) ?? asNonEmptyString(entry?.token);

  if (!apiKey) {
    return buildResult({
      providerId: 'crof',
      providerName: 'CrofAI',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetch(CROF_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Encoding': 'identity',
      },
      signal: timeoutSignal,
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'crof',
        providerName: 'CrofAI',
        ok: false,
        configured: true,
        error: response.status === 401
          ? 'Session expired — please re-authenticate with CrofAI'
          : `API error: ${response.status}`,
      });
    }

    const payload = asObject(await response.json());
    const credits = toNumber(payload?.credits);
    const valueLabel = credits !== null ? `$${formatMoney(credits)}` : null;

    return buildResult({
      providerId: 'crof',
      providerName: 'CrofAI',
      ok: true,
      configured: true,
      usage: {
        windows: {
          credits: toUsageWindow({
            usedPercent: null,
            windowSeconds: null,
            resetAt: null,
            valueLabel,
          }),
        },
      },
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError' && timeoutSignal.aborted;
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId: 'crof',
      providerName: 'CrofAI',
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed'),
    });
  }
};

const fetchDeepseekQuota = async (): Promise<ProviderResult> => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, ['deepseek']));
  const apiKey = asNonEmptyString(entry?.key) ?? asNonEmptyString(entry?.token);

  if (!apiKey) {
    return buildResult({
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      ok: false,
      configured: false,
      error: 'Not configured',
    });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Accept-Encoding': 'identity' },
      signal: timeoutSignal,
    });

    if (!response.ok) {
      return buildResult({
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        ok: false,
        configured: true,
        error: response.status === 401 || response.status === 403
          ? 'Session expired — please re-authenticate with DeepSeek'
          : `API error: ${response.status}`,
      });
    }

    const payload = await response.json() as DeepseekPayload;
    const balanceInfos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
    const balanceInfo = balanceInfos.find((info) => info.currency === 'USD')
      ?? balanceInfos.find((info) => info.currency === 'CNY')
      ?? null;
    const rawBalance = balanceInfo?.total_balance;
    const totalBalance = typeof rawBalance === 'number' || (typeof rawBalance === 'string' && rawBalance.trim() !== '')
      ? toNumber(rawBalance)
      : null;

    if (totalBalance === null) {
      return buildResult({
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        ok: false,
        configured: true,
        error: 'No quota data in response',
      });
    }

    const symbol = balanceInfo?.currency === 'CNY' ? '¥' : '$';
    return buildResult({
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      ok: true,
      configured: true,
      usage: {
        windows: {
          credits_balance: toUsageWindow({
            usedPercent: null,
            windowSeconds: null,
            resetAt: null,
            valueLabel: `${symbol}${formatMoney(totalBalance)}`,
          }),
        },
      },
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && (
      error.name === 'TimeoutError' || (error.name === 'AbortError' && timeoutSignal.aborted)
    );
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed'),
    });
  }
};

const fetchQuotaForProviderUncoalesced = async (providerId: string): Promise<ProviderResult> => {
  switch (providerId) {
    case 'claude':
      return fetchClaudeQuota();
    case 'codex':
      return fetchCodexQuota();
    case 'github-copilot':
      return fetchCopilotQuota();
    case 'github-copilot-addon':
      return fetchCopilotAddonQuota();
    case 'google':
      return fetchGoogleQuota();
    case 'kimi-for-coding':
      return fetchKimiQuota();
    case 'nano-gpt':
      return fetchNanoGptQuota();
    case 'minimax-coding-plan':
      return fetchMiniMaxCodingPlanQuota();
    case 'minimax-cn-coding-plan':
      return fetchMiniMaxCnCodingPlanQuota();
    case 'ollama-cloud':
      return fetchOllamaCloudQuota();
    case 'openrouter':
      return fetchOpenRouterQuota();
    case 'zai-coding-plan':
      return fetchZaiQuota();
    case 'zhipuai-coding-plan':
      return fetchZhipuaiCodingPlanQuota();
    case 'wafer':
      return fetchWaferQuota();
    case 'crof':
      return fetchCrofQuota();
    case 'deepseek':
      return fetchDeepseekQuota();
    case 'neuralwatt':
      return fetchNeuralwattQuota();
    case 'opencode-go': {
      deleteLegacyOpenCodeGoCredential();
      const entry = normalizeAuthEntry(getAuthEntry(readAuthFile(), ['opencode-go']));
      const apiKey = typeof entry?.key === 'string'
        ? entry.key.trim()
        : typeof entry?.token === 'string'
          ? entry.token.trim()
          : '';
      if (!apiKey) {
        return buildResult({
          providerId,
          providerName: 'OpenCode Go',
          ok: false,
          configured: false,
          error: 'Not configured',
        });
      }
      try {
        return buildResult({
          providerId,
          providerName: 'OpenCode Go',
          ok: true,
          configured: true,
          usage: { windows: await fetchOpenCodeGoUsage(apiKey) },
        });
      } catch (error) {
        return buildResult({
          providerId,
          providerName: 'OpenCode Go',
          ok: false,
          configured: true,
          error: error instanceof Error ? error.message : 'Request failed',
        });
      }
    }
    case 'command-code': {
      const entry = normalizeAuthEntry(getAuthEntry(readAuthFile(), ['command-code']));
      const stored = typeof entry?.key === 'string'
        ? entry.key
        : typeof entry?.access === 'string'
          ? entry.access
          : typeof entry?.token === 'string'
            ? entry.token
            : null;
      const apiKey = stored?.trim() || process.env.COMMAND_CODE_API_KEY?.trim() || null;
      if (!apiKey) {
        return buildResult({ providerId, providerName: 'Command Code', ok: false, configured: false, error: 'Not configured' });
      }
      try {
        return buildResult({
          providerId,
          providerName: 'Command Code',
          ok: true,
          configured: true,
          usage: { windows: await fetchCommandCodeUsage(apiKey) },
        });
      } catch (error) {
        return buildResult({
          providerId,
          providerName: 'Command Code',
          ok: false,
          configured: true,
          error: error instanceof Error ? error.message : 'Request failed',
        });
      }
    }
    default:
      return buildResult({
        providerId,
        providerName: providerId,
        ok: false,
        configured: false,
        error: 'Unsupported provider',
      });
  }
};

const pendingQuotaFetches = new Map<string, Promise<ProviderResult>>();

export const fetchQuotaForProvider = (providerId: string): Promise<ProviderResult> => {
  const existing = pendingQuotaFetches.get(providerId);
  if (existing) return existing;
  const request = fetchQuotaForProviderUncoalesced(providerId);
  const pending = request.finally(() => {
    if (pendingQuotaFetches.get(providerId) === pending) pendingQuotaFetches.delete(providerId);
  });
  pendingQuotaFetches.set(providerId, pending);
  return pending;
};
