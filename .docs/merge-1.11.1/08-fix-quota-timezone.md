# fix: show quota reset times in local timezone (#1128)

**Upstream**: `3d741c2c`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/components/sections/usage/UsageCard.tsx`

## What upstream did

Fixed timezone display for quota reset times — replaced UTC with local timezone formatting.

## Merge decision: ALREADY MERGED

Our `UsageCard.tsx` matches upstream exactly.

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/sections/usage/UsageCard.tsx → MATCH
```

## Status

Complete. No action needed.
