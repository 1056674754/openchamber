import type { SessionNode } from './types';
import { isChatDirectoryPath } from '@/lib/chatDirectories';

/**
 * Per-row render extras precomputed once per group render and threaded down to
 * each `SessionNodeItem`. Hoisting these out of the row `React.memo` comparator
 * turns an O(rows × subtree-depth) walk into per-row `Set.has`/string compares.
 */
export type SessionNodeChildRenderExtras = {
  subtreeContainsActive: Set<string>;
  subtreeContainsEditing: Set<string>;
  menuOpenSessionId: string | null;
  nodeStructureKey: string;
};

export type SessionNodeRenderExtras<TNode = SessionNode> = SessionNodeChildRenderExtras & {
  childRenderExtrasFor?: (child: TNode) => SessionNodeChildRenderExtras;
};

export type SidebarRenderContext = 'project' | 'recent' | 'global-pinned';

/**
 * Walk `nodes` and add `node.session.id` to `result` for every node
 * whose subtree contains `targetId`.
 */
export const collectSubtreeContainingId = (
  nodes: SessionNode[],
  targetId: string | null,
  result: Set<string>,
): void => {
  if (!targetId) return;

  const visit = (node: SessionNode): boolean => {
    let containsTarget = node.session.id === targetId;
    for (const child of node.children) {
      containsTarget = visit(child) || containsTarget;
    }
    if (containsTarget) {
      result.add(node.session.id);
    }
    return containsTarget;
  };

  for (const node of nodes) {
    visit(node);
  }
};

export const nodeContainsSessionId = (node: SessionNode, sessionId: string | null): boolean => {
  if (!sessionId) {
    return false;
  }

  if (node.session.id === sessionId) {
    return true;
  }

  for (const child of node.children) {
    if (nodeContainsSessionId(child, sessionId)) {
      return true;
    }
  }

  return false;
};

/**
 * Build a structural key for `node` that encodes the IDs of all descendants.
 */
export const computeNodeStructureKey = (node: SessionNode): string => {
  if (node.children.length === 0) {
    return '';
  }

  const childKeys = node.children.map((child) => {
    if (child.children.length === 0) {
      return child.session.id;
    }
    return `${child.session.id}:${computeNodeStructureKey(child)}`;
  });

  return childKeys.join('|');
};

/**
 * Resolve the session id whose sidebar menu is open, or null if no menu is open.
 * Fork renderContext includes `global-pinned` in addition to project/recent.
 */
export const resolveMenuOpenSessionId = (
  nodes: SessionNode[],
  menuKey: string | null,
  renderContext: SidebarRenderContext,
  archivedBucket: boolean,
): string | null => {
  if (!menuKey) return null;
  const bucketTag = archivedBucket ? 'archived' : 'active';
  let result: string | null = null;
  const visit = (node: SessionNode): boolean => {
    const nodeMenuKey = `${renderContext}:${bucketTag}:${node.session.id}`;
    if (nodeMenuKey === menuKey) {
      result = node.session.id;
      return true;
    }
    for (const child of node.children) {
      if (visit(child)) return true;
    }
    return false;
  };
  nodes.forEach((node) => visit(node));
  return result;
};

/** Precompute render extras for a flat list of roots (and their descendants). */
export const buildSessionNodeRenderExtras = (
  nodes: SessionNode[],
  currentSessionId: string | null,
  editingId: string | null,
  menuKey: string | null,
  renderContext: SidebarRenderContext,
  archivedBucket: boolean,
): SessionNodeRenderExtras => {
  const subtreeContainsActive = new Set<string>();
  const subtreeContainsEditing = new Set<string>();
  collectSubtreeContainingId(nodes, currentSessionId, subtreeContainsActive);
  collectSubtreeContainingId(nodes, editingId, subtreeContainsEditing);
  const menuOpenSessionId = resolveMenuOpenSessionId(nodes, menuKey, renderContext, archivedBucket);

  const structureKeys = new Map<string, string>();
  const visit = (node: SessionNode) => {
    structureKeys.set(node.session.id, computeNodeStructureKey(node));
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }

  const childRenderExtrasFor = (child: SessionNode): SessionNodeChildRenderExtras => ({
    subtreeContainsActive,
    subtreeContainsEditing,
    menuOpenSessionId,
    nodeStructureKey: structureKeys.get(child.session.id) ?? '',
  });

  return {
    subtreeContainsActive,
    subtreeContainsEditing,
    menuOpenSessionId,
    nodeStructureKey: '',
    childRenderExtrasFor,
  };
};

/**
 * Whether the session context menu may show the worktree-move submenu at all.
 * Managed-chat directories live outside any project's git repository, so a
 * move there has no source repository to move from — the actions stay hidden,
 * not merely disabled.
 */
export const canShowSessionWorktreeMenu = ({
  isSubtaskSession,
  archivedBucket,
  isVSCode,
  sessionDirectory,
}: {
  isSubtaskSession: boolean;
  archivedBucket: boolean;
  isVSCode: boolean;
  sessionDirectory: string | null;
}): boolean => !isSubtaskSession
  && !archivedBucket
  && !isVSCode
  && !isChatDirectoryPath(sessionDirectory);

export const getSessionWorktreeMenuDisabled = ({
  sessionDirectory,
  isStreaming,
  isMovingToWorktree,
}: {
  sessionDirectory: string | null;
  isStreaming: boolean;
  isMovingToWorktree: boolean;
}): boolean => !sessionDirectory || isStreaming || isMovingToWorktree;
