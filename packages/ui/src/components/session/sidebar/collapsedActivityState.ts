import type { Session } from '@opencode-ai/sdk/v2';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { createSessionActivityKey } from '@/sync/session-activity-key';
import type { SessionNode } from './types';

export type CollapsedActivityState = 'active' | 'unread' | null;

export const mergeCollapsedActivityStates = (
  current: CollapsedActivityState,
  next: CollapsedActivityState,
): CollapsedActivityState => {
  if (current === 'active' || next === 'active') return 'active';
  if (current === 'unread' || next === 'unread') return 'unread';
  return null;
};

type ActivityInput = {
  serverId: string;
  fallbackDirectory: string | null;
  activeSessionKeys: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  includeUnreadSubtasks: boolean;
};

const getNodeState = (node: SessionNode, input: ActivityInput): CollapsedActivityState => {
  const session = node.session as Session & { directory?: string | null };
  const directory = session.directory ?? input.fallbackDirectory;
  if (input.activeSessionKeys.has(createSessionActivityKey(input.serverId, directory, session.id))) {
    return 'active';
  }

  const isSubtask = Boolean(session.parentID);
  let state: CollapsedActivityState = input.serverId === DEFAULT_SERVER_ID
    && input.unreadSessionIds.has(session.id)
    && (input.includeUnreadSubtasks || !isSubtask)
    ? 'unread'
    : null;

  for (const child of node.children) {
    state = mergeCollapsedActivityStates(state, getNodeState(child, input));
    if (state === 'active') return state;
  }
  return state;
};

export const getSessionNodesActivityState = (
  nodes: SessionNode[],
  input: ActivityInput,
): CollapsedActivityState => {
  let state: CollapsedActivityState = null;
  for (const node of nodes) {
    state = mergeCollapsedActivityStates(state, getNodeState(node, input));
    if (state === 'active') return state;
  }
  return state;
};
