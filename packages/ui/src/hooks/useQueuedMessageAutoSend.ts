import React from 'react';
import { useMessageQueueStore, type QueuedMessage } from '@/stores/messageQueueStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useContextStore } from '@/stores/contextStore';
import { useAllServersSessionStatuses } from '@/sync/multi-server-hooks';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';
import { buildQueuedAutoSendPayload } from './queuedMessageAutoSendPayload';
import {
  getQueuedAutoSendRetryDelayMs,
  isQueuedAutoSendBackedOff,
  shouldDispatchQueuedAutoSend,
  type QueuedAutoSendFailure,
  type QueuedAutoSendSessionStatus,
} from './queuedMessageAutoSendPolicy';

const RECENT_ABORT_WINDOW_MS = 2000;

export const createQueuedAutoSendRetryScheduler = (
  onWake: () => void,
  now: () => number = Date.now,
  scheduleTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancelTimeout: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledAt: number | null = null;

  return {
    schedule(retryAt: number) {
      if (scheduledAt !== null && scheduledAt <= retryAt) return;
      if (timer !== null) cancelTimeout(timer);
      scheduledAt = retryAt;
      timer = scheduleTimeout(() => {
        timer = null;
        scheduledAt = null;
        onWake();
      }, Math.max(0, retryAt - now()));
    },
    dispose() {
      if (timer !== null) cancelTimeout(timer);
      timer = null;
      scheduledAt = null;
    },
  };
};

const getAbortHoldUntil = (sessionId: string): number | null => {
  const abortRecord = useSessionUIStore.getState().sessionAbortFlags.get(sessionId);
  if (!abortRecord) {
    return null;
  }
  const holdUntil = abortRecord.timestamp + RECENT_ABORT_WINDOW_MS;
  return Date.now() < holdUntil ? holdUntil : null;
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

export function useQueuedMessageAutoSend(enabledOrOptions?: boolean | { enabled?: boolean }) {
  const enabled = typeof enabledOrOptions === 'boolean' ? enabledOrOptions : (enabledOrOptions?.enabled ?? true);
  const queuedMessages = useMessageQueueStore((state) => state.queuedMessages);
  const liveSessionStatuses = useAllServersSessionStatuses();
  const globalSessionStatuses = useGlobalSessionsStore((state) => state.sessionStatuses);
  const autoReviewRuns = useAutoReviewStore((state) => state.runsByOriginalSessionID);

  const inFlightSessionsRef = React.useRef<Set<string>>(new Set());
  const sendFailuresRef = React.useRef<Map<string, QueuedAutoSendFailure>>(new Map());
  const previousStatusRef = React.useRef<Map<string, QueuedAutoSendSessionStatus>>(new Map());
  const autoReviewBlockedSessionsRef = React.useRef<Set<string>>(new Set());
  const [retryTick, setRetryTick] = React.useState(0);
  const retryScheduler = React.useMemo(
    () => createQueuedAutoSendRetryScheduler(() => setRetryTick((value) => value + 1)),
    [],
  );

  React.useEffect(() => () => retryScheduler.dispose(), [retryScheduler]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const getKnownStatusType = (sessionId: string): QueuedAutoSendSessionStatus | undefined => {
      const globalStatus = globalSessionStatuses.get(sessionId)?.type as QueuedAutoSendSessionStatus | undefined;
      if (globalStatus) {
        return globalStatus;
      }
      return liveSessionStatuses[sessionId]?.type as QueuedAutoSendSessionStatus | undefined;
    };

    const dispatchSessionQueue = async (sessionId: string, queueSnapshot: QueuedMessage[]) => {
      if (queueSnapshot.length === 0) {
        return;
      }
      if (inFlightSessionsRef.current.has(sessionId)) {
        return;
      }
      const abortHoldUntil = getAbortHoldUntil(sessionId);
      if (abortHoldUntil !== null) {
        retryScheduler.schedule(abortHoldUntil);
        return;
      }
      if (useAutoReviewStore.getState().isRunningForSession(sessionId)) {
        autoReviewBlockedSessionsRef.current.add(sessionId);
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

      const failure = sendFailuresRef.current.get(sessionId);
      if (failure && failure.messageId !== payload.queuedMessageId) {
        sendFailuresRef.current.delete(sessionId);
      } else if (failure && isQueuedAutoSendBackedOff(failure, payload.queuedMessageId, Date.now())) {
        retryScheduler.schedule(failure.nextAttemptAt);
        return;
      }

      // Use send config captured at queue time; fall back to current config
      const captured = payload.sendConfig;
      const resolved = captured?.providerID && captured?.modelID
        ? captured
        : resolveSessionSendConfig(sessionId);
      if (!resolved.providerID || !resolved.modelID) {
        retryScheduler.schedule(Date.now() + getQueuedAutoSendRetryDelayMs(1));
        return;
      }

      const queuedMessage = queueSnapshot.find((message) => message.id === payload.queuedMessageId);
      if (!queuedMessage) {
        return;
      }

      inFlightSessionsRef.current.add(sessionId);

      try {
        useMessageQueueStore.getState().removeFromQueue(sessionId, payload.queuedMessageId);

        // Route local slash commands (e.g. /compact, /undo, /redo) through their
        // dedicated handlers instead of the generic sendMessage path, which would
        // either send them as raw prompts to the LLM or fail to resolve them.
        const wasLocalCommand = await useSessionUIStore.getState().tryDispatchLocalSlashCommand(
          payload.primaryText,
          sessionId,
        );
        if (wasLocalCommand) {
          sendFailuresRef.current.delete(sessionId);
          return;
        }

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
        sendFailuresRef.current.delete(sessionId);
      } catch (error) {
        const sendError = error instanceof Error ? error : new Error(String(error));
        useMessageQueueStore.getState().restoreMessages(sessionId, [queuedMessage]);
        const priorFailures = failure?.messageId === payload.queuedMessageId ? failure.failures : 0;
        const failures = priorFailures + 1;
        const nextAttemptAt = Date.now() + getQueuedAutoSendRetryDelayMs(failures);
        sendFailuresRef.current.set(sessionId, {
          messageId: payload.queuedMessageId,
          failures,
          nextAttemptAt,
        });
        retryScheduler.schedule(nextAttemptAt);
        console.warn('[queue] queued auto-send failed:', sendError);
      } finally {
        inFlightSessionsRef.current.delete(sessionId);
      }
    };

    const nextStatusMap = new Map(previousStatusRef.current);
    for (const [sessionId, status] of Object.entries(liveSessionStatuses)) {
      if (status) {
        nextStatusMap.set(sessionId, status.type as QueuedAutoSendSessionStatus);
      }
    }
    for (const [sessionId, status] of globalSessionStatuses) {
      nextStatusMap.set(sessionId, status.type as QueuedAutoSendSessionStatus);
    }

    const queueEntries = Object.entries(queuedMessages);
    queueEntries.forEach(([sessionId, queue]) => {
      const currentStatusType = getKnownStatusType(sessionId);
      if (!currentStatusType) {
        return;
      }
      const previousStatusType = previousStatusRef.current.get(sessionId);
      const wasAutoReviewBlocked = autoReviewBlockedSessionsRef.current.has(sessionId);
      const isAutoReviewRunning = useAutoReviewStore.getState().isRunningForSession(sessionId);
      if (isAutoReviewRunning) {
        autoReviewBlockedSessionsRef.current.add(sessionId);
      } else if (wasAutoReviewBlocked) {
        autoReviewBlockedSessionsRef.current.delete(sessionId);
      }

      if (
        queue.length > 0
        && !isAutoReviewRunning
        && shouldDispatchQueuedAutoSend(previousStatusType, currentStatusType, true)
      ) {
        void dispatchSessionQueue(sessionId, queue);
      }

      nextStatusMap.set(sessionId, currentStatusType);
    });

    previousStatusRef.current = nextStatusMap;
  }, [enabled, queuedMessages, liveSessionStatuses, globalSessionStatuses, autoReviewRuns, retryTick, retryScheduler]);
}
