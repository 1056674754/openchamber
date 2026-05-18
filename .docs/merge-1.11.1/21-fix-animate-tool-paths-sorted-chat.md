# fix: animate tool paths in sorted chat mode

**Upstream**: `15d3cc0c`  
**Date**: 2026-05-15  
**Files**: `MessageList.tsx`, `ProgressiveGroup.tsx`, `ToolPart.tsx`

## What upstream did

Fixed tool path animations when chat messages are sorted (non-chronological order). Added proper animation keys so React tracks items correctly during reorder.

Changes:
1. `MessageList.tsx`: Added `hasAnchoredActivitySegment` check for sorted mode `isWorking` state
2. `ProgressiveGroup.tsx`: Added `animatedToolIds` prop threading
3. `ToolPart.tsx`: Added `animateTailText` prop

## Our divergence

All 3 files DIFFER from upstream due to our custom changes (ToolCallGroup, directive turns, etc). However, the upstream animation fix IS present in our code:
- `hasAnchoredActivitySegment` → FOUND in MessageList
- `animatedToolIds` → FOUND in ProgressiveGroup
- `animateTailText` → FOUND in ToolPart

## Merge decision: ALREADY MERGED (baseline) + OUR ADDITIONS

The upstream animation fix was applied during the initial merge. Our ToolCallGroup and directive turn additions are layered on top.

## Verification

```
grep "hasAnchoredActivitySegment" MessageList.tsx → FOUND (line 736, 761)
grep "animatedToolIds" ProgressiveGroup.tsx → FOUND (line 40, 861, 958, 969, 981)
grep "animateTailText" ToolPart.tsx → FOUND (line 57, 1079, 1081, 1149, 1161, 1172, 1848)
```

## Status

Complete. No action needed.
