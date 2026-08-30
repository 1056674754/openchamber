import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import {
  getBtwBoundaryMessageID,
  getBtwOriginalSessionID,
  getBtwSessionID,
  isBtwSession,
  wasPromotedBtwSession,
  withBtwSessionLink,
  withBtwSessionMarker,
  withoutBtwSessionLink,
  withoutBtwSessionMarker,
} from './sessionBtwMetadata';

const sessionWith = (metadata: unknown): Session => ({ id: 'session', metadata }) as Session;

describe('btw parent link', () => {
  test('preserves unrelated metadata and rejects blank links', () => {
    const linked = withBtwSessionLink({ openchamber: { reviewSessionID: 'review-1' }, other: 1 }, ' fork-1 ');
    expect(linked).toEqual({ openchamber: { reviewSessionID: 'review-1', btwSessionID: ' fork-1 ' }, other: 1 });
    expect(getBtwSessionID(sessionWith(linked))).toBe('fork-1');
    expect(getBtwSessionID(sessionWith({ openchamber: { btwSessionID: ' ' } }))).toBeNull();
  });

  test('a delayed cleanup cannot unlink a newer fork', () => {
    const linked = { openchamber: { btwSessionID: 'fork-2', reviewSessionID: 'review-1' } };
    expect(withoutBtwSessionLink(linked, 'fork-1')).toBe(linked);
    expect(withoutBtwSessionLink(linked, 'fork-2')).toEqual({ openchamber: { reviewSessionID: 'review-1' } });
    expect(withoutBtwSessionLink({ openchamber: { btwSessionID: 'fork-2' } }, 'fork-2')).toEqual({});
  });
});

describe('btw fork marker', () => {
  test('replaces inherited OpenChamber metadata and stores the boundary as identity', () => {
    const inherited = { openchamber: { btwSessionID: 'stale', reviewSessionID: 'review-1' }, other: 1 };
    const marked = withBtwSessionMarker(inherited, 'parent-1', 'msg-9');
    expect(marked).toEqual({
      openchamber: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' },
      other: 1,
    });
    const session = sessionWith(marked);
    expect(isBtwSession(session)).toBe(true);
    expect(getBtwOriginalSessionID(session)).toBe('parent-1');
    expect(getBtwBoundaryMessageID(session)).toBe('msg-9');
  });

  test('readers ignore marker-looking fields on another session kind', () => {
    const session = sessionWith({ openchamber: { kind: 'review', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' } });
    expect(isBtwSession(session)).toBe(false);
    expect(getBtwOriginalSessionID(session)).toBeNull();
    expect(getBtwBoundaryMessageID(session)).toBeNull();
  });

  test('promotion removes the live marker and leaves an explicit revocation flag', () => {
    const metadata = { openchamber: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-9' } };
    const promoted = withoutBtwSessionMarker(metadata);
    expect(promoted).toEqual({ openchamber: { btwPromoted: true } });
    expect(wasPromotedBtwSession(sessionWith(promoted))).toBe(true);
    expect(wasPromotedBtwSession(sessionWith(metadata))).toBe(false);
  });
});
