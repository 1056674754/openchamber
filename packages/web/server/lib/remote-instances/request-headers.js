/**
 * Per-instance request headers for remote OpenCode upstream calls.
 * Authorization is owned by instance.auth; requestHeaders must never set it.
 */

export const MAX_REMOTE_REQUEST_HEADERS = 20;
export const MAX_REMOTE_REQUEST_HEADER_NAME_LENGTH = 128;
export const MAX_REMOTE_REQUEST_HEADER_VALUE_LENGTH = 4096;

const isReservedHeaderName = (name) => String(name || '').trim().toLowerCase() === 'authorization';

/**
 * Normalize a client-supplied requestHeaders draft, keeping empty values so
 * preserve-on-update can restore stored secrets for those names.
 * @param {unknown} headers
 * @returns {Record<string, string> | undefined} undefined when input omitted / invalid
 */
export const normalizeRemoteRequestHeadersDraft = (headers) => {
  if (headers === undefined) return undefined;
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  const next = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (Object.keys(next).length >= MAX_REMOTE_REQUEST_HEADERS) {
      break;
    }
    if (typeof rawName !== 'string' || typeof rawValue !== 'string') continue;
    // Reject CRLF before trim — trim would otherwise strip trailing CR/LF and accept the value.
    if (/[\r\n:]/.test(rawName) || /[\r\n]/.test(rawValue)) continue;
    const name = rawName.trim();
    if (!name || name.length > MAX_REMOTE_REQUEST_HEADER_NAME_LENGTH) continue;
    if (isReservedHeaderName(name)) continue;
    const value = rawValue.trim();
    if (value.length > MAX_REMOTE_REQUEST_HEADER_VALUE_LENGTH) continue;
    next[name] = value;
  }
  return next;
};

/**
 * Sanitize a raw requestHeaders map for persistence / outbound use.
 * @param {unknown} headers
 * @returns {Record<string, string>}
 */
export const sanitizeRemoteRequestHeaders = (headers) => {
  const draft = normalizeRemoteRequestHeadersDraft(headers);
  if (!draft) return {};
  const next = {};
  for (const [name, value] of Object.entries(draft)) {
    if (!value) continue;
    next[name] = value;
  }
  return next;
};

/**
 * Build Authorization from instance.auth (password Basic / bearer).
 * @param {object | null | undefined} instance
 * @returns {Record<string, string>}
 */
export const buildRemoteAuthAuthorizationHeaders = (instance) => {
  const headers = {};
  if (instance?.auth?.type === 'password' && instance.auth.value) {
    headers.Authorization = `Basic ${Buffer.from(`user:${instance.auth.value}`).toString('base64')}`;
  } else if (instance?.auth?.type === 'bearer' && instance.auth.value) {
    headers.Authorization = `Bearer ${instance.auth.value}`;
  }
  return headers;
};

/**
 * Merge sanitized requestHeaders with auth Authorization (auth wins).
 * @param {object | null | undefined} instance
 * @returns {Record<string, string>}
 */
export const buildRemoteUpstreamHeaders = (instance) => ({
  ...sanitizeRemoteRequestHeaders(instance?.requestHeaders),
  ...buildRemoteAuthAuthorizationHeaders(instance),
});

/**
 * Redact header values for API responses while keeping names for the settings UI.
 * @param {unknown} headers
 * @returns {{ requestHeaders?: Record<string, string>, hasRequestHeaders?: boolean }}
 */
export const redactRemoteRequestHeadersForApi = (headers) => {
  const sanitized = sanitizeRemoteRequestHeaders(headers);
  const names = Object.keys(sanitized);
  if (names.length === 0) {
    return {};
  }
  const requestHeaders = {};
  for (const name of names) {
    requestHeaders[name] = '';
  }
  return { requestHeaders, hasRequestHeaders: true };
};

/**
 * When the client sends empty values for existing header names, keep the stored secrets.
 * Names present only in `current` and omitted from `next` are dropped (row removed in UI).
 * @param {unknown} currentHeaders
 * @param {unknown} nextHeaders
 * @returns {Record<string, string> | undefined}
 */
export const preserveRemoteRequestHeaderValues = (currentHeaders, nextHeaders) => {
  if (nextHeaders === undefined) {
    const current = sanitizeRemoteRequestHeaders(currentHeaders);
    return Object.keys(current).length > 0 ? current : undefined;
  }
  if (nextHeaders === null) {
    return undefined;
  }
  if (!nextHeaders || typeof nextHeaders !== 'object' || Array.isArray(nextHeaders)) {
    return undefined;
  }

  const current = sanitizeRemoteRequestHeaders(currentHeaders);
  const next = {};
  for (const [rawName, rawValue] of Object.entries(nextHeaders)) {
    if (Object.keys(next).length >= MAX_REMOTE_REQUEST_HEADERS) {
      break;
    }
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name.length > MAX_REMOTE_REQUEST_HEADER_NAME_LENGTH) continue;
    if (/[\r\n:]/.test(name) || isReservedHeaderName(name)) continue;

    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (value) {
      if (value.length > MAX_REMOTE_REQUEST_HEADER_VALUE_LENGTH || /[\r\n]/.test(value)) continue;
      next[name] = value;
      continue;
    }
    if (current[name]) {
      next[name] = current[name];
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
};
