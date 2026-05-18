# fix: show large git change lists reliably

**Upstream**: `3e4fb18a`  
**Date**: 2026-05-14  
**Files**: `packages/ui/src/components/views/git/ChangesSection.tsx` (1 line change)

## What upstream did

Changed `CHANGE_LIST_VIRTUALIZE_THRESHOLD` from `120` to `1000`. Large change lists (100+ files) now render as a simple list instead of being virtualized, which was causing display issues.

## Merge decision: ALREADY MERGED

Our file has `CHANGE_LIST_VIRTUALIZE_THRESHOLD = 1000`.

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/views/git/ChangesSection.tsx → MATCH
```

## Status

Complete. No action needed.
