import type { SessionGoalStatus } from '@/lib/sessionGoalMetadata';

const ACTIVE_LIKE: ReadonlySet<SessionGoalStatus> = new Set(['active', 'paused']);
const SETTLED: ReadonlySet<SessionGoalStatus> = new Set(['complete', 'blocked', 'budgetLimited']);

export type RemoteGoalSettleKind = 'complete' | 'budgetLimited' | 'blocked';

/**
 * Detect a settle transition for remote Goals UI toast.
 * Local host runtime already emits desktop/UI notify; remotes only update metadata.
 */
export function detectRemoteGoalSettleTransition(
  previous: SessionGoalStatus | null | undefined,
  next: SessionGoalStatus | null | undefined,
): RemoteGoalSettleKind | null {
  if (!previous || !next) return null;
  if (!ACTIVE_LIKE.has(previous)) return null;
  if (!SETTLED.has(next)) return null;
  if (next === 'complete') return 'complete';
  if (next === 'budgetLimited') return 'budgetLimited';
  return 'blocked';
}
