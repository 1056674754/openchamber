import { describe, expect, test } from 'bun:test';
import {
  ARCHIVED_VIRTUALIZE_THRESHOLD,
  MOBILE_VIRTUALIZE_THRESHOLD,
  shouldRenderAllUnpinnedSessions,
  shouldVirtualizeSessionGroupUnpinned,
} from './sessionGroupVirtualization';

describe('shouldVirtualizeSessionGroupUnpinned', () => {
  test('virtualizes large archived buckets', () => {
    expect(shouldVirtualizeSessionGroupUnpinned({
      isArchivedBucket: true,
      mobileVariant: false,
      hasSessionSearchQuery: false,
      unpinnedCount: ARCHIVED_VIRTUALIZE_THRESHOLD,
    })).toBe(true);
  });

  test('skips archived below threshold', () => {
    expect(shouldVirtualizeSessionGroupUnpinned({
      isArchivedBucket: true,
      mobileVariant: false,
      hasSessionSearchQuery: false,
      unpinnedCount: ARCHIVED_VIRTUALIZE_THRESHOLD - 1,
    })).toBe(false);
  });

  test('virtualizes mobile active groups at lower threshold', () => {
    expect(shouldVirtualizeSessionGroupUnpinned({
      isArchivedBucket: false,
      mobileVariant: true,
      hasSessionSearchQuery: false,
      unpinnedCount: MOBILE_VIRTUALIZE_THRESHOLD,
    })).toBe(true);
  });

  test('does not virtualize desktop active groups', () => {
    expect(shouldVirtualizeSessionGroupUnpinned({
      isArchivedBucket: false,
      mobileVariant: false,
      hasSessionSearchQuery: false,
      unpinnedCount: 500,
    })).toBe(false);
  });

  test('disables virtualization during search', () => {
    expect(shouldVirtualizeSessionGroupUnpinned({
      isArchivedBucket: true,
      mobileVariant: true,
      hasSessionSearchQuery: true,
      unpinnedCount: 200,
    })).toBe(false);
  });
});

describe('shouldRenderAllUnpinnedSessions', () => {
  test('mobile active groups stay paginated', () => {
    expect(shouldRenderAllUnpinnedSessions({
      isArchivedBucket: false,
      mobileVariant: true,
      hasSessionSearchQuery: false,
    })).toBe(false);
  });

  test('desktop active groups stay paginated', () => {
    expect(shouldRenderAllUnpinnedSessions({
      isArchivedBucket: false,
      mobileVariant: false,
      hasSessionSearchQuery: false,
    })).toBe(false);
  });

  test('search renders the full unpinned pool', () => {
    expect(shouldRenderAllUnpinnedSessions({
      isArchivedBucket: false,
      mobileVariant: true,
      hasSessionSearchQuery: true,
    })).toBe(true);
  });

  test('archived buckets render the full unpinned pool', () => {
    expect(shouldRenderAllUnpinnedSessions({
      isArchivedBucket: true,
      mobileVariant: false,
      hasSessionSearchQuery: false,
    })).toBe(true);
  });
});
