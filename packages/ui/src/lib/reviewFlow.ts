import type { Message, Session } from '@opencode-ai/sdk/v2/client';
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
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { optimisticSend, patchSessionMetadata, waitForConnectionOrThrow } from '@/sync/session-actions';
import { useSelectionStore } from '@/sync/selection-store';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getSyncMessages, getSyncParts, registerSessionDirectory } from '@/sync/sync-refs';
import { markPendingUserSendAnimation } from '@/lib/userSendAnimation';
import { serverRegistry } from '@/lib/opencode/server-registry';

const HANDOFF_TIMEOUT_MS = 180_000;
const HANDOFF_POLL_MS = 400;
const REVIEW_SESSION_TITLE = 'Review of workspace changes';

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

    // Fallback: explicit completion markers.
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
  const agent = selection.getSessionAgentSelection(sessionID) || lastChoice?.agent || config.currentAgentName || undefined;
  const sessionModel = selection.getSessionModelSelection(sessionID);
  const agentModel = agent ? selection.getAgentModelForSession(sessionID, agent) : null;
  const lastChoiceModel = lastChoice?.providerID && lastChoice.modelID
    ? { providerId: lastChoice.providerID, modelId: lastChoice.modelID }
    : null;
  const selectedModel = agentModel || sessionModel || lastChoiceModel || (config.currentProviderId && config.currentModelId
    ? { providerId: config.currentProviderId, modelId: config.currentModelId }
    : null);
  if (!selectedModel?.providerId || !selectedModel?.modelId) return null;
  const selectionVariant = agent
    ? selection.getAgentModelVariantForSession(sessionID, agent, selectedModel.providerId, selectedModel.modelId)
    : undefined;
  const lastChoiceVariant = lastChoiceModel
    && lastChoiceModel.providerId === selectedModel.providerId
    && lastChoiceModel.modelId === selectedModel.modelId
    ? lastChoice?.variant
    : undefined;
  const configVariant = config.currentProviderId === selectedModel.providerId && config.currentModelId === selectedModel.modelId
    ? config.currentVariant
    : undefined;
  return {
    providerID: selectedModel.providerId,
    modelID: selectedModel.modelId,
    agent,
    variant: selectionVariant || lastChoiceVariant || configVariant || undefined,
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
): Promise<void> => {
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
  await optimisticSend({
    sessionId: sessionID,
    content: text,
    directory,
    serverId: serverId ?? undefined,
    providerID: resolved.providerID,
    modelID: resolved.modelID,
    agent: resolved.agent,
    send: (messageID) => opencodeClient.sendMessage({
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
    }).then(() => undefined),
  });
  requestChatForceScrollBottom(sessionID);
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

const createOrReuseReviewSession = async (originalSessionID: string, directory: string): Promise<Session> => {
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

  const review = await opencodeClient.withDirectory(directory, () =>
    opencodeClient.createSession({
      title: REVIEW_SESSION_TITLE,
      metadata: withReviewSessionMarker({}, originalSessionID),
    }),
  );
  registerSessionDirectory(review.id, directory);
  try {
    await patchSessionMetadata(originalSessionID, directory, (metadata) => withReviewSessionLink(metadata, review.id));
  } catch (error) {
    await opencodeClient.withDirectory(directory, () => opencodeClient.deleteSession(review.id)).catch((deleteError) => {
      console.warn('[review-flow] failed to delete unlinked review session after link failure', deleteError);
    });
    throw error;
  }
  useGlobalSessionsStore.getState().upsertSession(review);
  return review;
};

export const startReviewFlow = async (input: StartReviewFlowInput): Promise<void> => {
  await waitForConnectionOrThrow();
  const serverId = input.serverId ?? serverRegistry.getServerForSession(input.originalSessionID) ?? null;
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
      const handoffReviewPrompt = await renderMagicPrompt('session.reviewSession.visible', { handoff });
      const reviewSession = await createOrReuseReviewSession(input.originalSessionID, input.directory);
      await sendPlainMessage(reviewSession.id, input.directory, handoffReviewPrompt, {
        providerID: input.providerID,
        modelID: input.modelID,
        agent: input.agent,
        variant: input.variant,
      }, undefined, serverId);
      openReviewSessionPanel(input.directory, reviewSession, serverId);
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

  const reviewSession = await createOrReuseReviewSession(input.originalSessionID, input.directory);
  await sendPlainMessage(reviewSession.id, input.directory, reviewPrompt, {
    providerID: input.providerID,
    modelID: input.modelID,
    agent: input.agent,
    variant: input.variant,
  }, undefined, serverId);
  openReviewSessionPanel(input.directory, reviewSession, serverId);
};

export const sendReviewFeedbackToOriginal = async (reviewSessionID: string, directory: string, reviewFeedback: string): Promise<void> => {
  const serverId = serverRegistry.getServerForSession(reviewSessionID) ?? null;
  const reviewSession = await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(reviewSessionID));
  const originalSessionID = getOriginalSessionID(reviewSession);
  if (!originalSessionID) throw new Error('Original session is missing');
  const prompt = await renderMagicPrompt('session.reviewFeedbackToImplementer.visible', { review_feedback: reviewFeedback });
  await sendPlainMessage(originalSessionID, directory, prompt, null, undefined, serverId);
};

export const sendImplementationResponseToReviewer = async (originalSessionID: string, directory: string, implementationResponse: string): Promise<void> => {
  const serverId = serverRegistry.getServerForSession(originalSessionID) ?? null;
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
  await sendPlainMessage(reviewSessionID, directory, prompt, null, undefined, serverId);
  openReviewSessionPanel(directory, reviewSession, serverId);
};

export type ReviewTransferDirection = 'review-to-original' | 'original-to-review';

export const getReviewTransferDirection = (session: Session | null | undefined): ReviewTransferDirection | null => {
  if (isReviewSession(session)) return 'review-to-original';
  if (getReviewSessionID(session)) return 'original-to-review';
  return null;
};

export const readSessionReviewMetadata = (session: Session | null | undefined) => getSessionMetadata(session);
