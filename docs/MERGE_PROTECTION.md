# Merge Protection Guide — Local-Only Features

> **Purpose**: This document lists ALL local-only features that exist on this fork but NOT in upstream (btriapitsyn/openchamber). Before every upstream merge, verify each section to ensure nothing is lost.
>
> **Last verified**: 2026-05-11 (HEAD vs upstream v1.10.4)

## How to Use This Document

1. Before merging a new upstream release, diff the upstream tag against HEAD
2. For every file the upstream changes, check if it appears in the **Hotspot Files** section below
3. After the merge, search for each local feature's **signature token** to verify it survived
4. If a signature is missing, cherry-pick or re-apply from the referenced commit

---

## Critical Hotspot Files (touched by 3+ merges)

These files are changed in EVERY upstream release AND contain local features. **Always verify after merge.**

| File | Merges touched | Local features at risk |
|---|---|---|
| `packages/ui/src/components/chat/ChatInput.tsx` | 4/5 merges | Queue mode button (45° rotate + tooltip), multi-server routing, draft context |
| `packages/ui/src/components/views/FilesView.tsx` | 4/5 merges | Multi-server directory context, remote project support |
| `packages/ui/src/components/chat/ChatMessage.tsx` | 3/5 merges | Reasoning UI, turn windowing, subagent rendering |
| `packages/ui/src/components/chat/MessageList.tsx` | 3/5 merges | Full-tree turn windowing, subagent visibility, sticky turns |
| `packages/ui/src/components/chat/message/MessageBody.tsx` | 3/5 merges | Reasoning collapse, turn windowing, tool call group |
| `packages/ui/src/sync/sync-context.tsx` | 3/5 merges | Multi-server sync layer, stuck-session timeout, SSE reconnect |
| `packages/ui/src/components/session/sidebar/SessionNodeItem.tsx` | 3/5 merges | Global pinned indicator, matrix spinner, remote status |
| `packages/electron/main.mjs` | 4/5 merges | SSH manager, port persistence, mini-chat windows |
| `packages/ui/src/lib/i18n/messages/en.ts` | 5/5 merges | 107 local-only i18n keys (see below) |
| All `packages/ui/src/lib/i18n/messages/*.ts` | 5/5 merges | 107 keys × 7 locales = ~749 keys to preserve |

---

## Feature Catalog

### F1: Queue Mode (Commit: `19b6e6c9`)

**Status**: ✅ Restored (was lost in v1.10.3 merge)

**What it does**:
- Enter/Ctrl+Enter send behavior toggles between "queue" and "send immediately" based on setting
- Floating queue button above stop button with 45° rotated send icon
- Dynamic tooltip showing "Click to queue" / "Ctrl+Click to send immediately"
- Ctrl/Meta key held detection for real-time tooltip updates

**Files containing this feature**:
- `packages/ui/src/components/chat/ChatInput.tsx` — `ComposerActionButtons` component
  - Props: `onSendNow`, `queueModeEnabled`
  - State: `isCtrlHeld` with keyboard listeners
  - Icon: `RiSendPlane2Line` with `-rotate-45`
  - Tooltip: `<Tooltip>` wrapping queue button with `tooltipText`
  - Memo comparison must include `queueModeEnabled`
- `packages/ui/src/components/chat/ChatInput.tsx` — `handleKeyDown` (Enter/Ctrl+Enter logic, lines ~1844-1873)
- `packages/ui/src/components/chat/ChatInput.tsx` — `handleSendNow` callback
- `packages/ui/src/components/chat/ChatInput.tsx` — `handlePrimaryAction` callback

**i18n keys to preserve**:
- `chat.chatInput.actions.queueButton.enter`
- `chat.chatInput.actions.queueButton.ctrlEnter`
- `chat.chatInput.actions.queueButton.queue`
- `chat.chatInput.actions.queueButton.send`
- `chat.chatInput.actions.queueMessageTooltip`
- `chat.chatInput.actions.sendImmediatelyAria`
- `chat.chatInput.actions.sendImmediatelyTooltip`

**Signature tokens to grep after merge**:
```
-rotate-45
isCtrlHeld
onSendNow
queueButton.ctrlEnter
handleSendNow
```

---

### F2: Global Pinned Sessions (Commit: `19b6e6c9`)

**What it does**:
- Sessions can be pinned globally (visible across all projects)
- Drag-and-drop reorder of pinned sessions via dnd-kit
- "Pin Globally" / "Pin to Project" in session context menu

**Files**:
- `packages/ui/src/components/session/sidebar/SessionGroupSection.tsx`
- `packages/ui/src/components/session/sidebar/SidebarProjectsList.tsx`
- `packages/ui/src/components/session/sidebar/sortableItems.tsx`
- `packages/ui/src/components/session/sidebar/hooks/useSessionGrouping.ts`
- `packages/ui/src/components/session/sidebar/utils.tsx`
- `packages/ui/src/stores/useGlobalSessionsStore.ts`
- `packages/ui/src/stores/useUIStore.ts` — `pinMode` setting
- `packages/ui/src/lib/i18n/messages/en.ts` — global pinned i18n keys

**Signature tokens**:
```
globalPinned
pinGlobal
pinToProject
useGlobalSessionsStore
pinMode
```

---

### F3: Multi-Server Resolution (Commits: `024ed432`, `0062c998`, `b212b6f2`, `17125cdb`)

**What it does**:
- Connect to multiple OpenCode servers simultaneously
- Server-scoped directory, project, and SDK resolution
- Cross-server session visibility
- API calls routed to correct server via `serverId`
- Remote directory explorer dialog
- SSH terminal open for remote instances

**Files (new, local-only)**:
- `packages/ui/src/sync/MultiServerSyncLayer.tsx`
- `packages/ui/src/sync/RemoteProjectDiscovery.tsx`
- `packages/ui/src/sync/multi-server-hooks.ts`
- `packages/ui/src/sync/multi-server-registry.ts`
- `packages/ui/src/hooks/useActiveServerId.ts`
- `packages/ui/src/hooks/useServerAwareFetch.ts`
- `packages/ui/src/lib/api/serverUrl.ts`
- `packages/ui/src/lib/opencode/server-registry.ts`
- `packages/ui/src/lib/desktopSsh.ts`
- `packages/ui/src/components/session/RemoteDirectoryExplorerDialog.tsx`

**Files (modified, co-owned with upstream)**:
- `packages/ui/src/App.tsx` — multi-server bootstrap
- `packages/ui/src/lib/opencode/client.ts` — server-aware client
- `packages/ui/src/lib/desktop.ts` — server ID resolution
- `packages/ui/src/sync/sync-context.tsx` — multi-server sync hooks
- `packages/ui/src/sync/session-actions.ts` — server-scoped actions
- `packages/ui/src/sync/use-sync.ts` — server-aware sync
- `packages/ui/src/stores/useConfigStore.ts` — multi-server config
- `packages/ui/src/components/chat/ModelControls.tsx` — remote model filtering
- `packages/electron/main.mjs` — SSH routing
- `packages/electron/ssh-manager.mjs` — SSH instance management

**Signature tokens**:
```
serverId
useActiveServerId
MultiServerSyncLayer
server-registry
useServerAwareFetch
RemoteDirectoryExplorerDialog
desktopSsh
```

---

### F4: Temp Sessions (Commit: `024ed432`)

**What it does**:
- Ephemeral sessions that don't belong to a project
- "New temp session" action in sidebar
- Auto-archival and cleanup

**Files (new, local-only)**:
- `packages/ui/src/lib/tempSessions.ts`
- `packages/ui/src/sync/temp-session-tracker.ts`
- `packages/ui/src/components/session/sidebar/TempSessionsSection.tsx`
- `packages/web/server/lib/temp-sessions/routes.js`
- `packages/web/server/lib/temp-sessions/temp-session-directory.js`
- `packages/web/server/lib/temp-sessions/temp-session-directory.ts`

**Signature tokens**:
```
tempSession
TempSessionsSection
temp-session-tracker
temp-session-directory
```

---

### F5: Terminal in Context Panel (Commit: `dd5e2f7f`)

**What it does**:
- Terminal moved from chat bottom dock to context panel
- Split view support (top/bottom)
- Terminal tab in context panel

**Files**:
- `packages/ui/src/components/layout/ContextPanel.tsx` — terminal tab
- `packages/ui/src/components/layout/MainLayout.tsx` — split view
- `packages/ui/src/components/views/TerminalView.tsx` — context panel integration
- `packages/ui/src/components/layout/BottomTerminalDock.tsx` — legacy dock (kept?)
- `packages/ui/src/hooks/useKeyboardShortcuts.ts` — terminal shortcuts
- `packages/ui/src/components/ui/sortable-tabs-strip.tsx` — tab strip

**i18n keys**:
- `contextPanel.mode.terminal`
- `contextPanel.split.closeSplitAria`
- `contextPanel.split.dropBottomHint`
- `contextPanel.split.dropTopHint`
- `contextPanel.split.resizeAria`

**Signature tokens**:
```
contextPanel.mode.terminal
split view
BottomTerminalDock
```

---

### F6: Reasoning UI (Commit: `d1b5f45e`)

**What it does**:
- Collapsible "Thinking..." / "Thought" blocks for reasoning models
- Auto-collapse threshold setting
- Visual styling for reasoning content

**Files**:
- `packages/ui/src/components/chat/message/parts/ReasoningPart.tsx` (new)
- `packages/ui/src/components/chat/ChatMessage.tsx` — reasoning rendering
- `packages/ui/src/components/chat/MessageList.tsx` — reasoning display
- `packages/ui/src/components/chat/message/MessageBody.tsx` — reasoning section
- `packages/ui/src/lib/i18n/messages/en.ts` — `chat.reasoning.*`

**i18n keys**:
- `chat.reasoning.thinking`
- `chat.reasoning.thought`

**Settings**:
- `settings.openchamber.visual.field.autoCollapseThinking`
- `settings.openchamber.visual.field.autoCollapseThinkingThresholdLabel`

**Signature tokens**:
```
ReasoningPart
chat.reasoning.thinking
autoCollapseThinking
```

---

### F7: Full-Tree Turn Windowing (Commit: `5eff9595`)

**What it does**:
- Virtualized turn rendering for large sessions
- Two-layer sticky for directive turns + scroll shadow
- Per-turn identity reuse for performance

**Files**:
- `packages/ui/src/components/chat/lib/turns/windowTurns.ts` (new)
- `packages/ui/src/components/chat/lib/turns/projectTurnRecords.ts` — turn projection
- `packages/ui/src/components/chat/lib/turns/types.ts` — turn types
- `packages/ui/src/components/chat/components/TurnItem.tsx`
- `packages/ui/src/components/chat/components/TurnAssistantBlock.tsx`
- `packages/ui/src/components/chat/hooks/useChatTimelineController.ts`

**Signature tokens**:
```
windowTurns
projectTurnRecords
TurnItem
useChatTimelineController
```

---

### F8: Sidebar Dot-Matrix Spinner (Commits: `5564b3b7`, `76dce963`)

**What it does**:
- Custom matrix-style spinner animation for session status
- Used for streaming and subagent sessions in sidebar

**Files**:
- `packages/ui/src/components/session/sidebar/SidebarSpinner.tsx` (new)
- `packages/ui/src/components/session/sidebar/SessionNodeItem.tsx`

**Signature tokens**:
```
SidebarSpinner
matrix spinner
dot-matrix
```

---

### F9: Sidebar Refresh + New Session Dropdown (Commit: `02a64719`)

**What it does**:
- Refresh button in sidebar header
- New-session button converted to dropdown (local dir, remote dir, temp session)

**Files**:
- `packages/ui/src/components/session/SessionSidebar.tsx`
- `packages/ui/src/components/session/sidebar/SidebarHeader.tsx`
- `packages/ui/src/components/session/sidebar/SidebarProjectsList.tsx`
- `packages/ui/src/components/session/sidebar/sortableItems.tsx`

**Signature tokens**:
```
addLocalProject
addRemoteProject
newTempSession
refresh.*sidebar
```

---

### F10: Remote Instances UX (Commit: `3f086938`)

**What it does**:
- Test connection button for SSH instances
- Search across remote instances
- Status indicators (healthy/unhealthy/connecting)

**Files**:
- `packages/ui/src/components/sections/remote-instances/RemoteInstancesPage.tsx`
- `packages/ui/src/components/sections/remote-instances/RemoteInstancesSidebar.tsx`
- `packages/ui/src/lib/desktopSsh.ts`

**i18n keys**: `instanceInfoPanel.*` (30+ keys)

**Signature tokens**:
```
instanceInfoPanel
testConnection
RemoteInstancesSidebar
sshPhase
```

---

### F11: File Existence Validation (Commit: `11fceaf6`)

**What it does**:
- Validates file links in chat messages
- Shows inline "File not found" badge for missing files

**Files**:
- `packages/ui/src/components/chat/MarkdownRendererImpl.tsx`
- `packages/ui/src/index.css` — missing file badge styles
- `packages/ui/src/lib/i18n/messages/en.ts` — `chat.file.notFound`

**Signature tokens**:
```
chat.file.notFound
missing-file
fileNotFound
```

---

### F12: Revert Confirmation Dialog (Commit: `19b6e6c9`)

**What it does**:
- Confirmation dialog before reverting to a previous turn
- Warns about losing subsequent messages

**i18n keys**:
- `chat.revertConfirm.title`
- `chat.revertConfirm.description`
- `chat.revertConfirm.confirm`
- `chat.revertConfirm.cancel`

**Signature tokens**:
```
revertConfirm
```

---

### F13: Port Persistence (Commit: `19b6e6c9`)

**What it does**:
- Persists OpenCode port across restarts
- Reconnects on startup using saved port
- Desktop setting for keeping OpenCode running after quit

**Files**:
- `packages/web/server/lib/opencode/lifecycle.js`
- `packages/web/server/lib/opencode/project-directory-runtime.js`
- `packages/ui/src/stores/useConfigStore.ts`
- `packages/electron/main.mjs`
- `packages/ui/src/components/sections/openchamber/DesktopOpenCodeSettings.tsx` (new)
- `packages/ui/src/lib/i18n/messages/en.settings.ts` — `desktopOpenCode.*`

**Signature tokens**:
```
keepAlive
port persistence
DesktopOpenCodeSettings
```

---

### F14: Agent Picker Simplification (Commit: `471157b6`)

**What it does**:
- Simplified agent picker UX with floating preview panel
- Shows agent description on hover

**Files**:
- `packages/ui/src/components/chat/ModelControls.tsx`

**Signature tokens**:
```
agent.*preview.*panel
agent.*description.*floating
```

---

### F15: Stuck-Session Recovery (Commit: `f4fd94e5`)

**What it does**:
- Timeout detection for stuck sessions
- Post-bootstrap resync
- SSE reconnect status reset

**Files**:
- `packages/ui/src/sync/sync-context.tsx`
- `packages/web/server/index.js`
- `packages/web/server/lib/opencode/watcher.js`

**Signature tokens**:
```
stuck-session
post-bootstrap resync
reconnect status reset
```

---

### F16: Subagent Session Rendering (Commits: `1a14df84`, `7fbde2ae`, `aedd222e`)

**What it does**:
- Proper rendering of subagent sessions in chat
- Parent directory hint when opening subagent session
- Subsession tree interactions and chevron placement

**Files**:
- `packages/ui/src/App.tsx`
- `packages/ui/src/components/chat/MessageList.tsx`
- `packages/ui/src/components/chat/lib/turns/projectTurnRecords.ts`
- `packages/ui/src/components/chat/message/parts/ToolPart.tsx`
- `packages/ui/src/components/session/sidebar/SessionNodeItem.tsx`
- `packages/ui/src/hooks/useChatScrollManager.ts`

**Signature tokens**:
```
subagent.*session
parentDirectory.*hint
subsession.*chevron
```

---

### F17: CLI Standalone Entry Point (Commit: `19b6e6c9`)

**What it does**:
- Standalone CLI entry via embedded assets
- `scripts/embed-assets.mjs` for building
- `packages/web/bin/cli-standalone.mjs`

**Files (new, local-only)**:
- `packages/web/bin/cli-standalone.mjs`
- `packages/web/bin/embedded-assets.generated.mjs`
- `packages/web/compile-entry.js`
- `scripts/embed-assets.mjs`

**Signature tokens**:
```
cli-standalone
embed-assets
compile-entry
```

---

### F18: Dropdown Auto-Close Fix (Commit: `1b29cef2`)

**What it does**:
- Prevents dropdown menus from auto-closing on mouse leave

**Files**:
- `packages/ui/src/components/ui/dropdown-menu.tsx`

**Signature tokens**:
```
auto-closing.*mouse leave
```

---

## Local-Only Files (not in upstream at all)

These files exist ONLY locally. **They should never conflict in a merge** (upstream doesn't know about them), but verify they still exist after merge:

```
# UI — new components
packages/ui/src/components/chat/message/parts/BackgroundTaskPart.tsx
packages/ui/src/components/chat/message/parts/ToolCallGroup.tsx
packages/ui/src/components/chat/message/parts/ReasoningPart.tsx
packages/ui/src/components/debug/BootstrapDebug.tsx
packages/ui/src/components/sections/openchamber/DesktopOpenCodeSettings.tsx
packages/ui/src/components/session/RemoteDirectoryExplorerDialog.tsx
packages/ui/src/components/session/sidebar/SidebarSpinner.tsx
packages/ui/src/components/session/sidebar/TempSessionsSection.tsx

# UI — new hooks/lib
packages/ui/src/hooks/useActiveServerId.ts
packages/ui/src/hooks/useServerAwareFetch.ts
packages/ui/src/lib/api/serverUrl.ts
packages/ui/src/lib/messages/system-directive.ts
packages/ui/src/lib/opencode/server-registry.ts
packages/ui/src/lib/tempSessions.ts

# UI — sync layer
packages/ui/src/sync/MultiServerSyncLayer.tsx
packages/ui/src/sync/RemoteProjectDiscovery.tsx
packages/ui/src/sync/multi-server-hooks.ts
packages/ui/src/sync/multi-server-registry.ts
packages/ui/src/sync/temp-session-tracker.ts

# Web server
packages/web/bin/cli-standalone.mjs
packages/web/bin/embedded-assets.generated.mjs
packages/web/compile-entry.js
packages/web/server/lib/fs/routes.test.js
packages/web/server/lib/opencode/project-directory-runtime.test.js
packages/web/server/lib/temp-sessions/routes.js
packages/web/server/lib/temp-sessions/temp-session-directory.js
packages/web/server/lib/temp-sessions/temp-session-directory.ts
```

---

## i18n Keys to Preserve (107 local-only keys)

All keys in `packages/ui/src/lib/i18n/messages/en.ts` that do NOT exist in upstream v1.10.4. **After every merge, run:**

```bash
diff <(git show v1.10.N:packages/ui/src/lib/i18n/messages/en.ts | grep "'" | sort) \
     <(grep "'" packages/ui/src/lib/i18n/messages/en.ts | sort) | grep "^>"
```

Any line prefixed with `>` is a local-only key that must survive the merge. Repeat for all 7 locales: `en`, `es`, `ko`, `pt-BR`, `uk`, `zh-CN`, `pl`.

### Key groups:

| Group | Count | Key prefix |
|---|---|---|
| Queue mode | 7 | `chat.chatInput.actions.queueButton.*`, `sendImmediately*` |
| Reasoning UI | 2 | `chat.reasoning.*` |
| Revert confirm | 4 | `chat.revertConfirm.*` |
| Compaction | 2 | `chat.compaction.*` |
| File validation | 1 | `chat.file.notFound` |
| Context panel/terminal | 5 | `contextPanel.*` |
| Remote directory | 13 | `remoteDirectoryExplorer.*` |
| Instance info | 25 | `instanceInfoPanel.*` |
| Sidebar actions | 15 | `sessions.sidebar.header.actions.*`, `sessions.sidebar.session.menu.*` |
| Global pinned | 3 | `sessions.sidebar.activity.globalPinned*`, `sessions.sidebar.session.status.pinnedGlobal` |
| Remote status | 5 | `sessions.sidebar.remote.*` |
| Temp sessions | 10 | `sessions.sidebar.tempSession.*` |
| Settings (openchamber) | 15 | `settings.openchamber.defaults.*`, `settings.openchamber.desktopOpenCode.*`, `settings.openchamber.visual.*` |

---

## Post-Merge Verification Checklist

After every upstream merge, run through this checklist:

### Step 1: Signature grep

```bash
# Queue mode (MUST find all 5)
grep -c "rotate-45" packages/ui/src/components/chat/ChatInput.tsx
grep -c "isCtrlHeld" packages/ui/src/components/chat/ChatInput.tsx
grep -c "onSendNow" packages/ui/src/components/chat/ChatInput.tsx
grep -c "queueButton.ctrlEnter" packages/ui/src/components/chat/ChatInput.tsx
grep -c "handleSendNow" packages/ui/src/components/chat/ChatInput.tsx

# Multi-server
grep -c "serverId" packages/ui/src/lib/opencode/client.ts
grep -c "MultiServerSyncLayer" packages/ui/src/sync/sync-context.tsx
grep -c "useActiveServerId" packages/ui/src/App.tsx

# Local-only files must exist
ls packages/ui/src/sync/MultiServerSyncLayer.tsx
ls packages/ui/src/components/session/sidebar/SidebarSpinner.tsx
ls packages/ui/src/components/session/sidebar/TempSessionsSection.tsx
ls packages/ui/src/components/chat/message/parts/ReasoningPart.tsx

# i18n key count (should be 107 local-only keys in en.ts)
diff <(git show v1.10.N:packages/ui/src/lib/i18n/messages/en.ts | grep "'" | sort) \
     <(grep "'" packages/ui/src/lib/i18n/messages/en.ts | sort) | grep "^>" | wc -l
```

### Step 2: Build verification

```bash
bun run type-check
bun run lint
```

### Step 3: Known regression patterns

If any of these appear in the merge diff, **STOP and manually verify**:

1. `ChatInput.tsx` changes touching `ComposerActionButtons` → verify queue mode props
2. `SessionNodeItem.tsx` changes → verify global pinned, matrix spinner, remote status
3. `sync-context.tsx` changes → verify multi-server hooks, stuck-session timeout
4. `MessageList.tsx` changes → verify turn windowing, subagent rendering
5. `ModelControls.tsx` changes → verify remote model filtering, agent picker
6. Any i18n file changes → diff against local keys to ensure no deletions

---

## Merge History

| Date | Upstream | Merge Commit | Issues Found |
|---|---|---|---|
| 2026-04-?? | v1.10.0 | `e5687966` | — |
| 2026-04-?? | v1.10.1 | `6718887f` | — |
| 2026-05-01 | v1.10.2 | `7434f075` | — |
| 2026-05-08 | v1.10.3 | `57e1bc0a` | ❌ Lost queue mode button (45° + tooltip), lost `onSendNow`/`queueModeEnabled` props |
| 2026-05-08 | v1.10.4 | `6867e8ae` | — |
| 2026-05-11 | — | — | ✅ Restored queue mode button from `19b6e6c9` |
