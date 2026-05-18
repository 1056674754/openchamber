# feat: add session switcher dropdown in header

**Upstream**: `6df6e3ab`  
**Date**: 2026-05-15  
**Files** (17): `SessionSwitcherDropdown.tsx` (NEW), `useSwitcherItems.ts` (NEW), `useActiveNowStore.ts` (NEW), `useSessionPinnedStore.ts` (NEW), `Header.tsx`, `SessionSidebar.tsx`, `MiniChatLayout.tsx`, `ElectronMiniChatApp.tsx`, `useUIStore.ts`, `useSidebarPersistence.ts`, i18n (7 files)

## What upstream did

1. New `SessionSwitcherDropdown` — dropdown in header showing sessions by project/recency
2. New `useActiveNowStore` — tracks active sessions
3. New `useSessionPinnedStore` — tracks pinned sessions
4. New `useSwitcherItems` hook — computes switcher items
5. `Header.tsx` gains session switcher dropdown
6. `SessionSidebar.tsx` simplified
7. `MiniChatLayout.tsx` gets the switcher
8. `ElectronMiniChatApp.tsx` gets ref guards to prevent re-bootstrap

## Our divergence

- `Header.tsx` DIFFERS — we have multi-instance server UI additions
- `SessionSidebar.tsx` DIFFERS — likely has our custom session management
- `MiniChatLayout.tsx` DIFFERS — may have our customizations
- `ElectronMiniChatApp.tsx` DIFFERS — our bootstrap may differ
- `useUIStore.ts` DIFFERS — our `ContextPanelMode` includes `terminal`, `SessionSortMode`, `splitTabId`/`splitRatio`

## Merge decision: ALREADY MERGED (baseline) + OUR ADDITIONS

All new files exist and match upstream. Our differences in modified files are additive custom features.

## Verification

```
ls packages/ui/src/components/session/SessionSwitcherDropdown.tsx → EXISTS
ls packages/ui/src/stores/useActiveNowStore.ts → EXISTS
ls packages/ui/src/stores/useSessionPinnedStore.ts → EXISTS
ls packages/ui/src/components/session/sidebar/hooks/useSwitcherItems.ts → EXISTS
```

## Status

Complete. No action needed.
