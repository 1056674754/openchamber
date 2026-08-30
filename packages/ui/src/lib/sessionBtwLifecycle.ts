import type { Session } from '@opencode-ai/sdk/v2';

import {
  getBtwOriginalSessionID,
  getBtwSessionID,
  isBtwSession,
  withoutBtwSessionLink,
} from './sessionBtwMetadata';
import type { SessionMetadataRecord } from './sessionReviewMetadata';

interface BtwRemovalDependencies {
  getSession: (sessionId: string) => Promise<Session | null>;
  patchMetadata: (
    sessionId: string,
    transform: (metadata: SessionMetadataRecord) => SessionMetadataRecord,
  ) => Promise<void>;
  deleteTemporarySession: (sessionId: string) => Promise<void>;
}

/** Best-effort linked-session cleanup performed before delete or archive. */
export const cleanupBtwBeforeSessionRemoval = async (
  sessionId: string,
  dependencies: BtwRemovalDependencies,
): Promise<void> => {
  const session = await dependencies.getSession(sessionId).catch(() => null);
  if (!session) return;

  if (isBtwSession(session)) {
    const parentId = getBtwOriginalSessionID(session);
    if (!parentId) return;
    await dependencies.patchMetadata(
      parentId,
      (metadata) => withoutBtwSessionLink(metadata, sessionId),
    ).catch(() => undefined);
    return;
  }

  const temporaryForkId = getBtwSessionID(session);
  if (!temporaryForkId) return;

  // Unlink first: if deletion fails, the orphan becomes visible as a normal
  // recoverable Session instead of leaving a dead panel on the parent.
  await dependencies.patchMetadata(
    sessionId,
    (metadata) => withoutBtwSessionLink(metadata, temporaryForkId),
  ).catch(() => undefined);
  await dependencies.deleteTemporarySession(temporaryForkId).catch(() => undefined);
};
