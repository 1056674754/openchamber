# feat: make agent switching shortcut configurable (#1186)

**Upstream**: `b6125967`  
**Date**: 2026-05-15  
**Files**: `ChatInput.tsx`, `ModelControls.tsx`, `HelpDialog.tsx`, `useKeyboardShortcuts.ts`, `shortcuts.ts`, i18n (14 files)

## What upstream did

1. Added `cycle_agent` to shortcut action registry
2. Replaced hardcoded `Tab` key with configurable shortcut
3. Supports bidirectional cycling (forward/backward via Shift modifier)
4. `handleCycleAgent` takes `direction: 1 | -1` parameter
5. Shortcut displayed in ModelControls and HelpDialog

## Our divergence

Our `ChatInput.tsx` has custom additions:
- Queue mode with Ctrl+Enter toggle (`ComposerActionButtons`)
- Custom send/queue button behavior

Our `useKeyboardShortcuts.ts` has custom changes:
- Multi-instance terminal routing (`openContextTerminal` instead of `toggleBottomTerminal`)
- `useEffectiveDirectory` hook usage

Our `ModelControls.tsx` has multi-instance server support.

## Merge decision: ALREADY MERGED (baseline) + OUR ADDITIONS

The `cycle_agent` shortcut was applied during the initial merge. Our queue mode and multi-instance changes are layered on top.

## Verification

```
grep "cycle_agent" packages/ui/src/lib/shortcuts.ts → 1 match (present)
grep "cycleAgentShortcutOverride" packages/ui/src/components/chat/ChatInput.tsx → 3 matches
grep "eventMatchesShortcut" packages/ui/src/components/chat/ModelControls.tsx → 2 matches
```

## Status

Complete. No action needed.
