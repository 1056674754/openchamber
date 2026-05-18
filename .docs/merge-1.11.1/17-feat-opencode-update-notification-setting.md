# feat: add OpenCode update notification setting

**Upstream**: `47fddfec`  
**Date**: 2026-05-15  
**Files**: `OpenCodeCliSettings.tsx`, `OpenCodeUpdateToast.tsx`, `useUIStore.ts`, i18n settings (7 files)

## What upstream did

1. Added `showOpenCodeUpdateNotifications` setting (default `true`) to `useUIStore`
2. `OpenCodeUpdateToast` checks this setting before showing notification
3. `OpenCodeCliSettings` gets a new checkbox control

## Our divergence

Our `OpenCodeUpdateToast.tsx` DIFFERS — we DON'T have the `showOpenCodeUpdateNotifications` gating. Our version always shows the toast without checking the setting.

However:
- `useUIStore.ts` has `showOpenCodeUpdateNotifications` (4 matches)
- `OpenCodeCliSettings.tsx` has the checkbox (2 matches)
- i18n strings exist

So the setting exists in the store and settings UI, but the toast component doesn't read it.

## Merge decision: PARTIAL — SETTING EXISTS, TOAST GATING MISSING

The `showOpenCodeUpdateNotifications` state and settings checkbox are present. But `OpenCodeUpdateToast.tsx` doesn't gate on the setting — it always shows updates.

## Status

**REQUIRES FIX** — Add the setting check to `OpenCodeUpdateToast.tsx` if we want the setting to actually work.
