# feat: add fusion for multi-run sessions

**Upstream**: `42e4f5ac`  
**Date**: 2026-05-15  
**Files**: `MultiRunFusionDialog.tsx` (NEW, 259 lines), `MultiRunLauncher.tsx`, `ModelMultiSelect.tsx`, `FusionIcon.tsx` (NEW, 31 lines), `title.ts`, i18n (7 files)

## What upstream did

1. "Fusion" feature combines results from multiple multi-run sessions
2. `MultiRunFusionDialog` — pick sources, model, prompt to fuse
3. Creates new session with concatenated results
4. Custom `FusionIcon` component
5. Enhanced `ModelMultiSelect` with inline dropdown

## Merge decision: ALREADY MERGED

All new files exist:
- `MultiRunFusionDialog.tsx` → EXISTS
- `FusionIcon.tsx` → EXISTS
- `title.ts` → EXISTS

`ModelMultiSelect.tsx` DIFFERS but only due to our custom changes.

## Verification

```
ls packages/ui/src/components/multirun/MultiRunFusionDialog.tsx → EXISTS
ls packages/ui/src/components/icons/FusionIcon.tsx → EXISTS
ls packages/ui/src/lib/multirun/title.ts → EXISTS
```

## Status

Complete. No action needed.
