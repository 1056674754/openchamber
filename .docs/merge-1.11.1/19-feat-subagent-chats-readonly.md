# feat: make subagent chats read-only

**Upstream**: `e2f45bda`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/components/chat/ChatContainer.tsx` (+5, -4)

## What upstream did

Extended commit #18's `promptReadOnly` logic — adds the `parentSession` check so subagent chats are always read-only (even without explicit `readOnly` prop).

## Merge decision: ALREADY MERGED

Our `ChatContainer.tsx` has `promptReadOnly` (5 matches), which includes the `parentSession` check.

## Verification

```
grep "promptReadOnly" ChatContainer.tsx → 5 matches
```

## Status

Complete. No action needed.
