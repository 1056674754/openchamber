import type { Session } from '@opencode-ai/sdk/v2';

export type ResolveGlobalPinnedSessionsArgs = {
  pinnedIds: Iterable<string>;
  pinnedOrder: readonly string[];
  /** Unfiltered catalogs — do not pass project-visibility-filtered lists. */
  catalogs: ReadonlyArray<Iterable<Session>>;
  stubTitle?: string;
};

/** Minimal session row so pin IDs remain visible before catalog hydrate. */
export const createPinnedSessionStub = (id: string, title = 'Pinned session'): Session => {
  return {
    id,
    title,
    time: {
      created: 0,
      updated: 0,
    },
  } as Session;
};

/**
 * Resolve global pinned sessions by pin ID order from unfiltered catalogs.
 * Missing catalog entries become stubs so a synced pin list never renders empty.
 */
export const resolveGlobalPinnedSessions = (
  args: ResolveGlobalPinnedSessionsArgs,
): Session[] => {
  const pinnedIds = Array.from(args.pinnedIds).filter((id) => typeof id === 'string' && id.length > 0);
  if (pinnedIds.length === 0) return [];

  const byId = new Map<string, Session>();
  for (const catalog of args.catalogs) {
    for (const session of catalog) {
      if (!session?.id || byId.has(session.id)) continue;
      byId.set(session.id, session);
    }
  }

  const order = args.pinnedOrder.filter((id) => typeof id === 'string' && id.length > 0);
  const orderedIds = order.length > 0
    ? [
        ...order.filter((id) => pinnedIds.includes(id)),
        ...pinnedIds.filter((id) => !order.includes(id)),
      ]
    : pinnedIds;

  const stubTitle = args.stubTitle ?? 'Pinned session';
  return orderedIds.map((id) => byId.get(id) ?? createPinnedSessionStub(id, stubTitle));
};
