export const ARCHIVED_VIRTUALIZE_THRESHOLD = 50;
export const MOBILE_VIRTUALIZE_THRESHOLD = 12;
export const ARCHIVED_ROW_ESTIMATE_PX = 28;
/** Fixed row height on mobile — skip measureElement so fling positions stay stable. */
export const MOBILE_ROW_ESTIMATE_PX = 40;
/** Steady overscan (~half a screen of 40px rows). */
export const MOBILE_VIRTUAL_OVERSCAN = 12;
/** Extra overscan while the list is flinging. */
export const MOBILE_VIRTUAL_OVERSCAN_FLING = 36;
export const DESKTOP_ARCHIVED_VIRTUAL_OVERSCAN = 8;

/** px/ms — above this, treat as fling and widen the virtual window. */
export const MOBILE_VIRTUAL_FLING_SPEED_PX_MS = 1.1;
export const MOBILE_VIRTUAL_FLING_HOLD_MS = 320;

import { isOhosApp } from '@/lib/platform';

export function shouldVirtualizeSessionGroupUnpinned(args: {
  isArchivedBucket: boolean;
  mobileVariant: boolean;
  hasSessionSearchQuery: boolean;
  unpinnedCount: number;
}): boolean {
  // ArkWeb (HarmonyOS shell): the virtualizer mis-measures under ArkWeb scroll
  // event delivery — totalSize inflates and rows unmount, leaving a growing
  // blank spacer inside the group. Session counts on device are modest; render
  // directly instead.
  if (isOhosApp()) return false;
  if (args.hasSessionSearchQuery) return false;
  if (args.unpinnedCount <= 0) return false;
  if (args.isArchivedBucket) {
    return args.unpinnedCount >= ARCHIVED_VIRTUALIZE_THRESHOLD;
  }
  if (args.mobileVariant) {
    return args.unpinnedCount >= MOBILE_VIRTUALIZE_THRESHOLD;
  }
  return false;
}

/** Archived + search render the full unpinned pool; active groups stay paginated (incl. mobile). */
export function shouldRenderAllUnpinnedSessions(args: {
  isArchivedBucket: boolean;
  mobileVariant: boolean;
  hasSessionSearchQuery: boolean;
}): boolean {
  void args.mobileVariant;
  return args.isArchivedBucket || args.hasSessionSearchQuery;
}
