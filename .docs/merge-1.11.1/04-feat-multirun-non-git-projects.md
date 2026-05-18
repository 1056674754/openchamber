# feat: support multi-run for non-Git projects

**Upstream**: `9f14dab6`  
**Date**: 2026-05-15  
**Files**: `BranchSelector.tsx`, `ModelMultiSelect.tsx`, `MultiRunLauncher.tsx`, i18n (7 files), `useMultiRunStore.ts`

## What upstream did

Enables multi-run for non-Git projects:
1. Added `useIsGitRepo` / `useGitLoadingStatus` hooks from `useGitStore`
2. Fetches git status proactively to determine repo state
3. Skips branch selection when not a git repo
4. Passes `isGitRepo` state through to launcher

## Merge decision: ALREADY MERGED

All hooks present:
- `useIsGitRepo` exists in our `useGitStore.ts`
- `useGitLoadingStatus` exists in our `useGitStore.ts`
- `BranchSelector.tsx` matches upstream exactly
- `MultiRunLauncher.tsx` matches upstream exactly
- `useMultiRunStore.ts` matches upstream exactly

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/multirun/BranchSelector.tsx → MATCH
git diff v1.11.1 HEAD -- packages/ui/src/components/multirun/MultiRunLauncher.tsx → MATCH
git diff v1.11.1 HEAD -- packages/ui/src/stores/useMultiRunStore.ts → MATCH
```

## Status

Complete. No action needed.
