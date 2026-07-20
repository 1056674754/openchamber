const filteredRequestHeaders = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'accept-encoding',
]);

const filteredResponseHeaders = new Set([
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'www-authenticate',
  'content-encoding',
]);

export const DECODED_PAYLOAD_LENGTH_HEADER = 'x-openchamber-decoded-content-length';

export const preserveDecodedPayloadLengthHeader = (responseHeaders) => {
  if (!responseHeaders || typeof responseHeaders !== 'object') {
    return;
  }

  delete responseHeaders[DECODED_PAYLOAD_LENGTH_HEADER];
  const rawEncoding = responseHeaders['content-encoding'];
  const encoding = (Array.isArray(rawEncoding) ? rawEncoding[0] : rawEncoding)?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') {
    return;
  }

  const rawLength = responseHeaders['content-length'];
  const normalizedLength = (Array.isArray(rawLength) ? rawLength[0] : rawLength)?.trim();
  if (!normalizedLength || !/^\d+$/.test(normalizedLength)) {
    return;
  }

  const payloadBytes = Number(normalizedLength);
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
    return;
  }
  responseHeaders[DECODED_PAYLOAD_LENGTH_HEADER] = String(payloadBytes);
};

export const collectForwardProxyHeaders = (requestHeaders, authHeaders = {}) => {
  const headers = {};

  for (const [key, value] of Object.entries(requestHeaders || {})) {
    if (!value) continue;
    const normalizedKey = key.toLowerCase();
    if (filteredRequestHeaders.has(normalizedKey)) continue;
    headers[normalizedKey] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  if (authHeaders.Authorization) {
    headers.Authorization = authHeaders.Authorization;
  }

  return headers;
};

export const shouldForwardProxyResponseHeader = (key) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return false;
  }

  return !filteredResponseHeaders.has(key.toLowerCase());
};

export const applyForwardProxyResponseHeaders = (responseHeaders, response) => {
  if (!responseHeaders || typeof response?.setHeader !== 'function') {
    return;
  }

  for (const [key, value] of responseHeaders.entries()) {
    if (!shouldForwardProxyResponseHeader(key)) {
      continue;
    }
    response.setHeader(key, value);
  }
};
