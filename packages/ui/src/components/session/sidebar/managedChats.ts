import type { Session } from '@opencode-ai/sdk/v2';

import {
  getChatsRootForHome,
  getChatsRootFromDirectory,
  isChatDirectoryPath,
} from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import type { SessionNode } from './types';

export type ManagedChatsSource = {
  root: string;
  sessions: Session[];
  rootNodes: SessionNode[];
  folderScopes: Array<{ scopeKey: string; directory: string }>;
};

export type InstanceManagedChatsSource = ManagedChatsSource & {
  serverId: string;
};

const getParentId = (session: Session): string | null => {
  const parentId = (session as Session & { parentID?: string | null }).parentID;
  return typeof parentId === 'string' && parentId.trim() ? parentId : null;
};

export const buildManagedChatNodes = (sessions: readonly Session[]): SessionNode[] => {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParentId = new Map<string, Session[]>();

  for (const session of sessions) {
    const parentId = getParentId(session);
    if (!parentId || !sessionsById.has(parentId)) continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(session);
    childrenByParentId.set(parentId, children);
  }

  const emitted = new Set<string>();
  const buildNode = (session: Session, ancestors = new Set<string>()): SessionNode => {
    emitted.add(session.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(session.id);
    const children = (childrenByParentId.get(session.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildNode(child, nextAncestors));
    return { session, children, worktree: null };
  };

  const roots = sessions
    .filter((session) => {
      const parentId = getParentId(session);
      return !parentId || !sessionsById.has(parentId);
    })
    .map((session) => buildNode(session));

  for (const session of sessions) {
    if (!emitted.has(session.id)) roots.push(buildNode(session));
  }
  return roots;
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

  return {
    root,
    sessions: managed,
    rootNodes: buildManagedChatNodes(managed),
    folderScopes,
  };
};

export const deriveInstanceManagedChatsSources = (
  sessions: readonly Session[],
  resolveServerId: (session: Session) => string,
  homeDirectory?: string | null,
  defaultServerId = 'default',
): InstanceManagedChatsSource[] => {
  const sessionsByServerId = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.time?.archived || !isChatDirectoryPath(session.directory)) continue;
    const serverId = resolveServerId(session);
    const current = sessionsByServerId.get(serverId) ?? [];
    current.push(session);
    sessionsByServerId.set(serverId, current);
  }

  const sources: InstanceManagedChatsSource[] = [];
  for (const [serverId, serverSessions] of sessionsByServerId) {
    const source = deriveManagedChatsSource(
      serverSessions,
      serverId === defaultServerId ? homeDirectory : null,
    );
    if (source) sources.push({ ...source, serverId });
  }
  return sources;
};
