# fix: avoid launching unrelated project actions for preview

**Upstream**: `f4851ada`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/lib/detectDevServer.ts`

## What upstream did

Removed fallback in `findDevServerAction` that returned the first action when there's only one. This prevented launching unrelated project dev servers.

## Our divergence

Our `detectDevServer.ts` has additional custom changes:
- `readOptionalTextFile` now takes a `directory` parameter (for multi-instance support)
- All call sites pass `directory` for proper scoping
- Fetch URL includes `directory` query parameter

The upstream fix (removing the fallback) is present in our code — the fallback does NOT exist.

## Merge decision: ALREADY MERGED + OUR ADDITIONS

The upstream fix (remove 5-line fallback) was applied during the initial merge. Our multi-instance directory parameter changes are additive.

## Verification

```
grep "Fallback: return the first action" detectDevServer.ts → NOT FOUND (correctly removed)
```

## Status

Complete. No action needed.
