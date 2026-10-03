import { readOpenCodeCredentials } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber,
  toTimestamp,
  resolveWindowLabel,
  formatMoney
} from '../utils/index.js';

export const providerId = 'codex';
export const providerName = 'Codex';
export const aliases = ['openai', 'codex', 'chatgpt'];

export const isConfigured = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return Boolean(entry?.access || entry?.token);
};

export const parseCodexUsageWindows = (payload) => {
  const primary = payload?.rate_limit?.primary_window ?? null;
  const secondary = payload?.rate_limit?.secondary_window ?? null;
  const credits = payload?.credits ?? null;
  const spendLimit = payload?.spend_control?.individual_limit ?? null;
  const windows = {};

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
    const label = unlimited
      ? 'Unlimited'
      : balance !== null
        ? `$${formatMoney(balance)} remaining`
        : null;
    windows.credits = toUsageWindow({
      usedPercent: null,
      windowSeconds: null,
      resetAt: null,
      valueLabel: label,
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

export const fetchQuota = async () => {
  const auth = await readOpenCodeCredentials();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  const accessToken = entry?.access ?? entry?.token;
  const accountId = entry?.accountId;

  if (!accessToken) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {})
    };
    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: response.status === 401
          ? 'Session expired \u2014 please re-authenticate with OpenAI'
          : `API error: ${response.status}`
      });
    }

    const payload = await response.json();
    const windows = parseCodexUsageWindows(payload);

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: { windows }
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed'
    });
  }
};
