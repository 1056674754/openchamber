# feat: open subagent sessions read-only in context panel

**Upstream**: `526f9a51`  
**Date**: 2026-05-15  
**Files** (15): `App.tsx`, `ChatContainer.tsx`, `MessageBody.tsx`, `ToolPart.tsx`, `ContextPanel.tsx`, `SessionNodeItem.tsx`, `ChatView.tsx`, i18n (7 files), `useUIStore.ts`

## What upstream did

1. `App.tsx`: adds `readOnly` URL parameter for embedded sessions
2. `ChatContainer.tsx`: adds `promptReadOnly = readOnly || Boolean(parentSession)`
3. `ToolPart.tsx`: adds "Open subagent" button opening in context panel
4. `MessageBody.tsx`: adds click handler for subagent session links
5. `ContextPanel.tsx`: passes `readOnly` flag

## Our divergence

All 8 code files DIFFER from upstream due to our custom changes:
- `App.tsx`: our multi-instance routing
- `ChatContainer.tsx`: our session management additions
- `ToolPart.tsx`: our directory handling for subagent sessions (`[sscity-mod]` comments)
- `ContextPanel.tsx`: our split panel support
- `MessageBody.tsx`: our ToolCallGroup and other additions
- `useUIStore.ts`: our `terminal` mode, `SessionSortMode`, split panel state

## Partially applied features

- `promptReadOnly` logic → PRESENT (5 matches in ChatContainer)
- `readOnly` in App.tsx → PRESENT (3 matches)
- `readOnly` in ContextPanel → PRESENT (3 matches)
- `ChatView.tsx` → MATCHES upstream
- **`MessageBody.tsx` openSubagent click → MISSING** (0 matches for "subagent" click handler)
- **`ToolPart.tsx` "Open subagent" button → OUR CUSTOM VERSION** (uses `setCurrentSession` instead of `openContextPanelTab`)

## Merge decision: MOSTLY MERGED, MINOR GAPS

The core read-only logic is applied. Our ToolPart handles subagent opening differently (using `setCurrentSession` with parent directory instead of `openContextPanelTab` — this is intentional for our multi-instance architecture). MessageBody lacks the subagent click handler from upstream.

## Status

Mostly complete. The MessageBody subagent click handler gap is **minor** — it only affects clicking subagent links in message text. Our ToolPart already has the "Open session" button with our custom multi-instance-aware logic.
