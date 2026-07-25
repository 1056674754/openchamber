import { resolveApiUrl } from '@/lib/api/serverUrl';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

/**
 * Session Goals support:
 * - Local (`default`): always supported (host runtime + host Small Model).
 * - Remote: only when that OpenChamber advertises GET /api/goals/capability
 *   (compatible Goals runtime). Bare OpenCode / old remotes fail closed.
 * Host never audits remote sessions — loop runs on the remote OpenChamber.
 */

export type SessionGoalSupportReason =
  | 'supported'
  | 'unsupported'
  | 'unreachable';

export type SessionGoalSupportResult = {
  supported: boolean;
  reason: SessionGoalSupportReason;
};

const PROBE_TTL_MS = 60_000;
const MIN_API_VERSION = 1;

type CacheEntry = SessionGoalSupportResult & { at: number };

const supportCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SessionGoalSupportResult>>();

export function resolveSessionGoalServerId(
  sessionId?: string | null,
  lookup: (id: string) => string | undefined = (id) => serverRegistry.getServerForSession(id),
): string {
  if (!sessionId) return DEFAULT_SERVER_ID;
  return lookup(sessionId) ?? DEFAULT_SERVER_ID;
}

export function resolveSessionGoalServerBaseUrl(serverId?: string | null): string | undefined {
  if (!serverId || serverId === DEFAULT_SERVER_ID) return undefined;
  const baseUrl = serverRegistry.get(serverId)?.config.baseUrl?.trim();
  return baseUrl || undefined;
}

const localSupported = (): SessionGoalSupportResult => ({
  supported: true,
  reason: 'supported',
});

const readFreshCache = (serverId: string): SessionGoalSupportResult | null => {
  const cached = supportCache.get(serverId);
  if (!cached) return null;
  if (Date.now() - cached.at > PROBE_TTL_MS) return null;
  return { supported: cached.supported, reason: cached.reason };
};

const writeCache = (serverId: string, result: SessionGoalSupportResult): SessionGoalSupportResult => {
  supportCache.set(serverId, { ...result, at: Date.now() });
  return result;
};

/**
 * Sync gate used by render paths. Local is always true. Remote uses the
 * latest probe cache; unknown/stale remotes are treated as unsupported until
 * `probeSessionGoalSupport` succeeds (fail closed — no UI unlock without runtime).
 */
export function isSessionGoalSupportedOnServer(serverId?: string | null): boolean {
  if (!serverId || serverId === DEFAULT_SERVER_ID) return true;
  const cached = supportCache.get(serverId);
  return cached?.supported === true;
}

export function isSessionGoalSupportedForSession(
  sessionId?: string | null,
  lookup?: (id: string) => string | undefined,
): boolean {
  return isSessionGoalSupportedOnServer(resolveSessionGoalServerId(sessionId, lookup));
}

async function fetchRemoteGoalsCapability(serverId: string): Promise<SessionGoalSupportResult> {
  const baseUrl = resolveSessionGoalServerBaseUrl(serverId);
  if (!baseUrl) {
    return writeCache(serverId, { supported: false, reason: 'unreachable' });
  }

  const url = resolveApiUrl('/api/goals/capability', baseUrl);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return writeCache(serverId, { supported: false, reason: 'unsupported' });
    }
    const body = await response.json().catch(() => null) as {
      goals?: unknown;
      apiVersion?: unknown;
    } | null;
    const apiVersion = typeof body?.apiVersion === 'number' && Number.isFinite(body.apiVersion)
      ? body.apiVersion
      : 0;
    const supported = body?.goals === true && apiVersion >= MIN_API_VERSION;
    return writeCache(serverId, {
      supported,
      reason: supported ? 'supported' : 'unsupported',
    });
  } catch {
    return writeCache(serverId, { supported: false, reason: 'unreachable' });
  }
}

/** Probe (or return fresh cache) whether Goals may run on this server. */
export async function probeSessionGoalSupport(
  serverId?: string | null,
): Promise<SessionGoalSupportResult> {
  if (!serverId || serverId === DEFAULT_SERVER_ID) {
    return localSupported();
  }

  const fresh = readFreshCache(serverId);
  if (fresh) return fresh;

  const existing = inFlight.get(serverId);
  if (existing) return existing;

  const pending = fetchRemoteGoalsCapability(serverId).finally(() => {
    inFlight.delete(serverId);
  });
  inFlight.set(serverId, pending);
  return pending;
}

export async function probeSessionGoalSupportForSession(
  sessionId?: string | null,
  lookup?: (id: string) => string | undefined,
): Promise<SessionGoalSupportResult> {
  return probeSessionGoalSupport(resolveSessionGoalServerId(sessionId, lookup));
}

/** Test helper — clear probe cache between cases. */
export function resetSessionGoalSupportCacheForTests(): void {
  supportCache.clear();
  inFlight.clear();
}

export type SessionGoalServerSupportState = SessionGoalSupportResult & {
  probing: boolean;
};
