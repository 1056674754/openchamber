# Merge v1.12.x → merge/v1.11.0

**Date**: 2026-06-04 ~ 2026-06-11
**Upstream**:
  - v1.11.7 (`5eccf83b`) → v1.12.0 (`996ffb08`), 56 commits, 347 files, +22816/-5022
  - v1.12.0 (`996ffb08`) → v1.12.1 (`b7cf5afd`), 173 files, +2421/-17345
  - v1.12.1 (`b7cf5afd`) → v1.12.2 (`a4c04ba7`), 16 commits, ~90 files, +2500/-700
  - v1.12.2 (`a4c04ba7`) → v1.12.3 (`cafbff47`), 5 commits, ~40 files, +640/-310
  - v1.12.3 (`cafbff47`) → v1.12.4 (`4a263c1`), 2026-06-11 release-note feature inventory added; commit/file diff pending
**Method**: 手工逐功能点移植，禁止 git merge/force

---

## v1.12.0 — 已移植功能

| Batch | 功能 | 文件数 | 说明 |
|---|---|---|---|
| 1.1 | Markdown 换行修复 | 1 | `UserTextPart.tsx` 添加 `applyHardLineBreaks()` |
| 1.2 | StatusRow selector 优化 | 1 | `useDirectorySync` 窄选择器，避免无关 re-render |
| 1.3 | 队列消息修复 | 3 | `useQueuedMessageAutoSend` 移除 `firstSeenIdle` 路径；`QueuedMessageChips` 重写为卡片式 UI + Edit/Send 按钮；`ChatInput` 集成发送逻辑 |
| 1.4 | ForkSessionDialog | 9 | 新建 `ThinkingPill`、`ForkSessionDialog` 组件；`executionMeta` 新增 fork 常量和 `composeForkSessionMessage`；`MessageBody` 集成对话框工作流；`session-ui-store` 签名改为接受 execution 参数；`sessionTypes`、`api/types` 类型更新 |
| 1.5 | JetBrains 主题 | 3 | `jetbrains-dark.json`、`jetbrains-light.json`；`presets.ts` 注册 |
| 1.7 | Agent 定义 | 2 | `.opencode/agent/reproduce-issue.md`、`triage.md` — GitHub issue 自动复现和分类 agent |
| 1.8 | 会话历史加载修复 | 1 | `session-prefetch-cache.ts` — `shouldSkipSessionPrefetch` 逻辑重排，修复无消息会话误跳过预取的 bug（#1468） |
| 1.9 | 浏览器语音 variant | 1 | `useBrowserVoice.ts` 把 `variant` 参数传入 `sendMessage`，仅 6 行改动 |

**v1.12.0 总计**: 26 files changed, +398/-84

---

## v1.12.1 — 已移植功能

| Batch | 功能 | 文件数 | 说明 |
|---|---|---|---|
| 2.1 | Tauri → Electron cutover | 28 | 删除整个 `packages/desktop/`，清理 `package.json`/`tsconfig.json`/`AGENTS.md`/`scripts/bump-version.mjs` 引用 |
| 2.2 | ToolPart LSP/JSON 输出 | 3 | `ToolPart.tsx` JSON 查看切换 + 复制按钮；`toolRenderUtils.ts` LSP 加入可展开工具列表；`toolHelpers.ts` LSP 工具元数据 |
| 2.3 | useGlobalSessionsStore | 2 | `useGlobalSessionsStore.ts` 重写 — 带 `mergeSessionDirectoryMetadata` 的目录感知会话管理；`globalSessions.ts` 全局会话操作 |
| 2.4 | Event pipeline | 2 | `event-pipeline.ts` + `event-reducer.ts` — 事件管线 + `areMessageUpdateFieldsEqual` 优化 |
| 2.5 | Store 层配合 | 3 | `useOpenInAppsStore.ts`、`useUpdateStore.ts`、`useUIStore.ts` — store 层配合 v1.12.1 改动 |
| 2.6 | i18n | 8 | `chat.toolPart.*` 5 个新 key × 8 个 locale |

**v1.12.1 总计**: ~21 files changed, +556/-95 (实际应用，不含还原)

### v1.12.1 — 不能直接移植（已跳过）

| 模块 | 原因 |
|---|---|
| **Electron main** | 上游退出流程与我们的 fork 冲突。应用后导致 Electron 反复打开多个网页窗口 —> 已还原；preload API rename 已在后续 cleanup 中完成 |
| **desktop libs** (`desktop.ts`, `desktopHosts.ts`, `desktopSsh.ts`, `desktopNative.ts`) | 已在后续 Tauri compat cleanup 中迁到 `__OPENCHAMBER_DESKTOP__`、`hasDesktopInvoke()`、`canUseDesktopNativeApi()`，并移除 UI 层 Tauri API import |
| **ChatInput** | 依赖 SDK 新接口 `MagicPromptId`、`pickFiles`、`summarizeSession`，SDK 版本未跟进 —> 已还原 |
| **MessageBody** | 依赖 `TurnGroupingContext.changedFiles` 新字段（需 types.ts 改造）—> 已还原 |
| **MessageList** | 依赖 `isDirectiveTurn` 新字段 + `showTurnChangedFiles` 新 option —> 已还原 |
| **SessionSidebar** | 用户要求最后处理，需仔细审查 |
| **MobileSessionStatusBar** | 依赖 UIStore 中不存在的 `mobileSessionPanelOpen` 等字段 |
| **sync-context.tsx** | 增加 `applySessionEventToGlobalSessions` 逻辑，导致远程实例侧边栏加载异常 —> 已还原 |
| **session-list-bootstrap.ts** | 改用 `listGlobalSessionPages` API，与其他未移植的改动耦合 —> 已还原 |

### v1.12.1 SessionSidebar Bugfix 补回 (2026-06-17 01:29 ~ 01:46)

**调查背景**：当初还原 v1.12.1 SessionSidebar 的理由记为"依赖 `mobileSessionPanelOpen` 等 mobile 字段"。2026-06-17 01:05 recon 确认这是**误判**——`SessionSidebar.tsx` 在 v1.12.1 不引用任何 mobile 字段，这些字段仅被 `MobileSessionsSheet.tsx` 和 `MobileSessionStatusBar.tsx` 消费。对上游 v1.11.7 → v1.12.1 范围内触及 `SessionSidebar.tsx` 的 6 个 commit 逐一 diff 对比 fork 当前代码：

| Commit | 功能 | Fork 状态 | 处理 |
|---|---|---|---|
| `7b3c59dc` | 增量刷新新目录 sessions | 🟡 store 层有 `refreshGlobalSessionsForDirectories` 但 SessionSidebar 未接入 | ✅ 已补：加 `projectSessionDirectories` memo + `knownProjectSessionDirectoriesRef` effect |
| `fc1db82d` | worktree session 分组修复 | ⚪ 不适用：fork 用 `openNewSessionDraft` 而非 `setCurrentSession`，worktree 流程不同 | 跳过 |
| `3715fa20` | 删除 recent session `filterNodes` 过滤 | ❌ 缺失：fork 仍有 `filterNodes`，recent session 被从 project group 隐藏 | ✅ 已补：删除 `filterNodes`，session 在 project group 正常显示 |
| `c8949e1f` | session 分组修复（`mergeSessionDirectoryMetadata`） | ✅ fork 已有等效实现 | 跳过 |
| `ddc7d0e1` | 归档开关 + 渐进式 show more | ❌ 缺失：fork 用旧 `expandedSessionGroups: Set<string>` 二态模式 | ✅ 已补：改为 `visibleSessionCountByGroup: Map<string, number>` 渐进式（每次 +7），加 `showArchivedSessions` toggle |
| `a03b1e42` | VS Code session UI（`!isVSCode` bug 修复） | ❌ 缺失：fork 有 `!isVSCode` 条件反转 bug | ✅ 随 `3715fa20` 删除 `filterNodes` 一并消除 |

**改动文件**（13 files）：
- `packages/ui/src/stores/useSessionDisplayStore.ts` — 加 `showArchivedSessions` + toggle
- `packages/ui/src/components/session/SessionSidebar.tsx` — state 改名 + callback 重写 + `sectionsForSidebarRender` 简化 + 增量刷新 memo/effect
- `packages/ui/src/components/session/sidebar/SessionGroupSection.tsx` — props 接口改 + `visibleSessions`/`canShowLess` 逻辑 + show more/fewer 按钮
- `packages/ui/src/components/session/sidebar/SidebarHeader.tsx` — 加 showArchivedSessions toggle
- `packages/ui/src/components/session/sidebar/prefetchOrder.ts` + test — 类型改 `expandedSessionGroups` → `visibleSessionCountByGroup`
- `packages/ui/src/lib/i18n/messages/*.ts` × 8 — 加 `showArchived` + `showMore` key

**验证**：`bun run lint` ✅ 0 errors / `bun run type-check` ✅ 我的改动相关 0 errors（残余 5 个 pre-existing errors 来自别的 agent 在做的 v1.13.0 `/handoff-review` i18n key 缺失，与本次改动无关）

---

## v1.12.0 — 未移植 / 还原 / 延后

### Batch 1.6 — Draft Welcome Starters + Chat 重构（✅ 已恢复核心功能）

**涉及文件**: `ChatContainer.tsx`、`MessageList.tsx`、`useChatTimelineController.ts`、`session-prefetch-cache.ts` (+ 3 个新建文件: `draftStarters.ts`、`useDraftStarters.ts`、`DraftPresetChips.tsx`)

**当前状态**：草稿启动页已在 `ChatContainer.tsx` 接入 `DraftPresetChips`，内置 starter、拖拽/增删、global/project persistence、i18n key、Magic Prompts 设置页等基础能力已存在。默认 chips 包含 `/explore`、`/catch-up`、`/weigh`、`/plan-feature`、`/debug`、`/workspace-review`，并已补齐对应 slash command handler。

**曾经为何还原**：首次应用官方整批 chat diff 后导致严重 bug：
- 聊天区域塌缩至 ~120×80px（`useCompactDraftLayout` / flex 布局变更）
- 会话列表不显示对话，显示 "No sessions in this workspace yet."，远程分支大量重复
- 运行时不稳（`handleHistoryScroll` 滚动检测效果引发测量死循环）

**仍需单独处理**：
- `handleHistoryScroll` 滚动自动加载历史仍未恢复，避免再次引入测量循环。
- `MessageList` 的官方虚拟化优化 → 跳过 v1.12.0 旧版，改按 v1.13.0 #25 (`virtua` 重写) 实现。（`TurnChangedFilePills` / `changedFiles` 已落地，见 feature gap 表）
- 注意命令名是 `/explore`，不是 `/explorer`。

**后续建议**：不要再整批套官方 chat diff。按以下顺序恢复剩余功能：
1. `handleHistoryScroll` 滚动加载逻辑（仅 `useChatTimelineController.ts`），验证不出现测量循环/跳动。
2. `TurnChangedFilePills` / `changedFiles`，先补类型和 grouping contract，再接 UI。
3. `MessageList` 虚拟化优化，最后处理。

### Batch 1.10 — Mobile UI（延后）

**涉及文件**: 18 个文件，`packages/ui/src/apps/MobileApp.tsx` 等完整移动端应用层

**延后原因**：用户选择 "Port mobile but defer"

---

## 跳过的功能

| 功能 | 原因 |
|---|---|
| 远程实例重构 (#1228) | 用户决定："官方改法已被我们抛弃"，我们的方案是 Electron server 转发 |
| VS Code adapter 主题颜色映射 | 不影响核心功能，暂不移植 |

---

## 尚未移植的功能 (feature gap)

### 用户体验相关

| 功能 | 说明 | 优先级 |
|---|---|---|
| **草稿启动页** | ✅ 已落地：新建会话展示快捷命令 chips（拖拽排序、搜索添加），`DraftPresetChips` + `useDraftStarters` 已接入 `ChatContainer` | 🟢 已完成 |
| **魔法命令** | ✅ 已落地：`/explore`、`/catch-up`、`/debug`、`/weigh`、`/plan-feature`、`/workspace-review` 均会展开为可见 prompt + hidden instructions，而不是裸发 slash command | 🟢 已完成 |
| **消息改动文件标记** | ✅ 已落地：实现为 `TurnChangedFilesDropdown`（下拉而非 pills），`changedFiles` 由 `activityParts` 经 `extractGitChangedFiles` 派生（非独立类型字段），已在 `MessageBody.tsx:2149` 渲染 | 🟢 已完成 |
| **时间格式偏好** | ✅ 已落地：新增 `packages/ui/src/lib/timeFormat.ts`，chat 消息 footer 与 Tunnel session 时间已接入 12/24 小时偏好 | 🟢 已完成 |
| **滚动加载历史** | 聊天区域触底自动加载更早消息，替代 "Load older messages" 按钮 | 🟡 中 |

### 移动端（延后）

| 功能 | 说明 |
|---|---|
| 完整移动端应用层 | 18 个文件：`MobileApp`, `MobileSessionsSheet`, `MobileFilesSurface`, `MobileChangesSurface`, `MobileSurfaceShell`, `MobileProjectEditSurface`, `MobileDeleteWorktreeDialog`, `renderMobileApp`, `mobileAppContext`, `mobileLayoutPreference`, `useMobileSessionExpansionStore`, `useMobileSessionTreeStore` 等 |

### 底层架构（不移植）

| 项 | 原因 |
|---|---|
| `preload API` 重命名 | 已完成：Electron preload 暴露 `__OPENCHAMBER_DESKTOP__` |
| `desktop libs` 清理 | 已完成：删除 `isTauriShell()` 引用并移除 `@tauri-apps/api` 依赖 |
| `runtime-*` 4 个文件 | `runtime-auth/fetch/switch/url` — 远程实例基础设施 (skip #1228) |
| `screenshot-capture` | 预览截图功能，依赖服务端重构 |
| `server-compatibility` | 服务端兼容性检查 |
| Electron 退出流程改进 | 后台服务清理/SSH 关闭/OpenCode kill，与我们的 fork 冲突 |

### 零散优化（暂不移植）

`Header`, `Layout`, `Settings`, `FilesView`, `Git PR Section`, `Git Commit Row`, `shortcuts`, `device`, `debug`, `url`, `ime`, `QuestionCard`, `OpenCodeCliSettings`, `PasskeySettings`, `TunnelSettings`, `UsageCard`, `UsagePage`, `ScheduledTasksDialog`, `ChooserScreen`, `LocalSetupScreen`, `RecoveryScreen`, `RemoteConnectionForm`, `DefaultsSettings`, `KeyboardShortcutsSettings`, `OpenChamberVisualSettings`, `OpenChamberPage`, `VSCodeLayout`, `ContextSidebarTab`, `DesktopHostSwitcher`, `OpenInAppButton`, `ThemeSystemContext` 等 ~40 个文件的小修改

---

## v1.12.2 — 移植状态

**上游 tag**: `a4c04ba7`
**范围**: v1.12.1 (`b7cf5afd`) → v1.12.2 (`a4c04ba7`), 16 commits, ~90 files, +2500/-700

### 状态校准 (2026-06-08)

| Batch | 当前状态 | 说明 |
|---|---|---|
| 3.1 | ✅ 已落地 | `startupTrace.ts` 已存在；`App.tsx`、`useConfigStore.ts` 的主要 startup trace 调用点已接入 |
| 3.2 | ✅ 已落地 | `device.ts` 已按官方 `useSyncExternalStore` + RAF 订阅式快照移植，保留本 fork 的 `isDesktopShell()` 设备判定 |
| 3.3 / 4.2 | ✅ 已落地 | `checkHealth()` 已改为 `/api/opencode/health`，并新增 web server `/api/opencode/health` route；`health-url.ts` / `client-health.test.ts` 覆盖 `/api`、desktop absolute URL、remote route |
| 3.4 | ✅ 已落地 | `useConfigStore.ts` 已接入 trace/source 参数、snapshot skip、`checkConnection` trace、跳过重复 `initApp()`、providers/agents 并行加载；保留本 fork 的 `serverId` / remote base URL 逻辑 |
| 3.5 | ✅ 已落地 | `sync-context.tsx` 已从 event `properties.sessionID` 提取 `message.part.updated/delta/removed` 的 sessionID，保留本 fork 的 serverId routing |
| 3.6 | ✅ 已落地 | `event-reducer.ts` 已从 event `properties.sessionID` 提取 part session，delta materialization 携带 sessionID，并保留 messageID guard |
| 3.7 | ✅ 已强于上游 | `optimisticSend` 已携带 `directory` + `serverId`，测试改为按 `serverRegistry` 的真实 reply client 路由 |
| 3.8 | ✅ 已落地 | `App.tsx` 已接 `App:mounted` trace，startup recovery 调用带 `source: 'startupRecovery'` |
| 3.9 | ⚪ 不适用 | 官方改动只作用于 `updateProportionalSidebarWidths` / `bottomTerminalHeight`；本 fork 当前 `useUIStore.ts` 无对应 bottom-terminal resize action，已确认没有可手工套用的同名状态路径 |
| 3.10 | ✅ 已落地 | `path-utils.ts` + test 已存在 |
| 3.S* | ✅ 主要落地 | `executable-search.js`、`install-help.js`、tunnel `types` / `index` / `routes`、provider install metadata、`ngrok-tunnel.js` URL/error handling、`cloudflare-tunnel.js` executable-search 已手工移植；版本号/CHANGELOG 仍按最终发布另处理 |

### 核心改动

| Batch | 功能 | 文件数 | 说明 | 合并难度 |
|---|---|---|---|---|
| 3.1 | 启动性能诊断框架 | 1 (新建) | `startupTrace.ts` — `markStartupTrace` / `measureStartupTrace`，URL 参数 `?startupTrace=1` 激活，console.table 输出 | ⭐ 低（纯新增） |
| 3.2 | useDeviceInfo useSyncExternalStore 重写 | 1 | `device.ts` — 从 useState+150ms debounce 改为 `useSyncExternalStore` + RAF 节流，消除 resize 延迟并减少 re-render | ⭐⭐ 中（独立模块） |
| 3.3 | Health endpoint 修复 | 1 | `client.ts` — `checkHealth()` 改为 `/api/opencode/health`（原 `/health`），返回 `{ healthy: true }` 判断 | ⭐⭐ 中（我们魔改了 client） |
| 3.4 | useConfigStore startup trace + 并行加载 | 1 | `useConfigStore.ts` — `loadProviders` / `loadAgents` 加 `source` 参数和 trace 插桩；`initializeApp` 不再调用 `initApp` 改用 `checkHealth`；providers/agents 改为 `Promise.all` 并行加载；`activateDirectory` 跳过已有 snapshot 的目录 | ⭐⭐⭐ 高（**最大冲突点**，我们有大量魔改） |
| 3.5 | sync-context sessionID 提取修复 | 1 | `sync-context.tsx` — `message.part.updated` 优先从 `props.sessionID` 提取而非嵌套 `part.sessionID`；`message.part.delta` / `message.part.removed` 也从 props 提取；auto-accept 提前 return 防止重复处理 | ⭐⭐⭐ 高（我们上次还原了 sync-context） |
| 3.6 | event-reducer sessionID + guard | 1 | `event-reducer.ts` — `message.part.updated` 从 props 提取 sessionID；`message.part.delta` 加 sessionID 到 materialization；messageID 空值 guard (`if (!messageID) return false`) | ⭐⭐ 中 |
| 3.7 | session-actions 跨目录发送 | 1 | `session-actions.ts` — `optimisticSend` 新增 `directory` 参数，支持跨目录消息路由到正确 store | ⭐⭐ 中 |
| 3.8 | App.tsx startup trace 集成 | 1 | `App.tsx` — mount 时 `markStartupTrace('App:mounted')`；启动恢复时 `loadProviders({ source: 'startupRecovery' })` | ⭐ 低 |
| 3.9 | useUIStore resize no-op | 1 | `useUIStore.ts` — `handleWindowResize` 仅在值变化时更新，避免无意义 setState | ⭐ 低 |
| 3.10 | Windows 路径工具 | 2 (新建) | `path-utils.ts` + `path-utils.test.ts` — Windows 路径规范化（UNC、反斜杠、大小写） | ⭐ 低（纯新增） |

### Windows 支持（按需合并）

| Batch | 功能 | 文件数 | 说明 |
|---|---|---|---|
| 3.W1 | Electron Windows 进程管理 | 1 | `electron/main.mjs` — Windows 进程树杀死（PowerShell `Stop-ProcessTree`），替代 `taskkill /t`；窗口 debounce 加 timer cleanup；`windowGeometryTimers` Map |
| 3.W2 | Windows 应用图标解析 | 1 | `electron/main.mjs` — `resolveWindowsAppIconExecutable`、`resolveWindowsTerminalIconPath`、`windowsIconToDataUrl`、`resolveWindowsScriptIconExecutable` 等 ~130 行；`desktop_fetch_app_icons` IPC 支持返回 Windows 图标 |
| 3.W3 | Windows 终端/应用启动 | 1 | `electron/main.mjs` — `shellStart` 模式（`start ""` 命令）；PowerShell + CMD 终端启动 spec；finder 改用 `shell.openPath` |
| 3.W4 | Windows Mini Chat 窗口控件 | 2 | `WindowsWindowControls.tsx` (新建) + `MiniChatLayout.tsx` — `frame: false` / `titleBarStyle: 'hidden'` on Windows |
| 3.W5 | Windows 应用图标文件 | 2 | `icon-win.svg` + `icon.ico` (更新) — Windows 特定应用图标 |
| 3.W6 | VS Code Windows 检测 | 2 | `opencode.ts` + `extension.ts` — `findWindowsOpenCode` 增强 `.exe` 检测 |

### 零散修复

| Batch | 功能 | 文件 | 说明 |
|---|---|---|---|
| 3.11 | TunnelSettings 增强 | `TunnelSettings.tsx` | ✅ 部分落地：服务端依赖检查结果驱动安装提示；session 时间遵守 12/24 小时偏好。未搬 `runtimeFetch`/`runtime-switch` 基础设施 |
| 3.12 | AboutSettings | `AboutSettings.tsx` (新建) | ✅ 已落地：About settings 展示 OpenCode version，并新增 web server `/api/opencode/version` route |
| 3.13 | 文件树隐藏文件过滤 | `DirectoryExplorerDialog.tsx` | ✅ 已落地：默认隐藏 dot directory，搜索 `.` 或开启 show hidden 时展示 |
| 3.14 | MarkdownRenderer / ProgressiveGroup 清理 | 2 | ✅ 已落地：复用 `path-utils.ts` 处理 Windows/UNC/相对路径；保留本 fork 的 remote/serverId 文件引用路由 |
| 3.15 | Header / MainLayout 清理 | 2 | ✅ 已落地 / ⚪ Header 无本地差异：MainLayout resize 改为 rAF 节流并修复 hook dependency；Header 中官方抽离的 inline Windows controls 本地已不存在 |
| 3.16 | 小修改集合 | ~10 | ✅ 已落地：`AgentMentionAutocomplete`、`ModelControls` startup trace、changedFiles 路径处理、`ForkSessionDialog`/`TodoSendDialog`/`ScheduledTaskEditorDialog` source 参数、`DiffView` path-utils、`AgentSelector` load 去重、`VSCodeLayout` bootstrap source |
| 3.17 | i18n 新 key | 9 | `en.ts` + 8 locale — `settings.about.*` + `ssh.*` key；`*.settings.ts` 3 个新 key |
| 3.18 | 版本号 | 3 | ✅ 开发态已改为 `1.12.3-merging-dev`，用于压住 update 提示；正式发布前再决定 release version |
| 3.19 | CI / Agent | 3 | ⚠️ 单独审批：官方 `pull_request_target` 自动 review 与 reproduce agent push/force-push 权限会改变 fork automation 权限边界，未直接移植 |

### 服务端（tunnels 重构）

| Batch | 功能 | 文件数 | 说明 |
|---|---|---|---|
| 3.S1 | tunnels 模块拆分 | 4 (新建) | ✅ 已移植：`executable-search.js` + test、`install-help.js` + test；补 Windows app alias 和平台化安装提示 |
| 3.S2 | tunnels types 重构 | 2 | ✅ 已移植：`types.js` + test；Windows home path 校验改为平台 path API，避免大小写/兄弟目录误判 |
| 3.S3 | ngrok 重写 | 2 | ✅ 已移植：`ngrok-tunnel.js` 改用 shared executable search、stdout JSON/text URL 解析、最近输出错误摘要，并新增纯函数测试 |
| 3.S4 | cloudflare 简化 | 1 | ✅ 已移植：`cloudflare-tunnel.js` 改用 shared executable-search/env，保留本 fork 现有 managed tunnel readiness |
| 3.S5 | server-utils 增强 | 2 | ✅ 已移植：`server-utils-runtime.js` + test；Windows managed PATH 补原生工具链目录 |
| 3.S6 | routes / index | 3 | ✅ 已移植：`tunnels/routes.js`、`tunnels/index.js` + test；provider 切换替换 active tunnel、startup error 包装、check route 返回 install metadata |
| 3.S7 | env-runtime + lifecycle 简化 | 3 | ✅ 已移植核心：Windows native OpenCode policy、server health route、lifecycle readiness `/global/health`；保留 Electron detach/auth persistence |
| 3.S8 | fs routes | 1 | ✅ 已移植：`git check-ignore` 超时保护 |
| 3.S9 | server index 清理 | 1 | `server/index.js` — -15 行移除旧逻辑 |

---

## v1.12.3 — 移植状态

**上游 tag**: `cafbff47`
**范围**: v1.12.2 (`a4c04ba7`) → v1.12.3 (`cafbff47`), 5 commits, ~40 files, +640/-310

### 状态校准 (2026-06-08)

| Batch | 当前状态 | 说明 |
|---|---|---|
| 4.1 / 4.5 | ✅ 已落地 | `env-runtime.js` 已禁用 WSL 自动检测/WSL settings 启动，保留 Windows 原生 `opencode.cmd`/`.exe` 解析；composition root/lifecycle 不再注入 WSL helper |
| 4.2 | ✅ 已落地 | 与 3.3 合并处理：health URL 和返回值判断已切到 server health route |
| 4.3 | ✅ 已落地 | `SidebarFilesTree.tsx` 已移植目录加载错误状态、根/子目录重试 UI，并按官方移除 lazy list 的 `respectGitignore` 参数；保留本 fork 的 desktop/local/remote 三分支 |
| 4.4 / 4.6 | ✅ 已落地 | `lifecycle.js` readiness 已统一到 `/global/health`，并移除 WSL helper 依赖；保留本 fork 的 Electron detach / managed auth 持久化逻辑 |
| 4.7 / 4.8 | ✅ 已落地 | `server-utils-runtime.js` 已补 Windows managed PATH；`fs/routes.js` 已给 `git check-ignore` 加 2500ms 默认超时并支持 env 覆盖 |
| 4.9 / 4.10 | ✅ 已落地 | VS Code bridge 已补 `git check-ignore` 超时与 `api:opencode/version`；`opencode.ts` 已补 `PATHEXT` / npm shim / debug CLI 重新探测 |
| 4.11 / 4.12 / 4.13 | ✅ 已落地 / ⚪ 4.13 无本地差异 | Windows onboarding 已按官方改为原生 Windows 安装文案，8 个 locale 已同步；settings about/tunnel locale key 已补齐。当前 `v1.12.2..v1.12.3` 的 docs diff 不含本仓库可移植 SSH 文档变更 |

### 核心改动

| Batch | 功能 | 文件数 | 说明 | 合并难度 |
|---|---|---|---|---|
| 4.1 | WSL 检测 + 排除 | 1 | `env-runtime.js` — `detectWslOpenCodeInstall()` 检测 WSL 路径并跳过；`findOpenCodeBinary` 简化为 `findLocalBinary` | ⭐ 低（Windows only，代码简化 -178 行） |
| 4.2 | Health 兼容性修复 | 1 | `client.ts` — `checkHealth()` 修复 URL 构建，统一用 `/api/opencode/health`；返回 `healthData?.healthy === true`（原 `isOpenCodeReady !== false`） | ⭐⭐ 中 |
| 4.3 | 文件树加载可靠性 | 1 | `SidebarFilesTree.tsx` — 修复懒加载/刷新时的空状态 | ⭐ 低 |
| 4.4 | startup readiness 性能 | 1 | ✅ 已移植：`waitForOpenCodeReady()` 改用 `/global/health`，避免 `/config` + `/agent` 双请求 readiness |

### 零散改动

| Batch | 功能 | 文件 | 说明 |
|---|---|---|---|
| 4.5 | env-runtime 简化 | `env-runtime.js` | -178 行大幅简化 opencode 二进制查找逻辑 |
| 4.6 | lifecycle 简化 | `lifecycle.js` | ✅ 已移植：移除 WSL launch helper 依赖并统一 health path；Electron detach / auth persistence 为本 fork 保留 |
| 4.7 | server-utils 增强 | `server-utils-runtime.js` + test | ✅ 已移植：Windows managed PATH 补充 npm/node/pnpm/bun/volta/yarn/scoop/chocolatey 等原生工具链目录 |
| 4.8 | fs routes 修复 | `fs/routes.js` | ✅ 已移植：`git check-ignore` 默认 2500ms 超时，超时回退为不过滤，避免文件列表卡死 |
| 4.9 | VS Code bridge 增强 | 3 | ✅ 已移植：FS helpers/runtime 加 `git check-ignore` 超时；system bridge 新增 `api:opencode/version` |
| 4.10 | VS Code opencode 检测 | 1 | ✅ 已移植：Windows `PATHEXT`、npm global shim、debug CLI availability/path 重新探测 |
| 4.11 | onboarding WSL UI | 2 | `ChooserScreen.tsx`、`LocalSetupScreen.tsx` — WSL 检测 UI |
| 4.12 | i18n | 8 | ✅ 已移植：Windows onboarding locale 已去掉 WSL 推荐；settings about/tunnel 3 个新 key × 8 locale 已补齐 |
| 4.13 | SSH 文档 | 7 | ⚪ 当前 `v1.12.2..v1.12.3` 的 docs diff 无本仓库可移植 SSH 文档变更 |
| 4.14 | 版本号 | 3 | ✅ 开发态已改为 `1.12.3-merging-dev`，正式 v1.12.3 release version 仍待发布收尾 |
| 4.15 | CHANGELOG | 2 | ⚠️ 发布收尾再处理：避免在未完成/未发布状态写成正式 v1.12.3 release |

---

## v1.12.4 — 新增功能盘点（待移植）

**上游 release**: [OpenChamber v1.12.4](https://github.com/openchamber/openchamber/releases) / tag `v1.12.4` (`4a263c1`)
**发布日期**: 2026-06-11
**范围**: v1.12.3 (`cafbff47`) → v1.12.4 (`4a263c1`)
**当前状态**: 已完成 release-note feature inventory + 本地 `rg` 初查；Multi-Run hidden models、table Markdown copy、长用户消息折叠设置已单独移植。其余项尚未逐 commit / file diff。后续仍需按官方实际提交逐项比对，不能整批套 patch。

### 状态校准 (2026-06-11)

| 类别 | Feature | 本 fork 初查状态 | 处理建议 |
|---|---|---|---|
| Chat | `/handoff-review` linked review session | ✅ 已落地 (T1-6, commits `8c06e59f` + `3a8ecc92`)：`ReviewFlowDialog.tsx` + `reviewFlow.ts` + `sessionReviewMetadata.ts` + ChatInput `/handoff-review` 入口 + MessageBody review 按钮 + 8 locale × 3 key | 已完成 |
| Chat/UI | Collapse long user messages setting | ✅ 已落地：新增 `collapsibleUserMessages` UI preference，Settings > Chat 可开关，默认保持现有两行折叠行为；关闭后长用户消息完整显示 | 已完成；后续可和官方 Settings search 索引项一起复核搜索命中 |
| Chat | Rendered `@agent` mentions use primary accent | ✅ 已落地 (Tier1-1)：`inlineMessageLinks.ts` 抽取 link builder/parser；`UserTextPart` 改用 markdown 格式内部 href；`MarkdownRendererImpl` 解析 `#openchamber-agent:` / `#openchamber-skill:` href 并渲染为 `text-primary` + data attribute；CSS `[data-openchamber-agent-mention]` / `[data-skill-name]` 强制 primary 色 | 已完成 |
| Chat | Table copy action adds Markdown format | ✅ 已落地：copy dropdown 新增 Markdown 选项；表格导出逻辑抽到 `markdownTableExport.ts` 并加测试 | 已完成，后续只需和官方实现复核文案/i18n 是否一致 |
| Chat | Mermaid diagram dedicated editor | ⚪ 不适用：上游 v1.12.4 CHANGELOG 误描述。取证（pickaxe `-S"mermaid"` 全范围 + 实现 commit + 文件路由）确认 commit `7f13c477` (#1432 by @nerdosaurus) 实为 **draw.io `.drawio` 编辑器**，非 Mermaid。上游 v1.12.4 对 Mermaid inline-render / preview dialog / zoom / copy / source **零改动**；本地 preview 已对齐上游 | 无需移植。真实 feature 为 draw.io editor（见下一行，新增条目） |
| Files/Chat | draw.io diagram editor for `.drawio`/`.dio` files（上游 CHANGELOG 误记为 "Mermaid dedicated editor"） | ✅ 已落地：commit `7f13c477` (#1432) 按文件级 cherry-pick。新建 `DiagramEditor.tsx` (react-drawio iframe wrapper)、`DiagramView.tsx`、`diagram/index.ts`；useUIStore 加 `'diagram'` MainTab + `pendingDiagramFile`/`navigateToDiagram`/`consumePendingDiagramFile`（镜像 `pendingDiffFile` 模式，无 serverId/directory 参数）；toolHelpers `isDrawioFile`；FilesView inline Visual/Source toggle + debounced autosave + remount-nonce；FileAttachment "Open in diagram view"（typed `FilePartWithSource` alias，无 `as any`）；router/Header/MainLayout 注册 diagram tab；4 i18n key × 8 locale；`react-drawio@1.0.7`。`bun run type-check` + `bun run lint` 0 errors。跳过 squash commit bundle 的 sub-agent/SSE/atomic-writes/snapdom |

> Mermaid merge note (2026-07-02): v1.13.8 及以前社区 Mermaid 展示/CSS 改动不再合并。设计理由：本 fork 刻意保留 inline Mermaid `max-height: 320px`，保障聊天列表密度；大图通过现有 fullscreen/scroll 查看。当前不可读问题根因是 `beautiful-mermaid`/ELK 对有回环 TD 图的断环布局，而不是外框高度，已在依赖补丁中用 `MODEL_ORDER` 断环策略修复。

| Models | Hidden models stay hidden in multi-model controls | ✅ 已落地：`useModelLists()` 暴露 `hiddenModels`，Multi-Run `ModelMultiSelect` 已传入 `ModelPickerList`，测试覆盖隐藏模型仍从 favorite/recent 排除 | 已完成，后续复核 Fusion/其它多模型入口即可 |
| Worktrees | Single new worktree session opens immediately while setup continues | 🟡 部分：本地已有 pending draft worktree flow，但真实 session 仍在 worktree 创建后才完成 | 高风险。必须保留 `[OPENCHAMBER-FORK] ensureWorktreeProject` 和 remote project 注册 |
| Multi-Run | Isolated runs open sessions immediately while setup continues | 🟡 部分：本地 waits worktree + session creation，只有 send message 阶段是 async fire-and-forget | 高风险。需重新设计 pending run/session 映射，不能丢 directory/serverId |
| Sessions | Chat folder assignments persist after reload | ✅ 已落地 (Tier1-11)：`useSessionFolderCleanup` 增加 `hasLoadedGlobalSessions` guard，防止 global sessions 未加载时过早清理 folder assignments | 已完成 |
| Sessions | Right-click menus for session/folder/project/worktree rows | 🟡 部分：session/temp session 已有 context menu；folder/project/worktree 覆盖面需逐文件对齐 | 中高风险，和 sidebar/tree 结构相关，需避免重复/错 server 操作 |
| Settings | Search across settings pages | 🔴 未实现。`settings/metadata.ts` 有 keywords，但 `SettingsView` 没有全局 search UI | 中等 UX 功能，可独立做 |
| Settings/Agents | Agent prompt and permission edits stay saved | ✅ 已落地 (Tier1-10)：cache invalidation (`invalidateAgentsLoadCache`/`invalidateCommandsLoadCache`/`invalidateSkillsLoadCache`) 在每次 CRUD 前调用；`buildAgentsSignature` 扩展覆盖 mode/model/temp/topP/prompt/permission；reload mode 从 `"active"` 改为 `"projects"`；null prompt 清除逻辑；permission source/merge 层级修正 (custom > project > user)；`AgentsPage` permission config 标准化 | 已完成 |
| Files | Editor Vim mode setting | ✅ 已落地 (Tier2-2)：`@replit/codemirror-vim` + `vimModeExtension.ts` + `fileEditorKeymap` store (useUIStore L671) + `OpenChamberVisualSettings.tsx` radio selector + 8 locale settings | 已完成 |
| Files | Safer writes via temporary files | ✅ 已落地 (Tier1-9)：`/api/fs/write` 改为 `realpath()` 解析 + `isPathWithinRoot` 安全检查 + temp file → rename 原子写入；error 时 always unlink temp | 已完成 |
| Git | Changed-file folders have revert action | ✅ 已落地 (Tier1-6)：`GitView` refactoring `handleRevertAll` → `handleRevertPaths(paths, setGlobalReverting, scope)`；`handleRevertDirectory` 使用 `scope: 'working'`；`ChangesSection` 目录行新增 revert 按钮 + 确认对话框；8 locale i18n key 补齐 | 已完成 |
| GitHub | Issue/PR pickers use server-side search | ✅ 已落地 (Tier2-1)：`/api/github/{issues,pulls}/list` 接收 `query` 参数并调用 `octokit.rest.search.issuesAndPullRequests`；UI 端 `useDebouncedValue(350ms)` + `isTextSearch` 切换；VS Code parity | 已完成 |
| Preview | Inline module scripts rewritten in proxied HTML | ✅ 已落地 (Tier1-7)：`rewriteInlineModuleScripts` 函数解析 `<script type="module">` 内容并用 `rewriteJavaScript` 改写 import/from 路径；`stripPreviewCspMeta` 移除 CSP meta 标签让 bridge 可运行；`rewriteHtml` 返回值包装两层处理 | 已完成 |
| Voice | Plan/file preview markdown TTS buttons + selected/full setting | ✅ 已落地：PlanView (`PlanView.tsx:714-741`) + FilesView (`FilesView.tsx:2986-3013`) markdown preview toolbar 均有 speaker/stop 按钮，gate `showMessageTTSButtons`；`ttsInputMode: 'sanitized'\|'raw'` config + VoiceSettings chip selector + `useMessageTTS` raw mode（仅 server provider）+ 8 locale × 2 key | 已完成 |
| Desktop/macOS | Menu bar tray with live session status, Mini Chat, provider usage submenu | 🔴 未实现。Mini Chat window 已有，但 Electron main 未见 Tray/menu-bar status item | macOS 独立批次；要考虑 remote/live session status source |
| Desktop/macOS | Optional vibrancy for left sidebar | 🔴 未实现且当前强制禁用：`desktop_set_vibrancy` handler 会写 `desktopVibrancy=false` | 需重新评估 Electron 可行性；不能直接按旧 Tauri/SwiftUI 思路套 |
| Desktop/macOS | Startup no longer opens unnecessary folder prompts | ✅ 已落地 (Tier1-5)：Electron `spawnLocalServer` 设置 `OPENCHAMBER_OPENCODE_CWD = app.getPath('userData')` 并确保目录存在；`hmr-state-runtime.js` 的 `getInitialOpenCodeWorkingDirectory` 从 env 读取配置的 CWD，不再 fallback 到 `os.homedir()` 导致文件夹提示 | 已完成 |
| Mobile | Refreshed session controls/worktree deletion/MCP/update/usage layout | 🟡 延后/部分。本 fork 已有大量 mobile-specific UI，但此前 mobile 批次是延后策略 | 继续延后，除非用户明确优先移动端 |
| Terminal/Mobile | Touch scrolling conflicts less with terminal input | 🟡 可能部分覆盖：`TerminalViewport` 已有 pointer/touch scroll 转 terminal scroll、tap threshold、passive false | 需真机/移动视口复测后决定是否还需官方 diff |
| Usage | Cursor quota tracking | ✅ 已落地 (Tier1-8)：新增 `packages/web/server/lib/quota/providers/cursor.js` (319 行)；注册到 providers/index.js + quota/index.js；UI 端 `quota.ts` 类型 + `utils.ts` window label + `providers/index.ts` 入口；8 locale 补 `quota.window.*` key | 已完成 |
| UI/Localization | French UI translations and French docs | 🔴 未实现。未见 `fr` locale files | 可低风险批量补，但应排在功能后 |
| VSCode | Archive all sessions action | 🔴 未实现。未看到 extension action/command | VS Code 批次处理 |
| VSCode | Multi-root workspace support + folder switching | 🔴 未实现。VS Code 多数路径仍取 `workspaceFolders[0]` | 高风险 VS Code 架构改动；需避免 web/desktop 假设污染 extension |

### Tier 1 移植批次

**时间**: 2026-06-15 03:53 (CST) | **Fork commit**: `f873cfd0`
**范围**: v1.12.4 低风险高价值功能，手工逐 commit 移植
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 1 | @agent mentions 主色渲染 | `d0e9d317` | 4 | 新建 `inlineMessageLinks.ts`；`UserTextPart` 改 markdown 内部 href；`MarkdownRendererImpl` 解析 agent/skill href；CSS data attribute 强制 primary 色 |
| 2 | Table copy Markdown 格式 | `274e886a` | 0 | ✅ 已在 fork 中（`markdownTableExport.ts` 更好的实现） |
| 3 | Hidden models multi-select | `266dde2d` | 0 | ✅ 已在 fork 中 |
| 4 | Collapsible user messages | `2f62f315` | 0 | ✅ 已在 fork 中 |
| 5 | macOS 启动不弹文件夹 | `e3993eb0` | 2 | Electron 设置 `OPENCHAMBER_OPENCODE_CWD`；`hmr-state-runtime` 从 env 读取初始 CWD |
| 6 | Git folder-level revert | `6ade0c4e` | 11 | `GitView` refactoring + `ChangesSection` revert button + dialog；8 locale i18n |
| 7 | Preview inline module scripts | `389ee4d6` | 1 | `proxy-runtime.js` 添加 `rewriteInlineModuleScripts` + `stripPreviewCspMeta` |
| 8 | Cursor quota tracking | `bf07ecaa` | 16 | 新建 `cursor.js` provider (319 行)；注册 + UI 类型 + utils + 8 locale i18n |
| 9 | Safer atomic file writes | `3b88ed38` | 1 | `fs/routes.js` realpath + isPathWithinRoot + temp→rename 原子写入 |
| 10 | Agent prompt/permission 持久化 | `1c6e8ef6` + `4b6cecf3` | 9 | cache invalidation；signature 扩展；reload mode 修正；null prompt 清除；permission source/merge 层级修正；`AgentsPage` permission config 标准化 |
| 11 | Chat folder reload 持久化 | `50d378f0` | 2 | `useSessionFolderCleanup` 增加 `hasLoadedGlobalSessions` guard |

### Tier 2 移植批次

**时间**: 2026-06-15 04:31 (CST) | **Fork commit**: `86b69ddf`
**范围**: v1.12.4 中等工程量功能
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 1 | GitHub server-side search | `435001d4` | 16 | issue/PR picker 改用 GitHub Search API；debounced search；VS Code parity；8 locale i18n |
| 2 | Vim mode (file editor) | `1c692d7e` | 12 | 新依赖 `@replit/codemirror-vim`；`vimModeExtension.ts` (新)；`CodeMirrorEditor` vim compartment；`fileEditorKeymap: 'default'\|'vim'` store + radio selector UI；8 locale settings i18n |
| 3 | TTS Plan/Files | `f4de298a` | 20 | PlanView + FilesView markdown preview 新增 speaker 按钮；`ttsInputMode: 'sanitized'\|'raw'` config + VoiceSettings chip selector；`useMessageTTS` raw mode 支持；8 locale × 2 file i18n |

**Tier 2 总计**: ~48 files changed (含 i18n overlap), +956/-159

### 建议制作顺序

1. **先确认/补小 UI**：`@agent` accent 校准、Settings search。
2. **再做数据安全和保存类**：`/api/fs/write` tmp-file 写入、Agents prompt/permission 三类复测、session folders persistence 对齐。
3. **Chat 高价值功能**：`/handoff-review`、Mermaid editor、Plan/File TTS。这里开始必须逐 commit 看官方实现。
4. **Worktree / Multi-Run / Session tree**：immediate open session、isolated runs、完整右键菜单。必须保护本 fork 的 multi-remote、serverId、directory routing、pending draft worktree 逻辑。
5. **Git / GitHub / Preview 服务端功能**：changed folder revert、GitHub server-side search、inline module script rewrite。每项都要补 targeted tests。
6. **Desktop / VS Code / Mobile / i18n**：tray、vibrancy、startup prompt、VS Code archive all/multi-root、mobile refresh、French locale/docs。平台面大，建议最后按平台分批。

---

## v1.12.2~3 合并策略

### 建议执行顺序

```
Batch 3.1 (纯新增，零冲突)
  ├── startupTrace.ts (新建)
  ├── path-utils.ts + test (新建)
  ├── AboutSettings.tsx (新建)
  ├── WindowsWindowControls.tsx (新建, Windows only)
  └── i18n keys

Batch 3.2 (独立模块)
  ├── device.ts (useSyncExternalStore)
  ├── useUIStore.ts (resize no-op)
  └── SidebarFilesTree.tsx (隐藏文件过滤 + 文件树可靠性)

Batch 3.3 (核心 bug 修复 — 最高价值)
  ├── event-reducer.ts (sessionID 提取 + messageID guard)
  ├── sync-context.tsx (sessionID 修复, 小心处理)
  ├── session-actions.ts (directory 参数)
  └── client.ts (health endpoint 修复)

Batch 3.4 (性能 — 最大工程量)
  ├── useConfigStore.ts (startup trace + 并行加载 + source 参数)
  ├── App.tsx (startup trace 集成)
  └── lifecycle.js / env-runtime.js (简化)

Batch 3.5 (服务端)
  ├── tunnels 模块拆分
  ├── ngrok 重写
  └── server routes 修复

Batch 3.6 (按需)
  ├── electron/main.mjs Windows 支持 (如果需要 Windows)
  ├── VS Code bridge 增强
  └── 零散 UI 清理
```

### 合并冲突评估

| 模块 | 冲突风险 | 说明 |
|---|---|---|
| `useConfigStore.ts` | 🔴 高 | 我们有大量魔改（provider circuit breaker、models metadata、directory-scoped config），需 diff3 逐段合并 |
| `sync-context.tsx` | 🔴 高 | 上次已还原，需要只 cherrypick sessionID 提取修复 + auto-accept return，不全量覆盖 |
| `client.ts` | 🟡 中 | 我们魔改了 client（retry logic、directory handling），health endpoint 变更需手动合并 |
| `session-actions.ts` | 🟡 中 | 我们已有魔改，directory 参数需审查兼容性 |
| `event-reducer.ts` | 🟡 中 | 我们已有 v1.12.1 版本的 reducer，需 diff 合并 |
| `electron/main.mjs` | 🟡 中 | 大量 Windows 新代码，macOS 行为变化小，但文件本身改动大 |
| 其余 | 🟢 低 | 新文件或独立模块，冲突少 |

---

## 当前状态 & 已知问题 (2026-06-15 Tier 1 后)

| 项目 | 状态 |
|---|---|
| `bun run type-check` | ✅ 0 errors |
| `bun run lint` | ✅ 0 errors |
| Electron | ✅ 正常，不会多开窗口 |
| 聊天区域 | ✅ 正常 |
| 远程实例侧边栏 | ✅ 已修复 |
| 上游版本差距 | v1.12.4 Tier 1+2 (14 features) + v1.13.0 Tier 1 (7 features) 已落地；v1.13.0 Tier 2/3 待移植 |
| 并发 agent 提交 | `3832c124` (2026-06-17 00:24): session markers + settings visibility policy (showOn: both→default) |

---

## v1.13.0 — 变更审核 (2026-06-17)

**范围**: v1.12.4 (`4a263c1`) → v1.13.0，76 commits，239 files，+10465/-4025

### 分歧概况：fork vs upstream 关键文件

| 文件 | Fork 行数 | v1.13.0 行数 | 上游 delta | 分歧原因 |
|---|---|---|---|---|
| `DiffView.tsx` | 1778 | 1715 | +729/-902 | 上游完全重写 Changes 视图 |
| `FilesView.tsx` | 3778 | 4226 | +404/-170 | fork 有 Vim/TTS 移植 + 上游加 PDF + docked toolbar |
| `useConfigStore.ts` | 2618 | 2943 | +443/-125 | fork 有大量魔改 (provider circuit breaker, models metadata) |
| `sync-context.tsx` | 3190 | 2739 | +102/-58 | fork 有 remote instance routing |
| `MessageList.tsx` | 2114 | 1699 | +94/-157 | fork 有 process folding + 上游迁移到 `virtua` |
| `ChatInput.tsx` | 4826 | 4569 | +81/-26 | fork 有 magic prompts + queue mode |
| `electron/main.mjs` | 2938 | 4444 | +98/-7 | fork 有 OPENCHAMBER_OPENCODE_CWD + 上游加 LAN 密码 |
| `SessionNodeItem.tsx` | 1530 | — | +78/-52 | fork 有 session markers |

### 虚拟化库冲突（关键）

| | Fork | v1.13.0 上游 |
|---|---|---|
| 库 | `@tanstack/react-virtual` | `virtua` |
| 用于 | `VirtualizedCodeBlock`（代码块） | `MessageList`（整个聊天列表） |

上游迁移到 `virtua` 是独立决策，fork 的 `@tanstack/react-virtual` 仅用于代码块虚拟化，两者不冲突——但如果要 port MessageList 虚拟化，需要引入 `virtua` 作为新依赖。

### Tier 1 — 低风险 / 快速见效

| # | Changelog 项 | 上游 commit | 关键文件 | 难度 | 说明 |
|---|---|---|---|---|---|
| 1 | Desktop: dev tools from Help menu | 零散 | `electron/main.mjs` menu | 🟢 极低 | 加一个 menu item |
| 2 | Mobile: empty Changes close control | 零散 | mobile CSS | 🟢 极低 | 几行样式 |
| 3 | Sessions: full gutter highlight | 零散 | CSS + sidebar | 🟢 极低 | `display:flex` 全行高亮 |
| 4 | Chat: custom-answer textarea resize | `b0567047` 等 | `QuestionCard.tsx` + **新** `questionTextareaSizing.ts` | 🟢 低 | 新工具文件 + QuestionCard 改动 |
| 5 | Settings/MCP: import snippets fix | 零散 | MCP settings | 🟢 低 | 小修复 |
| 6 | Git/Diff: review flow dialog | `206ec704` | **新** `ReviewFlowDialog.tsx` (213L) | 🟢 低 | 独立新组件 |
| 7 | GitHub: gh CLI credentials | `ce377e41` | **新** `gh-cli-credential.js` + `GitHubSettings.tsx` + `github/routes.js` | 🟡 中低 | server 新文件 + UI 改动 |
| 8 | Chat: clickable file paths in code blocks | `45bedeac` | `MarkdownRendererImpl.tsx` | 🟡 中低 | fork 已有 inline link 解析，增量改动 |

### v1.13.0 Tier 1 移植批次

**时间**: 2026-06-17 01:07 (CST) | **Fork commit**: `8c06e59f`
**范围**: v1.13.0 低风险功能
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 1 | Desktop dev tools from Help menu | `22f7b6ac` (部分) | 1 | `openDevToolsForMenuTarget()` + Help 菜单 `Cmd+Alt+I` |
| ~~2~~ | ~~Mobile empty Changes close~~ | — | — | **跳过**: fork 无 `MobileChangesSurface.tsx` |
| 3 | Session gutter highlight | `b74600c3` | 1 | `-ml-3` + `bg-interactive-selection` + `bg-primary/10` for active |
| 4 | Question textarea stabilize | `6b96f42c` | 3 | 新 `questionTextareaSizing.ts`；ref + `customTextFilled` 布尔值，打字不重渲染整个 card；保留 fork draft persistence |
| 5 | MCP import snippets fix | `8e1d75b0` | 2 | `{ "mcp": { ... } }` wrapper detection + test |
| 6 | Review flow dialog + 基础设施 | `206ec704` + `95aab547` (部分) | 15+ | **见下方详细说明** |
| 7 | GitHub gh CLI credentials | `ce377e41` + `d733896c` | 10 | 新 `gh-cli-credential.js` server module + UI toggle + octokit fallback |
| 8 | Clickable code block file paths | `45bedeac` + `d57ff40b` | 1 | Range API tokenization，`data-openchamber-block-path` anchor |

#### T1-6 Review Flow 详细说明

上游的 "session review handoff flow" 是 **三个 commit 的链条**：

```
95aab547  feat: add session review handoff flow   ← 地基 (1381行, 19文件)
669ced38  refinements                              ← 微调
206ec704  Add diff review flow dialog              ← 对话框 (最上层)
```

Fork 从未 port 过 `95aab547`。T1-6 agent 发现后，将 `95aab547` 的核心基础设施与 `206ec704` 的对话框一并 port。

**已 port 的 `95aab547` 部分** (T1-6 commit `8c06e59f`)：

| 文件 | 说明 |
|---|---|
| `sessionReviewMetadata.ts` (82L, 新建) | review session 元数据类型 + helper |
| `reviewFlow.ts` (291L, 新建) | 编排逻辑：create/reuse review session、发 handoff、链接 session pair。适配了 fork 的 `withDirectory` API |
| `opencode/client.ts` (+10) | `createSession`/`updateSession` 支持 `metadata` 参数 |
| `session-actions.ts` (+19) | `patchSessionMetadata` — read-modify-write 元数据 |
| `magicPrompts.ts` (+87) | `reviewHandoff`、`reviewSession`、`reviewSessionWithoutHandoff`、`reviewFeedbackToImplementer`、`implementationResponseToReviewer` |
| `ReviewFlowDialog.tsx` (213L, 新建) | 对话框本身 (`206ec704`) |
| `DiffView.tsx` (+64) | 审查按钮 + 对话框触发 |

**已补 port 的 `95aab547` 剩余部分** (2026-06-17 01:52, fork commit `3a8ecc92`)：

| 文件 | 改动 | 说明 |
|---|---|---|
| `ChatInput.tsx` | +25 | `/handoff-review` 命令入口 + 调用 `startReviewFlow` |
| `CommandAutocomplete.tsx` | +14 | 补全列表显示 `handoff-review` 命令 |
| `MessageBody.tsx` | +106 | 审查 session 中显示 "发送反馈"/"发送实现响应" 按钮；隐藏无关 action (saveAsPlan, multi-run, fork) |
| `useGlobalSessionsStore.ts` | +1 | session signature 包含 `metadata`，确保元数据变化触发去重/更新 |
| `session-ui-store.ts` | +6 | `createSession` 接受 `metadata` 参数 |
| 8 locale files | +3 each | `handoffReviewDescription`、`sendReviewFeedback`、`sendImplementationResponse` |

### Tier 2 — 中等风险 / 需逐文件合并

| # | Changelog 项 | 上游 commit | 关键文件 | 难度 | 冲突点 |
|---|---|---|---|---|---|
| 9 | Chat/Input: tab-complete mention fix | `a8270076` | `ChatInput.tsx` (+81/-26) | 🟡 中 | fork ChatInput 4826L 魔改 |
| 10 | Chat/Input: ArrowUp multi-line fix | 同上 | 同上 | 🟡 中 | 同上 |
| 11 | Chat/Mobile: collapsed tool cards icon | 零散 | `ToolPart.tsx` (+60/-44) | 🟡 中 | fork 有 tool rendering 魔改 |
| 12 | Sessions: delete action in menus | 零散 | `SessionNodeItem.tsx` (+78/-52) | 🟡 中 | fork 有 session markers 渲染 |
| 13 | Sessions: deleting parent no zombie children | 零散 | sync 层 | 🟡 中 | fork sync 层有 remote routing |
| 14 | Sessions: switching no blank chat | `475b7a99` | `MessageList.tsx` / chat controller | 🟡 中 | fork 有 process folding |
| 15 | Comments: inline drafts stay on focus | 零散 | comment draft store | 🟡 中 | 需检查 fork comment 系统 |
| 16 | Notifications: reliable streams behind proxies | `22f7b6ac` | event-stream WebSocket | 🟡 中 | SSE auth 改动 |
| 17 | Security: file preview path rejection | 零散 | **新** `outsideFileGrants.ts` + `fs/routes.js` (+224) | 🟡 中 | server 新文件 + route 安全检查 |
| 18 | Sessions: running session flicker fix | 零散 | sync/status | 🟡 中 | fork 有 live state 管理 |
| 19 | Sessions: draft default model/agent | `7ecce96e` | startup/draft 逻辑 | 🟡 中 | fork 有自己的 draft starter |
| 20 | Chat: context breakdown previews + cache hit | `8f629491` | `ContextSidebarTab.tsx` (+105/-31) + **新** `rawMessagePreview.ts` | 🟡 中 | fork 有 context tab 改动 |
| 21 | Files: workspace directory consistency | `78196208` | `FilesView.tsx` + `fs/routes.js` | 🟡 中 | fork FilesView 有 Vim/TTS |
| 22 | Chat: PDF preview (files) | `f9ce2ae8` | `FilesView.tsx` (+404/-170) | 🟡 中高 | fork FilesView 3778L，需增量合并 |

### Tier 3 — 高风险 / 大规模重写或深度冲突

| # | Changelog 项 | 上游 commit | 关键文件 | 难度 | 冲突点 |
|---|---|---|---|---|---|
| 23 | Security: LAN password required | `e58be0a0` 等 | `useConfigStore.ts` (+443/-125) + **新** `bind-host.js` + `server/index.js` + `electron/main.mjs` | 🔴 高 | fork useConfigStore 深度魔改；fork electron 退出流程不同 |
| 24 | Desktop: LAN without password starts locally | 同上 | `electron/main.mjs` (+98/-7) | 🔴 高 | fork main.mjs 2938L vs 上游 4444L，LAN 逻辑差异大 |
| 25 | Chat/Perf: virtualized rendering | `b920fd6f` | `MessageList.tsx` (+94/-157) + 新依赖 `virtua` | 🔴 高 | fork 有 process folding + 使用 `@tanstack/react-virtual`，上游用 `virtua`，需评估是否引入新库 |
| 26 | Files: docked editor toolbar | 零散 | `FilesView.tsx` (同 #22 大改) | 🔴 高 | fork FilesView 与上游差距 448 行 |
| 27 | Git/Diff: redesigned Changes view | 多 commit | `DiffView.tsx` (+729/-902) + `PierreDiffViewer.tsx` (+451) | 🔴 极高 | 上游完全重写，fork 有自己的 diff 改动；需决定是 port 还是保留 fork 版本 |
| 28 | Git/Diff: stage/unstage/discard hunks | `859c426e` | **新** `patchFileDiff.ts` (195L) + `git/service.js` (+522) + `git/routes.js` (+115) + DiffView 集成 | 🔴 高 | server 端是新逻辑（可 port），DiffView 集成依赖 #27 完成 |
| 29 | Startup: cached settings appear earlier | `c62f0d1c` | `useConfigStore.ts` + bootstrap | 🔴 高 | fork useConfigStore 深度魔改，cache hydration 逻辑需手动适配 |
| 30 | Startup: model/agent faster on draft | `b0567047` | config loading + project key | 🔴 高 | 同上 |
| 31 | VSCode: faster startup + cache | `fa5f9a9b` | `bridge-proxy-runtime.ts` + VS Code session list | 🟡 中高 | fork VS Code 改动较少，但 session grouping 需对齐 |
| 32 | VSCode: workspace-grouped sessions | 同上 | VS Code session tree | 🟡 中高 | 同上 |

### v1.13.0 新文件（可直接 port，不冲突）

| 文件 | 行数 | 用途 |
|---|---|---|
| `packages/ui/src/components/chat/questionTextareaSizing.ts` | — | 自定义问答 textarea 尺寸工具 |
| `packages/ui/src/components/layout/rawMessagePreview.ts` | 135 | 上下文侧栏消息预览 |
| `packages/ui/src/components/session/ReviewFlowDialog.tsx` | 213 | Diff review 流程对话框 |
| `packages/ui/src/lib/diff/patchFileDiff.ts` | 195 | Diff hunk patch 解析 |
| `packages/ui/src/lib/outsideFileGrants.ts` | — | 文件访问授权 |
| `packages/web/server/lib/github/gh-cli-credential.js` | — | gh CLI 凭据读取 |
| `packages/web/server/lib/security/bind-host.js` | — | LAN 绑定安全 |
| `packages/electron/opencode-cwd.mjs` | — | Electron CWD 管理 |
| `packages/ui/src/sync/sanitize.ts` | 181 | 同步数据清洗 |

### v1.13.0 建议移植顺序

```
Phase 1 — Tier 1 (#1-8): 独立小项，每项 30min-2h
Phase 2 — Tier 2 (#9-22): 逐文件合并，每项 2-4h
Phase 3 — Tier 3 安全 (#23-24): LAN 密码 + Desktop，需设计 fork 适配
Phase 4 — Tier 3 性能 (#25, #29-30): 虚拟化 + 启动缓存，核心架构改动
Phase 5 — Tier 3 Git/Diff (#27-28): DiffView 重写，最高风险
Phase 6 — VSCode (#31-32): 单独批次
```

### 特别注意：`virtua` vs `@tanstack/react-virtual`

上游 v1.13.0 将 `MessageList` 迁移到 [`virtua`](https://github.com/inokawa/virtua)，而 fork 当前使用 `@tanstack/react-virtual`（仅用于 `VirtualizedCodeBlock`）。

**选项**：
- A. 引入 `virtua`，跟随上游（长期维护成本低，但增加一个依赖）
- B. 用 `@tanstack/react-virtual` 重新实现 MessageList 虚拟化（无新依赖，但维护成本高）
- C. 不 port MessageList 虚拟化（fork 的 process folding 可能已足够缓解长对话性能）

**建议**: A。`virtua` 是轻量库，fork 的 `@tanstack/react-virtual` 用途不同（代码块），两者共存无冲突。

---

## v1.13.1 — 变更审核 (2026-06-17)

**范围**: v1.13.0 (`ee26f193`) → v1.13.1 (`dfa0ec61`)，31 commits，120 files，+5206/-2518
**前提**: fork 的 v1.13.1 全部 31 个 commit 都不在 fork 中

### 分歧概况：fork vs v1.13.1 关键文件

| 文件 | Fork 行数 | v1.13.1 行数 | 上游 delta | 分歧原因 |
|---|---|---|---|---|
| `MarkdownRendererImpl.tsx` | 2289 | ~700 | +291/-1168 | **上游完全重写**：marked+morphdom+Shiki 替换 react-markdown+Prism |
| `useConfigStore.ts` | 2618 | ~2800 | +124/-16 | fork 深度魔改 |
| `opencode/client.ts` | 魔改 | — | +53/-11 | fork 深度魔改 |
| `proxy.js` | 463 | — | +81/-51 | session list 请求重构 |
| `sync-context.tsx` | 3190 | — | +19/-19 | 通知去重 |
| `agents.js` (server) | 675 | — | +45/-21 | agent 删除修复 |

### Markdown 渲染引擎迁移状态

| | Fork | v1.13.1 上游 |
|---|---|---|
| 解析器 | `marked` 已在 deps 但实际仍用 `react-markdown` 渲染 | `marked` + `morphdom` (DOM diff) |
| 代码高亮 | `react-syntax-highlighter`/Prism (37 处引用) | `shiki` Web Worker |
| `markdown/` 目录 | ❌ 不存在 | ✅ 7 个新文件 (worker, core, theme) |
| `syntaxThemeGenerator.ts` | ✅ 211L (使用中) | ❌ 已删除 (dead code) |
| `shiki` 依赖 | ❌ | ✅ `^3.23.0` |
| 数学分隔符修复 | ❌ | ✅ (改的是 `markdownCore.ts`，fork 无此文件) |

### Tier 分类

#### 🔴 极高风险 — 核心架构重写

| # | 功能 | Commits | 说明 | 风险点 |
|---|---|---|---|---|
| 1 | **Markdown 渲染引擎完全重写** | `0d4009c4` `a08b4612` `55a098f6` | marked+morphdom+Shiki worker 替换 react-markdown+Prism。MarkdownRendererImpl +291/-1168。新建 7 个 worker 文件。移除 3 个依赖，新增 shiki | fork 的 agent mention、文件路径点击、inline comment drafts 全在被删的 1168 行里 |
| 2 | **Shiki 代码编辑器高亮** | `552c2217` `1599bfe1` `62184049` | CodeMirror/PlanView/SkillsPage 改用 Shiki。新建 `shikiHighlight.ts` (135L)。删除 `syntaxThemeGenerator` 管道 | 依赖 #1 的 shiki 引入；fork 的 flexokiTheme 需评估 |
| 3 | **Provider/Agent 启动性能** | `e24cd63c` | useConfigStore +124/-16、client.ts +53/-11。流线化 provider 和 agent 启动加载 | fork 最魔改的两个文件同时大改 |

**依赖链**: 数学分隔符 (`1c87e55f`) 和 mermaid 全屏 (`2c3f4e14`) 被 #1 阻塞 — 它们改的 `markdownCore.ts` 在 markdown 重写后才存在。

#### 🟡 中风险 — 需逐文件合并

| # | 功能 | Commit | 关键文件 | Fork 状态 |
|---|---|---|---|---|
| 4 | Scheduled Tasks cron 语法 | `7c05f238` | 新 `cron.ts` (51L) + `cron-parser` 依赖 + Dialog +164 | Dialog 1578L |
| 5 | Agent 删除修复 | `e3daeae1` | AgentsSidebar、useAgentsStore、server agents.js (+45/-21) | 文件都在 |
| 6 | Session 诊断/Windows 加载 | `5cd8b9d3` | proxy.js +81/-51（重构 session list 请求） | proxy.js 463L |
| 7 | Session 文件夹重渲染循环 | `65258d2c` | useSessionFoldersStore.ts +35（纯新增） | 620L |
| 8 | 桌面通知去重 | `dfd138c3` | sync-context.tsx (+19/-19)、emitter-runtime.js、runtime.js | sync-context 3190L |
| 9 | 主题同步（嵌入面板） | `4c26ce36` `c3e37e5a` | 新文件：theme-sync-payload.ts、theme-embedded-bootstrap.ts、contextPanelEmbeddedChat.ts (71L) | 新文件可直接 port |
| 10 | History diff 加载稳定化 | `fe6cff65` | GitView +29、PierreDiffViewer +20、HistoryCommitRow +6 | 文件都在 |
| 11 | 右侧边栏性能 | `b51dd008` | RightSidebar (+15/-15)、RightSidebarTabs (+103/-20) | RightSidebar 157L |

#### 🟢 低风险 — 独立小项

| # | 功能 | Commit | 改动量 | Fork 状态 |
|---|---|---|---|---|
| 12 | Draft starters preload | `5e13f79f` | useDraftStarters.ts +8 | 190L，纯新增 |
| 13 | Context usage 圆形进度 | `c546d908` | ContextUsageDisplay +43/-4 + Mobile/Header/VSCode 小改 | 174L |
| 14 | Agent definition missing toast | `7bf2e5a3` | AgentsSidebar + i18n | 637L |
| 15 | 防止搜索引擎索引 | `797bbc56` | server/index.js +11 | 纯新增 |
| 16 | 安装脚本版本检测 | `0847bfc8` | scripts/install.sh +75/-10 | — |
| 17 | Electron dev auth Vite proxy | `39d4a3b3` | main.mjs +32/-4 | 2938L |
| 18 | Android 移动端会话按钮 | `93485f08` | MobileSessionStatusBar +2/-16 | 1819L |

### v1.13.1 新文件（可直接 port）

| 文件 | 来源 commit | 用途 |
|---|---|---|
| `packages/ui/src/components/chat/markdown/markdownCore.ts` | `0d4009c4` | marked 渲染核心 |
| `packages/ui/src/components/chat/markdown/markdown-worker.ts` | `a08b4612` | Web Worker 入口 |
| `packages/ui/src/components/chat/markdown/markdown-shiki.worker.ts` | `a08b4612` | Shiki 高亮 Worker |
| `packages/ui/src/components/chat/markdown/markdown-worker-protocol.ts` | `a08b4612` | Worker 通信协议 |
| `packages/ui/src/components/chat/markdown/markdownTheme.ts` | `0d4009c4` | Markdown Shiki 主题 |
| `packages/ui/src/components/chat/markdown/decorate.ts` | `0d4009c4` | Markdown 装饰器 |
| `packages/ui/src/components/chat/markdown/markdownShikiThemeDefinition.ts` | `0d4009c4` | Shiki 主题定义 |
| `packages/ui/src/components/code/WorkerHighlightedCode.tsx` | `55a098f6` | Worker 高亮代码组件 |
| `packages/ui/src/components/code/useWorkerHighlightedLines.ts` | `55a098f6` | Worker 高亮 hook |
| `packages/ui/src/lib/codemirror/shikiHighlight.ts` | `552c2217` | CodeMirror Shiki 高亮 |
| `packages/ui/src/lib/cron.ts` | `7c05f238` | Cron 解析工具 |
| `packages/ui/src/contexts/theme-sync-payload.ts` | `4c26ce36` | 主题同步数据 |
| `packages/ui/src/contexts/theme-embedded-bootstrap.ts` | `c3e37e5a` | 嵌入面板主题引导 |
| `packages/ui/src/contexts/theme-validation.ts` | `4c26ce36` | 主题验证 |
| `packages/ui/src/components/layout/contextPanelEmbeddedChat.ts` | `c3e37e5a` | 嵌入式聊天面板 |

### v1.13.1 建议移植顺序

```
Phase 1 — 🟢 低风险 (#12-18): 7 项独立小改动，每项 <1h
Phase 2 — 🟡 独立中风险 (#7 文件夹重渲染, #9 主题同步, #4 cron)
Phase 3 — 🟡 需合并 (#5 agent 删除, #6 session 诊断, #8 通知去重, #10 history diff, #11 右侧栏)
Phase 4 — 🔴 Provider/Agent 性能 (#3): 逐段 diff3 合并
Phase 5 — 🔴 Markdown/Shiki 重写 (#1+#2): 独立 milestone，需迁移 fork 自定义功能
```

### v1.13.1 低风险移植批次 (2026-06-18)

**时间**: 2026-06-18 01:56 (CST) | **Fork commit**: `c85b591e`
**范围**: v1.13.1 低风险功能
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 12 | Draft starters preload | `5e13f79f` | 1 | mount 时调 `ensureLoaded()`，pinned starters 立即可用 |
| 13 | Context usage 圆形进度 | `c546d908` | 4 | SVG circular progress 替换 donut icon；tone-based 颜色 (success/warn/critical) |
| 14 | Agent definition missing toast | `7bf2e5a3` | 10 | try/catch + re-throw；`definitionNotFound` i18n key × 8 locale |
| 15 | 防止搜索引擎索引 | `797bbc56` | 1 | `X-Robots-Tag: noindex` + `/robots.txt` route |
| 16 | 安装脚本版本检测 | `0847bfc8` | 1 | `set -euo pipefail`、Node 22、safe version parsing、`bun.lock` 支持 |
| ~~17~~ | ~~Electron dev auth Vite proxy~~ | `39d4a3b3` | — | **⛔ 阻塞**: fork 的 `main.mjs` 无 `apiBaseUrl`/`clientToken`/`runtimeConfig` 模型，架构完全不同 |
| ~~18~~ | ~~Android 移动端会话按钮~~ | `93485f08` | — | **⏭️ 跳过**: fork 无 `MobileSessionPanelTrigger` |

### v1.13.1 中风险移植批次 A (2026-06-18)

**时间**: 2026-06-18 02:39 (CST) | **Fork commit**: `8b65650c`
**范围**: v1.13.1 中风险 bug fix + 新功能
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors / cron tests 4/4 ✅

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 7 | Session 文件夹重渲染循环修复 | `65258d2c` | 1 | `addSessionToFolder`/`addSessionsToFolder` 加 early-return guard，无变化时不触发 state update |
| 5 | Agent 删除 scope 修复 | `e3daeae1` | 6 | `scope` 参数贯穿 server→UI→VS Code；只删目标 config 层而非 disable built-ins |
| 4 | Cron 语法支持 | `7c05f238` | 13 | `cron-parser` 依赖 + `cron.ts` 工具 + dialog cron 模式（验证+预览+示例）+ 8 locale × 12 i18n key |

### v1.13.1 中风险移植批次 B (2026-06-18)

**时间**: 2026-06-18 03:21 (CST) | **Fork commit**: `19c46bef`
**范围**: v1.13.1 通知去重
**验证**: `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 8 | 桌面通知去重 | `dfd138c3` | 7 | `emitDesktopNotification` 返回 boolean；`broadcastUiNotification` 传 `desktopNotificationDelivered` 标记；`useWebNotificationStream` 在 loopback 上跳过重复通知；排除 reasoning chain-of-thought；新测试文件 |

### #11 右侧边栏性能 — 重新评估为 🔴 高风险

原分类为 🟡 中风险，但实际改动为 **8 文件 +681/-292 行**，包括 GitView (+270/-...) 和 SidebarFilesTree (+317/-...) 的深度重构。升级为 🔴 高风险，与 Markdown 重写、Provider 性能放在一起。

## v1.13.2 — 变更审核 (2026-06-21)

**上游 release**: `v1.13.2` (`bbc89a65`), 2026-06-18
**范围**: v1.13.1 (`dfa0ec61`) → v1.13.2 (`bbc89a65`), 7 commits, 66 files, +5100/-2653

### Changelog 对应真实改动

| 上游 commit | Changelog 项 | 真实改动范围 | 本地合并判断 |
|---|---|---|---|
| `0542bcfc` | Startup: 不等待 default OpenCode config | `useConfigStore.ts`、`client.ts`、`bootstrap.ts`、`sync-refs.ts`，+940/-33 | 🟡 中高风险：fork 的 config/client/bootstrap 已深改，需逐段合并 |
| `e88afff2` | Chat/Performance: 长会话和大 session list streaming 更顺 | 47 files, +3167/-1828；chat streaming、turn projection cache、sidebar memo、sync stale guard、history preload | 🔴 高风险：不能整包拿，需拆成 chat/sidebar/sync 三个 milestone |
| `fefad721` | Chat: assistant 段落间距恢复 | `index.css` + design token，小 CSS 修复 | 🟢 低风险 |
| `5e8fe1ec` | Chat: streamed response 末尾不再偶发截断 | `event-pipeline.ts` + 测试；`message.part.updated` 作为 delta coalescing barrier | 🟢 低风险，高价值 |
| `30b5cf14` | Files: HTML/image/PDF preview 不再 50 秒后 auth required | `runtime-auth.ts` + `FilesView.tsx`，官方新增 proactive token refresh | 🟡 中风险：fork 当前无 `runtime-auth.ts`，需按本地预览鉴权适配 |
| `c051409e` | Diff: line wrap off 时 header/横向滚动不溢出 | `DiffView.tsx` 2 行级布局修复 | 🟢 低风险 |
| `bbc89a65` | release v1.13.2 | version/changelog | release-only，发布收尾再处理 |

### 第一批低风险移植计划

| 顺序 | 功能 | Commit | 说明 |
|---|---|---|---|
| 1 | 流式末尾截断修复 | `5e8fe1ec` | 先补测试，再在 event pipeline 中让 part snapshot 清掉同 part 的 pending delta coalesce key |
| 2 | assistant 段落间距 | `fefad721` | 接上 `--markdown-paragraph-spacing`，tool/reasoning markdown 保持紧凑 |
| 3 | Diff 横向滚动布局 | `c051409e` | 补 `min-w-0`，避免长 diff 行把 header controls 挤出面板 |

### v1.13.2 第一批低风险移植批次 (2026-06-21)

**范围**: v1.13.2 低风险独立修复
**验证**: `bun test packages/ui/src/sync/__tests__/event-pipeline.test.js` ✅ 25/25 / `bun run type-check` ✅ 0 errors / `bun run lint` ✅ 0 errors

| # | 功能 | 上游 commit | 文件数 | 说明 |
|---|---|---|---|---|
| 1 | 流式末尾截断修复 | `5e8fe1ec` | 2 | `message.part.updated` 现在会清掉同一 message/part 的 pending delta coalesce key；补回归测试，防止 snapshot 后 delta 被吞 |
| 2 | assistant 段落间距 | `fefad721` | 2 | `.markdown-content p` 接入 `--markdown-paragraph-spacing`；最后一个 block 去掉尾部 margin；tool/reasoning markdown 保持紧凑 |
| 3 | Diff 横向滚动布局 | `c051409e` | 1 | Diff 外层 flex child 增加 `min-w-0`，避免关闭 line wrap 时长行把 header controls 挤出面板 |

### 后续批次建议

| 批次 | 内容 | 处理方式 |
|---|---|---|
| 第二批 | Files preview token 续期 (`30b5cf14`) | 先梳理 fork 当前 `/api/fs/raw` 和 preview 鉴权，再按本地结构实现 proactive refresh |
| 第三批 | Startup config 非阻塞 (`0542bcfc`) | 针对 `useConfigStore` / `client` / `bootstrap` 做逐段 diff，重点保护手动 model 和目录 model |
| 独立 milestone | Chat/sidebar streaming 性能大改 (`e88afff2`) | 不整包合并；拆 chat tail isolation、sidebar row memo、sync stale guard 三块分别测试 |

## v1.13.3 ~ v1.14.1 — 当前差距审核 (2026-07-09)

**社区当前版本**: `v1.14.1` (`9fc971c8`), 2026-07-07
**本 fork 当前版本标记**: `1.13.2-merging-dev` (`package.json`, `packages/{web,ui,electron,vscode}/package.json`)
**已确认落地基线**: v1.12.4 Tier 1+2、v1.13.0 Tier 1、v1.13.1 低/中风险 A/B、v1.13.2 第一批低风险。
**尚未等价宣布**: v1.13.3~v1.14.1 整体；本地已有若干后续功能的 fork 实现痕迹，但未按官方区间完整校准。

### 官方 compare 范围

| 范围 | commits | files | diff | 备注 |
|---|---:|---:|---:|---|
| `v1.13.2...v1.13.3` | 45 | 95 | +3466/-642 | 多数是会话绑定、滚动、provider/model/settings、CLI/OpenCode 进程修复 |
| `v1.13.3...v1.13.4` | 20 | 300 | +8373/-10307 | 含日文 docs/i18n、大量 dead-code cleanup、自动 review loop、queue 拖拽、model picker 持久化 |
| `v1.13.4...v1.13.5` | 3 | 25 | +170/-26 | CLI/quota/provider startup 回归修复 |
| `v1.13.5...v1.13.6` | 7 | 31 | +520/-312 | chat auto-follow、Dock badge、context panel seen、preview token 去重 |
| `v1.13.6...v1.13.7` | 7 | 21 | +342/-81 | expanded tools 下滚动稳定、移动端 history/controls、providers form 保持 |
| `v1.13.7...v1.13.8` | 23 | 51 | +960/-1418 | GitHub PR status 限流/并发、OpenCode auto-attach 禁止、follow-up behavior、subagent 删除、sync watchdog |
| `v1.13.2...v1.13.8` | 105 | 300 | +9742/-9700 | 不能整包套 patch；上游删除/整理和 fork 深改冲突明显 |
| `v1.13.8...v1.13.9` | 27 | 336 | compare 过大未完整渲染 | native iOS/Android app、桌面 bundled CLI/keep-awake/custom headers、chat scroll/reconnect 修复、VS Code agent config 修复 |
| `v1.13.9...v1.14.0` | 26 | 133 | +11532/-6526 | voice input/local STT/Kokoro TTS、mobile composer 大重构、统一 list virtualization、cross-project abort、LAN auth/Windows CLI 修复 |
| `v1.14.0...v1.14.1` | 17 | 91 | +4153/-392 | Small Model utility、session recap/suggestion、notes/TTS/git generation 改用 Small Model、timeline load earlier、line-range links、VS Code favorites/settings 修复 |
| `v1.13.8...v1.14.1` | 70 | 450 | compare 过大未完整渲染 | 三个 release 合计；移动端/语音/Small Model/桌面运行时改动大，不能整包套 patch |

### 版本功能盘点

| 版本 | 主要新增/修复 | 本 fork 初判 |
|---|---|---|
| `v1.13.3` | slash skill 调用、粘贴 `@` 不触发 file mention、用户 code block 字符保真、session switch/history scroll 稳定、ArrowUp history、new session 绑定当前 project/directory、pinned/folder 空刷新保护、agent thinking/temp/topP、provider disconnect、SSH commit signing、MiniMax quota、VS Code font prefs、managed OpenCode orphan cleanup、CLI pid identity、非 Latin header | 🟡 多数可逐项合；chat/input/scroll 和 session binding 要保护 fork 的 queue/magic prompt/remote routing |
| `v1.13.4` | Japanese i18n/docs、queued message drag reorder、发送时关闭 open question、底部 pinned scroll 稳定、automatic review loop、model picker reorder/accordion/Shift+Delete、model shortcut 自定义、external OpenCode agent save 状态、provider add form 保持、worktree session bootstrap gate、draft generate materialization、CLI live port check | 🟡/🔴 混合；docs/i18n/CLI 小修容易，auto review loop、queue drag、model picker、worktree bootstrap 需逐段 |
| `v1.13.5` | 修复 CLI/quota/provider startup 回归、`openchamber update` helper、tunnel start paths、fork upstream detection、Google quota helpers | 🟢/🟡 以 server/CLI 小修为主，但 `packages/web/bin/cli.js` 本地 5452 行，需按 helper 粒度 port |
| `v1.13.6` | chat scroll 全面稳定、slash skill 再修、context panel tab title/seen、macOS Dock badge、preview duplicate token、mobile typography | 🟡 部分已存在：`desktop_set_dock_badge`、`desktop-dock-badge.ts` 已有；scroll/preview/context panel 仍需对照官方 diff |
| `v1.13.7` | expanded tool 下 scroll 不跳、mobile history virtualization fidelity、mobile composer polish、providers add flow 保持、update helper 修复 | 🔴 chat/mobile scroll 依赖本 fork 的 `@tanstack/react-virtual` MessageList；不能直接套官方滚动实现 |
| `v1.13.8` | startup PR status 不阻塞连接、禁止自动接管外部 OpenCode、Follow-up behavior 替代 queue-mode、worktree/archived session 删除带 subagent、worktree session selection 防 snap-back、sync watchdog 不重复 resync、GitHub timeout/rate-limit/cooldown | 🟡/🔴 混合；GitHub PR status 容易独立，OpenCode attach/kill 与本 fork Electron/managed runtime 生命周期强耦合 |
| `v1.13.9` | native iOS/Android app projects、mobile saved connections/password unlock/QR/push/widgets/app resume、desktop bundled OpenCode CLI + custom CLI path、Keep awake、remote runtime custom headers、SSH UI password unlock、chat late tool/subagent/thinking scroll 修复、embedded JSON 防 result-card、idle reconnect 恢复、VS Code agent null-field/CLI detection 修复 | 🔴 高风险为主：本 fork 无 `packages/mobile`；desktop bundled CLI 与本 fork custom OpenCode binary/shared channel 约束冲突；remote headers/SSH/auth 可逐项评估；chat/sync 小修需适配本 fork scroll/routing |
| `v1.14.0` | streaming dictation、local STT picker (Parakeet/Whisper/OpenAI-compatible)、Kokoro read-aloud、Voice settings 重构、mobile compact composer/bottom sheets/fullscreen editor/history button/autocomplete/keyboard choreography、统一 list virtualization、cross-project abort、LAN-bound local auth、prefer user OpenCode install、Windows CLI discovery/launch 修复 | 🟡/🔴 混合：本 fork 已有旧 STT/TTS/Kokoro/OpenAI-compatible 基础但没有 1.14 streaming dictation UI；mobile composer 大改因无 native mobile 包需延后；cross-project abort/Windows CLI 可单项合；list virtualization 要保护本 fork `@tanstack/react-virtual` MessageList |
| `v1.14.1` | Small Model utility calls、finished reply recap/suggested next message、Notes selected text summarization、TTS summarized mode、Git/GitHub generation 改用 Small Model、timeline dialog load earlier、line-range file refs、first changed diff line jump、mobile keyboard/PWA safe-area 修复、desktop auth fallback 修复、VS Code favorite models/settings return 修复 | 🟡/🔴 混合：本地未见 `small-model`/session assist 地基；timeline/line-range/diff-line/VS Code favorites 多数可独立；Small Model 必须按 session directory/provider 权限设计，不能走全局 provider fallback |

### 本地已有或部分覆盖

| 功能 | 本地证据 | 结论 |
|---|---|---|
| macOS Dock unread badge | `packages/electron/main.mjs` 有 `desktop_set_dock_badge` IPC；`packages/ui/src/sync/desktop-dock-badge.ts` 已调用 | ✅ 已有 fork 实现；仍需和 v1.13.6 Appearance toggle / unseen activity 口径复核 |
| Steer delivery 基础 | `steer-side-channel.ts`、`session-actions.ts`、`client.ts` 已支持 `deliveryMode: "steer"` | 🟡 有核心能力；v1.13.8 的 Settings > Chat `Follow-up behavior` 仍未完整替换现有 `queueModeEnabled` UX |
| gh CLI credentials | `packages/web/server/lib/github/gh-cli-credential.js`、routes/octokit 已接入 | ✅ 属于 v1.13.0 已移植项，后续 GitHub PR status 修复可在此基础上做 |
| Cron parser | `packages/ui/src/lib/cron.ts`、scheduled-tasks runtime 已用 `cron-parser` | ✅ v1.13.1 已移植 |
| Diff virtualization / PierreDiffViewer | `PierreDiffViewer.tsx`、`patchFileDiff.ts`、DiffView data-diff-virtual-root 已存在 | 🟡 有较多 v1.13.0 Git/Diff 地基，但 v1.13.3~8 的 history diff/cleanup 仍需 diff |
| Chat MessageList virtualization | 本地 `MessageList.tsx` 使用 `@tanstack/react-virtual`，没有上游 `virtua` 迁移 | 🟡 fork 已有自己的虚拟化路径；后续 scroll fixes 应适配本地实现，不直接照搬官方 `virtua` 代码 |
| Markdown/Shiki rewrite | 本地无 `packages/ui/src/components/chat/markdown/` 目录，仍有 `MarkdownRendererImpl.tsx` + react-markdown 路径 | ❌ v1.13.1 高风险重写仍未落地；后续 markdown fixes 若改 `markdownCore.ts` 不能直接套 |
| Native mobile app projects | 本地只有 `packages/ui` / `packages/web` / `packages/electron` / `packages/vscode`，无 `packages/mobile` | ❌ v1.13.9 native iOS/Android app project 未落地；mobile/PWA UI 修复只能按现有 web mobile surface 选合 |
| Voice/TTS 基础 | `VoiceSettings.tsx`、`useBrowserVoice.ts`、`useMessageTTS.ts`、`wasmSttService.ts`、`ttsInputMode: 'sanitized'|'raw'` 已存在；`small-model` 相关目录不存在 | 🟡 已有旧语音/TTS/STT 和 Kokoro/OpenAI-compatible 基础；v1.14.0 streaming dictation、local model picker、Kokoro first-class read-aloud、v1.14.1 summarized TTS 未等价 |
| Desktop OpenCode CLI / remote auth | 本地已有 `OPENCHAMBER_OPENCODE_PATH` / `OPENCHAMBER_OPENCODE_BIN`、拒绝 OpenCode.app 当 CLI、UI password/remote instance 基础；未见 `runtime-request-headers.mjs`、bundled CLI prepare/verify 脚本、Keep awake 设置 | 🟡/🔴 部分覆盖；v1.13.9 bundled CLI 必须服从本 fork custom OpenCode build/shared DB 规则，remote custom headers 和 Keep awake 可单独评估 |
| Timeline dialog | 本地已有 `TimelineDialog.tsx` 和 `loadOlder` 主聊天入口，但 timeline dialog 自身未见 v1.14.1 的 load earlier 控件 | 🟡 可独立移植，需确认历史分页状态来自当前 session 的 authoritative store |
| Line-range file refs / first changed line | 本地已有普通 timeline/file path click、`openFileAtFirstChangedLine` i18n key；未见 `fileReferenceParser.ts` | 🟡 可独立做；MarkdownRendererImpl 是 fork 深改文件，需补 focused parser tests |
| VS Code favorites/settings return | 本地 VS Code 有独立 webview/runtime；未见 v1.14.1 favorite model persist / settings previous-view 修复证据 | 🟡 平台小批次处理，避免污染 web/desktop |

### 容易合并 / 建议第一批

| 优先级 | 功能 | 来源版本 | 原因 | 处理建议 |
|---|---|---|---|---|
| 1 | 非 Latin download/header 修复 | v1.13.3 | server header 编码通常独立，低耦合 | 先找 `Content-Disposition` / fetch header helper，补测试 |
| 2 | MiniMax quota API 兼容 | v1.13.3 | provider adapter 局部改动 | 只动 quota provider 和测试 |
| 3 | skills catalog settings 后刷新 | v1.13.3 | settings/store 小修 | 对照本 fork skills catalog store，避免误刷新 remote instance |
| 4 | provider disconnect endpoint 修复 | v1.13.3 | settings route 小修 | 后端 route + Providers UI 单项验证 |
| 5 | Git push 前 sync | v1.13.3 | GitView action 小改 | 保护本 fork gitApi 路由；补失败提示 |
| 6 | CLI pid identity / live port check / update helper | v1.13.3~5/7 | CLI 回归修复价值高 | `packages/web/bin/cli.js` 按 helper 抽取逐项 port，不套 cleanup |
| 7 | GitHub PR status timeout/rate-limit/cooldown/concurrency | v1.13.8 | 主要在 `github/pr-status.js` 和 store，不应影响 chat | 独立批次；验证 startup 不被 PR status 阻塞 |
| 8 | Preview duplicate auth token | v1.13.6 | URL 清理局部 | 先对照本 fork preview auth/token 机制，补 URL 去重测试 |
| 9 | Context panel chat title/seen | v1.13.6 | 本地已有 context panel session/unread store | 逐文件合并，避免影响主 session unread 口径 |
| 10 | Cross-project/worktree abort routing | v1.14.0 | `session-actions` 路由级修复，高价值且范围相对小 | 必须用 session 的 serverId/directory，不能读全局当前 project |
| 11 | Desktop LAN-bound auth token fix | v1.14.0 | 本 fork 已有 UI password/LAN 基础，可能是局部 auth 判定 | 先读 `opencode` auth/runtime docs，验证 0.0.0.0 / 127.0.0.1 token 口径 |
| 12 | Timeline dialog load earlier | v1.14.1 | 已有 TimelineDialog 和 loadOlder 主链路，适合小步补齐 | 只接当前 session 历史分页；避免用全局当前 session fallback |
| 13 | Line-range file refs + first changed line jump | v1.14.1 | 解析和导航局部，用户价值高 | 新增 parser tests；MarkdownRendererImpl 不整包替换 |
| 14 | VS Code favorite models / settings return | v1.14.1 | 平台内小修，不影响 web/desktop | 单独 VS Code 批次验证 reload/settings navigation |

### 中等难度 / 需要逐段适配

| 功能 | 影响文件/模块 | 风险点 |
|---|---|---|
| slash skill 调用、粘贴 `@`、ArrowUp history、发送关闭 question prompt | `ChatInput.tsx`、autocomplete、question state | 本地 `ChatInput.tsx` 近 5k 行，已有 magic prompts、queue mode、remote routing；只移植纯逻辑函数和测试 |
| queue drag reorder + Follow-up behavior | `messageQueueStore.ts`、`QueuedMessageChips.tsx`、`OpenChamberVisualSettings.tsx`、`ChatInput.tsx` | 官方用 Follow-up behavior 替换 queue-mode；本 fork 已有 `steer` 能力但设置仍是 boolean `queueModeEnabled` |
| model picker reorder/accordion/Shift+Delete + thinking variant | `ModelPickerList.tsx`、`ModelControls.tsx`、agents settings | fork 已有 hidden/favorite/recent 和 remote instance model scope；必须按 instance/serverId 隔离 |
| agent temp/topP/thinking save/clear | `AgentsPage.tsx`、`useAgentsStore.ts`、server agents/config | 本 fork 已做过 prompt/permission persistence；新增字段要按 custom/project/user 层级合并 |
| session project binding / pinned/folder empty refresh / worktree snap-back | sidebar hooks、global sessions store、project selection | fork 有 remote instance、Global Pinned、session markers；所有 fallback 必须使用 session/directory authoritative context |
| worktree session bootstrap gate / draft generate materialization | worktree store、session actions、GitView generate | 不能破坏 `[OPENCHAMBER-FORK] ensureWorktreeProject` 和 pending draft flow |
| subagent 删除级联 | `SessionNodeItem`、`useSessionActions`、delete/archive flow | fork 已有 export/delete subtask 文案和运行中跳过逻辑；需保留 per-child partial failure |
| VS Code font prefs / mobile exact grouping / mobile history | `packages/vscode/*`、mobile apps | 可做，但建议平台批次，不和 web/desktop 混合 |
| Desktop remote custom headers / SSH saved password unlock | `packages/electron`、`remote-instances`、`ssh-manager`、remote proxy/SSE relay | 本 fork remote instance proxy 是深改区域；header forwarding 必须贯穿 HTTP + WebSocket + SSE，不能只改设置页 |
| Voice input / local STT / Kokoro read-aloud refresh | `VoiceSettings.tsx`、`useBrowserVoice.ts`、`lib/voice/*`、`web/server/lib/tts/*` | 本地已有旧实现，官方 v1.14.0 是 UX + runtime 重构；应先抽取 local model picker/STT/TTS capability，不直接套 mobile composer 改动 |
| Small Model utility consumers | `web/server/lib/small-model`（新）、config/settings、session assist metadata、Git/GitHub generation、TTS/Notes | 高价值但必须按 session directory/provider/model 权限约束；后台任务禁止无 session 的全局 provider 扫描 |
| Unified list virtualization / chat history loading | `MessageList.tsx`、mobile history、scroll preservation | 官方从 `virtua` 转向统一 `@tanstack/react-virtual`，但 fork 已有自己的 MessageList 虚拟化和 process folding；只移植可证明的 scroll invariants |

### 高风险 / 不建议作为第一批

| Milestone | 原因 | 处理方式 |
|---|---|---|
| Chat scroll 全链路稳定 (v1.13.3~7) | 上游多轮修复 `useChatAutoFollow` / `MessageList` / history virtualization；本 fork 用 `@tanstack/react-virtual`、process folding、custom scroll anchoring，文件差异大 | 单独开性能 milestone；先写滚动复现脚本，再 port 最小逻辑 |
| Markdown/Shiki worker rewrite 相关后续 fixes | 本地没有上游 `chat/markdown/` 目录，`MarkdownRendererImpl.tsx` 仍承载 agent/skill links、文件路径点击、table copy 等 fork 功能 | 暂不混入 v1.13.3~8；若做，必须先迁移 fork 自定义渲染能力 |
| OpenCode never auto-attach / orphan cleanup / process killer port ownership | 本 fork Electron 在同进程启动 web server，并有自定义 managed OpenCode keep-alive / detach / quit 语义 | 先读 `opencode` 模块 docs + Electron lifecycle，做 runtime-truth 验证；不能照搬上游 kill/attach 判断 |
| v1.13.4 dead-code cleanup / knip sweep | compare 删除大量 UI/shared 文件；fork 仍有远程实例、session markers、custom UI 依赖 | 暂缓。cleanup 不应和功能合并混在一起 |
| Japanese docs/i18n bulk import | 文件量很大但业务风险低；容易污染 diff | 等功能批次稳定后单独做 docs/i18n 批次 |
| Native iOS/Android app project | v1.13.9 新增 `packages/mobile`，当前 fork 无该 workspace，且本 fork desktop/web runtime 已有自定义远程实例/managed runtime 语义 | 不作为第一阶段；除非明确决定引入 mobile workspace，否则只选合 PWA/mobile web 修复 |
| Bundled OpenCode CLI | 官方 v1.13.9 打包 pinned OpenCode CLI，但本 fork 明确要求保留 custom merged OpenCode build 和 shared `opencode.db` channel | 不能直接 port；先设计 custom build packaging/update 策略 |
| Mobile composer/keyboard full redesign | v1.14.0/1 大面积改 `MobileApp`/`ChatInput`/autocompletes/keyboard choreography；本 fork 没有 native mobile package，且 ChatInput 深改 | 先处理小的 PWA auth/safe-area bug；大重构单独排 |

### 建议下一步批次

1. **小修批次 A (低风险)**: header encoding、MiniMax quota、skills catalog refresh、provider disconnect、Git push sync、Preview duplicate token、line-range file refs、first changed line jump。
2. **CLI/Startup/Desktop auth 批次 B**: pid identity、live port check、update helper、quota/provider startup、Bun global CLI fix、LAN-bound local auth token，按 helper/route 切，不做 v1.13.4 cleanup。
3. **GitHub PR status 批次 C**: timeout/rate-limit/cooldown/concurrent metadata，并验证启动时 session/diff/message 不被 PR status 阻塞。
4. **Chat input/abort 批次 D**: pasted `@`、ArrowUp、question dismiss、slash skill 调用、cross-project abort routing，全部补 focused tests。
5. **Queue/Steer 批次 E**: 把 boolean `queueModeEnabled` 迁到 Follow-up behavior (`steer` / `queue`)，复用本 fork `steer-side-channel`。
6. **Session/worktree 批次 F**: selected project binding、folder/pinned refresh、worktree snap-back、subagent delete cascade、timeline dialog load earlier；必须按 `openchamber-context-authority` 校准 directory/serverId。
7. **VS Code 批次 G**: favorite models persist、settings close returns previous view、agent null field cleanup、CLI detection，单独验证 extension reload/navigation。
8. **Voice/Small Model 批次 H**: 先做 Small Model server capability + settings + one consumer（建议 TTS summarized 或 Notes selected text），再扩展 session recap/suggestion 和 Git/GitHub generation。
9. **高风险 milestone**: chat scroll + auto-follow、OpenCode process ownership、Markdown/Shiki rewrite、mobile/native app、bundled custom OpenCode packaging、bulk docs/i18n，分别处理。
