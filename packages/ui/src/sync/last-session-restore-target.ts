import type { Session } from '@opencode-ai/sdk/v2';

import { normalizePath } from '@/lib/pathNormalization';
import type { PersistedLastSession } from '@/sync/last-session-cache';

type RestoreTargetInput = {
  readonly persisted: PersistedLastSession;
  readonly sessions: readonly Session[];
  readonly getServerId: (session: Session) => string | null;
  readonly getDirectory: (session: Session) => string | null;
};

export const findLastSessionRestoreTarget = ({
  persisted,
  sessions,
  getServerId,
  getDirectory,
}: RestoreTargetInput): Session | null => {
  const expectedDirectory = normalizePath(persisted.directory);
  return sessions.find((session) => {
    if (session.id !== persisted.sessionId) return false;
    if (getServerId(session) !== persisted.serverId) return false;
    if (!expectedDirectory) return true;
    return normalizePath(getDirectory(session)) === expectedDirectory;
  }) ?? null;
};
