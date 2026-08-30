const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 120_000;

export class BrowserControlError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BrowserControlError';
    this.status = status;
  }
}

export const createBrowserControlBroker = ({ emitRequest, createId, setTimer = setTimeout, clearTimer = clearTimeout } = {}) => {
  if (typeof emitRequest !== 'function') throw new TypeError('emitRequest is required');
  const pending = new Map();
  const settle = (requestId, outcome) => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    pending.delete(requestId);
    clearTimer(entry.timer);
    entry.finish(outcome);
    return true;
  };
  return {
    get pendingCount() { return pending.size; },
    request(action, parameters = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
      const requestId = typeof createId === 'function' ? createId() : `browser-${Date.now()}-${pending.size}`;
      const boundedTimeout = Math.min(Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);
      const listenerCount = emitRequest({ requestId, action, parameters });
      if (!listenerCount) {
        return Promise.reject(new BrowserControlError(
          'No connected OpenChamber desktop client can control a page. Nothing was changed.',
          503,
        ));
      }
      return new Promise((resolve, reject) => {
        const finish = (outcome) => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          if (outcome.ok) resolve(outcome.data ?? null);
          else reject(new BrowserControlError(outcome.message || 'Browser action failed', outcome.status || 400));
        };
        const onAbort = signal ? () => settle(requestId, { ok: false, message: 'Browser action was cancelled', status: 499 }) : null;
        if (signal?.aborted) {
          reject(new BrowserControlError('Browser action was cancelled', 499));
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimer(() => settle(requestId, {
          ok: false,
          message: `The in-app browser did not respond within ${Math.round(boundedTimeout / 1000)}s`,
          status: 504,
        }), boundedTimeout);
        pending.set(requestId, { finish, timer, claimed: false });
      });
    },
    claim(requestId) {
      const entry = typeof requestId === 'string' ? pending.get(requestId) : null;
      if (!entry || entry.claimed) return false;
      entry.claimed = true;
      return true;
    },
    resolve(requestId, result) {
      if (typeof requestId !== 'string' || !requestId) return false;
      return result?.ok === true
        ? settle(requestId, { ok: true, data: result.data ?? null })
        : settle(requestId, { ok: false, message: result?.error || 'Browser action failed', status: 400 });
    },
    rejectAll(message) {
      for (const requestId of [...pending.keys()]) settle(requestId, { ok: false, message, status: 503 });
    },
  };
};
