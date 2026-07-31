const PROVIDER_ALIASES = new Map([
  ['anthropic', 'claude'],
  ['chatgpt', 'codex'],
  ['openai', 'codex'],
  ['z.ai', 'zai-coding-plan'],
  ['zai', 'zai-coding-plan'],
  ['zhipu', 'zhipuai-coding-plan'],
  ['zhipuai', 'zhipuai-coding-plan'],
]);

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCandidateModel = (value) => {
  const model = asNonEmptyString(value);
  const separator = model?.indexOf('/') ?? -1;
  if (!model || separator <= 0 || separator === model.length - 1) return null;
  const provider = model.slice(0, separator).toLowerCase();
  return {
    providerId: PROVIDER_ALIASES.get(provider) || provider,
    modelId: model.slice(separator + 1).replace(/\([^)]*\)$/, ''),
  };
};

const getUsageWindows = (usage, modelId) => {
  if (!usage || typeof usage !== 'object') return [];
  const models = usage.models && typeof usage.models === 'object' ? usage.models : null;
  const modelUsage = models
    ? Object.entries(models).find(([key]) => key.toLowerCase() === modelId.toLowerCase())?.[1]
    : null;
  const selected = modelUsage && typeof modelUsage === 'object' ? modelUsage : usage;
  const windows = selected.windows && typeof selected.windows === 'object'
    ? selected.windows
    : null;
  return windows ? Object.values(windows) : [];
};

const isExhaustedWindow = (window) => {
  if (!window || typeof window !== 'object') return false;
  return (typeof window.remainingPercent === 'number' && window.remainingPercent <= 0)
    || (typeof window.usedPercent === 'number' && window.usedPercent >= 100);
};

export const createRuntimeFallbackApprovalService = ({
  crypto,
  broadcastEvent,
  getQuotaProviders,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) => {
  const pending = new Map();

  const preflight = async (candidateModel) => {
    const parsed = parseCandidateModel(candidateModel);
    if (!parsed) return { status: 'unknown', providerId: null };

    try {
      const providers = await getQuotaProviders();
      const result = await providers.fetchQuotaForProvider(parsed.providerId);
      if (!result?.ok || !result?.configured) {
        return { status: 'unknown', providerId: parsed.providerId };
      }
      const windows = getUsageWindows(result.usage, parsed.modelId);
      if (windows.some(isExhaustedWindow)) {
        return { status: 'exhausted', providerId: parsed.providerId };
      }
      return {
        status: windows.length > 0 ? 'available' : 'unknown',
        providerId: parsed.providerId,
      };
    } catch {
      return { status: 'unknown', providerId: parsed.providerId };
    }
  };

  const broadcast = (properties) => {
    broadcastEvent?.({
      type: 'openchamber:runtime-fallback-approval',
      properties,
    });
  };

  const finish = (id, decision) => {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeoutFn(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    broadcast({
      id,
      sessionID: entry.request.sessionID,
      status: 'resolved',
      decision,
    });
    entry.resolve({
      requestID: id,
      decision,
      preflight: entry.preflight,
    });
    return true;
  };

  const request = async (input, options = {}) => {
    const candidateModel = asNonEmptyString(input?.candidateModel);
    const currentModel = asNonEmptyString(input?.currentModel);
    const sessionID = asNonEmptyString(input?.sessionID);
    const directory = asNonEmptyString(input?.directory);
    if (!candidateModel || !currentModel || !sessionID || !directory) {
      return {
        decision: 'unavailable',
        preflight: { status: 'unknown', providerId: null },
        error: 'sessionID, directory, currentModel, and candidateModel are required',
      };
    }

    const candidatePreflight = await preflight(candidateModel);
    if (candidatePreflight.status === 'exhausted') {
      return {
        decision: 'unavailable',
        preflight: candidatePreflight,
      };
    }

    const timeoutMs = Number.isFinite(input?.timeoutMs)
      ? Math.max(1_000, Math.min(60_000, Math.trunc(input.timeoutMs)))
      : 30_000;
    const id = crypto.randomUUID();
    const createdAt = now();
    const expiresAt = createdAt + timeoutMs;

    return new Promise((resolve) => {
      const onAbort = () => finish(id, 'cancelled');
      const timer = setTimeoutFn(() => finish(id, 'timeout'), timeoutMs);
      const approvalRequest = {
        id,
        sessionID,
        directory,
        currentModel,
        candidateModel,
        source: asNonEmptyString(input.source) || 'runtime-fallback',
        createdAt,
        expiresAt,
        timeoutMs,
      };
      pending.set(id, {
        request: approvalRequest,
        preflight: candidatePreflight,
        resolve,
        timer,
        signal: options.signal,
        onAbort,
      });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) {
        finish(id, 'cancelled');
        return;
      }
      broadcast({
        ...approvalRequest,
        status: 'pending',
        preflight: candidatePreflight,
      });
    });
  };

  const list = () => Array.from(pending.values(), (entry) => ({
    ...entry.request,
    status: 'pending',
    preflight: entry.preflight,
  }));

  const reply = (id, decision) => {
    if (decision !== 'approve' && decision !== 'reject') return false;
    return finish(id, decision === 'approve' ? 'approved' : 'rejected');
  };

  return {
    request,
    list,
    reply,
    cancel: (id) => finish(id, 'cancelled'),
  };
};
