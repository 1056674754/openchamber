import { useEffect, useState } from 'react';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import {
  probeSessionGoalSupport,
  type SessionGoalServerSupportState,
  type SessionGoalSupportResult,
} from '@/lib/sessionGoalLocal';

const localSupported = (): SessionGoalSupportResult => ({
  supported: true,
  reason: 'supported',
});

/**
 * Keeps remote Goals capability cache warm for UI gates.
 * Local servers report supported immediately without a network round-trip.
 */
export function useSessionGoalServerSupport(
  serverId?: string | null,
): SessionGoalServerSupportState {
  const normalized = !serverId || serverId === DEFAULT_SERVER_ID
    ? DEFAULT_SERVER_ID
    : serverId;

  const [state, setState] = useState<SessionGoalServerSupportState>(() => {
    if (normalized === DEFAULT_SERVER_ID) {
      return { ...localSupported(), probing: false };
    }
    return { supported: false, reason: 'unsupported', probing: true };
  });

  useEffect(() => {
    if (normalized === DEFAULT_SERVER_ID) {
      setState({ ...localSupported(), probing: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, probing: true }));
    void probeSessionGoalSupport(normalized).then((result) => {
      if (cancelled) return;
      setState({ ...result, probing: false });
    });

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return state;
}
