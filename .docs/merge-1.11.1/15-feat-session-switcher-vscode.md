# feat: add session switcher to VS Code layout

**Upstream**: `b13cb2ee`  
**Date**: 2026-05-15  
**Files**: `VSCodeLayout.tsx`, `SessionSwitcherDropdown.tsx`, `useSwitcherItems.ts`

## What upstream did

Extends session switcher dropdown for VS Code layout mode. Adds VS Code-specific filtering and dropdown positioning.

## Merge decision: ALREADY MERGED

`VSCodeLayout.tsx` matches upstream. `SessionSwitcherDropdown.tsx` and `useSwitcherItems.ts` exist.

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/layout/VSCodeLayout.tsx → MATCH
```

## Status

Complete. No action needed.
