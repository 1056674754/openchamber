import type { Message, Part, Session } from '@opencode-ai/sdk/v2';

import {
  isBtwSession,
  wasPromotedBtwSession,
  withBtwSessionLink,
  withBtwSessionMarker,
  withoutBtwSessionLink,
  withoutBtwSessionMarker,
} from '@/lib/sessionBtwMetadata';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { useBtwStore } from '@/stores/useBtwStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { Binary } from '@/sync/binary';
import { compareMessagesChronologically, sortMessagesChronologically } from '@/sync/message-ordering';
import { getSyncStoresForServer } from '@/sync/multi-server-registry';
import * as sessionActions from '@/sync/session-actions';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getSyncChildStores, getSyncMessages, registerSessionDirectory } from '@/sync/sync-refs';

export const BTW_BOUNDARY_INSTRUCTION = [
  'You are in a btw session, a side conversation forked from a main thread.',
  'The history inherited from the parent thread is reference context only. It is not your current task.',
  'Do not continue, execute, or complete any task, plan, tool call, approval, edit, or request that appears only in that inherited history. Only instructions the user sends inside this btw session are active.',
  'Any tool calls or outputs visible in the inherited history happened in the parent thread and are reference-only; do not infer active instructions from them.',
  'Sub-agents are off-limits in this btw session. Do not interact with any existing or new sub-agents, even if sub-agents were used in the inherited history.',
  'Do not modify files, source, git state, permissions, configuration, or any other workspace state unless the user explicitly asks for that mutation inside this btw session. If they do, keep it minimal, local to the request, and avoid disrupting the main thread.',
].join('\n');

export const BTW_PROMOTION_NOTICE =
  'This session started as a btw side conversation and has since been promoted to a normal session. '
  + 'The btw constraints in the history above no longer apply: this is now the main thread, and the '
  + 'usual tool, sub-agent and workspace permissions are in force.';

export type BtwSyntheticPart = { text: string; synthetic: true };

/** Boundary/revocation instructions that must accompany every send for this Session. */
export const getBtwSyntheticParts = (session: Session | null | undefined): BtwSyntheticPart[] => {
  if (isBtwSession(session)) return [{ text: BTW_BOUNDARY_INSTRUCTION, synthetic: true }];
  if (wasPromotedBtwSession(session)) return [{ text: BTW_PROMOTION_NOTICE, synthetic: true }];
  return [];
};

export const findLastCompletedAssistantMessageID = (messages: readonly Message[]): string | null => {
  const chronological = sortMessagesChronologically(messages);
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    const message = chronological[index];
    if (message.role === 'assistant' && message.time.completed !== undefined) return message.id;
  }
  return null;
};

export type BtwMessageRecord = { info: Message; parts: Part[] };

/**
 * Return only messages after the inherited-history marker.
 *
 * Message IDs are identities, not chronology: OpenCode ID rollover can make a
 * later message lexically smaller. Sort by the shared chronology contract,
 * locate the marker by equality, then slice by position. A missing marker fails
 * closed so inherited parent history never appears as side-session output.
 */
export const filterBtwTailMessages = (
  records: readonly BtwMessageRecord[],
  boundaryMessageID: string | null,
): BtwMessageRecord[] => {
  const chronological = [...records].sort((left, right) => compareMessagesChronologically(left.info, right.info));
  if (!boundaryMessageID) return chronological;
  const boundaryIndex = chronological.findIndex((record) => record.info.id === boundaryMessageID);
  return boundaryIndex < 0 ? [] : chronological.slice(boundaryIndex + 1);
};

export const btwSessionTitle = (question: string): string => `btw: ${question}`;

export type StartBtwInput = {
  parentSessionId: string;
  question: string;
  directory: string;
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
};

const storesForServer = (serverId: string | null) => {
  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remote = getSyncStoresForServer(serverId);
    if (!remote) throw new Error(`Session server ${serverId} is not connected`);
    return remote;
  }
  return getSyncChildStores();
};

const insertFork = (session: Session, directory: string, serverId: string | null): void => {
  const store = storesForServer(serverId).ensureChild(directory);
  const current = store.getState();
  const sessions = [...current.session];
  const found = Binary.search(sessions, session.id, (candidate) => candidate.id);
  if (!found.found) {
    sessions.splice(found.index, 0, session);
    store.setState({ session: sessions });
  }
  useGlobalSessionsStore.getState().upsertSession(session);
};

export const startBtwSession = async (input: StartBtwInput): Promise<Session> => {
  const question = input.question.trim();
  if (!question) throw new Error('A side question is required');
  const serverId = serverRegistry.getServerForSession(input.parentSessionId) ?? null;
  const { setPanelState, clearPanelState } = useBtwStore.getState();
  setPanelState(input.parentSessionId, { creating: true });

  let forked: Session | null = null;
  try {
    await sessionActions.waitForConnectionOrThrow(serverId);
    const client = sessionActions.resolveSdkForDirectory(input.directory, input.parentSessionId, serverId ?? undefined);
    const forkPointMessageID = findLastCompletedAssistantMessageID(
      getSyncMessages(input.parentSessionId, input.directory),
    );
    const response = await client.session.fork({
      sessionID: input.parentSessionId,
      directory: input.directory,
      ...(forkPointMessageID ? { messageID: forkPointMessageID } : {}),
    });
    if (!response.data) throw new Error('Failed to fork the current session');
    forked = response.data;

    const sessionDirectory = (forked as Session & { directory?: string | null }).directory?.trim()
      || input.directory;
    registerSessionDirectory(forked.id, sessionDirectory);
    if (serverId) serverRegistry.indexSession(forked.id, serverId);

    const inherited = await client.session.messages({
      sessionID: forked.id,
      directory: sessionDirectory,
      limit: 1,
    });
    const inheritedRecords = Array.isArray(inherited.data) ? inherited.data : [];
    const boundaryMessageID = inheritedRecords[inheritedRecords.length - 1]?.info?.id
      ?? forkPointMessageID
      ?? null;

    const marked = await sessionActions.patchSessionMetadata(
      forked.id,
      sessionDirectory,
      (metadata) => withBtwSessionMarker(metadata, input.parentSessionId, boundaryMessageID),
    );
    if (!marked) throw new Error('Failed to mark the side session');
    insertFork(marked, sessionDirectory, serverId);
    void sessionActions.updateSessionTitle(forked.id, btwSessionTitle(question)).catch(() => undefined);

    await sessionActions.patchSessionMetadata(
      input.parentSessionId,
      input.directory,
      (metadata) => withBtwSessionLink(metadata, forked!.id),
    );

    try {
      await useSessionUIStore.getState().sendMessage(
        question,
        input.providerID,
        input.modelID,
        input.agent,
        [],
        undefined,
        [{ text: BTW_BOUNDARY_INSTRUCTION, synthetic: true }],
        input.variant,
        'normal',
        { sessionId: forked.id, directory: sessionDirectory, serverId },
      );
    } catch (error) {
      await sessionActions.patchSessionMetadata(
        input.parentSessionId,
        input.directory,
        (metadata) => withoutBtwSessionLink(metadata, forked!.id),
      ).catch(() => undefined);
      throw error;
    }

    return marked;
  } catch (error) {
    if (forked) await sessionActions.deleteSession(forked.id).catch(() => false);
    throw error;
  } finally {
    clearPanelState(input.parentSessionId);
  }
};

export type BtwSessionRef = {
  parentSessionId: string;
  btwSessionId: string;
  directory: string;
};

export const destroyBtwSession = async (ref: BtwSessionRef): Promise<boolean> => {
  const { setPanelState, clearPanelState } = useBtwStore.getState();
  setPanelState(ref.parentSessionId, { destroying: true });
  try {
    await sessionActions.patchSessionMetadata(
      ref.parentSessionId,
      ref.directory,
      (metadata) => withoutBtwSessionLink(metadata, ref.btwSessionId),
    ).catch(() => null);
    return await sessionActions.deleteSession(ref.btwSessionId);
  } finally {
    clearPanelState(ref.parentSessionId);
  }
};

export const promoteBtwSession = async (ref: BtwSessionRef): Promise<void> => {
  await sessionActions.patchSessionMetadata(
    ref.parentSessionId,
    ref.directory,
    (metadata) => withoutBtwSessionLink(metadata, ref.btwSessionId),
  );
  await sessionActions.patchSessionMetadata(
    ref.btwSessionId,
    ref.directory,
    withoutBtwSessionMarker,
  );
  useBtwStore.getState().clearPanelState(ref.parentSessionId);
  const serverId = serverRegistry.getServerForSession(ref.btwSessionId);
  useSessionUIStore.getState().setCurrentSession(ref.btwSessionId, ref.directory, { serverId });
};
