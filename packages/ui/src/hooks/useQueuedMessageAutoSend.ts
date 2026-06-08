import React from 'react';
import { useMessageQueueStore, type QueuedMessage } from '@/stores/messageQueueStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useContextStore } from '@/stores/contextStore';
import { useAllServersSessionStatuses } from '@/sync/multi-server-hooks';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { buildQueuedAutoSendPayload } from './queuedMessageAutoSendPayload';

type SessionStatusType = 'idle' | 'busy' | 'retry';

const RECENT_ABORT_WINDOW_MS = 2000;

const hasRecentAbort = (sessionId: string): boolean => {
  const abortRecord = useSessionUIStore.getState().sessionAbortFlags.get(sessionId);
  if (!abortRecord) {
    return false;
  }
  return Date.now() - abortRecord.timestamp < RECENT_ABORT_WINDOW_MS;
};

const resolveSessionSendConfig = (sessionId: string) => {
  const context = useContextStore.getState();
  const config = useConfigStore.getState();
  const selection = useSelectionStore.getState();

  const selectedAgent =
    context.getSessionAgentSelection(sessionId)
    ?? context.getCurrentAgent(sessionId)
    ?? config.currentAgentName
    ?? undefined;

  const sessionModel = context.getSessionModelSelection(sessionId);
  const agentModel = selectedAgent
    ? context.getAgentModelForSession(sessionId, selectedAgent)
    : null;

  const providerID =
    agentModel?.providerId
    ?? sessionModel?.providerId
    ?? config.currentProviderId
    ?? selection.lastUsedProvider?.providerID;
  const modelID =
    agentModel?.modelId
    ?? sessionModel?.modelId
    ?? config.currentModelId
    ?? selection.lastUsedProvider?.modelID;

  const variant =
    selectedAgent && providerID && modelID
      ? (selection.getAgentModelVariantForSession(sessionId, selectedAgent, providerID, modelID)
        ?? context.getAgentModelVariantForSession(sessionId, selectedAgent, providerID, modelID))
      : undefined;

  return {
    providerID,
    modelID,
    agent: selectedAgent,
    variant,
  };
};

export const shouldDispatchQueuedAutoSend = (
  previousStatusType: SessionStatusType | undefined,
  currentStatusType: SessionStatusType,
): boolean => {
  return (previousStatusType === 'busy' || previousStatusType === 'retry')
    && currentStatusType === 'idle';
};

export function useQueuedMessageAutoSend(enabledOrOptions?: boolean | { enabled?: boolean }) {
  const enabled = typeof enabledOrOptions === 'boolean' ? enabledOrOptions : (enabledOrOptions?.enabled ?? true);
  const queuedMessages = useMessageQueueStore((state) => state.queuedMessages);
  const liveSessionStatuses = useAllServersSessionStatuses();
  const globalSessionStatuses = useGlobalSessionsStore((state) => state.sessionStatuses);

  const inFlightSessionsRef = React.useRef<Set<string>>(new Set());
  const previousStatusRef = React.useRef<Map<string, SessionStatusType>>(new Map());

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const getKnownStatusType = (sessionId: string): SessionStatusType | undefined => {
      const globalStatus = globalSessionStatuses.get(sessionId)?.type as SessionStatusType | undefined;
      if (globalStatus) {
        return globalStatus;
      }
      return liveSessionStatuses[sessionId]?.type as SessionStatusType | undefined;
    };

    const dispatchSessionQueue = async (sessionId: string, queueSnapshot: QueuedMessage[]) => {
      if (queueSnapshot.length === 0) {
        return;
      }
      if (inFlightSessionsRef.current.has(sessionId)) {
        return;
      }
      if (hasRecentAbort(sessionId)) {
        return;
      }

      const currentStatus = getKnownStatusType(sessionId);
      if (currentStatus !== 'idle') {
        return;
      }

      const payload = buildQueuedAutoSendPayload(queueSnapshot, useConfigStore.getState().getVisibleAgents());
      if (!payload) {
        return;
      }
      if (!payload.primaryText && payload.primaryAttachments.length === 0) {
        return;
      }

      // Use send config captured at queue time; fall back to current config
      const captured = payload.sendConfig;
      const resolved = captured?.providerID && captured?.modelID
        ? captured
        : resolveSessionSendConfig(sessionId);
      if (!resolved.providerID || !resolved.modelID) {
        return;
      }

      const queuedMessage = queueSnapshot.find((message) => message.id === payload.queuedMessageId);
      if (!queuedMessage) {
        return;
      }

      inFlightSessionsRef.current.add(sessionId);

      try {
        useMessageQueueStore.getState().removeFromQueue(sessionId, payload.queuedMessageId);

        await useSessionUIStore.getState().sendMessage(
          payload.primaryText,
          resolved.providerID,
          resolved.modelID,
          resolved.agent,
          payload.primaryAttachments,
          payload.agentMentionName,
          undefined,
          resolved.variant,
          'normal',
          {
            sessionId,
            directory: payload.sendTarget?.directory,
            serverId: payload.sendTarget?.serverId,
          }
        );
      } catch (error) {
        useMessageQueueStore.getState().restoreMessages(sessionId, [queuedMessage]);
        console.warn('[queue] queued auto-send failed:', error);
      } finally {
        inFlightSessionsRef.current.delete(sessionId);
      }
    };

    const nextStatusMap = new Map(previousStatusRef.current);
    for (const [sessionId, status] of Object.entries(liveSessionStatuses)) {
      if (status) {
        nextStatusMap.set(sessionId, status.type as SessionStatusType);
      }
    }
    for (const [sessionId, status] of globalSessionStatuses) {
      nextStatusMap.set(sessionId, status.type as SessionStatusType);
    }

    const queueEntries = Object.entries(queuedMessages);
    queueEntries.forEach(([sessionId, queue]) => {
      const currentStatusType = getKnownStatusType(sessionId);
      if (!currentStatusType) {
        return;
      }
      const previousStatusType = previousStatusRef.current.get(sessionId);

      if (queue.length > 0 && shouldDispatchQueuedAutoSend(previousStatusType, currentStatusType)) {
        void dispatchSessionQueue(sessionId, queue);
      }

      nextStatusMap.set(sessionId, currentStatusType);
    });

    previousStatusRef.current = nextStatusMap;
  }, [enabled, queuedMessages, liveSessionStatuses, globalSessionStatuses]);
}
