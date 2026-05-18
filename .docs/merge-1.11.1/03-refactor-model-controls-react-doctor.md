# Reduce React Doctor diagnostics in ModelControls (#1265)

**Upstream**: `ec61167c`  
**Date**: 2026-05-14  
**Files**: `packages/ui/src/components/chat/ModelControls.tsx` (218+, 174-)

## What upstream did

Refactored ModelControls to reduce React Doctor diagnostics:
- Tailwind shorthand: `h-5 w-5` → `size-5`, `h-4 w-4` → `size-4`
- `.map().filter()` chains → imperative `for...of` loops
- Inlined `renderEditModeIcon` (removed `React.useCallback`)
- Reorganized `useMemo` dependencies

No behavior changes — pure code quality improvements.

## Our divergence

Our `ModelControls.tsx` has significant custom additions on top of upstream:
- Multi-instance remote server support (`useActiveServerId`, `serverRegistry`)
- Remote provider fetching effect
- Custom provider filtering for remote servers

The upstream refactor targets the shared baseline code (icon sizes, memo patterns, etc). Our additions are layered on top.

## Merge decision: ALREADY MERGED (baseline) + OUR ADDITIONS

The upstream refactoring patterns were applied during the initial merge. Our multi-instance additions are layered on top and don't conflict.

## Verification

- `ModelControls.tsx` DIFFERS from upstream — but the diff is our multi-instance code only
- The upstream Tailwind shorthand and memo optimizations are present
- `eventMatchesShortcut` import present (from commit #6)

## Status

Complete. No action needed.
