# feat: add optional multi-run isolation

**Upstream**: `9842b6cc`  
**Date**: 2026-05-15  
**Files**: `MultiRunLauncher.tsx`, `BranchSelector.tsx`, `useMultiRunStore.ts`, `en.ts`

## What upstream did

1. Added "Isolate runs" checkbox (defaults to true for Git projects)
2. When disabled, runs share workspace instead of creating worktrees
3. Auto-disables for non-Git projects
4. Passes `isolateRuns` flag to `createMultiRun`

## Merge decision: ALREADY MERGED

All files match upstream:
- `MultiRunLauncher.tsx` → MATCH
- `useMultiRunStore.ts` → MATCH
- `BranchSelector.tsx` → MATCH

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/multirun/MultiRunLauncher.tsx → MATCH
git diff v1.11.1 HEAD -- packages/ui/src/stores/useMultiRunStore.ts → MATCH
```

## Status

Complete. No action needed.
