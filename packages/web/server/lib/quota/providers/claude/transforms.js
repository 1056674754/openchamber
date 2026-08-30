import {
  asNonEmptyString,
  asObject,
  formatMoney,
  toNumber,
  toTimestamp,
  toUsageWindow,
} from '../../utils/index.js';

const SESSION_WINDOW_SECONDS = 5 * 60 * 60;
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const asArray = (value) => (Array.isArray(value) ? value : []);

const toAmount = (value) => {
  const money = asObject(value);
  const minor = toNumber(money?.amount_minor);
  if (minor === null) return null;
  const exponent = toNumber(money?.exponent) ?? 2;
  return minor / 10 ** exponent;
};

const formatSpendLabel = (used, limit, currency) => {
  const usedLabel = formatMoney(used);
  if (usedLabel === null) return null;
  const prefix = currency === 'USD' || !currency ? '$' : `${currency} `;
  const limitLabel = formatMoney(limit);
  return limitLabel === null ? `${prefix}${usedLabel}` : `${prefix}${usedLabel} / ${prefix}${limitLabel}`;
};

const addWindow = (target, key, { percent, resetAt, valueLabel, windowSeconds = null }) => {
  if (percent === null && !valueLabel) return;
  target[key] = toUsageWindow({ usedPercent: percent, windowSeconds, resetAt, valueLabel });
};

const applyLimitsArray = (limits, windows, models) => {
  for (const entry of limits) {
    const limit = asObject(entry);
    if (!limit) continue;
    const percent = toNumber(limit.percent);
    const resetAt = toTimestamp(limit.resets_at);
    const modelName = asNonEmptyString(asObject(asObject(limit.scope)?.model)?.display_name);

    if (limit.kind === 'session') {
      addWindow(windows, '5h', { percent, resetAt, windowSeconds: SESSION_WINDOW_SECONDS });
    } else if (limit.kind === 'weekly_all') {
      addWindow(windows, '7d', { percent, resetAt, windowSeconds: WEEKLY_WINDOW_SECONDS });
    } else if (limit.kind === 'weekly_scoped' && modelName) {
      const modelWindows = {};
      addWindow(modelWindows, '7d', { percent, resetAt, windowSeconds: WEEKLY_WINDOW_SECONDS });
      if (Object.keys(modelWindows).length > 0) models[modelName] = { windows: modelWindows };
    }
  }
};

const applyLegacyFields = (payload, windows) => {
  const fiveHour = asObject(payload.five_hour);
  const sevenDay = asObject(payload.seven_day);
  if (fiveHour) {
    addWindow(windows, '5h', {
      percent: toNumber(fiveHour.utilization),
      resetAt: toTimestamp(fiveHour.resets_at),
      windowSeconds: SESSION_WINDOW_SECONDS,
    });
  }
  if (sevenDay) {
    addWindow(windows, '7d', {
      percent: toNumber(sevenDay.utilization),
      resetAt: toTimestamp(sevenDay.resets_at),
      windowSeconds: WEEKLY_WINDOW_SECONDS,
    });
  }
};

const applyExtraUsage = (payload, windows) => {
  const spend = asObject(payload.spend);
  if (!spend || spend.enabled !== true) return;
  addWindow(windows, 'extra_usage', {
    percent: toNumber(spend.percent),
    resetAt: null,
    valueLabel: formatSpendLabel(
      toAmount(spend.used),
      toAmount(spend.limit),
      asNonEmptyString(asObject(spend.used)?.currency),
    ),
  });
};

export const toClaudeUsage = (rawPayload) => {
  const payload = asObject(rawPayload) ?? {};
  const windows = {};
  const models = {};
  const limits = asArray(payload.limits);
  if (limits.length > 0) applyLimitsArray(limits, windows, models);
  else applyLegacyFields(payload, windows);
  applyExtraUsage(payload, windows);
  return { windows, models };
};
