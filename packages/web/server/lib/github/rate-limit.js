const MAX_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 60 * 1000;

let rateLimitedUntil = 0;

const headerValue = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name];
};

const parseRetryAfterMs = (error) => {
  const headers = error?.response?.headers;
  const retryAfter = headerValue(headers, 'retry-after');
  if (retryAfter !== undefined && retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const reset = headerValue(headers, 'x-ratelimit-reset');
  if (reset !== undefined && reset !== null) {
    const delta = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  return null;
};

export const isGitHubRateLimitError = (error) => {
  const status = error?.status ?? error?.response?.status;
  if (status === 429) return true;
  if (status !== 403) return false;
  const remaining = headerValue(error?.response?.headers, 'x-ratelimit-remaining');
  if (remaining === '0' || remaining === 0) return true;
  if (headerValue(error?.response?.headers, 'retry-after') != null) return true;
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('rate limit');
};

export const noteGitHubRateLimit = (error) => {
  const retryMs = Math.min(parseRetryAfterMs(error) ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS);
  const until = Date.now() + retryMs;
  if (until > rateLimitedUntil) {
    rateLimitedUntil = until;
    console.warn(`[github] rate limited; pausing GitHub PR status calls for ~${Math.round(retryMs / 1000)}s`);
  }
};

export const noteIfGitHubRateLimit = (error) => {
  if (!isGitHubRateLimitError(error)) return false;
  noteGitHubRateLimit(error);
  return true;
};

export const isGitHubRateLimited = () => Date.now() < rateLimitedUntil;
