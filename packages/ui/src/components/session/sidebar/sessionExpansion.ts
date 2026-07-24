import type { Session } from '@opencode-ai/sdk/v2';

const EXPANSION_CONTEXT_PREFIXES = [
  'project:active:',
  'project:archived:',
  'recent:active:',
  'recent:archived:',
  'global-pinned:active:',
  'global-pinned:archived:',
] as const;

const getParentId = (session: Session | undefined): string | null => {
  const parentID = (session as (Session & { parentID?: string | null }) | undefined)?.parentID;
  return typeof parentID === 'string' && parentID.trim().length > 0 ? parentID : null;
};

export const buildTransientSessionExpansionKeys = (
  sessions: Session[],
  currentSessionId: string | null,
): Set<string> => {
  const expanded = new Set<string>();
  if (!currentSessionId) return expanded;

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const visited = new Set<string>([currentSessionId]);
  let current = sessionsById.get(currentSessionId);

  while (current) {
    const parentId = getParentId(current);
    if (!parentId || visited.has(parentId)) break;

    EXPANSION_CONTEXT_PREFIXES.forEach((prefix) => expanded.add(`${prefix}${parentId}`));
    visited.add(parentId);
    current = sessionsById.get(parentId);
  }

  return expanded;
};

export const shouldRenderSessionExpanded = ({
  hasSessionSearchQuery,
  expansionRequested,
  hasChildren,
  childrenLoaded,
}: {
  hasSessionSearchQuery: boolean;
  expansionRequested: boolean;
  hasChildren: boolean;
  childrenLoaded: boolean;
}): boolean => {
  return hasSessionSearchQuery
    || (expansionRequested && (hasChildren || childrenLoaded));
};

export const getNextSessionExpansionKeys = (
  previous: Set<string>,
  expansionKey: string,
  isRenderedExpanded: boolean,
): Set<string> => {
  const next = new Set(previous);
  if (isRenderedExpanded) {
    next.delete(expansionKey);
  } else {
    next.add(expansionKey);
  }
  return next;
};
