import type { Message } from '@opencode-ai/sdk/v2/client';
import type { Session as LegacySession } from '@opencode-ai/sdk/v2/client';
import type { Metadata, Session } from '@/lib/opencode/model';
import type { ReviewMetadataSession } from '@/lib/sessionReviewMetadata';
import { opencodeClient } from '@/lib/opencode/client';
import { renderMagicPrompt } from '@/lib/magicPrompts';
import { flattenAssistantTextParts } from '@/lib/messages/messageText';
import {
  getOriginalSessionID,
  getReviewSessionID,
  getSessionMetadata,
  isReviewSession,
  withoutReviewSessionLink,
  withReviewSessionLink,
  withReviewSessionMarker,
} from '@/lib/sessionReviewMetadata';
import { useConfigStore } from '@/stores/useConfigStore';
import { useAutoReviewStore, type AutoReviewRun } from '@/stores/useAutoReviewStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { optimisticSend, patchSessionMetadata, waitForConnectionOrThrow } from '@/sync/session-actions';
import { useSelectionStore } from '@/sync/selection-store';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getSyncMessages, getSyncParts, getSyncSessionStatus, registerSessionDirectory } from '@/sync/sync-refs';
import { markPendingUserSendAnimation } from '@/lib/userSendAnimation';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import {
  AUTO_REVIEW_FINAL_MARKER,
  assertAutoReviewServerStillCurrent,
  claimAutoReviewForward,
  hasFinalReviewMarker,
  isAutoReviewServerCurrent,
  isExpectedAutoReviewAssistantParent,
  releaseAutoReviewForward,
  stripFinalReviewMarker,
} from '@/lib/reviewFlowAutoReview';

export {
  assertAutoReviewServerStillCurrent,
  claimAutoReviewForward,
  hasFinalReviewMarker,
  isAutoReviewServerCurrent,
  isExpectedAutoReviewAssistantParent,
  releaseAutoReviewForward,
  stripFinalReviewMarker,
} from '@/lib/reviewFlowAutoReview';

const HANDOFF_TIMEOUT_MS = 180_000;
const HANDOFF_POLL_MS = 400;
const AUTO_REVIEW_POLL_MS = 300;
const AUTO_REVIEW_MAX_ITERATIONS = 15;
const activeAutoReviewLoops = new Set<string>();

type SessionModelContext = {
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
};

type StartReviewFlowInput = SessionModelContext & {
  originalSessionID: string;
  directory: string;
  serverId?: string | null;
  agentMentionName?: string;
  generateHandoff?: boolean;
  returnAfterHandoffRequest?: boolean;
  autoReview?: boolean;
};

type AssistantTextMessage = {
  id: string;
  text: string;
};

const isMessageCompleted = (message: Message): boolean => {
  const finish = (message as { finish?: unknown }).finish;
  if (typeof finish === 'string' && finish.length > 0) return true;
  const completed = (message as { time?: { completed?: unknown } }).time?.completed;
  return typeof completed === 'number' && completed > 0;
};

const getMessageCreatedAt = (message: Message): number => {
  const created = (message as { time?: { created?: unknown } }).time?.created;
  return typeof created === 'number' && Number.isFinite(created) ? created : 0;
};

const getMessageRole = (message: Message): string => {
  const role = (message as { role?: unknown }).role;
  return typeof role === 'string' ? role : '';
};

const getMessageParentID = (message: Message): string | null => {
  const parentID = (message as { parentID?: unknown }).parentID;
  return typeof parentID === 'string' && parentID.trim().length > 0 ? parentID : null;
};

const isCompactionCommandMessage = (message: Message, directory: string): boolean => {
  const parts = getSyncParts(message.id, directory);
  return parts.some((part) => {
    const type = (part as { type?: unknown }).type;
    if (type === 'compaction') return true;
    if (type !== 'text') return false;
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' && text.trim() === '/compact';
  });
};

const stopRunForServerMismatch = (run: AutoReviewRun): void => {
  useAutoReviewStore.getState().updateRun(run.originalSessionID, (current) => ({
    ...current,
    status: 'stopped',
    error: 'Auto-review stopped because the server became unavailable.',
  }));
};

const isServerChangeError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('server became unavailable');
};

const getLatestAssistantTextMessage = (
  sessionID: string,
  directory: string,
  lastForwardedMessageID?: string,
  afterCreatedAt = 0,
  expectedParentID?: string,
): AssistantTextMessage | null => {
  const messages = getSyncMessages(sessionID, directory);
  const compactionCommandIDs = new Set<string>();
  for (const message of messages) {
    if (isCompactionCommandMessage(message, directory)) {
      compactionCommandIDs.add(message.id);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.id === lastForwardedMessageID) return null;
    if (getMessageRole(message) !== 'assistant') continue;
    if (!isMessageCompleted(message)) continue;
    if (getMessageCreatedAt(message) < afterCreatedAt - 1000) continue;
    const parentID = getMessageParentID(message);
    if (!isExpectedAutoReviewAssistantParent(message, expectedParentID)) continue;
    if (parentID && compactionCommandIDs.has(parentID)) continue;
    const text = flattenAssistantTextParts(getSyncParts(message.id, directory)).trim();
    if (!text) continue;
    return { id: message.id, text };
  }

  return null;
};

const isSessionIdle = (sessionID: string, directory: string): boolean => {
  const status = getSyncSessionStatus(sessionID, directory);
  if (status?.type === 'idle') return true;
  const globalStatus = useGlobalSessionsStore.getState().sessionStatuses.get(sessionID);
  return globalStatus?.type === 'idle' || globalStatus === undefined;
};

const autoReviewReviewerInstructions = (): Array<{ text: string; synthetic: true }> => [{
  synthetic: true,
  text: `This review is part of an automatic review loop. If there are no remaining issues, end your response with this exact final line:\n${AUTO_REVIEW_FINAL_MARKER}\nIf you found issues that require changes, do not include that final status line.`,
}];

const resolveServerId = (sessionID: string, explicit?: string | null): string => (
  explicit
  ?? serverRegistry.getServerForSession(sessionID)
  ?? DEFAULT_SERVER_ID
);

const runAutoReviewLoop = async (originalSessionID: string): Promise<void> => {
  while (true) {
    const run = useAutoReviewStore.getState().runsByOriginalSessionID[originalSessionID];
    if (!run || run.status !== 'running') return;
    if (!isAutoReviewServerCurrent(run.serverId)) {
      stopRunForServerMismatch(run);
      return;
    }

    const sourceSessionID = run.phase === 'waiting_for_reviewer' ? run.reviewSessionID : run.originalSessionID;
    if (!isSessionIdle(sourceSessionID, run.directory)) {
      await new Promise((resolve) => setTimeout(resolve, AUTO_REVIEW_POLL_MS));
      continue;
    }

    const latest = getLatestAssistantTextMessage(
      sourceSessionID,
      run.directory,
      run.lastForwardedMessageID,
      run.waitAfterCreatedAt,
      run.expectedAssistantParentID,
    );
    if (!latest) {
      await new Promise((resolve) => setTimeout(resolve, AUTO_REVIEW_POLL_MS));
      continue;
    }

    if (run.phase === 'waiting_for_reviewer') {
      const forwardKey = claimAutoReviewForward(run, latest.id);
      if (!forwardKey) {
        await new Promise((resolve) => setTimeout(resolve, AUTO_REVIEW_POLL_MS));
        continue;
      }
      if (!isAutoReviewServerCurrent(run.serverId)) {
        releaseAutoReviewForward(forwardKey);
        stopRunForServerMismatch(run);
        return;
      }
      try {
        const waitAfterCreatedAt = Date.now();
        const isFinalReview = hasFinalReviewMarker(latest.text);
        const reviewFeedback = isFinalReview ? stripFinalReviewMarker(latest.text) : latest.text;
        const sentMessageID = await sendReviewFeedbackToOriginal(
          run.reviewSessionID,
          run.directory,
          reviewFeedback,
          run.serverId,
        );
        if (isFinalReview) {
          useAutoReviewStore.getState().completeRun(run.originalSessionID);
          return;
        }
        useAutoReviewStore.getState().updateRun(run.originalSessionID, (current) => ({
          ...current,
          phase: 'waiting_for_implementer',
          lastForwardedMessageID: latest.id,
          expectedAssistantParentID: sentMessageID,
          waitAfterCreatedAt,
        }));
      } finally {
        releaseAutoReviewForward(forwardKey);
      }
    } else {
      if (run.iteration >= run.maxIterations) {
        useAutoReviewStore.getState().stopRun(run.originalSessionID);
        return;
      }
      const forwardKey = claimAutoReviewForward(run, latest.id);
      if (!forwardKey) {
        await new Promise((resolve) => setTimeout(resolve, AUTO_REVIEW_POLL_MS));
        continue;
      }
      if (!isAutoReviewServerCurrent(run.serverId)) {
        releaseAutoReviewForward(forwardKey);
        stopRunForServerMismatch(run);
        return;
      }
      try {
        const waitAfterCreatedAt = Date.now();
        const sentMessageID = await sendImplementationResponseToReviewer(
          run.originalSessionID,
          run.directory,
          latest.text,
          true,
          run.serverId,
        );
        useAutoReviewStore.getState().updateRun(run.originalSessionID, (current) => ({
          ...current,
          phase: 'waiting_for_reviewer',
          iteration: current.iteration + 1,
          lastForwardedMessageID: latest.id,
          expectedAssistantParentID: sentMessageID,
          waitAfterCreatedAt,
        }));
      } finally {
        releaseAutoReviewForward(forwardKey);
      }
    }
  }
};

const startAutoReviewRun = (run: AutoReviewRun): void => {
  useAutoReviewStore.getState().upsertRun(run);
  resumeAutoReviewRun(run.originalSessionID);
};

export const resumeAutoReviewRun = (originalSessionID: string): void => {
  const run = useAutoReviewStore.getState().runsByOriginalSessionID[originalSessionID];
  if (
    !run
    || run.status !== 'running'
    || !isAutoReviewServerCurrent(run.serverId)
    || activeAutoReviewLoops.has(originalSessionID)
  ) {
    return;
  }
  activeAutoReviewLoops.add(originalSessionID);
  void runAutoReviewLoop(run.originalSessionID).catch((error) => {
    console.error('[review-flow] auto-review loop failed', error);
    useAutoReviewStore.getState().updateRun(run.originalSessionID, (current) => ({
      ...current,
      status: isServerChangeError(error) ? 'stopped' : 'error',
      error: error instanceof Error ? error.message : String(error),
    }));
  }).finally(() => {
    activeAutoReviewLoops.delete(originalSessionID);
  });
};

export const resumeAllAutoReviewRuns = (): void => {
  const runs = Object.values(useAutoReviewStore.getState().runsByOriginalSessionID);
  for (const run of runs) {
    if (run.status === 'running' && isAutoReviewServerCurrent(run.serverId)) {
      resumeAutoReviewRun(run.originalSessionID);
    }
  }
};

export const isAutoReviewRunningForSession = (sessionID: string): boolean => (
  useAutoReviewStore.getState().isRunningForSession(sessionID)
);

const waitForAssistantText = async (sessionID: string, directory: string, afterCreatedAt: number): Promise<string> => {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
  const extractText = (): string | null => {
    const messages = getSyncMessages(sessionID, directory);
    const candidates = messages
      .filter((message) => getMessageRole(message) === 'assistant')
      .filter((message) => getMessageCreatedAt(message) >= afterCreatedAt - 1000)
      .sort((left, right) => getMessageCreatedAt(right) - getMessageCreatedAt(left));
    for (const message of candidates) {
      const text = flattenAssistantTextParts(getSyncParts(message.id, directory)).trim();
      if (text) return text;
    }
    return null;
  };
  let sawBusy = false;
  while (Date.now() < deadline) {
    const status = useGlobalSessionsStore.getState().sessionStatuses.get(sessionID);
    const isBusy = status?.type === 'busy' || status?.type === 'retry';
    if (isBusy) sawBusy = true;

    if (sawBusy && !isBusy) {
      const text = extractText();
      if (text) {
        return text;
      }
    }

    {
      const messages = getSyncMessages(sessionID, directory);
      const completed = messages
        .filter((message) => getMessageRole(message) === 'assistant')
        .filter((message) => getMessageCreatedAt(message) >= afterCreatedAt - 1000)
        .filter(isMessageCompleted)
        .sort((left, right) => getMessageCreatedAt(right) - getMessageCreatedAt(left));

      for (const message of completed) {
        const text = flattenAssistantTextParts(getSyncParts(message.id, directory)).trim();
        if (text) return text;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, HANDOFF_POLL_MS));
  }
  throw new Error('Timed out waiting for handoff response');
};

const resolveModelContext = (sessionID: string): SessionModelContext | null => {
  const selection = useSelectionStore.getState();
  const config = useConfigStore.getState();
  const lastChoice = useSessionUIStore.getState().getLastUserChoice(sessionID);
  const agent = lastChoice?.agent || selection.getSessionAgentSelection(sessionID) || config.currentAgentName || undefined;
  const sessionModel = selection.getSessionModelSelection(sessionID);
  const agentModel = agent ? selection.getAgentModelForSession(sessionID, agent) : null;
  const lastChoiceModel = lastChoice?.providerID && lastChoice.modelID
    ? { providerId: lastChoice.providerID, modelId: lastChoice.modelID }
    : null;
  const selectedModel = lastChoiceModel || agentModel || sessionModel || (config.currentProviderId && config.currentModelId
    ? { providerId: config.currentProviderId, modelId: config.currentModelId }
    : null);
  if (!selectedModel?.providerId || !selectedModel?.modelId) return null;
  if (lastChoiceModel) {
    return {
      providerID: lastChoiceModel.providerId,
      modelID: lastChoiceModel.modelId,
      agent,
      variant: lastChoice?.variant,
    };
  }
  const selectionVariant = agent
    ? selection.getAgentModelVariantForSession(sessionID, agent, selectedModel.providerId, selectedModel.modelId)
    : undefined;
  const configVariant = config.currentProviderId === selectedModel.providerId && config.currentModelId === selectedModel.modelId
    ? config.currentVariant
    : undefined;
  return {
    providerID: selectedModel.providerId,
    modelID: selectedModel.modelId,
    agent,
    variant: selectionVariant || configVariant || undefined,
  };
};

const requestChatForceScrollBottom = (sessionId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('openchamber:chat-force-scroll-bottom', {
    detail: { sessionId },
  }));
};

const sendPlainMessage = async (
  sessionID: string,
  directory: string,
  text: string,
  modelContext?: SessionModelContext | null,
  additionalParts?: Array<{ text: string; synthetic?: boolean }>,
  serverId?: string | null,
): Promise<string> => {
  assertAutoReviewServerStillCurrent(serverId ?? undefined);
  const resolved = modelContext ?? resolveModelContext(sessionID);
  if (!resolved) throw new Error('Select a model before sending review flow messages');
  const selection = useSelectionStore.getState();
  selection.saveSessionModelSelection(sessionID, resolved.providerID, resolved.modelID);
  if (resolved.agent) {
    selection.saveSessionAgentSelection(sessionID, resolved.agent);
    selection.saveAgentModelForSession(sessionID, resolved.agent, resolved.providerID, resolved.modelID);
    selection.saveAgentModelVariantForSession(sessionID, resolved.agent, resolved.providerID, resolved.modelID, resolved.variant);
  }
  markPendingUserSendAnimation(sessionID);
  let sentMessageID: string | null = null;
  await optimisticSend({
    sessionId: sessionID,
    content: text,
    directory,
    serverId: serverId ?? undefined,
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    agent: resolved.agent,
    send: (messageID) => {
      assertAutoReviewServerStillCurrent(serverId ?? undefined);
      sentMessageID = messageID;
      return opencodeClient.sendMessage({
        id: sessionID,
        directory,
        providerID: resolved.providerID,
        modelID: resolved.modelID,
        agent: resolved.agent,
        variant: resolved.variant,
        text,
        additionalParts,
        messageId: messageID,
        serverId: serverId ?? undefined,
      }).then(() => undefined);
    },
  });
  requestChatForceScrollBottom(sessionID);
  if (!sentMessageID) throw new Error('Failed to prepare review flow message');
  return sentMessageID;
};

// [OPENCHAMBER-FORK] Side panel's useEffectiveDirectory may return the wrong
// path in worktree scenarios. Navigate directly until that is fixed.
const openReviewSessionPanel = (directory: string, session: Session, serverId?: string | null): void => {
  useSessionUIStore.getState().setCurrentSession(session.id, directory, { serverId: serverId ?? undefined });
};

const getSessionOrNull = async (sessionID: string, directory: string): Promise<Session | null> => {
  try {
    return await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(sessionID));
  } catch {
    return null;
  }
};

const getReviewSessionTitle = (original: Session): string => {
  const implementationTitle = original.title?.trim() || original.id;
  return `Review: ${implementationTitle}`;
};

const createOrReuseReviewSession = async (
  originalSessionID: string,
  directory: string,
  expectedServerId?: string,
): Promise<Session> => {
  assertAutoReviewServerStillCurrent(expectedServerId);
  const original = await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(originalSessionID));
  const existingReviewID = getReviewSessionID(original);
  if (existingReviewID) {
    const existing = await getSessionOrNull(existingReviewID, directory);
    if (existing && isReviewSession(existing)) return existing;
    await patchSessionMetadata(originalSessionID, directory, (metadata) => {
      const next = { ...metadata };
      const openchamber = next.openchamber;
      if (openchamber && typeof openchamber === 'object' && !Array.isArray(openchamber)) {
        const rest = { ...(openchamber as Record<string, unknown>) };
        delete rest.reviewSessionID;
        next.openchamber = rest;
      }
      return next;
    });
  }

  assertAutoReviewServerStillCurrent(expectedServerId);
  const review = await opencodeClient.withDirectory(directory, () =>
    opencodeClient.createSession({
      title: getReviewSessionTitle(original),
      // The v2 metadata wire is JSON; the marker helper's record shape is the
      // same JSON the server stores.
      metadata: withReviewSessionMarker({}, originalSessionID) as unknown as Metadata,
    }),
  );
  registerSessionDirectory(review.id, directory);
  if (expectedServerId) {
    serverRegistry.indexSession(review.id, expectedServerId);
  }
  try {
    await patchSessionMetadata(originalSessionID, directory, (metadata) => withReviewSessionLink(metadata, review.id));
  } catch (error) {
    await opencodeClient.withDirectory(directory, () => opencodeClient.deleteSession(review.id)).catch((deleteError) => {
      console.warn('[review-flow] failed to delete unlinked review session after link failure', deleteError);
    });
    throw error;
  }
  // The global store still types records with the legacy wire Session (R2
  // 残留: sync-bridge batch retypes them); the review flow reads only shared fields.
  useGlobalSessionsStore.getState().upsertSession(review as unknown as LegacySession);
  return review;
};

export const startReviewFlow = async (input: StartReviewFlowInput): Promise<void> => {
  await waitForConnectionOrThrow();
  const serverId = resolveServerId(input.originalSessionID, input.serverId);
  const expectedAutoReviewServerId = input.autoReview ? serverId : undefined;
  let reviewPrompt: string;

  if (input.generateHandoff ?? true) {
    const visibleText = await renderMagicPrompt('session.reviewHandoff.visible');
    const instructionsText = await renderMagicPrompt('session.reviewHandoff.instructions');
    const startedAt = Date.now();
    await sendPlainMessage(input.originalSessionID, input.directory, visibleText, null, [
      { text: instructionsText, synthetic: true },
    ], serverId);

    const continueFromHandoff = async (): Promise<void> => {
      const handoff = await waitForAssistantText(input.originalSessionID, input.directory, startedAt);
      assertAutoReviewServerStillCurrent(expectedAutoReviewServerId);
      const handoffReviewPrompt = await renderMagicPrompt('session.reviewSession.visible', { handoff });
      const reviewSession = await createOrReuseReviewSession(
        input.originalSessionID,
        input.directory,
        expectedAutoReviewServerId,
      );
      const waitAfterCreatedAt = Date.now();
      const sentMessageID = await sendPlainMessage(reviewSession.id, input.directory, handoffReviewPrompt, {
        providerID: input.providerID,
        modelID: input.modelID,
        agent: input.agent,
        variant: input.variant,
      }, input.autoReview ? autoReviewReviewerInstructions() : undefined, serverId);
      if (input.autoReview) {
        startAutoReviewRun({
          originalSessionID: input.originalSessionID,
          reviewSessionID: reviewSession.id,
          directory: input.directory,
          serverId,
          status: 'running',
          phase: 'waiting_for_reviewer',
          iteration: 0,
          maxIterations: AUTO_REVIEW_MAX_ITERATIONS,
          expectedAssistantParentID: sentMessageID,
          waitAfterCreatedAt,
        });
      }
      if (!input.autoReview) {
        openReviewSessionPanel(input.directory, reviewSession, serverId);
      }
    };

    if (input.returnAfterHandoffRequest) {
      void continueFromHandoff().catch((error) => {
        console.error('[review-flow] failed to finish background review flow', error);
      });
      return;
    }

    await continueFromHandoff();
    return;
  } else {
    reviewPrompt = await renderMagicPrompt('session.reviewSessionWithoutHandoff.visible');
  }

  const reviewSession = await createOrReuseReviewSession(
    input.originalSessionID,
    input.directory,
    expectedAutoReviewServerId,
  );
  const waitAfterCreatedAt = Date.now();
  const sentMessageID = await sendPlainMessage(reviewSession.id, input.directory, reviewPrompt, {
    providerID: input.providerID,
    modelID: input.modelID,
    agent: input.agent,
    variant: input.variant,
  }, input.autoReview ? autoReviewReviewerInstructions() : undefined, serverId);
  if (input.autoReview) {
    startAutoReviewRun({
      originalSessionID: input.originalSessionID,
      reviewSessionID: reviewSession.id,
      directory: input.directory,
      serverId,
      status: 'running',
      phase: 'waiting_for_reviewer',
      iteration: 0,
      maxIterations: AUTO_REVIEW_MAX_ITERATIONS,
      expectedAssistantParentID: sentMessageID,
      waitAfterCreatedAt,
    });
  }
  if (!input.autoReview) {
    openReviewSessionPanel(input.directory, reviewSession, serverId);
  }
};

export const sendReviewFeedbackToOriginal = async (
  reviewSessionID: string,
  directory: string,
  reviewFeedback: string,
  expectedServerId?: string,
): Promise<string> => {
  const serverId = expectedServerId ?? resolveServerId(reviewSessionID);
  assertAutoReviewServerStillCurrent(expectedServerId);
  const reviewSession = await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(reviewSessionID));
  const originalSessionID = getOriginalSessionID(reviewSession);
  if (!originalSessionID) throw new Error('Original session is missing');
  const prompt = await renderMagicPrompt('session.reviewFeedbackToImplementer.visible', { review_feedback: reviewFeedback });
  return sendPlainMessage(originalSessionID, directory, prompt, null, undefined, serverId);
};

export const sendImplementationResponseToReviewer = async (
  originalSessionID: string,
  directory: string,
  implementationResponse: string,
  autoReview = false,
  expectedServerId?: string,
): Promise<string> => {
  const serverId = expectedServerId ?? resolveServerId(originalSessionID);
  assertAutoReviewServerStillCurrent(expectedServerId);
  const originalSession = await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(originalSessionID));
  const reviewSessionID = getReviewSessionID(originalSession);
  if (!reviewSessionID) throw new Error('Review session is missing');
  let reviewSession: Session;
  try {
    reviewSession = await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(reviewSessionID));
  } catch (error) {
    await patchSessionMetadata(originalSessionID, directory, (metadata) => withoutReviewSessionLink(metadata, reviewSessionID));
    throw error;
  }
  const prompt = await renderMagicPrompt('session.implementationResponseToReviewer.visible', { implementation_response: implementationResponse });
  const sentMessageID = await sendPlainMessage(
    reviewSessionID,
    directory,
    prompt,
    null,
    autoReview ? autoReviewReviewerInstructions() : undefined,
    serverId,
  );
  if (!autoReview) {
    openReviewSessionPanel(directory, reviewSession, serverId);
  }
  return sentMessageID;
};

export type ReviewTransferDirection = 'review-to-original' | 'original-to-review';

// Structural: callers pass either the projected or the legacy wire session.
export const getReviewTransferDirection = (session: ReviewMetadataSession): ReviewTransferDirection | null => {
  if (isReviewSession(session)) return 'review-to-original';
  if (getReviewSessionID(session)) return 'original-to-review';
  return null;
};

export const readSessionReviewMetadata = (session: ReviewMetadataSession) => getSessionMetadata(session);
