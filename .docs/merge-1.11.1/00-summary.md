# Upstream Merge Summary: v1.11.0 → v1.11.1

**Merge date**: 2026-05-18  
**Upstream range**: `v1.11.0..v1.11.1` (21 commits, 78 files, +2737/-419)  
**Initial merge commit**: `fc867c49` (already merged most changes)  
**Strategy**: Manual review — each commit verified against our codebase

---

## Overall Result

**All 21 upstream commits have been reviewed. 20/21 are fully merged. 1 has a minor gap.**

| Status | Count | Commits |
|--------|-------|---------|
| ✅ Already merged | 17 | #3-16, #18-21 |
| ⏭️ Skipped (dev tooling) | 2 | #1, #2 |
| ⏭️ Skipped (version bump) | 1 | #22 |
| ⚠️ Partially merged | 1 | #17 (toast gating missing) |

---

## The One Gap

### Commit #17: `OpenCodeUpdateToast.tsx` setting gating

**What's present**: 
- `showOpenCodeUpdateNotifications` in `useUIStore` ✅
- Checkbox in `OpenCodeCliSettings.tsx` ✅
- i18n strings ✅

**What's missing**: 
- `OpenCodeUpdateToast.tsx` doesn't read the setting — it always shows update toasts
- The `useUIStore` import and gating logic was stripped from our version

**Impact**: Low — the setting checkbox exists in settings but has no effect. Update toasts always show.

**Fix required**: Add back the `useUIStore` import and setting check to `OpenCodeUpdateToast.tsx` (see upstream diff in commit #17 doc).

---

## Our Divergences (not upstream gaps)

These are our intentional customizations that cause files to differ from upstream:

| File | Our additions |
|------|---------------|
| `ModelControls.tsx` | Multi-instance remote server support (`useActiveServerId`, `serverRegistry`) |
| `ChatInput.tsx` | Queue mode (Ctrl+Enter toggle), custom send/queue button UI |
| `useKeyboardShortcuts.ts` | Multi-instance terminal routing (`openContextTerminal`) |
| `useUIStore.ts` | `terminal` context panel mode, `SessionSortMode`, split panel state |
| `App.tsx` | Multi-instance routing, directory normalization |
| `ChatContainer.tsx` | Custom session management additions |
| `ToolPart.tsx` | Multi-instance-aware directory handling for subagent sessions |
| `ProgressiveGroup.tsx` | ToolCallGroup, getStaticGroupToolName imports |
| `MessageList.tsx` | Directive turns, compaction turn detection, turn grouping context |
| `ContextPanel.tsx` | Split panel support (`splitTabId`, `splitRatio`) |
| `detectDevServer.ts` | `directory` parameter for multi-instance file reads |
| `MessageBody.tsx` | ToolCallGroup, custom imports |

---

## Per-Commit Documents

| # | File | Upstream | Verdict |
|---|------|----------|---------|
| 1 | `01-chore-react-doctor-workflow.md` | `e7d64fff` | SKIP (tooling) |
| 2 | `02-chore-rd-manual-testing-guidance.md` | `f33e59cf` | SKIP (tooling) |
| 3 | `03-refactor-model-controls-react-doctor.md` | `ec61167c` | MERGED |
| 4 | `04-feat-multirun-non-git-projects.md` | `9f14dab6` | MERGED |
| 5 | `05-fix-large-git-change-lists.md` | `3e4fb18a` | MERGED |
| 6 | `06-feat-configurable-agent-shortcut.md` | `b6125967` | MERGED |
| 7 | `07-fix-tooltip-context-crashes.md` | `df151ebf` | MERGED |
| 8 | `08-fix-quota-timezone.md` | `3d741c2c` | MERGED |
| 9 | `09-feat-multirun-isolation.md` | `9842b6cc` | MERGED |
| 10 | `10-feat-multirun-fusion.md` | `42e4f5ac` | MERGED |
| 11 | `11-fix-preview-unrelated-actions.md` | `f4851ada` | MERGED |
| 12 | `12-fix-preview-proxy-absolute-urls.md` | `ba9750a3` | MERGED |
| 13 | `13-fix-skills-catalog-dropdown-label.md` | `945ffa17` | MERGED |
| 14 | `14-feat-session-switcher-dropdown.md` | `6df6e3ab` | MERGED |
| 15 | `15-feat-session-switcher-vscode.md` | `b13cb2ee` | MERGED |
| 16 | `16-fix-hide-branch-non-git-draft.md` | `a314411f` | MERGED |
| 17 | `17-feat-opencode-update-notification-setting.md` | `47fddfec` | ⚠️ PARTIAL |
| 18 | `18-feat-subagent-read-only-context-panel.md` | `526f9a51` | MERGED |
| 19 | `19-feat-subagent-chats-readonly.md` | `e2f45bda` | MERGED |
| 20 | `20-feat-mini-chat-new-session-shortcut.md` | `63f302e3` | MERGED |
| 21 | `21-fix-animate-tool-paths-sorted-chat.md` | `15d3cc0c` | MERGED |
| 22 | `22-release-v1.11.1.md` | `f3ece2ba` | SKIP (version) |
