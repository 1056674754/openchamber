# #19 `526f9a51` — Context Panel read-only subagent sessions

## Upstream Summary
Opens subagent sessions in read-only mode inside the context panel, instead of switching the main session. Users can view subagent chats without accidentally modifying them.

## Changes Applied

### Code files (7)

| File | Change |
|------|--------|
| `App.tsx` | Restructure `EmbeddedSessionSelectionGate` → `EmbeddedSessionChatContent`: now renders ChatView directly with `readOnly` prop, uses bootstrap key ref for session selection, adds `normalizeEmbeddedDirectory` helper |
| `ChatView.tsx` | Add `readOnly?: boolean` prop, pass to `ChatContainer` |
| `MessageBody.tsx` | Subtask "open session" button → opens in context panel with `readOnly: true` instead of switching session |
| `ToolPart.tsx` | Task session "open session" → opens in context panel with `readOnly: true` instead of switching session |
| `ContextPanel.tsx` | `ContextPanelTabLike` type gets `readOnly: boolean`; `buildEmbeddedSessionChatURL` accepts + propagates `readOnly` to URL params |
| `SessionNodeItem.tsx` | `openContextPanelTab` prop type gets `readOnly?: boolean` |
| `useUIStore.ts` | `ContextPanelTab` and `ContextPanelTabDescriptor` types get `readOnly` field; `createContextPanelTab` and `sanitizeContextPanelTabs` handle it |

### Already covered by earlier commits
- `ChatContainer.tsx` — `promptReadOnly` from #18 (superset of #19's `readOnly`)
- 7 i18n files — `readOnlySubagentPromptBanner` from #18

## Post-merge fixes
- Fixed `ContextPanelTabLike` missing `readOnly` field in local type definition
- Fixed `selectedProjectId` → removed from `openNewSessionDraft` calls (3 sites in SidebarProjectsList + SessionGroupSection)
- Added missing `sessions.sidebar.session.menu.runFusion` i18n key to all 7 app locale files
- Fixed `ModelMultiSelect.tsx` Enter handler: `onAdd({...};` → `const nextModel = {...};`

## Divergences Preserved
- Our `useEffectiveDirectory` used instead of upstream's simpler directory logic in MessageBody
- Our `ChatContainer.promptReadOnly` is a superset (includes `parentSession` check)
- Our multi-instance architecture preserved in App.tsx

## Verification
- `bun run type-check` — all 5 workspaces pass (0 errors)
