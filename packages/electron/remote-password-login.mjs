const normalizeHttpUrl = (raw) => {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
};

export const hasSameHttpOrigin = (left, right) => {
  const leftUrl = normalizeHttpUrl(left);
  const rightUrl = normalizeHttpUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl.origin === rightUrl.origin);
};

const readSetCookieHeaders = (headers) => {
  if (typeof headers?.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    if (Array.isArray(values) && values.length > 0) return values;
  }
  const combined = typeof headers?.get === 'function' ? headers.get('set-cookie') : '';
  return String(combined || '')
    .split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .map((value) => value.trim())
    .filter(Boolean);
};

const parseSetCookie = (rawCookie, url) => {
  const parts = String(rawCookie || '').split(';').map((part) => part.trim()).filter(Boolean);
  const pair = parts.shift() || '';
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;

  const details = {
    url: url.origin,
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1),
  };
  if (!details.name) return null;

  for (const attribute of parts) {
    const attributeSeparator = attribute.indexOf('=');
    const key = (attributeSeparator >= 0 ? attribute.slice(0, attributeSeparator) : attribute).trim().toLowerCase();
    const value = attributeSeparator >= 0 ? attribute.slice(attributeSeparator + 1).trim() : '';
    if (key === 'path' && value) details.path = value;
    if (key === 'domain' && value) details.domain = value.replace(/^\./, '');
    if (key === 'secure') details.secure = true;
    if (key === 'httponly') details.httpOnly = true;
    if (key === 'max-age') {
      const maxAge = Number(value);
      if (Number.isFinite(maxAge)) details.expirationDate = Math.floor(Date.now() / 1000) + maxAge;
    }
    if (key === 'expires' && !details.expirationDate) {
      const expiresAt = Date.parse(value);
      if (Number.isFinite(expiresAt)) details.expirationDate = Math.floor(expiresAt / 1000);
    }
    if (key === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict') details.sameSite = 'strict';
      if (normalized === 'lax') details.sameSite = 'lax';
      if (normalized === 'none') details.sameSite = 'no_restriction';
    }
  }

  return details;
};

export const loginRemotePasswordAndPersistSession = async ({
  url,
  password,
  trustDevice,
  cookieStore,
  fetchImpl = fetch,
}) => {
  const baseUrl = normalizeHttpUrl(url);
  const candidatePassword = typeof password === 'string' ? password : '';
  if (!baseUrl) throw new Error('Invalid URL');
  if (!candidatePassword) throw new Error('Password is required');
  if (!cookieStore || typeof cookieStore.set !== 'function') throw new Error('Cookie store is unavailable');

  const response = await fetchImpl(new URL('/auth/session', `${baseUrl.toString()}/`).toString(), {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: candidatePassword, trustDevice: trustDevice === true }),
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const cookieDetails = readSetCookieHeaders(response.headers)
    .map((cookie) => parseSetCookie(cookie, baseUrl))
    .filter(Boolean);
  if (cookieDetails.length === 0) {
    return { ok: false, status: 500 };
  }

  for (const details of cookieDetails) {
    await cookieStore.set(details);
  }
  return { ok: true, status: response.status };
};
