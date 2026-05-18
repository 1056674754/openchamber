# feat: support new session shortcut in mini chat

**Upstream**: `63f302e3`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/hooks/useMiniChatKeyboardShortcuts.ts` (+13, -1)

## What upstream did

Adds keyboard shortcut to create a new session from the mini chat window. Calls `openNewSessionDraft` from `useSessionUIStore`.

## Merge decision: ALREADY MERGED

Our file has `openNewSessionDraft` (3 matches).

## Verification

```
grep "openNewSessionDraft" packages/ui/src/hooks/useMiniChatKeyboardShortcuts.ts → 3 matches
```

## Status

Complete. No action needed.
