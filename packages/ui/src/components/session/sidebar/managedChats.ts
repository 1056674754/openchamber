import type { Session } from '@opencode-ai/sdk/v2';

import {
  getChatsRootForHome,
  getChatsRootFromDirectory,
  isChatDirectoryPath,
} from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';

export type ManagedChatsSource = {
  root: string;
  sessions: Session[];
  folderScopes: Array<{ scopeKey: string; directory: string }>;
};

export const deriveManagedChatsSource = (
  sessions: readonly Session[],
  homeDirectory?: string | null,
): ManagedChatsSource | null => {
  const managed = sessions.filter((session) => (
    !session.time?.archived && isChatDirectoryPath(session.directory)
  ));
  if (managed.length === 0) return null;

  const inferredRoots = managed
    .map((session) => getChatsRootFromDirectory(session.directory))
    .filter((value): value is string => Boolean(value));
  const homeRoot = getChatsRootForHome(homeDirectory);
  const root = homeRoot && inferredRoots.some((candidate) => candidate === homeRoot)
    ? homeRoot
    : inferredRoots[0];
  if (!root) return null;

  const directories = managed
    .map((session) => normalizePath(session.directory))
    .filter((value): value is string => Boolean(value));
  const folderScopes = Array.from(new Set([root, ...directories])).map((directory) => ({
    scopeKey: directory,
    directory,
  }));

  return { root, sessions: managed, folderScopes };
};
