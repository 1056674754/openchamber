const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

type WaitForDelay = (delayMs: number, signal?: AbortSignal) => Promise<boolean>;

type RetryProjectRepoStatusProbeOptions = {
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
  waitForDelay?: WaitForDelay;
};

const waitForDelay: WaitForDelay = (delayMs, signal) => {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const timer = globalThis.setTimeout(() => finish(true), delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      finish(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const retryProjectRepoStatusProbe = async (
  probe: () => Promise<boolean>,
  options: RetryProjectRepoStatusProbeOptions = {},
): Promise<boolean> => {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const wait = options.waitForDelay ?? waitForDelay;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (options.signal?.aborted) {
      return false;
    }

    if (await probe()) {
      return true;
    }

    const retryDelayMs = retryDelaysMs[attempt];
    if (retryDelayMs === undefined) {
      return false;
    }

    if (!await wait(retryDelayMs, options.signal)) {
      return false;
    }
  }

  return false;
};
