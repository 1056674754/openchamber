import React from 'react';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { getSessionGoal, type SessionGoalStatus } from '@/lib/sessionGoalMetadata';
import { detectRemoteGoalSettleTransition } from '@/lib/remoteSessionGoalSettle';
import { useUIStore } from '@/stores/useUIStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';

/**
 * Local host runtime emits settle notifications itself. Remote OpenChamber
 * loops settle on the remote machine — fan-in only updates session metadata
 * here. Toast once when a remote goal leaves active/paused for a settle status.
 */
export const RemoteSessionGoalSettleToast: React.FC = () => {
  const { t } = useI18n();
  const notifyOnCompletion = useUIStore((state) => state.notifyOnCompletion);
  const activeSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const previousStatusRef = React.useRef(new Map<string, SessionGoalStatus | null>());

  React.useEffect(() => {
    if (!notifyOnCompletion) return;

    for (const session of activeSessions) {
      const serverId = serverRegistry.getServerForSession(session.id) ?? DEFAULT_SERVER_ID;
      if (serverId === DEFAULT_SERVER_ID) {
        previousStatusRef.current.delete(session.id);
        continue;
      }

      const goal = getSessionGoal(session);
      const nextStatus = goal?.status ?? null;
      const previous = previousStatusRef.current.get(session.id);
      const settleKind = detectRemoteGoalSettleTransition(previous, nextStatus);
      if (settleKind) {
        const title = settleKind === 'complete'
          ? t('chat.goal.toast.settledComplete')
          : (settleKind === 'budgetLimited'
            ? t('chat.goal.toast.settledBudget')
            : t('chat.goal.toast.settledBlocked'));
        const detail = goal?.statusReason && goal.statusReason !== 'verified by audit' && goal.statusReason !== 'reported by agent'
          ? goal.statusReason
          : (goal?.note || '');
        toast.info(detail ? `${title}: ${detail}` : title);
      }
      previousStatusRef.current.set(session.id, nextStatus);
    }
  }, [activeSessions, notifyOnCompletion, t]);

  return null;
};
