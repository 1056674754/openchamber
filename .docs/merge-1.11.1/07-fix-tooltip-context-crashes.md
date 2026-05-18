# fix: prevent tooltip context crashes in chat (#1134)

**Upstream**: `df151ebf`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/components/ui/tooltip.tsx`

## What upstream did

Added `TooltipPartBoundary` error boundary class wrapping `TooltipTrigger` and `TooltipContent`. Prevents React context errors from tooltips crashing the entire chat.

## Merge decision: ALREADY MERGED

Our `tooltip.tsx` has `TooltipPartBoundary` class wrapping both Trigger and Content, exactly matching upstream.

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/ui/tooltip.tsx → MATCH
```

## Status

Complete. No action needed.
