import { resolveApiUrl } from '@/lib/api/serverUrl';
import { runtimeFetch } from '@/lib/runtime-fetch';

export type PendingRestartSession = {
  readonly sessionId: string;
  readonly status: 'busy' | 'retry';
};

export type PendingRestartChange = {
  readonly id: number;
  readonly reason: string;
  readonly recordedAt: number;
  readonly scope?: string;
  readonly entityId?: string;
};

export type PendingRestartSnapshot = {
  readonly count: number;
  readonly reasons: readonly string[];
  readonly changes: readonly PendingRestartChange[];
  readonly affectedSessions: readonly PendingRestartSession[];
  readonly isApplying: boolean;
};

export type ApplyPendingRestartResult = {
  readonly success: boolean;
  readonly appliedCount: number;
  readonly pending: PendingRestartSnapshot;
  readonly requiresReload: boolean;
  readonly requiresManualRestart: boolean;
  readonly reloadDelayMs?: number;
};

export const EMPTY_PENDING_RESTART: PendingRestartSnapshot = {
  count: 0,
  reasons: [],
  changes: [],
  affectedSessions: [],
  isApplying: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export function parsePendingRestartSnapshot(value: unknown): PendingRestartSnapshot | null {
  if (!isRecord(value) || typeof value.count !== 'number' || !Array.isArray(value.reasons)) {
    return null;
  }

  const reasons = value.reasons.filter((reason): reason is string => typeof reason === 'string');
  const changes = Array.isArray(value.changes)
    ? value.changes.flatMap((entry): PendingRestartChange[] => {
      if (!isRecord(entry) || typeof entry.id !== 'number') return [];
      if (typeof entry.reason !== 'string' || typeof entry.recordedAt !== 'number') return [];
      return [{
        id: entry.id,
        reason: entry.reason,
        recordedAt: entry.recordedAt,
        ...(typeof entry.scope === 'string' ? { scope: entry.scope } : {}),
        ...(typeof entry.entityId === 'string' ? { entityId: entry.entityId } : {}),
      }];
    })
    : [];
  const affectedSessions = Array.isArray(value.affectedSessions)
    ? value.affectedSessions.flatMap((entry): PendingRestartSession[] => {
      if (!isRecord(entry) || typeof entry.sessionId !== 'string') return [];
      if (entry.status !== 'busy' && entry.status !== 'retry') return [];
      return [{ sessionId: entry.sessionId, status: entry.status }];
    })
    : [];

  return {
    count: Math.max(0, Math.floor(value.count)),
    reasons,
    changes,
    affectedSessions,
    isApplying: value.isApplying === true,
  };
}

const readJson = async (response: Response): Promise<unknown> => response.json().catch(() => null);

export async function fetchPendingRestart(baseUrl: string): Promise<PendingRestartSnapshot> {
  const response = await runtimeFetch(resolveApiUrl('/api/opencode/restart/pending', baseUrl));
  const payload = await readJson(response);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Failed to load pending OpenCode restart state';
    throw new Error(message);
  }
  const snapshot = parsePendingRestartSnapshot(payload);
  if (!snapshot) throw new Error('Invalid pending OpenCode restart response');
  return snapshot;
}

export async function applyPendingRestart(baseUrl: string): Promise<ApplyPendingRestartResult> {
  const response = await runtimeFetch(resolveApiUrl('/api/opencode/restart/apply', baseUrl), {
    method: 'POST',
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Failed to apply pending OpenCode restart';
    throw new Error(message);
  }
  if (!isRecord(payload)) throw new Error('Invalid Apply & Restart response');
  const pending = parsePendingRestartSnapshot(payload.pending);
  if (!pending || typeof payload.appliedCount !== 'number') {
    throw new Error('Invalid Apply & Restart response');
  }
  return {
    success: payload.success === true,
    appliedCount: payload.appliedCount,
    pending,
    requiresReload: payload.requiresReload === true,
    requiresManualRestart: payload.requiresManualRestart === true,
    ...(typeof payload.reloadDelayMs === 'number' ? { reloadDelayMs: payload.reloadDelayMs } : {}),
  };
}
