// Fork dual-probe for direct OpenCode server detection (spine S8). OpenCode 2.x
// removed the v1 `GET /global/health` probe and answers `GET /api/info` instead
// (JSON with at least `version`); v1 404s (or HTML-serves) `/api/info`. The
// probe order is v2-first with a v1 fallback, mirroring the web server's
// established conventions (packages/web/server/lib/opencode/compatibility.js):
// the fallback only runs after `/api/info` fails to match, so v1 servers keep
// their byte-identical single-probe outcome. Probe failures never throw — they
// surface through `error` (fork rule: detection must not block).

export type OpenCodeProbeMode = 'v1' | 'v2';

export type OpenCodeServerProbe = {
  version: string | null;
  /** Which wire generation answered the probe; `null` when neither did. */
  mode: OpenCodeProbeMode | null;
  /** v1 `/global/health` contract only; `true` when the v1 body said healthy. */
  healthy?: boolean;
  error?: string;
};

export type OpenCodeProbeFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ProbeOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Used when the failing response carries neither an error body nor statusText. */
  defaultError?: string;
};

const PROBE_TIMEOUT_MS = 5000;

// Normalization identical to the existing VS Code call sites: trim, strip a
// leading `v`, keep everything else — an `-sscity` suffix is tolerated as-is.
const normalizeVersion = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^v/, '');
  return normalized.length > 0 ? normalized : null;
};

const readJsonObject = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const requestJson = async (
  pathname: string,
  baseUrl: string,
  fetchImpl: OpenCodeProbeFetch,
  options: ProbeOptions,
): Promise<{ response: Response; body: Record<string, unknown> | null }> => {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS);
  let signal: AbortSignal = timeoutSignal;
  let forwardAbort: (() => void) | null = null;
  if (options.signal) {
    if (typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([options.signal, timeoutSignal]);
    } else {
      // Older extension hosts (Node 18) have no AbortSignal.any.
      const combined = new AbortController();
      forwardAbort = () => combined.abort();
      options.signal.addEventListener('abort', forwardAbort, { once: true });
      signal = combined.signal;
    }
  }
  try {
    const response = await fetchImpl(new URL(pathname, baseUrl).toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
      signal,
    });
    return { response, body: await readJsonObject(response) };
  } finally {
    if (forwardAbort) options.signal?.removeEventListener('abort', forwardAbort);
  }
};

/**
 * Probe an OpenCode server for its version and wire mode. Tries v2
 * `GET /api/info` first; falls back to v1 `GET /global/health` when `/api/info`
 * 404s, errors, or does not match the v2 shape (a non-JSON body, e.g. the v1
 * catch-all serving the web UI, is not evidence of v2). Never throws.
 */
export const probeOpenCodeVersion = async (
  baseUrl: string,
  fetchImpl: OpenCodeProbeFetch = fetch,
  options: ProbeOptions = {},
): Promise<OpenCodeServerProbe> => {
  const describeFailure = (
    body: Record<string, unknown> | null,
    response: Response,
  ): string => {
    if (typeof body?.error === 'string') return body.error;
    return response.statusText || (options.defaultError ?? 'OpenCode probe failed');
  };

  const info = await requestJson('/api/info', baseUrl, fetchImpl, options).catch(() => null);
  if (info && info.response.ok) {
    const version = normalizeVersion(info.body?.version);
    if (info.body && version) {
      return { version, mode: 'v2' };
    }
  }

  if (options.signal?.aborted) {
    return { version: null, mode: null, error: 'OpenCode probe aborted' };
  }

  try {
    const { response, body } = await requestJson('/global/health', baseUrl, fetchImpl, options);
    if (response.ok && body) {
      return {
        version: normalizeVersion(body.version),
        mode: 'v1',
        healthy: body.healthy === true,
      };
    }
    return { version: null, mode: null, error: describeFailure(body, response) };
  } catch (error) {
    return {
      version: null,
      mode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
