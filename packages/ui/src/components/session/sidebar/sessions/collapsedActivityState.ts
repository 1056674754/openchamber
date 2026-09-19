import React from 'react';
import type { SessionNode } from '../types';
// [fork-port] Upstream derives collapsed-folder activity from its
// global-session-status / global-blocking-requests stores. The fork's single
// source of truth for running indicators is `useGlobalSessionsStore`
// .sessionStatuses (fed by the fork's own multi-server sync pipeline), and
// unread state lives in the notification store. This module re-exports the
// fork's pure helpers and provides the self-subscribing hook on top of the
// fork's sources. The state union stays the fork's ('active' | 'unread' |
// null) so fork row components keep their contract.

export {
  getSessionNodesActivityState,
  mergeCollapsedActivityStates,
  type CollapsedActivityState,
} from '../collapsedActivityState';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useNotificationStore } from '@/sync/notification-store';

type SessionActivityProps = {
  nodes: readonly SessionNode[];
  includeUnreadSubtasks: boolean;
  enabled?: boolean;
};

type NodeActivityState = 'active' | 'unread' | null;

const mergeStates = (current: NodeActivityState, next: NodeActivityState): NodeActivityState => {
  if (current === 'active' || next === 'active') return 'active';
  if (current === 'unread' || next === 'unread') return 'unread';
  return null;
};

const getNodeState = (
  node: SessionNode,
  activeSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
  includeUnreadSubtasks: boolean,
): NodeActivityState => {
  if (activeSessionIds.has(node.session.id)) return 'active';
  // SAFETY: SessionNode sessions are SDK Session records; parentID is the optional hierarchy field.
  const isSubtask = Boolean((node.session as SessionNode['session'] & { parentID?: string | null }).parentID);
  let state: NodeActivityState = unreadSessionIds.has(node.session.id) && (includeUnreadSubtasks || !isSubtask)
    ? 'unread'
    : null;
  for (const child of node.children) {
    state = mergeStates(state, getNodeState(child, activeSessionIds, unreadSessionIds, includeUnreadSubtasks));
    if (state === 'active') return state;
  }
  return state;
};

/**
 * Subscribes to the fork's cross-server running-status index and the
 * notification store and resolves one collapsed activity state for the given
 * nodes. Used by folder rows so a collapsed folder keeps its activity spinner
 * / unread dot without subscribing every rendered row.
 */
export const useCollapsedSessionActivityState = ({
  nodes,
  includeUnreadSubtasks,
  enabled = true,
}: SessionActivityProps): NodeActivityState => {
  const sessionStatuses = useGlobalSessionsStore((state) => state.sessionStatuses);
  const sessionUnseenCounts = useNotificationStore((state) => state.index.session.unseenCount);
  return React.useMemo(() => {
    if (!enabled) return null;
    const activeSessionIds = new Set(
      [...sessionStatuses].filter(([, status]) => status.type !== 'idle').map(([id]) => id),
    );
    const unreadSessionIds = new Set(
      Object.entries(sessionUnseenCounts).filter(([, count]) => count > 0).map(([id]) => id),
    );
    let state: NodeActivityState = null;
    for (const node of nodes) {
      state = mergeStates(state, getNodeState(node, activeSessionIds, unreadSessionIds, includeUnreadSubtasks));
      if (state === 'active') return state;
    }
    return state;
  }, [enabled, includeUnreadSubtasks, nodes, sessionStatuses, sessionUnseenCounts]);
};
