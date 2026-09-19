import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { filterSessionNodesForSearchQuery } from './useSessionGrouping';
import type { SessionNode } from '../types';

const buildSearchText = (session: Session): string => {
  const title = (session.title || '').trim();
  const directory = (session as Session & { directory?: string | null }).directory ?? '';
  return `${title} ${directory}`.toLowerCase();
};

const session = (id: string, title: string, patch: Partial<Session> = {}): Session => ({
  id,
  title,
  time: { created: 1, updated: 1 },
  ...patch,
} as Session);

const node = (session: Session, children: SessionNode[] = []): SessionNode => ({ session, children, worktree: null });

describe('sidebar exact-ID search', () => {
  const targetId = 'ses_f88b1a2b3c4d';

  test('matches only a complete ID, ignoring case and surrounding whitespace', () => {
    const nodes = [
      node(session(targetId, 'Release notes')),
      node(session('ses_f88b1a2b3c4e', targetId)),
    ];
    for (const query of [targetId, `  ${targetId.toUpperCase()}\n`]) {
      expect(filterSessionNodesForSearchQuery(nodes, query, buildSearchText).map((item) => item.session.id))
        .toEqual([targetId]);
    }
    for (const query of ['ses_', 'ses_f88b', 'ses_f88b1a2b3c4f', `${targetId}x`, `${targetId} release`]) {
      expect(filterSessionNodesForSearchQuery(nodes, query, buildSearchText)).toEqual([]);
    }
  });

  test('ID queries do not fall back to titles, directories or archived sessions', () => {
    const nodes = [
      node(session('ses_active', targetId)),
      node(session('ses_bydirectory', 'Notes', { directory: `/repo/${targetId}` } as Partial<Session>)),
      node(session(targetId, 'Archived', { time: { created: 1, updated: 1, archived: 2 } })),
    ];
    expect(filterSessionNodesForSearchQuery(nodes, targetId, buildSearchText)).toEqual([]);
    // Title matching keeps working for non-ID queries.
    expect(filterSessionNodesForSearchQuery(nodes, 'notes', buildSearchText).map((item) => item.session.id))
      .toEqual(['ses_bydirectory']);
  });

  test('keeps tree context: an ancestor stays when a child matches', () => {
    const parent = node(session('ses_parent', 'Parent'), [
      node(session(targetId, 'Child')),
      node(session('ses_sibling', 'Sibling')),
    ]);
    const filtered = filterSessionNodesForSearchQuery([parent], targetId, buildSearchText);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.session.id).toBe('ses_parent');
    expect(filtered[0]?.children.map((child) => child.session.id)).toEqual([targetId]);
  });
});
