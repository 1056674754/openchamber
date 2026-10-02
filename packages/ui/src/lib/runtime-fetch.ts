import { getActiveRelayTunnel } from './relay/runtime-tunnel';
import { TUNNEL_PARSE_BASE } from './relay/tunnel-payloads';
import { buildRuntimeAuthHeaders } from './runtime-auth';
import { observeRuntimeAuthResponse } from './runtime-auth-expiry';
import { getRuntimeKey } from './runtime-switch';
import { getRuntimeUrlResolver, type RuntimeUrlQuery } from './runtime-url';
import { isCapacitorApp, isOhosApp } from './platform';
import { ohosHttpRequest } from '@/apps/nativeShell';

export interface RuntimeFetchOptions extends RequestInit {
  query?: RuntimeUrlQuery;
}

const CAPACITOR_REQUEST_BODY_MAX_BYTES = 16 * 1024 * 1024;

const readBoundedRequestBody = async (
  request: Request,
  maxBytes: number = CAPACITOR_REQUEST_BODY_MAX_BYTES,
): Promise<Uint8Array | undefined> => {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return undefined;
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Capacitor request body exceeds ${maxBytes} bytes`);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    size += chunk.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Capacitor request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const prepareCapacitorRequestForFetch = async (
  request: Request,
  target: string,
  init: RequestInit | undefined,
  headers: Headers,
): Promise<{ target: string; init: RequestInit }> => {
  const body = init?.body ?? await readBoundedRequestBody(request);
  return {
    target,
    init: {
      method: init?.method ?? request.method,
      headers,
      body,
      cache: init?.cache ?? request.cache,
      credentials: init?.credentials ?? request.credentials,
      integrity: init?.integrity ?? request.integrity,
      keepalive: init?.keepalive ?? request.keepalive,
      mode: init?.mode ?? request.mode,
      redirect: init?.redirect ?? request.redirect,
      referrer: init?.referrer ?? request.referrer,
      referrerPolicy: init?.referrerPolicy ?? request.referrerPolicy,
      signal: init?.signal ?? request.signal,
    },
  };
};

const shouldResolveApiPath = (input: string): boolean => {
  return input.startsWith('/api/') || input === '/api' || input.startsWith('/auth/') || input === '/auth' || input === '/health';
};

const getCurrentOrigin = (): string => {
  if (typeof window === 'undefined') return '';
  return window.location.origin || '';
};

const isCurrentWindowUrl = (url: URL): boolean => {
  if (typeof window === 'undefined') return false;
  const currentOrigin = getCurrentOrigin();
  if (currentOrigin && url.origin === currentOrigin) return true;
  try {
    const current = new URL(window.location.href || currentOrigin);
    return url.protocol === current.protocol && url.host === current.host;
  } catch {
    return false;
  }
};

const isAbsoluteUrl = (value: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(value);

const isNgrokHost = (hostname: string): boolean => (
  /(^|\.)ngrok(?:-free)?\.(?:app|dev|io)$/i.test(hostname)
);

export const addRuntimeProxyHeaders = (url: string, headers: Headers): Headers => {
  try {
    if (isNgrokHost(new URL(url).hostname) && !headers.has('ngrok-skip-browser-warning')) {
      headers.set('ngrok-skip-browser-warning', 'openchamber');
    }
  } catch {
    // Relative and tunnel-virtual paths do not need proxy-specific headers.
  }
  return headers;
};

const appendRuntimeQuery = (url: URL, query?: RuntimeUrlQuery): void => {
  if (!query) return;
  const entries = query instanceof URLSearchParams ? Array.from(query.entries()) : Object.entries(query);
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
};

const isActiveRuntimeServiceUrl = (url: URL): boolean => {
  try {
    const apiBase = getRuntimeUrlResolver().api('/api');
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(apiBase)) return false;
    const base = new URL(apiBase);
    if (url.origin !== base.origin) return false;
    return shouldResolveApiPath(url.pathname);
  } catch {
    return false;
  }
};

const shouldResolveFetchInput = (input: string): boolean => {
  if (shouldResolveApiPath(input)) return true;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return false;
  try {
    const url = new URL(input);
    return isCurrentWindowUrl(url) && shouldResolveApiPath(url.pathname);
  } catch {
    return false;
  }
};

const buildRuntimeFetchUrlFromAbsolute = (input: string, query?: RuntimeUrlQuery): string => {
  try {
    const url = new URL(input);
    if (!isCurrentWindowUrl(url)) return input;
    const rewritten = buildRuntimeFetchUrl(`${url.pathname}${url.search}`, query);
    if (!isAbsoluteUrl(rewritten) && (url.protocol === 'http:' || url.protocol === 'https:')) {
      appendRuntimeQuery(url, query);
      return url.toString();
    }
    return url.hash ? `${rewritten}${url.hash}` : rewritten;
  } catch {
    return input;
  }
};

export const buildRuntimeFetchUrl = (input: string, query?: RuntimeUrlQuery): string => {
  if (input === '/health') return getRuntimeUrlResolver().health(query);
  if (input.startsWith('/auth/') || input === '/auth') return getRuntimeUrlResolver().auth(input, query);
  if (shouldResolveApiPath(input)) return getRuntimeUrlResolver().api(input, query);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return buildRuntimeFetchUrlFromAbsolute(input, query);
  return input;
};

const shouldAttachRuntimeAuth = (input: string | URL | Request): boolean => {
  const raw = input instanceof Request ? input.url : input.toString();
  if (!isAbsoluteUrl(raw)) {
    return shouldResolveApiPath(raw);
  }

  try {
    return isActiveRuntimeServiceUrl(new URL(raw));
  } catch {
    return false;
  }
};

// Headers API only accepts ISO-8859-1 (Latin-1) characters. Any value containing
// characters outside \u0000-\u00FF causes "Failed to construct/set 'Headers':
// String contains non ISO-8859-1 code point." Encode those values so they round-trip
// safely through the browser's Headers API. Directory hints get an explicit marker
// only when encoded, so plain ASCII paths remain compatible with routes that read
// the header directly.
export const isLatin1Safe = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xFF) return false;
  }
  return true;
};

const shouldEncodeHeaderValue = (_key: string, value: string): boolean => !isLatin1Safe(value);

export const sanitizeHeadersForBrowser = (init?: HeadersInit): [string, string][] | undefined => {
  if (!init) return undefined;
  // Normalize any HeadersInit shape into a plain array of entries so we can
  // safely inspect and re-encode non-Latin-1 values.
  const sourceEntries: [string, string][] = init instanceof Headers
    ? Array.from(init.entries())
    : Array.isArray(init)
      ? init
      : Object.entries(init);
  if (sourceEntries.length === 0) return undefined;
  const entries: [string, string][] = [];
  let dirty = false;
  let encodedDirectoryHint = false;
  for (const [key, value] of sourceEntries) {
    if (shouldEncodeHeaderValue(key, value)) {
      entries.push([key, encodeURIComponent(value)]);
      dirty = true;
      if (key.toLowerCase() === 'x-opencode-directory') encodedDirectoryHint = true;
    } else {
      entries.push([key, value]);
    }
  }
  if (encodedDirectoryHint) {
    entries.push(['x-opencode-directory-encoding', 'uri']);
  }
  return dirty ? entries : undefined;
};

const mergeHeaders = async (inputHeaders?: HeadersInit, initHeaders?: HeadersInit, attachAuth = true): Promise<Headers> => {
  const headers = new Headers(sanitizeHeadersForBrowser(inputHeaders) ?? inputHeaders);
  if (initHeaders) {
    new Headers(sanitizeHeadersForBrowser(initHeaders) ?? initHeaders).forEach((value, key) => headers.set(key, value));
  }
  if (!attachAuth) {
    return headers;
  }
  return buildRuntimeAuthHeaders(headers);
};

// ── Relay-mode routing ─────────────────────────────────────────────────────
// When the active runtime is a private relay, runtime HTTP does not go to the
// network: it rides the E2EE tunnel. We route exactly the same paths we would
// resolve for a network runtime (/api, /auth, /health) and attach identical
// auth headers; the bearer/url-token semantics are unchanged, only the
// transport differs. Non-runtime requests (external URLs) fall through to the
// real network fetch.
const appendPathQuery = (path: string, query?: RuntimeUrlQuery): string => {
  if (!query) return path;
  const url = new URL(path, TUNNEL_PARSE_BASE);
  appendRuntimeQuery(url, query);
  return `${url.pathname}${url.search}`;
};

const extractRelayPath = (input: string | URL | Request, query?: RuntimeUrlQuery): string | null => {
  const raw = input instanceof Request ? input.url : input.toString();
  if (!isAbsoluteUrl(raw)) {
    if (!shouldResolveApiPath(raw)) return null;
    return appendPathQuery(raw, query);
  }
  try {
    const url = new URL(raw);
    if (!isCurrentWindowUrl(url) || !shouldResolveApiPath(url.pathname)) return null;
    appendRuntimeQuery(url, query);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};

const tryRelayFetch = async (
  input: string | URL | Request,
  requestInit: RequestInit,
  query?: RuntimeUrlQuery,
): Promise<Response | null> => {
  const relay = getActiveRelayTunnel();
  if (!relay) return null;
  const path = extractRelayPath(input, query);
  if (path === null) return null;
  const inputHeaders = input instanceof Request ? input.headers : undefined;
  const headers = await mergeHeaders(inputHeaders, requestInit.headers, true);
  if (input instanceof Request) {
    // Forward the Request itself — the tunnel reads its method/body/signal
    // natively (incl. stream bodies). Re-wrapping as `new Request(path, input)`
    // throws on a stream body without duplex:'half'.
    return relay.fetch(input, { ...requestInit, headers });
  }
  return relay.fetch(path, { ...requestInit, headers });
};

const resolveRuntimeFetchInput = (input: string | URL | Request, query?: RuntimeUrlQuery): string | URL | Request => {
  if (typeof input === 'string') {
    return buildRuntimeFetchUrl(input, query);
  }

  if (input instanceof URL) {
    return buildRuntimeFetchUrl(input.toString(), query);
  }

  const target = buildRuntimeFetchUrl(input.url, query);
  return target === input.url ? input : new Request(target, input);
};

// ---------------------------------------------------------------------------
// In-flight read coalescing
//
// On cold start two independent data layers (the sync bootstrap and the config
// store) fire the SAME idempotent reads — providers, config, path, agents,
// project — concurrently, with no shared dedup. That saturates the single
// OpenCode process and delays everything queued behind it (e.g. createSession).
// Coalesce genuinely-concurrent identical GETs to those read endpoints so
// OpenCode does the work once; every caller gets an independent `clone()`.
//
// Scope is deliberately tight: GET only, an allowlist of read paths, never an
// event stream, and never a request carrying an AbortSignal (so one caller
// aborting can't cancel the shared fetch for the others). The entry is removed
// as soon as the request settles, so this only ever shares overlapping in-flight
// requests — it never serves a stale/cached response.
// ---------------------------------------------------------------------------
const COALESCE_READ_PATH = /\/api\/(config|path|app\/agents|agent|project|command|fs\/(?:read|stat))(\b|\/|\?|$)/;
const READ_COALESCE = new Map<string, Promise<Response>>();

const normalizeCoalescibleReadPath = (url: string): string => {
  try {
    const pathname = new URL(url, 'http://openchamber.invalid').pathname;
    return pathname.replace(/^\/api\/remote\/[^/]+/, '/api');
  } catch {
    return url;
  }
};

// OpenCode 2.x scopes these reads by the `x-opencode-directory` header, not
// the URL (OC2 spine S6, upstream 654705f7d runtime-fetch slice), so two
// projects asking for `/api/config` at once must not share one response. The
// v1 track sends no such header, so its key space is unchanged.
const coalesceReadKey = (method: string, url: string, hasSignal: boolean, scopeHeaders: Headers): string | null => {
  if (hasSignal) return null;
  if (method !== 'GET') return null;
  if (url.includes('/event')) return null;
  if (!COALESCE_READ_PATH.test(normalizeCoalescibleReadPath(url))) return null;
  return `GET ${url}\u0000${scopeHeaders.get('x-opencode-directory') ?? ''}`;
};

export const runtimeFetch = async (input: string | URL | Request, init: RuntimeFetchOptions = {}): Promise<Response> => {
  const { query, ...requestInit } = init;

  // Resolve the transport once — relay tunnel or network — then apply the SAME
  // read-coalescing to both. On a relay the tunnel is bandwidth/latency-bound, so
  // deduping concurrent identical GETs matters there most.
  const relay = getActiveRelayTunnel();
  const relayPath = relay ? extractRelayPath(input, query) : null;

  let doFetch: () => Promise<Response>;
  let url: string;
  let method: string;
  let scopeHeaders: Headers;
  let observesRuntimeAuth = false;
  if (relay && relayPath !== null) {
    const inputHeaders = input instanceof Request ? input.headers : undefined;
    const headers = await mergeHeaders(inputHeaders, requestInit.headers, true);
    doFetch = input instanceof Request
      ? () => relay.fetch(input, { ...requestInit, headers })
      : () => relay.fetch(relayPath, { ...requestInit, headers });
    scopeHeaders = headers;
    url = relayPath;
    method = String(requestInit.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    observesRuntimeAuth = true;
  } else {
    const resolvedInput = resolveRuntimeFetchInput(input, query);
    const inputHeaders = resolvedInput instanceof Request ? resolvedInput.headers : undefined;
    observesRuntimeAuth = shouldAttachRuntimeAuth(resolvedInput);
    const headers = await mergeHeaders(inputHeaders, requestInit.headers, observesRuntimeAuth);
    const resolvedUrl = resolvedInput instanceof Request
      ? resolvedInput.url
      : resolvedInput instanceof URL
        ? resolvedInput.toString()
        : String(resolvedInput);
    addRuntimeProxyHeaders(resolvedUrl, headers);
    doFetch = resolvedInput instanceof Request
      ? () => fetch(new Request(resolvedInput, { ...requestInit, headers }))
      : () => fetch(resolvedInput, { ...requestInit, headers });
    scopeHeaders = headers;
    url = resolvedUrl;
    method = String(
      requestInit.method ?? (resolvedInput instanceof Request ? resolvedInput.method : 'GET'),
    ).toUpperCase();
  }

  if (observesRuntimeAuth) {
    const requestRuntimeKey = getRuntimeKey();
    const rawFetch = doFetch;
    doFetch = () => rawFetch().then((response) => {
      observeRuntimeAuthResponse(url, response.status, requestRuntimeKey);
      return response;
    });
  }

  // A Request always carries a (possibly default) signal; treat any Request, or
  // an explicit init.signal, as "has signal" and skip coalescing for safety.
  const hasSignal = requestInit.signal != null || input instanceof Request;

  const key = coalesceReadKey(method, url, hasSignal, scopeHeaders);
  if (!key) return doFetch();

  const existing = READ_COALESCE.get(key);
  if (existing) return existing.then((res) => res.clone());

  const pending = doFetch();
  READ_COALESCE.set(key, pending);
  pending.then(
    () => READ_COALESCE.delete(key),
    () => READ_COALESCE.delete(key),
  );
  return pending.then((res) => res.clone());
};

let runtimeFetchBridgeInstalled = false;

// ArkWeb (HarmonyOS shell) blocks every cors-mode cross-origin fetch a packaged
// page makes to private/LAN IPs inside the renderer (Chromium Local Network
// Access — the request never leaves the browser, so no server CORS header can
// fix it). Route those through the ArkTS native-HTTP bridge, the CapacitorHttp
// equivalent. Same-origin and https (relay/tunnel/public) stay on window.fetch.
const ohosBridgeFetch = async (target: string, init?: RequestInit): Promise<Response | null> => {
  if (!isOhosApp()) return null;
  let url: URL;
  try {
    url = new URL(target, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.origin === window.location.origin) return null;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  const headerList = new Headers(init?.headers);
  headerList.forEach((value, key) => {
    headers[key] = value;
  });
  let body: string | null = null;
  const rawBody = init?.body;
  if (rawBody != null) {
    if (typeof rawBody === 'string') {
      body = rawBody;
    } else if (rawBody instanceof URLSearchParams) {
      body = rawBody.toString();
    } else {
      // Streams/FormData/Blob are not JSON-transportable over the port; leave
      // them on window.fetch (which fails on LAN but callers handle failure).
      return null;
    }
  }
  const response = await ohosHttpRequest({
    url: url.toString(),
    method,
    headers,
    body,
    timeoutMs: 60_000,
  });
  if (!response) return null;
  const responseInit: ResponseInit = {
    status: response.status >= 200 && response.status <= 599 ? response.status : 502,
    headers: response.headers,
  };
  if (response.status === 204 || response.status === 304) {
    return new Response(null, responseInit);
  }
  return new Response(response.text, responseInit);
};

export const installRuntimeFetchBridge = (): void => {
  if (runtimeFetchBridgeInstalled || typeof window === 'undefined') return;
  runtimeFetchBridgeInstalled = true;

  const bareFetch = window.fetch.bind(window);
  const nativeFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (isOhosApp()) {
      const target = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
      const bridged = await ohosBridgeFetch(target, init);
      if (bridged) return bridged;
    }
    return bareFetch(input as RequestInfo, init);
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestRuntimeKey = getRuntimeKey();
    const rawInput = input instanceof Request ? input.url : input.toString();
    const observesRuntimeAuth = getActiveRelayTunnel() !== null
      || shouldResolveFetchInput(rawInput)
      || (() => {
        try {
          return isActiveRuntimeServiceUrl(new URL(rawInput));
        } catch {
          return false;
        }
      })();

    const response = await (async () => {
      const relayResponse = await tryRelayFetch(input, init ?? {});
      if (relayResponse) return relayResponse;
      if (typeof input === 'string') {
        if (!shouldResolveFetchInput(input)) {
          try {
            const url = new URL(input);
            if (isActiveRuntimeServiceUrl(url)) {
              const headers = await mergeHeaders(undefined, init?.headers);
              addRuntimeProxyHeaders(url.toString(), headers);
              return nativeFetch(input, { ...init, headers });
            }
          } catch {
            // Non-URL fetch inputs should fall through unchanged.
          }
          return nativeFetch(input, init);
        }
        const headers = await mergeHeaders(undefined, init?.headers);
        const target = buildRuntimeFetchUrl(input);
        addRuntimeProxyHeaders(target, headers);
        return nativeFetch(target, { ...init, headers });
      }

      if (input instanceof URL) {
        const raw = input.toString();
        if (!shouldResolveFetchInput(raw)) {
          if (isActiveRuntimeServiceUrl(input)) {
            const headers = await mergeHeaders(undefined, init?.headers);
            addRuntimeProxyHeaders(input.toString(), headers);
            return nativeFetch(input, { ...init, headers });
          }
          return nativeFetch(input, init);
        }
        const headers = await mergeHeaders(undefined, init?.headers);
        const target = buildRuntimeFetchUrl(raw);
        addRuntimeProxyHeaders(target, headers);
        return nativeFetch(target, { ...init, headers });
      }

      if (input instanceof Request) {
        if (!shouldResolveFetchInput(input.url)) {
          try {
            const url = new URL(input.url);
            if (isActiveRuntimeServiceUrl(url)) {
              const headers = await mergeHeaders(input.headers, init?.headers);
              addRuntimeProxyHeaders(url.toString(), headers);
              return nativeFetch(new Request(input, { ...init, headers }));
            }
          } catch {
            // Non-URL request inputs should fall through unchanged.
          }
          return nativeFetch(input, init);
        }
        const headers = await mergeHeaders(input.headers, init?.headers);
        const target = buildRuntimeFetchUrl(input.url);
        addRuntimeProxyHeaders(target, headers);
        if (isCapacitorApp()) {
          const prepared = await prepareCapacitorRequestForFetch(input, target, init, headers);
          return nativeFetch(prepared.target, prepared.init);
        }
        const request = target === input.url ? input : new Request(target, input);
        return nativeFetch(new Request(request, { ...init, headers }));
      }

      return nativeFetch(input, init);
    })();

    if (observesRuntimeAuth) {
      observeRuntimeAuthResponse(rawInput, response.status, requestRuntimeKey);
    }
    return response;
  };
};
