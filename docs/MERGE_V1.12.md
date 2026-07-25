# Merge v1.12.x → merge/v1.11.0

**Date**: 2026-06-04 ~ 2026-06-11
**Upstream**:
  - v1.11.7 (`5eccf83b`) → v1.12.0 (`996ffb08`), 56 commits, 347 files, +22816/-5022
  - v1.12.0 (`996ffb08`) → v1.12.1 (`b7cf5afd`), 173 files, +2421/-17345
  - v1.12.1 (`b7cf5afd`) → v1.12.2 (`a4c04ba7`), 16 commits, ~90 files, +2500/-700
  - v1.12.2 (`a4c04ba7`) → v1.12.3 (`cafbff47`), 5 commits, ~40 files, +640/-310
  - v1.12.3 (`cafbff47`) → v1.12.4 (`4a263c1`), 2026-06-11 release-note feature inventory added; commit/file diff pending
**Method**: 手工逐功能点移植，禁止 git merge/force

## Work Item 管理

- **GitLab 项目**: `https://coding.s-s.city/songsong/openchamber`
- **总览 Work Item**: `https://coding.s-s.city/songsong/openchamber/-/issues/1`
- GitLab 是未完成能力、优先级、风险、阻塞关系和版本 milestone 的权威执行 backlog；本文继续作为逐 commit 审计、架构判断和验证证据账本。
- Agent 双源规则见 [`AGENTS.md`](../AGENTS.md)「Migration backlog (dual source of truth)」。
- 已完成、fork 已等价、明确不适用和纯上游维护项不重复创建待办。每个延期或新发现的运行时能力必须对应一个 GitLab Work Item。
- 关闭 Work Item 前必须完成实现、定向测试、全仓检查、对应运行面的实际 QA，并把验证证据更新回本文。
- Native mobile / Android 从上游 `v1.13.9` 开始作为跨版本产品轨道管理；`v1.16.2` 的 APK/AAB 区分只是该轨道的后续更新器修复，不再错误归类为 1.16 新功能。

### 同步清单

完成一个 Work Item 后，按顺序做完再关闭：

1. 本文对应功能行改为 ✅，并链到该 WI（`/-/work_items/<n>`）。
2. GitLab：加 `status::done`、close issue，附实现/验证 note。
3. 总览 [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) checklist 勾选该条目。

新延期 / 新发现上游运行时能力时：

1. 先在 GitLab 建 WI（milestone + labels），并挂到 [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1)。
2. 再在本文记 ⏸️ / 🟡 / 🟠 等状态，并链到该 WI。
3. 不为本地未提交 WIP 批量建 issue；只有已判定延期的上游运行时能力才进 backlog。

### 元任务 [#30](https://coding.s-s.city/songsong/openchamber/-/work_items/30)

[#30](https://coding.s-s.city/songsong/openchamber/-/work_items/30) 是流程收口项：固化 GitLab ↔ 本文双源规则，而不是常驻 open blocker。关闭后靠 `AGENTS.md` 与本节清单持续遵守；后续同步不再依赖 #30 保持打开。

| 项 | 状态 | 证据 |
|---|---|---|
| GitLab backlog 集成与文档同步 | ✅ 已收口；Work Item [#30](https://coding.s-s.city/songsong/openchamber/-/work_items/30) 已关闭 | `AGENTS.md` 写入 dual-source 规则；本节补充同步清单；MERGE 延期行交叉链接 #6/#7/#9–#12/#14–#19/#23–#26/#29/#31/#32 等；已完成项 #3/#5/#13/#20/#21/#22 与总览 [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) checklist 对齐。无产品运行时代码改动 |

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

**已单独处理**：
- 历史加载改为 sentinel + `IntersectionObserver` 提前预取：距离顶部约 3 个视口（最低 2400px）时自动请求；同一历史版本只自动尝试一次，`Load older messages` 保留为失败/无进展时的手动保底。
- prepend 使用稳定 turn 锚点并在虚拟行测量收敛期间同步恢复；滚轮、触摸、指针或键盘继续滚动会立即取消锚点，避免与用户意图竞争。
- `MessageList` 已在后续批次对齐 v1.16 的 `@tanstack/react-virtual` 路径；旧 `virtua` 迁移计划作废，详见 v1.16 Chat scroll stability 批次。
- 注意命令名是 `/explore`，不是 `/explorer`。

**后续建议**：不要再整批套官方 chat diff。按以下顺序恢复剩余功能：
1. 历史自动预取、手动保底与 prepend 锚点已经稳定；后续改动必须继续验证同版本防自旋和用户输入取消锚点。
2. `TurnChangedFilePills` / `changedFiles`，先补类型和 grouping contract，再接 UI。
3. `MessageList` v1.16 虚拟化与桌面滚动稳定已完成；移动端 momentum 仍需独立验证。

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
| **滚动加载历史** | ✅ 距顶部约 3 个视口自动预取，手动 `Load older messages` 作为保底；server pagination、虚拟化与 prepend 锚点均已验证 | 🟢 已完成 |

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
| Desktop/macOS | Menu bar tray with live session status, Mini Chat, provider usage submenu | ✅ 已落地；Work Item [#27](https://coding.s-s.city/songsong/openchamber/-/work_items/27) | `tray.mjs` + template 图标；`useTraySync` 聚合 local/remote sync stores（`serverId + directory`）；主窗/Mini Chat focus；usage 子菜单；Quit 走确认退出（Keep/Stop OpenCode） |
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
| `0542bcfc` | Startup: 不等待 default OpenCode config | `useConfigStore.ts`、`client.ts`、`bootstrap.ts`、`sync-refs.ts`，+940/-33 | ✅ 已逐段移植；Work Item [#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2) 已关闭。`getConfig` 实例缓存 + sync-config bridge；`loadAgents`/`initializeApp` 不再 await `config.get`；`selectionSource` + `applyOpenCodeConfigDefaults` 保护 manual/project 选择；directory key 仍含 `serverId` |
| `e88afff2` | Chat/Performance: 长会话和大 session list streaming 更顺 | 47 files, +3167/-1828；chat streaming、turn projection cache、sidebar memo、sync stale guard、history preload | 🔴 高风险：不能整包拿，需拆成 chat/sidebar/sync 三个 milestone |
| `fefad721` | Chat: assistant 段落间距恢复 | `index.css` + design token，小 CSS 修复 | 🟢 低风险 |
| `5e8fe1ec` | Chat: streamed response 末尾不再偶发截断 | `event-pipeline.ts` + 测试；`message.part.updated` 作为 delta coalescing barrier | 🟢 低风险，高价值 |
| `30b5cf14` | Files: HTML/image/PDF preview 不再 50 秒后 auth required | `runtime-auth.ts` + `FilesView.tsx`，官方新增 proactive token refresh | ✅ fork 架构等价；Work Item [#3](https://coding.s-s.city/songsong/openchamber/-/work_items/3) 已关闭。fork 不存在约 50 秒的 `oc_url_token` 生命周期：Web/remote 图片通过同源 `/api/fs/raw` 和 UI Session cookie，HTML 使用已读取内容的 `srcDoc`，Desktop 图片使用 data URL；不引入无调用方的 token scheduler |
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
| 第二批 | Files preview token 续期 (`30b5cf14`) | ✅ 审计完成：上游短命 URL token 模型不适用于 fork；`/api/fs/raw` 显式目录、preview proxy 认证参数重写和 HTML preview 导航共 24 条定向测试通过 |
| 第三批 | Startup config 非阻塞 (`0542bcfc`) | ✅ 已完成；Work Item [#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2)。定向测试：`client.getConfig` / `sync-refs.config` / `useConfigStore.nonblocking` |
| 独立 milestone | Chat/sidebar streaming 性能大改 (`e88afff2`) | 不整包合并；拆 chat tail isolation、sidebar row memo、sync stale guard 三块分别测试 |

## v1.13.3 ~ v1.16.0 — 当前差距审核 (更新于 2026-07-13)

**社区当前版本**: `v1.16.0` (`e1e5bf61`), 2026-07-13
**本 fork 当前版本标记**: `1.13.2-merging-dev` (`package.json`, `packages/{web,ui,electron,vscode}/package.json`)
**已确认落地基线**: v1.12.4 Tier 1+2、v1.13.0 Tier 1、v1.13.1 低/中风险 A/B、v1.13.2 第一批低风险。
**尚未等价宣布**: v1.13.3~v1.16.0 整体；本地已有若干后续功能的 fork 实现或等价实现，但未按官方区间完整校准。
**Custom OpenCode 状态边界**: 外部 custom OpenCode 已单独更新 GPT-5.6 用量支持；这不等于 OpenChamber v1.16.0 的 OpenCode Go quota provider 或 Codex reset-window 修复，后两项仍按 OpenChamber 代码独立审核。

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
| `v1.14.1...v1.15.0` | 50 | 249 | +19402/-2914 | private relay、native mobile pairing、多 transport desktop、通用 tool result/JSON viewer、project default model、Last turn diff、Mermaid zoom、code line number/wrap |
| `v1.15.0...v1.16.0` | 63 | 231 | +11767/-1313 | server-driven session goals、server-persisted auto-accept、OpenCode Go quota、queue idle dispatch、subagent prompting、markdown preview、sidebar sort/pin/tree 修复、remote relay/security 修复 |
| `v1.14.1...v1.16.0` | 113 | 408 | +31041/-4099 | 两个大版本合计；remote/mobile/goal 架构占比高，只能按独立能力切分，不能按 release 整包合并 |

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
| `v1.15.0` | E2E private relay、native iOS/Android pairing v2、desktop 多 transport fallback/host health、Windows tray/startup、通用 tool result + navigable JSON、project default model、Last turn diff、Mermaid zoom、code line number/wrap、sticky user header/transport failure 等修复 | 🔴 架构功能占主导：本 fork 的 remote instances/sidebar 已深改且无 native mobile workspace；relay/pairing 不合。tool result、Mermaid zoom、code wrap、transport failure 可拆成独立中风险批次 |
| `v1.16.0` | server-driven session goals、OpenCode Go quota/Codex reset time、relay candidate/identity/claim lock、server-persisted permission auto-accept、subagent direct prompt、queue idle dispatch、pending question/rename/pin refresh修复、markdown preview、project sort、editor font、fork source repo、agent YAML 保真、通知/Windows/mobile/security 修复 | 🟡/🔴 混合：queue idle dispatch 是最小高价值修复；markdown preview、VS Code Insiders、agent YAML 保真可单项合。Goals、relay、server auto-accept 会改 server/runtime authority，必须独立设计和验证 |

### v1.15.0 ~ v1.16.0 新增差距分组

| 分组 | 状态 | 判断 |
|---|---|---|
| Queue idle dispatch + failure backoff (`73209d4f`, `c387fb21`) | ✅ 已移植 | queue item 在 authoritative status 已是 idle 时也会发送；同一失败队首按 2s→60s 指数退避，队首变化后清除旧失败状态；保留 `sendConfig` / `sendTarget`、recent abort、in-flight guard 和失败恢复 |
| Markdown preview toggle (`7ab06f15`) | ✅ fork 已提前完成 | FilesView 已有 Markdown edit/preview toggle、状态持久化、TTS 与本地文件渲染；不复制官方较弱的按钮/默认模式实现 |
| VS Code Insiders (`c8761951`) | ✅ 已移植 | Open In app registry 已加入 `Visual Studio Code - Insiders`，沿用现有 installed-app scan、icon、selection persistence 和 Electron `open -a` fallback |
| Windows drive casing (`39c4bbd4`) | ✅ 已按多实例架构移植 | 共享规范化已进入 project/session/config/worktree/child-store 权威键；只统一 Windows 首位盘符，不折叠 POSIX 大小写，`serverId` 分域保持不变 |
| Agent YAML frontmatter preservation (`e9193876`) | ✅ 已移植 | UI 不再构造 undefined description/scope；web 与 VS Code 核心更新器均跳过 undefined，null 删除语义保持不变；project `.md` round-trip tests 覆盖自定义字段 |
| Tool result/JSON summary、Mermaid zoom、code line number/wrap、Last turn diff | 🟡 部分完成 | Last-turn Diff [#13](https://coding.s-s.city/songsong/openchamber/-/work_items/13) 与 Navigable JSON [#14](https://coding.s-s.city/songsong/openchamber/-/work_items/14) 已关闭；code line number/wrap 已适配本地 `MarkdownRendererImpl`；Mermaid 沿用现有 fork，不能直接换掉 Markdown/MessageBody |
| Project default model / project sort / command palette project search | 🟡 部分完成 | project sort 与 Command Palette 项目搜索已按唯一 project ID、`serverId + directory` 适配；project default model 仍需独立按实例隔离，不能引入全局 active-project fallback |
| Server-persisted permission auto-accept (`6231375b`) | 🟠 独立高风险 | 本地已有 UI store、draft intent、subagent inheritance和 server mirror，但 server 只保存进程内 Set；重启持久化、app 关闭后自动响应和多 server ownership 尚不等价。无独立 WI：继续作为 Goals/权限相关后续发现项跟踪，确认延期时再建 WI |
| Session goals (`56cf5e29`) | ✅ v1 local-only 已关闭；Work Item [#29](https://coding.s-s.city/songsong/openchamber/-/work_items/29) | **关闭口径：v1 local-only**（`serverId === default`）。已交付 host `session-goal` runtime、composer arm/Row/Dialog、`sendMessage` stamp、Small Model audit（directory + last-assistant）、settings。完整 DoD 拆到：[#33](https://coding.s-s.city/songsong/openchamber/-/work_items/33) glyph+settle、[#34](https://coding.s-s.city/songsong/openchamber/-/work_items/34) Plan/Fork/Todo/scheduled/`/craft-goal`、[#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) Remote。勿与 `#6` 混批 |
| Goals sidebar glyph + settle notify 抑制 | ✅ 本地收口；Work Item [#33](https://coding.s-s.city/songsong/openchamber/-/work_items/33) | `SessionNodeItem` status glyph；`notifications/runtime` 在 active goal 时抑制 per-turn ready；settle 仍走 desktop/UI notify |
| Goals 本地入口接线 | ✅ 入口批次；Work Item [#34](https://coding.s-s.city/songsong/openchamber/-/work_items/34) | Plan/Fork/Todo `runAsGoal` + arm/`sendMessage`；scheduled `goalEnabled`/`goalTokenBudget`；`/craft-goal` magic prompt + autocomplete + draft starter；全程 local-only gate（VS Code 隐藏） |
| Remote Session Goals | ✅ ADR Accepted + 已实现；Work Item [#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) | [`docs/REMOTE_SESSION_GOALS_ADR.md`](./REMOTE_SESSION_GOALS_ADR.md)：C 门禁 + B `GET /api/goals/capability` 探测 + A 远端 OC 跑 loop；UI objective 走 `/api/remote/{id}/goals/...`；本机 runtime 仍忽略非 default；remote settle 本机 toast；与 `#6` 分批 |
| Direct subagent prompting | ✅ 已移植 | Chat 设置新增默认关闭的显式开关；子会话按自身 `parentID` 识别，不依赖父会话是否已载入，Parent 返回入口保留。右侧嵌入 chat 通过同源、已登记 frame 校验的双向桥实时同步；Web/Desktop 设置 API、启动 hydration 与服务端 boolean sanitizer 已接入 |
| Local Host spoof protection | ✅ 已移植 | tunnel auth 不再只信任 `Host: localhost`；Host 必须是 localhost/private/loopback 且真实 socket 地址同时为 private/loopback，配置中的公开 tunnel host 仍优先识别为 tunnel。控制器级测试覆盖远端伪造 Host |
| Notification reliability | ✅ 已移植 | 父会话判断已从可能受分页影响的全量 Session 列表改为带 directory 的单 Session 查询，main/null 结果也进入短期缓存；`session.idle` 可补发 completion，`session.error` 规范化进入错误通知并按 Session 冷却去重。focused runtime 测试覆盖子会话模板/抑制、idle fallback 与 error fallback |
| Sidebar file tree refresh | ✅ 已移植 | 手动刷新不再清空 `childrenByDir` 造成展开树闪烁/折叠；按当前 root 的权威 `expandedPaths` 先刷新根目录、再以 3 路批次刷新展开目录。切换项目、过滤条件或卸载会 abort 旧刷新，避免跨目录结果回写 |
| Sidebar project sorting | ✅ 已移植 | 侧栏菜单提供 `manual / A-Z / Z-A / date-added / recent`，持久化 display store；所有 project sections 在分组前统一使用同一顺序。默认 `manual` 保留 fork 现有手工排序，只有 manual 模式允许拖拽，project pin 继续高于所选排序规则；无自定义标签时沿官方规则使用完整 path 排序 |
| Pinned Session 空刷新保护 | ✅ fork 已有更强等价实现 | 全局 pin 由独立 `oc.sessions.pinned` Zustand store 持久化，项目内 pin 与两类排序也使用独立 storage；Session snapshot 的空成功或暂时缺项只替换列表数据，不会清空 pin。现有 store tests 覆盖持久化、rehydrate、损坏数据和跨 tab 同步 |
| Chat visual settings 分组 | ✅ 已按 fork 设置项适配 | 保留本 fork 的 queue/steer、multi-run、diff、自动折叠 thinking 等额外设置，只为现有 Chat 设置加入“会话辅助 / 推理 / 消息外观 / 工具和文件 / 输入框”语义标题；未复制官方 Goals、recap 等尚未落地的控件，8 个 locale 同步 |
| Private relay / pairing v2 / native mobile | 🔴 不合；Work Items [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) / [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) | 与本 fork DIY remote instances/sidebar、认证、SSE proxy 和无 `packages/mobile` 的现状冲突；除非另立 remote transport 项目，不进入普通迁移批次 |
| OpenCode Go quota / Codex reset windows | ✅ 已移植 | 新增独立 credential store/route/provider、active-instance UI 和 VS Code bridge parity；Codex 两个窗口均按 `limit_window_seconds` 生成标签，不再固定假设 5h/weekly |

### 本地已有或部分覆盖

| 功能 | 本地证据 | 结论 |
|---|---|---|
| macOS Dock unread badge | `packages/electron/main.mjs` 有 `desktop_set_dock_badge` IPC；`packages/ui/src/sync/desktop-dock-badge.ts` 已调用 | ✅ 已有 fork 实现；仍需和 v1.13.6 Appearance toggle / unseen activity 口径复核 |
| Follow-up behavior / Steer delivery | `steer-side-channel.ts`、`session-actions.ts`、`client.ts`、`followUpBehavior.ts`、`messageQueueStore.ts`、`useQueuedMessageAutoSend.ts` | ✅ 已完成枚举设置、旧值迁移、Enter/修饰键行为、queue-time config/target 快照、idle dispatch 和失败退避 |
| gh CLI credentials | `packages/web/server/lib/github/gh-cli-credential.js`、routes/octokit 已接入 | ✅ 属于 v1.13.0 已移植项，后续 GitHub PR status 修复可在此基础上做 |
| Cron parser | `packages/ui/src/lib/cron.ts`、scheduled-tasks runtime 已用 `cron-parser` | ✅ v1.13.1 已移植 |
| Diff virtualization / PierreDiffViewer | `@pierre/diffs@1.3.0-beta.6`；`patchFileDiff.ts` + `PierreDiffViewer` 1.3 API（`FileDiffMetadata` / `areFilesEqual` / separator CSS）；`appThemeRegistry` signature+LRU；DiffView turn/working 传 `fileDiff`；Tool metrics `spacing` | ✅ [#8](https://coding.s-s.city/songsong/openchamber/-/work_items/8) 已关闭。未重写 DiffView Changes UX（Tier3 changelog #27）亦未做 hunk stage（MERGE #28） |
| Chat MessageList virtualization | `MessageList.tsx` 使用 `@tanstack/react-virtual@3.14.5` / `virtual-core@3.17.3`，带官方越界 offset clamp patch | ✅ 已按 v1.16 统一虚拟化路径校准；5 条以上始终虚拟化，本地 7 轮 buffered reveal 已移除；历史容器采用单一 `totalSize` + 行级测量，禁止全局 `measure()` 清空尺寸缓存 |
| Markdown/Shiki rewrite | 本地无 `packages/ui/src/components/chat/markdown/` 目录，仍有 `MarkdownRendererImpl.tsx` + react-markdown 路径 | ❌ v1.13.1 高风险重写仍未落地；后续 markdown fixes 若改 `markdownCore.ts` 不能直接套 |
| Native mobile app projects | 本地只有 `packages/ui` / `packages/web` / `packages/electron` / `packages/vscode`，无 `packages/mobile` | ❌ v1.13.9 native iOS/Android app project 未落地；mobile/PWA UI 修复只能按现有 web mobile surface 选合 |
| Voice/TTS 基础 | `VoiceSettings.tsx`、`useBrowserVoice.ts`、`useMessageTTS.ts`、`wasmSttService.ts`、`ttsInputMode: 'sanitized'|'raw'` 已存在；`small-model` 相关目录不存在 | 🟡 已有旧语音/TTS/STT 和 Kokoro/OpenAI-compatible 基础；v1.14.0 streaming dictation、local model picker、Kokoro first-class read-aloud、v1.14.1 summarized TTS 未等价 |
| Desktop OpenCode CLI / remote auth | 本地已有 custom embedded OpenCode staging/verify/signing 脚本、强制 shared data channel、CLI path guards、Keep Awake、desktop/browser password fallback 和完整打包 runbook | ✅ custom packaging/Keep Awake/auth 已完成；官方 relay transport、remote custom headers/SSH saved password 仍未等价，不能混为一项 |
| Timeline dialog | `TimelineDialog.tsx` 已接入 `onLoadEarlier` / loading 状态 / 加载前锚点保持，`ChatContainer` 使用当前 session timeline controller 提供分页状态 | ✅ 已有等价实现，无需重复移植 |
| Line-range file refs / first changed line | `markdownFileReferences.ts` 已解析 `file.ts:10-20` / `#L10-L20` 并有 focused tests；`DiffView` 已按首个 changed line 打开文件 | ✅ 已有 fork 实现，保留现有 MarkdownRenderer 适配层 |
| VS Code favorites/settings return | `modelPrefsAutoSave.ts` / `persistence.ts` 已持久化 favorites；`VSCodeLayout.tsx` 已用 `viewBeforeSettingsRef` 返回上一视图 | ✅ 已有等价实现，无需重复移植 |
| Desktop LAN-bound auth token | Electron `isLocalRuntimeUrl()` 已按同端口 + 本机 hostname/interface 判断 `0.0.0.0` / LAN 地址为本地 runtime | ✅ 已有等价实现，无需重复移植 |

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
| 11 | Desktop LAN-bound auth token fix | v1.14.0 | ✅ 已有等价实现 | Electron 已按同端口 + 本机地址识别 local runtime |
| 12 | Timeline dialog load earlier | v1.14.1 | ✅ 已有等价实现 | 当前 session timeline controller 已提供分页与滚动锚点保持 |
| 13 | Line-range file refs + first changed line jump | v1.14.1 | ✅ 已有 fork 实现 | 保留 `markdownFileReferences.ts` 与现有 DiffView 路径 |
| 14 | VS Code favorite models / settings return | v1.14.1 | ✅ 已有等价实现 | favorites 持久化和 previous-view return 均已存在 |

### 第二轮独立小修 (2026-07-10)

| 编号 | 功能 | 来源版本 | 状态 | 处理边界 |
|---:|---|---|---|---|
| 1 | Embedded JSON 示例误显示为 generated-result card | v1.13.9 | ✅ 已移植 | 只接受整段纯 JSON 或整个 fenced JSON block；已补 parser regression tests |
| 2 | VS Code agent 可选字段清除写入 `null` | v1.13.9 | ✅ 已移植 | PATCH 传 `null` 时删除 md frontmatter / JSON field，保留其他 agent 配置；已补 bridge test |
| 3 | Idle reconnect 后 stale busy 恢复 | v1.13.9 | ✅ 本地已有更完整实现 | `reconnect-recovery.ts` + `resyncDirectoryAfterReconnect` 已按 candidate sessions 回读 authoritative status；缺失 status 强制 idle，并有 stale-busy watchdog 同步 global store |
| 4 | Windows OpenCode CLI 路径发现与 `.cmd` 启动 | v1.14.0 | ✅ 已移植 | web/desktop + VS Code 去除包裹引号；补 system npm prefix / Scoop；`.cmd` 经 `cmd.exe call` 启动 |
| 5 | Task/subagent session id parser 增强 | v1.13.9 | ✅ 已移植 | 已作为本 fork JSON / `task_id` / `session_id` 之后的补充解析，并保留 fallback child-session 匹配 |

**运行确认 (2026-07-10)**: 用户已确认第二轮 1 / 2 / 4 在实际使用中可用。自动化验证为 15 个 focused assertions、root + VS Code type-check/lint、root build 与 VS Code build 全部通过；Windows 专项由模拟 `win32` runtime tests 覆盖，尚未在 Windows 真机复测。

### 第三轮候选 (2026-07-10)

| 优先级 | 功能 | 难度 | 当前判断 |
|---:|---|---|---|
| 1 | `<task id="...">` 子会话标签解析 | ✅ 已移植 | 新增独立 parser + 3 tests（含属性乱序），作为本 fork JSON / `task_id` / `session_id` 之后的补充解析，不替换 fallback child-session 逻辑 |
| 2 | 排除 Windows OpenCode Desktop app 路径 | ✅ 已移植 | web/desktop 与 VS Code 均排除 `%LOCALAPPDATA%/Programs/opencode/opencode.exe`；显式 settings 会报准确错误，PATH/where/fallback 自动发现会跳过；保留 WSL 禁用策略 |
| 3 | Desktop Keep Awake | ✅ 已移植 | Electron `powerSaveBlocker('prevent-app-suspension')`、settings persistence、启动恢复、退出清理、Desktop Network toggle 和 8 locale 已接入 |
| 4 | Follow-up behavior (`steer` / `queue`) | ✅ 已按 fork 架构移植 | 新增明确的 follow-up preference、旧 boolean/`immediate` 迁移和 busy submit 行为矩阵；保留 queue-time `sendConfig` + `sendTarget`，未整段替换官方 queue store |
| 5 | Desktop/browser password auth fallback | ✅ 已按 fork 架构移植 | 未引入官方 `runtime-switch`/client-token 地基；Electron 主进程代发当前远端 origin 的密码登录并把 HttpOnly session Cookie 写入当前窗口 session，IPC 严格限制同源 |
| 6 | PWA keyboard resize-content 默认与 safe-area 收尾 | ✅ 已移植，待真机复测 | 无配置默认改为 `resize-content`，保留显式 `native` override；iOS 不再强制回退；PWA composer、dialog、overlay、top toast safe-area 已按本 fork 现有 DOM 适配 |

### Follow-up behavior 专项审计与实现（2026-07-13）

**官方 v1.13.8 的行为**：

- 把 `queueModeEnabled: boolean` 升级为 `followUpBehavior: 'steer' | 'queue'`，新默认值是 `steer`。
- 迁移旧值：`queueModeEnabled=true` 映射到 `queue`，`false` 和旧 `immediate` 映射到 `steer`。
- busy session 下，主 Enter 行为由该枚举决定；queue 模式下可用修饰键 steer，steer 模式下主 Enter 直接 steer。它同时改设置 UI、持久化和 `ChatInput` 热路径，并非只换一个 label。

**本 fork 的 DIY 行为**：

- 仍以 `queueModeEnabled=true` 为默认；busy 时普通提交进入 queue，并保留显式 `deliveryMode: 'steer'` / `'interrupt'` 路径。
- queue item 已在排队时冻结 `provider/model/agent/variant` 的 `sendConfig`，解决了切换 agent/model 后排队消息仍用旧配置的问题。
- queue item 额外冻结 `sendTarget`（`directory` + `serverId`）。这是本 fork 多 instance / remote routing 的关键字段，官方 queue store 没有这层上下文。
- 本 fork 的 `steer-side-channel.ts`、`session-actions.ts` 和 `client.ts` 已有 steer transport；缺的是统一的 follow-up preference UX，不缺底层 steer 能力。

**为什么没有直接套官方 diff**：

1. 整段替换官方 queue store 会丢 `sendTarget`，排队消息可能被发到后来激活的 instance/directory。
2. 新用户默认从 queue 变成 steer，属于明显行为改变；旧用户迁移和无旧设置用户的默认策略必须单独决定。
3. 官方重写 Enter/Ctrl+Enter 分支，容易和本 fork 的 `normal` / `steer` / `interrupt`、magic prompt、question state、queued force-send 分支交叉。
4. 现有“排队时冻结 agent/model/variant”修复必须继续以 queue item snapshot 为权威，不能在实际发送时从 live controls 重新解析。

**本次实现结果**：

- `followUpBehavior: 'steer' | 'queue'` 已替代运行时 `queueModeEnabled`；全新安装默认 `steer`，旧 `true/false/immediate` 分别迁移为 `queue/steer/steer`。
- busy session 下，Enter 执行所选行为，Ctrl/Cmd+Enter 执行另一个行为；idle/new-session 始终走 normal send。原显式 interrupt-and-send 闪电按钮已移除，紧急中止统一使用停止按钮后再发送。
- queue item 的 `sendConfig` 与 `sendTarget` 继续作为自动发送和手动发送的权威快照；迁移测试覆盖 agent/model/variant 与 directory/serverId 不丢失。
- Settings > Chat 已改为 `Steer now / Queue` 选择器，并完成 8 个 locale、桌面和 390px 响应式验证；设置同时写入 Zustand v1 与 `/api/config/settings`。
- focused tests、`bun run type-check`、`bun run lint` 和 Playwright 实际切换/恢复均通过。

### Fork runtime / packaging 完成记录（2026-07-13）

- Packaged app 启动时的 interrupted-run recovery 已改为 SQLite JSON 条件过滤，不再把所有含 `status` 的历史 part materialize 到 Electron 内存；22GB 实际 `opencode.db` 验证约 2.7 秒完成且候选为 0，修复此前约 3.7GB RSS 后 OOM 退出的问题。
- Custom embedded OpenCode 已建立 staging、identity/version、shared data channel、双重签名和 packaged smoke-check 脚本；`docs/EMBEDDED_OPENCODE_PACKAGING.md` 是强制 runbook，禁止用官方 binary 替换 custom merged build。
- Electron packaged app 与 `bun run dev` 均已用真实共享数据启动验证；这些是 fork runtime 稳定性/分发能力，不把它们误计为上游 release feature。

### v1.16 Queue reliability 批次（2026-07-13）

- `shouldDispatchQueuedAutoSend` 现在接受明确的 `hasQueuedItems` 条件：有 queue item 且当前 authoritative status 为 idle 时直接 dispatch，不再要求必须观察到 `busy/retry -> idle` 边沿。
- 失败队首按 2 秒起步指数退避，最高 60 秒；只限制同一 message，队首变化后立即丢弃旧 failure record。成功发送或成功执行 local slash command 后清理失败状态。
- 自动发送仍从 queue snapshot 读取 `provider/model/agent/variant` 和 `directory/serverId`，没有回退到后来切换的 instance 或 controls；原 recent-abort、per-session in-flight、remove/restore rollback 继续生效。
- 纯策略被抽到 `queuedMessageAutoSendPolicy.ts`，避免测试加载 React/store 初始化副作用。focused queue tests 12/12、strict no-excuse check、全量 `bun run type-check` 和 `bun run lint` 均通过。

### v1.16 小型兼容批次（2026-07-14）

- Open In app registry 新增 VS Code Insiders，使用 macOS 应用名 `Visual Studio Code - Insiders`；现有 Electron installed-app scan 与 `open -a` fallback 会自动接入，无需新增 IPC 或平台分支。
- Agent update 的 `undefined` 与 `null` 语义已分离：`undefined` 表示 UI 没有提供该字段并保持现有 frontmatter，`null` 继续表示显式删除。web server 与 VS Code bridge 保持一致。
- `AgentsPage` 仅在有值时发送 description，新 agent 仅在有 scope 时发送 scope，降低无意义字段进入 mutation boundary 的概率；核心更新器仍承担最终数据保护。
- focused tests 4/4、全量 `bun run type-check` 与 `bun run lint` 通过。额外 strict scan 报告的 7 项均为 `opencodeConfig.ts` 既存违规，本批新增行没有引入新违规。

### v1.13.4 / v1.15 / v1.16 交互与 quota 批次（2026-07-14）

- queued message chips 支持鼠标、触摸和键盘拖拽排序；store 仅重排数组，queued item 本体及其 `sendConfig`、`sendTarget` 快照保持同一引用，自动发送仍以排队时上下文为权威。
- OpenCode Go quota 已注册到共享 provider registry；workspace ID 与 dashboard auth cookie 使用 OpenChamber 独立的 owner-only credential file，状态 API 永不回传 cookie。Web/desktop 通过 active instance base URL 调用，VS Code bridge 提供同一契约。
- Codex primary/secondary reset window 都从 API 的 `limit_window_seconds` 生成显示标签，支持服务端窗口长度变化。
- Markdown code block 在高亮和流式降级路径均显示同步行号；全局换行按钮持久化 `codeBlockLineWrap`，纯文本/CJK 单元格渲染路径保留。

### v1.16 Chat scroll stability 批次（2026-07-14）

- 移除本 fork 的 7 轮 buffered reveal 双层分页：`turnStart` 固定为 0，`Load older messages` 只根据 authoritative server cursor 拉取真实历史，不再先改变本地窗口高度。
- 5 条以上历史始终使用 `@tanstack/react-virtual`；依赖升级到 `3.14.5` / `virtual-core@3.17.3`，并应用官方 out-of-range scroll offset clamp patch。
- 空闲会话不再因 ResizeObserver、内容重测或 settle burst 自动回到底部；用户向上滚动立即释放 auto-follow。桌面 prepend 只做一次同步锚点恢复，不再运行 900ms 重复写入。
- 历史列表改为官方 v1.16 的单一尺寸容器：外层高度只使用 virtualizer `totalSize`，当前窗口只使用顶部偏移，不再把剩余估算高度重复渲染成尾部 padding。
- 移除历史容器 ResizeObserver、entry 变化和内容变化触发的全局 `virtualizer.measure()`；该 API 会清空全部行高缓存，使大量 42px 的折叠 OMO 行反复退回 320px 估算并制造数千像素空白。现在只由每行 `measureElement` 更新尺寸，并使用已测行高的自适应平均值估算未测行。
- virtualizer 的 `scrollToFn` 会先同步暴露新的 `totalSize` 再写滚动位置，避免浏览器按旧高度截断锚点修正；虚拟行尺寸变化只补偿当前首个可见行上方的变化。
- 自动历史预取使用顶部 sentinel + `IntersectionObserver`，在约 3 个视口（最低 2400px）内触发；请求 pending、loading 和 history version 三重门控防止重入/自旋，无 observer 环境退回被动 scroll listener。显式 Load older 仍作为失败或无进展时的保底。
- 精确回归会话 `ses_0b5e6259bffd7VmOXn1RtsMN7S`：修复前在最后已渲染行后仍有 1480–1660px 尾部 padding，且全局重测使历史总高度保持约 18k；修复后首屏历史高度收敛到 7680px，物理底部 `scrollTop === max === 6888`，最后历史行位于 834px、最新用户消息位于 914–969px（视口 1009px）。
- 同一会话 Playwright 验证：向上/向下各滚动 700px 后等待 1.5s 漂移均为 0；OMO 折叠展开后高度 8222 -> 11044 -> 8222，收起后漂移 0；`Load older` 后 `scrollTop 0 -> 1982` 且 1.2s 内漂移 0，再滚到底后最后历史行与最新消息仍完整落在视口内，无大块空白。
- 最大真实会话 `ses_18d725d60ffew6mw40mAFhIZMs` 自动预取验证（2026-07-19）：1280×900 下 `scrollTop=2400`、保底按钮仍在视口上方 2388px 时触发；450 条扩展到 900 条后稳定 turn 锚点从 `top=433.890625` 恢复到 `433.46875`，漂移 0.42px。375/768/1280 三档视口均无横向溢出。

### v1.16.1 / v1.16.2 第一批核对（2026-07-20）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| 创建 Session 失败时保留输入草稿 | ✅ 已有更完整实现 | `ChatInput` 在发送失败后恢复正文、附件、confirmed mentions、inline drafts、synthetic parts 和 queue snapshot；`session-ui-store` 同时恢复 `newSessionDraft` 的 selected project、directory、parent、folder 和 permission intent，不套官方只恢复正文的分支 |
| 新 Session 严格留在所选项目，包含嵌套项目 | ✅ 已校准 | 新建发送继续冻结 `selectedProjectId + directory + serverId`；通用项目解析改为先匹配显式注册的最长项目路径，再回退到 worktree ownership，避免嵌套子项目被父项目 worktree 吞掉；新增 remote server 回归测试 |
| 子智能体在侧栏打开并返回 Parent | ✅ 已有 fork 实现 | Task 卡通过 `openContextChat` 打开右侧 chat tab，`TaskSessionMaterializer` 按 child/parent `serverId` 和 directory 同步会话；嵌入会话显示 Parent 按钮并保持只读，不引入官方单实例 iframe 导航状态 |
| Shell 模式卡片实时状态和输出 | ✅ 已完成 | 本地已有 optimistic `/shell` 卡、Bash bridge 折叠、实时 output/status 合并、展开/复制 UI；补齐 memo comparator 对 `shellAction.command/output/status` 的比较，确保 running、流式输出和 completed 变化触发重绘 |
| Android 更新器区分 APK/AAB | ⏸️ 当前不适用；Work Item [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) | 官方补丁只在 `appType=mobile-capacitor + platform=android` 时解析 GitHub Release APK；本 fork 没有 `packages/mobile`/Capacitor runtime，也没有该调用方。暂不加入无调用方的更新分支，待 native mobile milestone 一并移植 |
| VS Code 每 Session Autoaccept 持久化 | ✅ 已按 fork 架构移植 | 保留 fork 的 Web/Desktop server mirror、子会话继承和多实例权限路由；VS Code extension `globalState` 作为权威策略并在 sidebar/editor/agent-manager Webview 间广播。首次升级会迁移旧 local policy；缺失子会话按通知携带的 `directory + serverId` 补取父链，权限回复使用同一显式目标并做 0/250/1000ms 有界重试 |
| Small Model 环境变量/文件密钥 + Gemini thinking | ✅ 已随基础批次落地；Work Item [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12) | 随 `packages/web/server/lib/small-model` 一并引入 `{env:NAME}`、`{file:path}` 与 Gemini 3 `thinkingLevel`；`call.test.js` 覆盖 custom OpenAI / Gemini thinking |
| 嵌入侧栏子任务原地导航 | ✅ 已按多实例架构移植 | 抽取稳定 iframe 身份与锚点 Session helper；嵌入 Chat 打开子任务时在当前 iframe 内切换，router 不改写 `ocPanel/sessionId/directory/readOnly`，bootstrap 不把孙级任务拉回锚点。Parent 只在钻取后出现并按 session registry 保留目标 `serverId`；主聊天、移动端、VS Code 和普通右侧开新 tab 行为保持不变，纯 helper 回归测试在每个用例内显式恢复 window，以兼容本仓库精简的 Bun 测试类型声明 |
| Quota 凭据保存提示本地化 | ✅ fork 已等价 | 上游为通用 `QuotaCredentials` 增加 provider 插值；本 fork 当前只有专用 `OpenCodeGoCredentials`，保存提示已使用 8 套 locale 的专用 key，不存在英文硬编码或 provider 混淆，无需把单 provider 组件泛化 |
| 新 Session 缺 directory 时的项目路由 | ✅ fork 已有更强实现 | `createSession` 强制显式 `directoryOverride`，按目标 `serverId` 选择 client，并以服务端 directory 优先、显式目录兜底注册 session routing；嵌套项目解析也已改为注册项目最长路径优先，不会回退到可变全局目录 |
| Task 子 Session 权威绑定 | ✅ 已移植并收紧 | 运行中 Task 只认 OpenCode `state.metadata.sessionId/sessionID`；part metadata、`task_metadata` 和 output 中的明确 ID 仅兼容旧持久记录。已移除按父 Session、开始时间和 busy 状态扫描目录并在 3 秒后扩大窗口的猜测路径，避免并行子任务绑定到错误 child；纯函数测试覆盖 live 优先、旧记录兼容与无 ID 不猜测。旧 fallback helper 暂留但不再被产品代码引用，后续只作为清理项处理 |
| Prompt active-turn 稳定与底部锚点 | ✅ 已移植并验证 | Scroll spy 不再按 IntersectionObserver 可见比例选择 active turn，改为按固定阅读线单调推进，长消息滚动时不会因比例翻转来回切换；距离物理底部 8px 内固定选择最后一轮，短末轮也能成为当前轮。保留 fork 的 timeline controller、虚拟列表和滚动位置写入边界，纯函数测试覆盖阅读线与底部锚点 |
| Desktop project deep link | ✅ 按官方关闭 | `openchamber://project/...` 不再把外部 URL 中的任意路径直接加入本地项目；Session 与多实例 Host deep link 保留。UI 内部的显式目录选择、open-draft-session 和项目管理流程不受影响 |

#### v1.16.1 / v1.16.2 剩余提交审计（2026-07-21）

| 官方功能/修复 | 状态 | Fork 结论 |
|---|---|---|
| Desktop Prompt Navigator rail | ✅ 已补齐社区完整交互 | 已对齐 v1.16.2 的整条 gutter 命中、边缘轮播、30 刻度窗口、8 行虚拟预览、全 Prompt 键盘/滚轮遍历、prepend 索引保持、窄窗口避让、渐隐遮罩与邻近刻度波形；rail 仅在桌面 Web/Electron、非展开输入且至少 2 条真实 Prompt 时显示，VS Code 与移动端隐藏，隐藏时关闭键盘面板。HelpDialog、Chat 设置开关和快捷键自定义列表均按官方规则在 VS Code 过滤无效入口；非 VS Code 设置仍可同步桌面偏好。HelpDialog 已接入 `mod+alt+p`，8 套现有 locale 使用社区文案。保留 fork 的 synthetic/Shell 过滤、稳定预览缓存和 `scrollToTurnId(..., { behavior: 'auto' })` 滚动边界，避免覆盖 multi-instance 上下文与重新引入聊天滚动跳动；简化版遗留且无调用方的居中窗口 helper/test 已删除。模型 4 项与 settings 19 项测试通过，改动文件 ESLint、docs validation、全 workspace type-check/build 通过；隔离真实组件在 1280/768/375 验证边缘轮播、面板滚轮、前插 12 条后的 Prompt 身份保持、`End + Enter` 选到第 48 条、28px/12px gutter 和移动端隐藏，最终两路只读审阅均以 0.98 高置信 PASS。全量 lint 仅剩并行 `sync/retry.ts:87` 的 `prefer-const`，不属于本批且未覆盖 |
| Sidebar Session ownership 性能索引 | ✅ fork 已等价且多实例更强 | `useProjectSessionLists` 已一次建立 `sessionById`、direct/tree project cache 和 project buckets；全局 store 维护 `sessionsByDirectory` 与 status Map，SessionSidebar 另有 remote server、嵌套项目、Global Pinned 和 worktree 索引。官方单实例 `sessionOwnership.ts` 不能覆盖这些结构，不再重复引入第二套 owner source |
| Small Model 自定义 OpenAI provider dispatch | ✅ 已随基础批次落地；Work Item [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12) | `call.js` 支持 config `baseURL`/apiKey 与 catalog fallback；settings override + Notes consumer 已接线，非死代码 |
| Linux AppImage window controls / updater polish | ⏸️ Linux 发行批次；Work Item [#32](https://coding.s-s.city/songsong/openchamber/-/work_items/32) | 当前内部发行和真实 QA 均为 macOS Developer ID + notarization；AppImage 标题栏、安装检测和 Linux 更新文案不影响现有 runtime。保留官方差异清单，建立 Linux 构建与安装 QA 后再移植 |
| Quota toast / Shell 状态与输出 / Task 权威绑定 | ✅ 已完成 | Quota 已有专用本地化；Shell optimistic card 与流式状态已补 comparator；Task 已移除时间/状态猜测并只消费明确 child Session ID |
| 删除 Share Opinion sidebar prompt | ✅ fork 无对应 surface | 当前 sidebar、footer、设置与 i18n 均不存在 `ShareOpinionDialog` 或 opinion CTA，无需删除不存在的社区推广入口 |
| Session goal child-activity gate / evaluation diagnostics | ✅ 已随 #29 v1 local-only 落地；Remote 扩展见 [#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) | local runtime 已按 directory 拉 parent/children status，并记录 evaluation provider/model；非 default `serverId` 事件忽略。Remote 权威 status 订阅留在 #35 |
| Chat input 与 Editor font size 解耦 | ✅ fork 已等价 | `editorFontSize` 仅用于 FilesView CodeMirror theme；ChatInput 使用聊天 typography/token，不读取 editor font setting，因此不存在官方修复的输入字号串联 |
| 新 Session draft 所选项目 / 创建失败恢复 | ✅ 已完成 | selected project、directory、serverId 和完整输入/附件/inline drafts 均在 draft snapshot 中恢复，覆盖官方两个小修 |
| 固定消息跨 compaction 恢复 | ⏸️ 独立上下文安全批次；Work Item [#18](https://coding.s-s.city/songsong/openchamber/-/work_items/18) | 官方不是本地收藏：它把 message ID 写入 Session metadata，监听 `session.compacted`，回读旧消息后自动发送 synthetic prompt。必须先定义每个 pinned entry 与注入请求的 `serverId + directory + sessionId`，处理部分消息已丢失、重复 compaction、queue/steer 并发和远程实例，不能复用全局当前目录 |
| VS Code Autoaccept / missing-directory project routing | ✅ 已完成 | 已按 VS Code `globalState`、父链继承和显式多实例权限目标移植；新 Session 路由以服务端 directory 优先、冻结目录兜底并按最长注册项目匹配 |
| Terminal runtime refactor + mobile workspace | ⏸️ 独立 Terminal/mobile 批次；Work Item [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) | 官方替换 replay buffer、shell/theme/history 协议并新增 mobile workspace；fork 已深改 ghostty-web、context terminal、SSH forward 和 server-scoped terminal store。需先做协议兼容矩阵，不能覆盖现有 terminal runtime |
| Project action auto-discover tooltip/icon | ✅ 核心能力已有，视觉微调暂缓 | fork 已有自动检测 dev server、实时终端输出 URL、Preview 自动打开、等待状态、停止和多 server terminal 路由；当前 search icon 与动态 aria-label 已提供语义，官方 scan icon/tooltip 仅视觉微调，待 Terminal 批次统一处理 |
| Settings layout 标准化 + AgentPermissionsEditor 抽取 | ✅ 功能已有，布局不覆盖 | Agent permission 的 allow/ask/deny、pattern、继承和序列化已在 fork AgentsPage；Settings 正在做 remote-instance wiring，官方大规模单实例页面重排会覆盖 fork 的可见性和路由。继续按页面逐项迁移功能，不机械替换 layout |
| Chat/sidebar/mobile shadows | ➖ 不移植纯视觉差异 | 不为版本号同步引入独立阴影；遵循 fork 现有 theme token 和密度，待对应 surface 有明确设计目标时统一调整 |
| Desktop update check install ID / web schedule | ⛔ 保留内部发行分歧 | fork 使用 `-sscity` 内部包、custom embedded OpenCode、签名/公证门禁和内部下载渠道；不能让官方 release API 或 autoUpdater 静默替换整包。usage telemetry 仍只按现有显式设置上报 |
| Chat input draft-toggle overflow | ✅ fork 结构已规避 | 官方问题来自 mobile 新建按钮外层在 `w-0` 时始终 `overflow-hidden`；fork 已移除该独立外置按钮，send/stop/queue 全部在稳定尺寸的 `ComposerActionButtons` 内，不存在对应裁切路径 |
| Virtual scroll clamp / SDK 1.18.3 | ✅ 已超过官方基线 | virtual-core 3.17.3 clamp patch 与历史滚动验证已完成；manifest 为 `^1.17.9`，lock 实际解析 SDK `1.18.4`，高于官方 1.18.3。嵌入 OpenCode `1.18.4-sscity` 仍是独立发行产物 |

本批验证：Task identity、scroll spy 与 embedded session chat 共 8 条测试通过；全 workspace `type-check`、`lint`、`build` 通过；Electron main 语法检查通过。运行驱动确认阅读线中部选择第二轮、物理底部选择最后一轮、Task live metadata 优先且无明确 ID 时不生成值；deep-link dispatch 保留 Session/Host 并已不存在 Project 分支。未启动、终止或替换 `/Applications/OpenChamber.app` 与任何 OpenCode 进程。

### v1.16.3 第一批审计与兼容小修（2026-07-23）

官方 `v1.16.2..v1.16.3` 共 46 个提交；本轮不按 tag 整包覆盖，按 fork 的多实例侧栏、消息投影和 managed OpenCode 生命周期边界逐项手工移植。遇到并行修改时只补目标逻辑，不替换整文件。

| 官方功能/修复 | 状态 | Fork 处理 |
|---|---|---|
| Mobile Web Terminal hidden input 自动聚焦 | ✅ 已移植并验证 | `TerminalView` 在可见时始终把 `autoFocus` 传给 terminal viewport，触屏输入 overlay 不再因 mobile 判定而失去首次聚焦；不改变 ghostty touch scroll、SSH terminal 或 server-scoped tab 状态 |
| Cursor / VS Code `postMessage` 空对象崩溃 | ✅ 已按 fork 结构移植并验证 | 官方改 `ChatContainer`，fork 的嵌入设置同步位于 `App`；现在要求真实 parent frame、校验 `event.source` 并缓存 parent。VS Code bridge 在 `acquireVsCodeApi()` 缺失/返回空时使用只告警一次的无数据日志 fallback，SSE 回调在 panel 已释放时不再直接解引用 |
| 项目排序默认 manual 的旧偏好迁移 | ✅ 已移植并验证 | fork 已默认 `manual`，但此前没有 persist version；新增只把旧的 `recent` 默认迁到 `manual` 的 v1 migration，保留用户显式 `a-z`、`z-a` 和 `date-added`，不带入官方对 display mode 的历史迁移 |
| Permission Card 隐藏重复 bash pattern | ✅ 已移植并验证 | bash/shell/shell_command 已单独渲染 command 时，从 patterns 展示列表删除完全相同的一项；不同 wildcard/pattern 继续显示 |
| `/plan-feature`、`/debug`、`/weigh` 强制用 Question tool | ✅ 已移植并验证 | 只补 fork 实际存在的三组 magic prompt；不新增官方不存在于本 fork 的 Goal prompt，也不对自然语言 prompt 写脆弱字符串测试 |
| Meta typography 像素取整 | ✅ 已移植并验证 | UI header/label/meta/micro 使用 `round(1.45em, 1px)`，避免非整数 line-height 让小图标在状态更新时上下抖动；字号与 theme token 不变 |
| Project action 打开 terminal 不切主 Tab | ✅ fork 已等价 | 当前 `ProjectActionsButton` 只打开底部 terminal 并切 terminal 内部 tab，没有调用 `setActiveMainTab('terminal')` |
| Active assistant model 显示 | ✅ fork 已等价 | 当前 status row 已从运行中的 assistant/message metadata 解析并展示 provider/model；不回退到可变的 composer 当前选择 |
| FilesView 延迟焦点抢回旧文件 | ✅ 已移植并通过静态验证 | pending focus 只对当前仍选中的目标文件生效，不再在异步加载后把用户切走的 tab 重新选回；preview/error/image 无 CodeMirror 时也会消费请求，避免后续状态变化重复触发。需随下次隔离桌面包补一次“打开文件后立即切换 tab”的交互 QA |
| PR summary 映射回 sidebar directory/branch | ✅ 已移植并验证；Work Item [#20](https://coding.s-s.city/songsong/openchamber/-/work_items/20) 已关闭 | `usePrVisualSummaryByKeys` 继续使用规范化 GitHub lookup key；收集 sidebar group 时同时保留 lookup key 到 `${directory}::${branch}` 展示 key 的映射，渲染前显式转换并跳过已失效条目。未改变多实例项目归属、GitHub client 或 PR 刷新目标路由 |
| VS Code runtime API 注册前识别 workspace | ✅ 已移植并验证；Work Item [#21](https://coding.s-s.city/songsong/openchamber/-/work_items/21) 已关闭 | 新增独立 runtime detector，同时读取 extension host 注入的 `__VSCODE_CONFIG__` 与已注册 runtime API；project store 在静态 import 阶段即可锁定 VS Code workspace，不会短暂按普通 Web 初始化。保留 fork 当前单 workspace、无远程项目写入的 VS Code 约束 |
| Cursor quota token 标签本地化 | ➖ 当前 surface 不存在 | fork 没有官方通用 `QuotaCredentials` 组件；OpenCode Go 与 subscription quota 使用各自本地化 surface，不为 Cursor 凭据造无调用方表单 |
| Parent Session bootstrap recovery / session loading overhaul | 🟠 独立 sync 批次；Work Item [#23](https://coding.s-s.city/songsong/openchamber/-/work_items/23) | 官方包含 197 文件的 runtime isolation、cache ownership、authoritative deletion 和 sidebar cleanup；与 fork 当前并行的多实例 sidebar/global store 修改重叠，必须逐 helper 对照，禁止覆盖 |
| Worktree stale `index.lock` 恢复 | ✅ Web / VS Code 均已移植并验证；Work Item [#22](https://coding.s-s.city/songsong/openchamber/-/work_items/22) 已关闭 | 两端 bootstrap 都先重试两次，再比较锁文件 `dev/ino/size/mtime`，只有第三次仍失败且锁身份完全不变才删除并重试；变化中的锁绝不删除。两端均保留 Git error 文本识别和 worktree `.git` 文件 fallback。VS Code 抽出无 extension-host 依赖的 `git-lock-recovery-runtime`，真实临时仓库/worktree 测试覆盖“稳定旧锁恢复”与“变化活锁保留” |
| Session 移动到新 worktree | 🟠 独立 Git/worktree 批次；Work Item [#24](https://coding.s-s.city/songsong/openchamber/-/work_items/24) | 涉及 Session metadata、folder/pin/todo/queue 迁移，需保持 `serverId + directory` 权威和部分失败语义，不能和 stale lock 小修捆绑 |
| Tool/Office/图片附件标准化 | 🟠 独立 attachment 批次；Work Item [#25](https://coding.s-s.city/songsong/openchamber/-/work_items/25) | 包含 materializer attachment 保留、文件归一化、Office 文档转换、unsupported warning 和 VS Code CSP；需先核对 fork 现有本地图片、`file://` raw route、queue snapshot 与远程文件读取 |
| Remote-only desktop startup / Windows SSH | 🟠 独立 desktop/remote 批次；Work Item [#26](https://coding.s-s.city/songsong/openchamber/-/work_items/26) | 与 fork 自定义 remote instances、SSH manager、managed OpenCode keep-alive 和 chooser/recovery 深度重叠，不能直接套官方 desktop boot 或 SSH rewrite |
| Scheduled task permission autoaccept | ✅ 已移植并验证 | 补齐 fork 缺失的服务端 `permission-auto-accept` 权威策略、持久化 revision、最近显式父子继承、事件监听、失败重试和 pending reconciliation；scheduled task 在首次 prompt 前登记 session policy，登记失败时仍执行任务并退回人工审批。编辑器提供与 composer 一致的 shield toggle，并完成项目配置/API schema、8 个 locale 和旧 IANA timezone canonicalization。保留 fork 现有交互式客户端 autoaccept，通知抑制同时检查客户端和服务端策略 |
| macOS 菜单栏开关 | ✅ 已移植并验证；Work Item [#27](https://coding.s-s.city/songsong/openchamber/-/work_items/27) 已关闭 | 完整 tray runtime：`packages/electron/tray.mjs`、`resources/icons/tray/**`、`setupTray`（darwin-only）、preload `trayEnabled` + platform hint、`useTraySync`（`getAllSyncStores` + `batchLoadStatuses`）、`desktopMacMenuBarEnabled` 默认 true（Settings + settings-helpers + restart）。Tray Quit 走 `requestQuitWithConfirmation`，禁止裸 `app.exit`。定向 settings-helpers 含 `desktopMacMenuBarEnabled`；全仓 type-check/lint 通过。隔离桌面交互 QA（busy 图标 / toggle restart / OpenCode PID）随下次 local app-only 包补测 |
| Hidden-user turn 合并 / footer metadata / streaming jitter | ✅ 已移植并验证；Work Item [#28](https://coding.s-s.city/songsong/openchamber/-/work_items/28) 已关闭 | 新增 `hiddenUserMessage.ts`；`projectTurnRecords` 在 `mergeHiddenUserTurns` 下把无可见 parts 的 user turn 并入上一 turn；assistant `MessageHeader` 移除，provider/model/agent/variant/duration/time 进 turn footer（metadata 左、actions 右 hover 显）；Working 指示器显示 provider logo + `chat.statusRow.modelStatus`；`FadeInOnReveal` mount latch 防 snap；assistant 完成 turn `pb-2`；message text `leading-relaxed` 像素取整 + auto-follow 贴底 overshoot。定向 `projectTurnRecords` 17/17；UI type-check 通过。保留 fork 单 writer scroll、directive fold 与 turn identity reuse |
| React Scan、PR review workflow、LF/docs/mobile native | ➖ 不作为运行时迁移 | React Scan 仅官方 dev helper；PR workflow/agent guidance 属维护策略；`.gitattributes`、纯换行和无 `packages/mobile` 的 native 文件不混入功能批次 |

验证：4 个定向测试文件共 10 条用例通过，覆盖 parent-frame 判定、VS Code API 缺失 fallback、项目排序持久化迁移和 permission pattern 去重；全仓 `bun run type-check`、`bun run lint`、`bun run build` 通过。未重启或替换当前桌面应用；独立浏览器 QA 因本机 `127.0.0.1:5191` 当时无监听进程而未执行。

Scheduled task autoaccept 验证：permission policy、settings sanitizer、project config、scheduled runtime 和 timezone 共 41 条定向测试通过；全仓 type-check、lint、build 通过。隔离运行态驱动真实 scheduled runtime 与临时 OpenCode HTTP surface，观察到 `Session 创建 -> autoaccept policy 登记 -> prompt_async`，且运行结果返回目标 Session ID；未连接或修改正在使用的 OpenCode/OpenChamber。

FilesView focus / worktree lock 验证：stale-lock 两条真实 Git worktree 集成用例通过；全仓 `type-check`、`lint`、`build`、Git service `node --check` 与 docs validation 通过。完整 `service.test.js` 另有 19 条既存环境失败（Bun 下测试 helper 获取 Git stdout/commit hash 为空及签名配置差异），不属于本批回归；新增两条用例可独立通过。未启动、终止或替换当前 OpenChamber/OpenCode。

PR summary / VS Code bootstrap 验证：两个纯函数回归文件共 4 条用例通过，实际使用规范化 GitHub lookup key 验证 `${directory}::${branch}` 映射，并驱动“runtime API 尚未注册但 bootstrap config 已存在”的 VS Code 初始化场景；全仓 `type-check`、`lint`、`build` 与 docs validation 通过。未启动、终止或替换当前 OpenChamber/OpenCode。

VS Code worktree lock 验证：在两个真实临时 Git 仓库及 `--no-checkout` worktree 上分别制造稳定旧锁和观察窗口内变化的活锁；旧锁路径经 `.git` 文件解析后被删除，worktree 成功填充，活锁内容保持为 `active-lock` 且 bootstrap 明确失败。定向测试 2/2、VS Code 专用 type-check、全仓 `type-check`、`lint`、`build` 与 docs validation 通过；未启动、终止或替换当前 OpenChamber/OpenCode。

### 内部发行版本与许可证（2026-07-21）

- OpenChamber 的 merge baseline 已于 2026-07-21 提升到 `1.16.0`；源码版本使用 `1.16.0-sscity`，Electron 每次打包生成 `1.16.0-sscity.YYYYMMDD.HHMMSS`，About、包元数据和内部下载记录使用同一个构建版本。下一次 baseline 提升仍需先完成对应官方区间的逐项审计和验证。
- 自定义 OpenCode 统一使用 `-sscity` 后缀；当前嵌入候选为 `1.18.4-sscity`，且必须以 `OPENCODE_CHANNEL=latest` 构建以继续使用共享数据库。
- OMO 是独立的内部发行产物，不嵌入 OpenChamber；OpenCode、Codex 与 Senpi edition 当前统一为 `4.19.0-sscity`。
- macOS 包新增 `Resources/legal/OpenChamber-LICENSE.txt` 和 `Resources/legal/THIRD-PARTY-NOTICES.md`。内部网站只分发通过 Developer ID 签名、公证、staple 和 Gatekeeper 验证的最终产物。
- `/Applications` 中仍显示 `OpenCode 1.17.20-my`，是因为此前候选没有完成公证和替换，并非新构建版本失效。新候选必须分别核验 About 版本、嵌入 OpenCode 版本和上述许可证文件后才能安装。
- 本地隔离候选 `dist-candidate-sscity-20260721-v3` 已验证：Info.plist、`app.asar/package.json` 均为 `1.13.2-sscity.20260721.141229`，嵌入二进制与 metadata 均为 `1.18.4-sscity`，legal 文件存在，`codesign --verify --deep --strict` 通过。该包仅使用 Apple Development 签名，Gatekeeper 拒绝属预期，不能用于内部网站分发或替换 `/Applications`；仍需单独完成 Developer ID 打包、公证和 staple。
- OMO `4.19.0-sscity` 的版本一致性、打包布局和插件运行时聚焦验证共 48 条通过，typecheck 通过；完整 QA 仍受本机缺少 `tmux` 与 npm 代理安装卡住影响，未将环境门禁误记为通过。
- Developer ID 发行候选位于 `dist-release-sscity-20260721/mac-arm64/OpenChamber.app`：版本 `1.13.2-sscity.20260721.141611`，嵌入 OpenCode `1.18.4-sscity`，签名 Team ID `MB4JP6WR3G`，深度签名校验通过。Apple 公证任务 `cd4d032f-1ba3-4b0e-ad80-7ae041691b52` 已提交但仍为 `In Progress`；本机 `--wait` 已停止，云端任务保留。未 Accepted/staple 前不生成或分发 DMG/ZIP，不替换 `/Applications`。
- 首次实际安装 QA 发现 Electron 包元数据已有时间戳，但 web server 的 `/api/system/info` 仍读取 `@openchamber/web` 基础版本，导致 About 只显示 `1.13.2-sscity`。桌面启动现在会在导入内嵌 server 前传入权威 `APP_VERSION`，server 优先使用该运行时版本；web/VS Code 未提供 override 时继续读取各自 package version。
- 修正版已于 2026-07-21 安装并实际运行：`/Applications/OpenChamber.app` 和 `/api/system/info` 均为 `1.13.2-sscity.20260721.145048`，`/api/opencode/version` 与包内 CLI 均为 `1.18.4-sscity`，resolution source 为 `bundled`，OpenChamber 插件已加载，iCloud `ops` 目录的 path/session API 均返回 HTTP 200。替换时只结束 Electron 壳，前后 7 个 OpenCode PID 完全一致；上一安装包保留在 `/Applications/OpenChamber.previous.20260721-150109.app`。
- 当前本机包使用公司 Developer ID `MB4JP6WR3G` 且深度签名有效，但它是为立即本机使用而显式跳过重复公证提交的目录包。用于内部网站的公证任务 `cd4d032f-1ba3-4b0e-ad80-7ae041691b52` 仍为 `In Progress`；未 Accepted/staple 前不得把本机目录包当作可下载发行件。

### v1.16.1 / v1.16.2 G1 ChatInput 兼容批次（2026-07-20）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| `/skill` 直接调用 | ✅ 已有更完整实现 | `skillSlashDispatch` 已区分真实 command 与同名 skill，保留用户可见请求并追加 synthetic skill instruction；大小写匹配、参数透传和 command 优先级已有 5 条回归测试 |
| 粘贴文本中的 `@` 不触发 mention autocomplete | ✅ 已完成 | 引入纯 `fileMentionAutocompleteState` 判定并区分 manual/paste input source；粘贴邮箱、npm scope、路径或普通 `@` 文本不弹文件/智能体选择，手打 `@` 后只粘贴查询片段仍继续 autocomplete；兼容标准 `insertFromPaste`、仅提供 paste marker 的 WebView、选中文字粘贴 URL、Office 富文本和图片附件插入路径 |
| 多行输入 `ArrowUp` history | ✅ 本地已对齐 | 仅在无 autocomplete 且光标折叠于输入开头时进入历史；多行正文中间或存在选区时不抢占方向键，`ArrowDown` 只在末尾继续/退出历史，原草稿会恢复。与 1.16.2 官方条件逐段一致，无需改 fork 输入状态 |
| 发送时关闭未回答 Question | ✅ 已按多实例架构移植 | 从当前 Session 及其子智能体树收集待答请求，每条请求携带所属 `serverId + directory` 调用 reject，不依赖当前页面目录；Question 先乐观消失，用户消息按排队时的 model/agent/variant/send target 快照入队，等被解锁的旧 turn 回到 idle 后再发送，避免 OpenCode 丢弃仍在运行时到达的新 prompt。单条 reject 失败会记录错误、恢复对应 Question，已排队输入不丢失 |

### v1.13.3 逐项收口（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Git 身份支持 SSH commit signing | ✅ 已移植并验证 | 身份编辑器可启用 SSH 提交签名并保存公钥路径；签名配置只写当前仓库的 `gpg.format`、`user.signingkey`、`commit.gpgsign`。切换到不签名身份时会清理三项本地配置，补足官方补丁没有覆盖的旧签名残留路径；临时仓库回归测试已加入 |
| 添加技能源后立即加载并选中 | ✅ 已移植并验证 | 保存自定义 catalog 后先强制刷新 source 列表，再刷新新 source 的内容并将其设为当前选择；不改动现有仓库扫描、Git 身份认证或目录作用域逻辑 |
| CLI PID 文件校验进程归属 | ✅ 已移植并验证 | `serve` 与实例发现读取 PID 文件后，不再只做存活判断；macOS 通过 `ps`、Linux 通过 `/proc/<pid>/cmdline` 确认命令行属于 OpenChamber。死 PID 或已复用给无关进程的 PID 会清理陈旧记录；无法读取命令行的平台保留原存活 fallback |
| Agent thinking variant + 参数清除 | ✅ 已移植并验证 | Agent 编辑器按所选模型元数据提供 thinking variant 下拉，无元数据时保留自由输入；复制、重命名和保存均保留 variant，8 个现有 locale 已补齐文案。Temperature / Top P / variant 清除现在显式发送 `null`，由现有 web 与 VS Code mutation core 删除旧 frontmatter，而 `undefined` 仍表示未提供字段 |
| 模型可见性与 sibling selector 偏好持久化 | ✅ 已移植并验证 | 自动保存、settings 类型、客户端恢复/清洗和 server 保存边界均覆盖 `hiddenModels`、折叠 provider、最近 agent 和每模型最近 thinking efforts。沿用 fork 的 remote-instance 隔离，远程实例不会读取这些本地偏好；数组/记录有去重和数量上限，空 `recentEfforts` 可明确清除旧值 |
| 取消共享后的 Session 状态同步 | ✅ 已移植并验证 | 侧栏合并 live/global Session 时以 global store 的 `share` 为权威，避免 child store 未初始化时 `unshare` 后仍显示旧链接；directory 和 live Session 的时间等高频字段继续保留，红测已转绿 |
| Tool 耗时跨 Session 切换保留 | ✅ 已移植并验证 | materialization snapshot 缺少 `state.time` 时保留 live part 已有的 start/end；ToolPart 首次挂载及 `part.id` 切换时从 ref 读取最新 server time，不会因后续 time 更新反复清空本地计时基准，红测已转绿 |
| 切换 Agent 时保留 thinking variant 默认链 | ✅ 已移植并验证 | ConfigStore 已补回模型优先级：Agent 配置模型 > Session 保存模型 > Settings 默认模型 > 保持当前；variant 按 `Session saved > Agent config > Settings default > undefined` 解析。ModelControls 的显式切换使用 active-server provider 列表，历史恢复只接受目标模型真实存在的 variant，同步 effect 不再把 Agent/Settings 默认重置为空；queue 仍以排队时的 sendConfig 快照为权威 |
| VS Code font/padding 不被 mobile.css 覆盖 | ✅ 已移植并验证 | device runtime 判定将 VS Code 与 Electron 同样视为桌面 surface；触摸屏设备上的窄 VS Code panel 不再添加 `mobile-pointer`，用户 font size / padding CSS 变量可继续生效 |
| Mobile 子会话箭头触摸尺寸 | ✅ 已移植并验证 | fork 的 chevron 是 `span[role=button]`，为其固定 `minWidth/minHeight=14`，防止 mobile 全局 36px 触摸规则把箭头盒子扩大并覆盖标题；不改行高或点击区域之外的侧栏布局 |
| 空 Session 列表保留 folder 引用 | ✅ 已移植并验证 | 全局 Session 已加载但 active 与所有项目 archived 列表同时为空时跳过 cleanup，避免瞬时空响应清掉 folder 映射；已有 `normalizedProjects.length===0` 数据丢失保护继续保留 |
| Mobile Session 项目精确匹配 | ➖ 架构不适用 | 官方修复针对独立 `MobileSessionsSheet` 的 prefix 分组；fork 已删除该 surface，mobile/desktop 共用多实例 `SessionSidebar`，按 serverId、已注册 project/worktree 和最长项目路径统一归属。不能复制已不存在组件的 helper；后续只需验证共享侧栏的 nested project 用例 |
| Pinned Session 空刷新保护 | ✅ fork 已等价 | 官方在 `useSidebarPersistence` 清理 pinned IDs 前加空列表 guard；fork 的 pinned store/顺序不会按 Session 响应做删除性 reconcile，空刷新只暂时隐藏行，ID 与 order 原样保留，因此不存在对应数据丢失写路径 |
| Sidebar 状态图标占位 | ✅ fork 已有更完整实现 | 官方只在 busy/unread 标记出现时隐藏 pin，并在 hover 时覆盖 chevron；fork 已用 `resolveLeadingState` 与 `resolveGlobalPinnedLeadingState` 明确管理 spinner、unread、pin、chevron 的两槽优先级，普通与 Global Pinned 行共用稳定尺寸，不再复制较弱的条件分支 |
| 展开行触发 virtualizer 重新测量 | ✅ fork 已等价 | 官方修复针对固定 `bufferSize` 缓存键；fork 的会话历史已经统一使用 TanStack virtualizer，每行由 `measureElement`/ResizeObserver 按真实 DOM 高度更新，展开状态改变会自然重测，不存在同一套固定高度缓存。继续保留现有 scroll anchor 约束，避免引入第二个补偿 writer |
| PR review agent / workflow 文案 | ➖ 仓库流程，不移植 | 上游提交只调整 `.github/workflows/pr-review.yml` 和 `.opencode/agent/pr-review.md`；不属于 OpenChamber 运行时功能。本 fork 使用自定义 OMO/审查流程，机械覆盖会改变维护策略，与版本功能同步无关 |
| managed OpenCode 退出清理 | ⛔ 明确保留 fork 分歧 | 上游 v1.13.3 要求 shell 退出时终止 managed OpenCode；fork 则有意在 desktop 以 detached + unref 启动并复用健康持久端口，支持 OpenChamber 壳重启而不中断正在运行的 OpenCode。显式 stop/restart 和不健康旧端口仍由 lifecycle 按进程组清理并有测试，不能照搬上游“退出即杀”而破坏 keep-alive/shared database 约束 |
| v1.13.3 依赖基线 | ✅ 安装与构建验证完成 | root/ui/web/VS Code 的 OpenCode SDK manifest 对齐 `^1.17.9`，当前 lock 按该范围解析为 `1.18.4`；WebAuthn server 锁定 `13.3.1`，KaTeX 锁定 `0.17.0`，DOM Speech 类型锁定 `0.0.12`。fork 未使用官方 dev-only `sharp`，不为机械一致性新增依赖；冻结锁安装、全 workspace type-check/lint/build 均通过，该 SDK 依赖与嵌入 OpenCode `1.18.4-sscity` 二进制是不同产物 |

### v1.13.4 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Review handoff 保留目标 Session thinking variant | ✅ 已移植并验证 | handoff 的目标上下文优先使用该 Session 最后一条用户消息记录的 Agent、provider/model 和 variant；只有没有历史用户选择时才回退到 Agent selection、Session selection 和当前 Config。这样不会把目标 Session 的 thinking effort 替换成发起页面的缓存值，且不改变现有 review 消息发送与多实例目录路由 |
| 启动时清理失效的文件树展开路径 | ✅ 已移植并验证 | 新增只删除 `expandedPaths` 的 prefix action；曾展开的子目录不存在时不再误用 `removeOpenPathsByPrefix` 关闭其下文件标签。根目录读取失败不做删除性清理，真实失效文件仍由现有 stat/read 失败路径关闭；加入 store 回归测试 |
| External OpenCode 智能体保存状态 | ✅ 已移植并验证 | lifecycle 区分 managed restart 与 external health probe，外部实例不再等待永远不会出现的新 Agent；Agent API 返回 `requiresManualRestart`，store 不用外部进程的 stale config 覆盖刚保存的表单，页面与侧栏用现有 8 个 locale 显示手动重启提示。生命周期与 HTTP 合约均有回归测试；远程实例 Agents 设置页仍按既有规划单独接线 |
| 模型选择器快捷键可自定义 | ✅ 已移植并验证 | `open_model_selector` 加入快捷键设置列表，沿用 fork 现有 shortcut override 与冲突检测；不改变默认 `mod+shift+m` 或模型选择器行为 |
| Git generate 从 draft materialize Session | ✅ 已移植并验证 | 空白 draft 在生成 commit/PR 文案前创建真实 Session，严格沿用 selected project、nested directory、serverId 和 model/agent/variant；创建前校验 Git directory，pending worktree 等待 bootstrap，并迁移 permission intent、folder 与 selection。已有 Session 也必须与 Git directory 一致；structured prompt 通过 session registry 选 SDK client，不再默认发给本地实例。临时目录 draft 明确拒绝，远程路由有回归测试 |
| Worktree bootstrap session gate | ✅ fork 核心 gate 已验证 | `opencodeClient.sendMessage/sendShell` 已在 authoritative request directory 上等待 bootstrap，覆盖普通、queue 与 remote 发送；Git draft generate 现在也在 pending worktree materialize 时等待。上游可选“创建 Session 前等待 setup”开关不移植，保留本 fork 当前“允许创建、发送前强制等待”的统一策略 |
| VS Code 启动状态本地化 | ✅ 已移植并验证 | 补回 React 挂载前可读取的 bootstrap 文案模块，并按 fork 实际支持的 8 个 locale 覆盖连接、初始数据加载失败及 provider/agent 加载状态；只替换现有 VS Code loading overlay 的文案来源，不改变连接状态机、重试或多实例初始化流程 |
| 发送时关闭未回答 Question | ✅ fork 已有更完整实现 | 当前实现会按 Session 子树收集 Question，以每条请求自己的 `serverId + directory` 路由 reject，并在失败时恢复 Question；发送项继续保留排队时的 model/agent/variant/target 快照。覆盖范围强于上游单 Session 处理，已有成功、跨子会话、失败恢复测试 |
| Queue 拖拽排序 | ✅ fork 已移植并有测试 | `QueuedMessageChips` 已使用 dnd-kit，`messageQueueStore.reorderQueue` 只移动原 queued item，不重建或丢失 `sendConfig`、附件及 `sendTarget` 快照；无需重复套用上游提交 |
| Sidebar worktree 排序回弹 | ➖ 架构不适用 | 上游修复是失效一份 fork 中不存在的 `worktreeOrderCache`；本 fork 的项目/工作树顺序由 `useProjectsStore` 的持久项目数组和 `reorderProjectsById` 直接维护，且覆盖“隐藏 worktree 项目仍保序”的测试。机械加入另一份 cache 会制造双重排序源 |
| Provider 添加表单保留 | ✅ fork 已等价 | 添加模式使用稳定 sentinel `ADD_PROVIDER_ID`；provider 列表刷新时默认选择 effect 只在 selection 为空时运行，不会把 sentinel 改回第一个 provider。候选项只有在确实不再属于未连接列表时才清理，后台刷新不会退出表单 |
| Chat scroll jiggle / 历史定位瞬移 | ✅ fork 已有更完整实现 | 聊天容器已禁用原生 anchoring，并在 `useLayoutEffect` 中同步消费加载旧消息前保存的 `scrollHeight/scrollTop`；历史定位、展开折叠和回到底部使用单一 timeline controller 的 instant/smooth 意图。此前长会话、自动 Load older 与展开流程已专项修复，不再叠加上游旧 scroll writer |
| Model picker 折叠持久化与 provider 排序 | ✅ 已移植并验证；Work Item [#5](https://coding.s-s.city/songsong/openchamber/-/work_items/5) 已关闭 | 新增 `modelPickerLayoutByServerId`（`providerOrder` + `collapsedProviders` section keys），按 `serverId` 分区；旧扁平 `collapsedModelProviders` 迁移到 `DEFAULT_SERVER_ID`。`ModelPickerList` 受控折叠、按 order 排序并支持 provider DnD；Chat / MultiRun / Agent selector / 移动端 accordion 共用 `useModelPickerLayout()`。favorites/hidden/recents 仍保持本地全局 + 远程清空展示，未扩成 per-server。定向 helper/sanitize 测试与 type-check/lint 通过 |
| Shift 永久删除 Session | ⛔ 不随普通 UI 批次移植 | 上游同一提交把“按住 Shift 点击删除”变成跳过确认的永久删除，属于高危快捷操作，且与 provider 排序没有必要耦合。本 fork 保留现有确认、运行中检查和子智能体 partial-failure 流程；除非单独设计可发现提示与撤销/保护规则，否则不引入 |
| Automatic review loop | ✅ 已移植并验证；Work Item [#6](https://coding.s-s.city/songsong/openchamber/-/work_items/6) 已关闭 | 持久 `useAutoReviewStore`（`serverId + directory + original/review Session`，deferred safeStorage）；`runAutoReviewLoop` / `resumeAutoReviewRun`；Dialog `autoReview` + Banner；queue auto-send 阻塞；AppEffects hydrate resume；remote `serverRegistry.unregister` 停跑。以 `serverId` 替代上游 `runtimeKey`，不引入 `runtime-switch`。VS Code 仍不开放 `/handoff-review` 入口。定向 `reviewFlow` helper tests + type-check/lint 通过。客户端 persist 清盘会丢 loop（非服务端权威） |
| CLI live-port lifecycle 检测 | ✅ 已移植并验证；Work Item [#7](https://coding.s-s.city/songsong/openchamber/-/work_items/7) 已关闭 | 移植上游 `2c6422018` live-port 行为：新增 `cli-lifecycle.js`（DI 友好），`discoverRunningInstances` 以 `/api/system/info` 确认实例；matched/unknown + probe 失败时保留 registry，mismatched 才清理；serve/status/stop/restart/tunnel 走 `discoverLifecycleInstances`；显式 `--port` 支持 unmanaged probe 与 unconfirmed PID 恢复；desktop 端口拒绝 CLI stop/restart。不整包合入 `e59dc5e59` 命令模块化。CLI stop 只打 OpenChamber `/api/system/shutdown`，不杀 managed/external OpenCode。`packages/web` vitest `bin/cli.test.js`（含 json/quiet 策略）通过 |
| CLI 大规模内部重构 | ⏸️ 仍延后；不随 [#7](https://coding.s-s.city/songsong/openchamber/-/work_items/7) 合入 | `e59dc5e59`（`bin/lib/commands-*` 拆分）仍不采用；本轮只抽取 `cli-lifecycle.js`，命令编排继续留在 `cli.js`。待后续 CLI 专项再按边界迁移 |
| Dead-code / dead-export sweep | ⏸️ 独立维护批次 | 两个官方提交及新增 `dead-code` 脚本服务于 knip 清理。fork 的 remote instances、Session markers、custom sidebar 仍使用大量上游已删除导出，当前也没有 knip 依赖；不在功能合并中删除。后续只能依据本仓库引用结果逐个清理 |
| Japanese locale | ⏸️ 语言包批次；Work Item [#31](https://coding.s-s.city/songsong/openchamber/-/work_items/31) | 上游新增完整日文 locale；本 fork 当前明确支持 8 个 locale，启动文案也严格按这 8 个闭合。日语是独立产品范围扩展，不阻塞运行功能同步，待语言包批次一次性加入 runtime、标签、字典和 fallback 测试 |
| v1.13.4 manifest/release 元数据 | ✅ 无依赖变更 | 官方 root/ui/web manifests 除版本号外只新增 `bunx knip` 脚本，没有 runtime dependency 变化；fork 不为尚未采用的清理工具增加脚本或依赖。上述功能审计完成后将内部基线推进为 `1.13.4-sscity` |

**v1.13.4 收口**：20 个官方提交已逐项审计；实际移植、fork 等价覆盖、架构不适用和明确延后项均已记录。源码与 Electron 构建前缀推进到 `1.13.4-sscity`。其中 live-port lifecycle（`2c6422018`）已在后续 CLI 批次合入并关闭 [#7](https://coding.s-s.city/songsong/openchamber/-/work_items/7)；`e59dc5e59` CLI 命令模块化重构仍延后。

### v1.13.5 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| CLI Clack spinner/progress 启动回补 | ✅ fork 已等价 | `cli-output.js` 已同时 import/export `spinner`、`progress`，并通过 `createSpinner/createProgress` 对 TTY、`--json`、`--quiet` 做统一 gating；未经历上游 v1.13.4 cleanup 的误删，无需重复修改 |
| CLI fallback tunnel capability 回补 | ✅ fork 已等价 | ngrok capability 已是命名导出，CLI 的 fallback 同时包含 Cloudflare 与 ngrok；当前单文件 CLI 架构没有上游拆分模块的 lazy-export 丢失问题 |
| Google quota provider contract | ✅ 已移植并验证 | Google 模块补齐 `providerId/providerName/aliases/isConfigured`，registry 不再自行拼装元数据；保留 fork 现有多 auth source quota 聚合，并新增 provider contract 与 registry 启动测试 |
| GitHub upstream remote resolver import | ✅ 已移植并验证 | `/api/github/repo/upstream` 在枚举本地 remote 的同一作用域导入 `resolveGitHubRepoFromDirectory`，修复仅在 fork/upstream 网络存在时触发的运行时 `ReferenceError`；不改变现有 multi-remote 排名或 PR 状态缓存 |
| CLI validation helper exports | ➖ 架构不适用 | 上游修复 `bin/lib/*` 拆分后遗漏的 `waitForServerHealth`、unsafe port 和 managed config path exports；fork 的 CLI 仍在 `cli.js` 内直接定义并调用这些 helper，没有跨模块 export 边界 |
| Update command current-version export | ✅ fork 已等价 | `package-manager.js` 的 `getCurrentVersion` 已是命名导出，现有 update tests 覆盖 prerelease/internal suffix；无需重复回补 |
| Web Vitest/Bun test baseline | ✅ fork 已等价 | web package 已使用可运行的 Vitest 配置与 scripts，本轮 v1.13.4 web lifecycle/API tests 已实际通过；不引入上游为 cleanup 后测试迁移新增的 Bun shim |
| v1.13.5 release 元数据 | ✅ 无依赖变更 | 官方无 runtime dependency 变化；25 项 CLI/quota/update focused tests 通过，源码与 Electron 构建前缀推进为 `1.13.5-sscity` |

**v1.13.5 收口**：3 个官方提交已逐项审计。此版本主要修复 v1.13.4 cleanup/refactor 遗漏；fork 保留的 CLI 能力按等价实现记录，Google quota contract 与 GitHub upstream resolver 的真实缺口已手动补齐。

### v1.13.6 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Context panel 可见 Session 计为已读 | ✅ 已按 split 架构移植并验证 | panel 打开且窗口聚焦/可见时，active chat 与 split chat 两个可见 Session 都会清除 unseen，并以 `directory + sessionId` 登记 external viewed presence；窗口 blur、页面隐藏、切 tab、关闭 split 或卸载时立即撤销，10 秒续期一次以匹配 sync TTL |
| Context panel Session 标题 | ✅ fork 已有主体能力 | context tab store 已持久化 `label`，侧栏打开时传真实 Session title，subtask 工具可传 description/agent；无需套用上游新增的第二套 fallback 字段。Review Session 新建标题改为 `Review: <原 Session 标题>`，后续从侧栏打开即可显示可辨识名称 |
| Mobile 语义字号真正缩小 | ✅ 已移植并通过构建验证 | 保留 fork 的 `mobile-pointer:not(.desktop-runtime)` 保护，只把 `ui-header/ui-label/meta/micro` 调整为官方 14/12/12/11px，并同步 iOS PWA standalone 覆盖；VS Code 与 Electron 不受 mobile.css 影响 |
| Preview URL auth token 去重 | ➖ 当前架构不适用 | 官方修复针对 UI `runtime-url.ts` 在 iframe URL 反复追加 `oc_url_token`；fork 不存在该 helper，loopback preview 通过 server 注册 target + HttpOnly scoped cookie，URL 只加可替换的 `ocPreview` reload nonce。server proxy 的 token rewrite 已有独立测试，不新增不存在的客户端 token 状态 |
| Chat auto-follow 单 instant writer | ✅ 已移植并通过逻辑/构建验证 | 删除 RAF easing、settle burst、200ms 粗粒度写入窗口和 1.2s repin grace；被动内容增长只由 `ResizeObserver` 在绘制前瞬时贴底，并以目标位置 + 1500ms TTL 区分程序化滚动。保留 fork 的 process-fold transition 禁写、nested wheel/touch intent、per-Session viewport snapshot、overlay scrollbar抑制与历史 prepend 同步锚点 |
| macOS Dock 未读角标 | ✅ 已移植并通过计数/构建验证 | 复用 fork 现有 `desktop_set_dock_badge` IPC；计数从可见 sidebar DOM 改为聚合后的多实例 Session 列表，每个 root chat 最多计 1，subtask 未读仅在启用 subtask 通知时递归汇总。新增默认开启、持久化的 macOS 本地桌面 Appearance 开关和 fork 的 8 套 locale；关闭后立即发送 0 清除角标 |
| v1.13.6 release 元数据 | ✅ 已收口 | 官方无依赖升级；源码、workspace、lock、Electron 构建前缀和打包 runbook 已推进为 `1.13.6-sscity`。`bun install --frozen-lockfile`、23 项 focused tests、全仓 type-check、lint 与生产 build 均通过 |

**v1.13.6 收口**：7 个官方提交已逐项审计。Context panel seen、移动端字号、单 writer auto-follow 与 Dock badge 已按 fork 架构手工移植；preview token 修复判定为当前 cookie/proxy 架构不适用。原生 Dock 图标与真实长会话滚动手感留待后续安装包实机回归，不阻塞源码基线继续推进。

### v1.13.7 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Update command helper exports | ✅ fork 已等价 | `detectPackageManager` 与 `executeUpdate` 已是命名导出，v1.13.5 focused tests 已覆盖；不重复引入上游拆分后的 CLI test harness |
| Expanded tool 滚动稳定 | ✅ fork 已有等价实现 | Tool body 初始 state 已直接取 `isExpanded`，默认展开或虚拟列表重新挂载时首帧即渲染真实高度；fork 没有上游 deferred body mount 的短行首帧 |
| 空闲 Session 禁止被动 auto-follow | ✅ 已移植并验证 | ResizeObserver 仅在 working 或结束后 300ms settle window 内贴底；idle 时虚拟列表重测、图片/代码块和 tool layout 变化只更新 overflow，不再写 `scrollTop`。保留 process-fold 禁写与显式 go-to-bottom writer；focused tests 覆盖 working、settling、idle、released 与 fold |
| Mobile history 预取与虚拟化 | ✅ 已适配并验证 | fork 的自动历史预取原本已是 2400px / 3 viewport，早于官方 1200px / 2 viewport；TanStack virtualizer 从 fork 现有 `useDeviceInfo` 读取真实 surface，采用 mobile overscan 12、desktop 6，并保留实测行高的自适应 estimate |
| Mobile 字号回退 | ✅ 已同步并验证 | 官方撤回 v1.13.6 的 14/12/12/11px，恢复 15/14/14/13px；仍保留 fork 的 `mobile-pointer:not(.desktop-runtime)` 边界，390px 隔离视口确认现有 mobile composer 控件尺寸稳定 |
| Provider 添加流程保持 | ✅ 已按 scoped store 移植并验证 | 后台 provider/default refresh 不再覆盖当前目录的 `__add_provider__` sentinel；sentinel 只存在于内存，不写入 active 或任一 `serverId + directory` snapshot 的持久化数据。focused tests 与隔离 Provider 添加页均通过 |
| Mobile composer controls | ✅ 已移植并验证 | model/agent 控件去边框并正确截断，model 显示 provider logo；footer action group 收紧，thinking variant/favorite 垂直居中。沿用现有 theme token 与 fork 的 remote provider picker |
| v1.13.7 release 元数据 | ✅ 已收口 | 官方无依赖升级；源码、workspace、lock、Electron 构建前缀和打包 runbook 已推进为 `1.13.7-sscity`。`bun install --frozen-lockfile`、21 个 focused tests、全仓 type-check/lint/build 均通过 |

**v1.13.7 收口**：7 个官方提交已逐项审计，代码与发行元数据均完成。隔离 Web QA 验证 Provider 添加流程和 390px mobile surface；临时服务连接外部 OpenCode 时出现的 499/历史 Session resync 警告属于隔离连接边界，未据此修改同步架构，也未替换或停止正在使用的 OpenChamber/OpenCode。

### v1.13.8 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| GitHub PR status 启动防阻塞 | ✅ 已移植并验证 | 客户端 PR status 全局网络并发限制为 2；Octokit 单请求 8s 超时，route 保留现有 12s 总预算与 stale-cache fallback；remote/repo metadata 并行解析但按原优先级归并 |
| GitHub rate-limit cooldown / 删除目录跳过 | ✅ 已补齐并验证 | 复用已存在的 process-global cooldown；resolver 各 GitHub 缺口记录 rate limit，已删除 worktree 在 git/GitHub 调用前返回空状态；认证和 PR 路径统一走 timeout Octokit factory |
| Follow-up behavior (`steer` / `queue`) | ✅ fork 已提前完整移植 | 已有枚举设置、旧 boolean/`immediate` 迁移、busy submit 行为矩阵、queue-time `sendConfig` + `sendTarget`；保留本 fork 多 instance 路由权威，不套上游 queue store |
| Sync watchdog heartbeat 去重 | ✅ fork 已等价覆盖 | fork 没有上游“安静即 full resync”的 watchdog；event-pipeline 已用包含 heartbeat 的全部 SSE/WS 活动维护连接超时并重连，另有 90s stuck-session authoritative status reconciliation。叠加上游全局 timer 反而会破坏多 server/directory 边界 |
| 禁止自动接管外部 OpenCode | ✅ 已按 fork lifecycle 移植并验证 | 删除无配置时对默认 4096 的隐式 probe/attach；显式 `OPENCODE_HOST` / `OPENCODE_PORT` / skip-start 不变，并保留本 fork 对自身 persisted managed port 的安全重连。当前 Electron server in-process handle 不向 shell 暴露 OpenCode pid/port，官方 Electron killer 防护不适用 |
| Worktree/subagent 删除与 selection snap-back | ✅ 核心缺口已移植并验证 | sidebar 已有子代优先逐项删除、running 保留和 passive selection，故不套官方 JSX/selection patch；设置页删除 worktree 改从 server-scoped global active+archived snapshot 递归找跨目录 subagent。delete 404 视为 server cascade 已完成，并同步清理 child/global session、状态与 worktree attachment |
| 依赖与 v1.13.8 release 元数据 | ✅ baseline 已收口；Pierre 兼容批次已完成 | 源码、workspace lock、Electron 构建前缀和打包 runbook 已推进为 `1.13.8-sscity`。`@pierre/diffs` 已升到 `1.3.0-beta.6`（[#8](https://coding.s-s.city/songsong/openchamber/-/work_items/8)）：`patchFileDiff` / viewer / theme registry / tool metrics；type-check、lint、`patchFileDiff`+`turnSnapshotDiff` tests 通过。Docker 镜像更新不影响当前发行面 |

**v1.13.8 收口**：23 个官方提交已逐项审计。GitHub PR status 防阻塞、默认 4096 attach 防护、跨目录 subagent 删除和 404 cleanup 已按 fork 架构移植；Follow-up、sync heartbeat、Git missing-directory 与 selection 防回弹判定为已有等价或更强实现。16 个 lifecycle tests、80 个 session/worktree focused tests、UI/Web type-check/lint 和全仓 build 均通过；未替换或停止正在使用的 OpenChamber/OpenCode。

### v1.13.9 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Embedded JSON / VS Code agent null / stale busy | ✅ 已有或已提前移植 | generated-result 只接受完整 JSON；agent create 不再传输空数值字段，VS Code PATCH `null` 删除字段，web/VS Code markdown writer 也过滤 nullish frontmatter；reconnect recovery 按 server/directory 回读 authoritative status |
| Safe storage interaction-path writes | ✅ 第一批已移植 | 17 个 Zustand 持久化 store 已切到 deferred JSON storage：序列化和同 key 合并移出交互调用栈，读取立即返回 pending value，下一任务写盘；`pagehide` / hidden / freeze 强制 flush，listener 注册失败时仍由 timer 写盘，并保留 fork 现有 quota fallback 语义 |
| Mobile Markdown file-reference probing | ✅ 第一批已移植 | mobile surface 不再为 inline file reference 发 `/api/fs/stat`；本地图片 `/api/fs/raw` 转换仍保留，不把图片代理与 annotation probe 混为一项 |
| Chat first-open / Thinking scroll | ✅ 审计完成，保留 fork 实现 | fork 已有单 writer、wheel/touch/key 用户意图释放、process-fold guard、历史锚点和 working/settle passive follow。官方 first-open 最长 8s 强制贴底会重新引入用户反馈过的滚动硬控；Thinking patch又依赖上游已改写的 reasoning DOM，因此不机械叠加第二套 scroll writer |
| Desktop remote custom headers / realtime proxy | 🔴 独立高风险批次；Work Item [#10](https://coding.s-s.city/songsong/openchamber/-/work_items/10) | 官方依赖单 runtime-switch/relay；fork 是多 serverId + directory 路由，必须同时覆盖 HTTP、SSE、WS、auth，禁止只移植设置 UI |
| Native mobile workspace / official bundled CLI | ⏸ 不直接移植；Work Item [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) | 当前无 `packages/mobile`；官方 CLI 与 custom `1.18.4-sscity`、shared database 和签名 runbook 冲突，继续保留 fork packaging authority |

**v1.13.9 收口**：27 个官方提交已逐项审计。Embedded JSON、agent null-field、stale busy、Keep Awake、CLI path 防护、custom bundled CLI 等已有或更强实现；本批新增 deferred safeStorage 与 mobile file-reference probe guard。原生 mobile、official CLI、remote relay headers 明确保留为架构分歧，chat scroll 继续使用 fork 单 writer，不引入上游强制贴底窗口。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.13.9-sscity`。

### v1.14.0 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Load older 完成态 | ✅ 已移植 | sync 增加 positively-confirmed `isComplete`；一旦服务器确认无 cursor，旧 prefetch cursor 不再让 Load older 按钮复活 |
| Preset starter 直接发送 | ✅ 已移植 | starter 文本通过 submit options 直接进入发送快照，不再依赖 textarea 挂载、setState 和下一帧 staging；保留附件、draft 与 queue/steer 决策 |
| 首次连接与 materialization 去重 | ✅ 已移植 | pipeline 首次成功连接不重复回拉 bootstrap 已有数据；若首连前确实断线或后续重连仍执行 scoped recovery；materialization 无消息/part 变化时返回原 store state |
| Cross-project / multi-instance abort | ✅ 已收紧并补测试 | 使用 Session 的 authoritative SDK 和 directory；仅当 Session directory 确实不可解析时回退当前目录，不再向当前页面目录多发一次 abort；独立跨目录 fixture 验证只产生一条目标请求 |
| Tooltip elevated surface | ✅ 已移植 | tooltip popup 与 arrow 改用 `surface.elevated` / foreground theme token，不使用 deprecated muted background |
| Unified virtualization / prepend scroll | ✅ fork 已提前完成 | MessageList 已统一 TanStack virtualizer、server cursor pagination、行级测量和同步 prepend anchor；不重复套上游已被 fork 后续滚动修复替代的实现 |
| Voice/mobile composer/native keyboard | 🟡 独立产品批次 | fork 有旧 web/desktop voice、STT/TTS 和 PWA composer，但无 native mobile workspace；官方大重构不能作为版本小修机械移植 |
| 用户 CLI 优先于 bundled CLI | ⛔ 保留 fork 分歧 | custom embedded `1.18.4-sscity`、shared database、双签名和 provenance 是发行约束；不允许任意用户 PATH CLI 静默替换包内权威二进制，显式外部配置仍受支持 |

**v1.14.0 收口**：26 个官方提交已逐项审计。Load older 完成态、preset 直接发送、首连 materialization 去重、authoritative abort 与 tooltip token 已按 fork 架构移植；Windows CLI、LAN 本机 token、浏览器密码解锁和统一虚拟列表判定为已有等价或更强实现。Native mobile keyboard/composer 与 first-class voice 保留为独立产品批次，用户 PATH CLI 优先策略因 custom embedded binary 约束不采用。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.14.0-sscity`。

### v1.14.1 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Line-range file refs / first changed diff line | ✅ 已提前移植 | 当前 parser 已支持 `file:start-end` 与 `#Lx-Ly`；DiffView 从 patch hunk 计算首个变化行，focused tests 已存在 |
| Timeline load earlier | ✅ 已提前移植 | TimelineDialog 使用当前 Session 的 timeline controller、server cursor、loading 状态和 prepend anchor，不新增第二套分页状态 |
| VS Code favorites / settings return | ✅ 已提前移植 | favorites 已持久化，退出 settings 恢复 previous view |
| Mobile auth fallback / PWA safe area | ✅ fork 已等价或更强 | 非 desktop status probe 失败进入 network error；只有 desktop remote password fallback 显示 unlock。PWA keyboard mode、safe-area composer/dialog/toast 已按现有 DOM 适配 |
| Small Model + session recap/suggestion | ✅ Small Model 基础已移植（Notes + 标题重生成）；session-assist 仍延期 | Work Item [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12)：`/api/small-model` + settings + Notes 选区摘要；另将侧栏「AI 重新生成标题」改为调用 Small Model（`restrictToPreferredProvider` + directory），删除本地首句/末句假候选，失败时明确 `reason` 并允许手改当前标题。**未**移植 `session-assist` recap/suggestion、Goals、git generation |
| Native mobile resume/focus/dictation overlay | ➖ 当前架构不适用；Work Item [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) | fork 无 Capacitor mobile workspace，也没有官方 `ComposerDictation` surface；旧 browser voice/STT/TTS 后续与 Small Model/voice 批次一起重构 |
| Share opinion prompt / `oc-dev` Bun global helper | ➖ 不移植 | 临时社区调查不属于产品功能；当前仓库无官方 `oc-dev.mjs` 部署 surface |

**v1.14.1 收口**：17 个官方提交已逐项审计。文件范围、Diff 首行、Timeline、VS Code favorites/返回页和 auth/PWA 边界已有实现；native mobile 与临时调查不适用。Small Model/session assist 明确保留为后续独立批次，不把未完成能力计作已合并。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.14.1-sscity`。

### v1.15.0 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Loose unified diff patch | ✅ 已移植 | 规范化带缩进/Windows 分隔符的 `---`/`+++`、缺少 context 前缀的 hunk body 与错误 hunk count；新增 bare header、blank context、`/dev/null` focused tests |
| Sticky user header / CORS directory encoding | ✅ fork 已等价 | 虚拟列表已使用 `paddingTop` offset；loopback CORS 回显实际 preflight requested headers，已包含该编码头且不依赖静态白名单 |
| Right sidebar resize / VS Code selection path | ✅ 已移植 | layout commit 后清理拖拽写入 DOM 的临时 min/max；选择附件使用 workspace-relative filename，显示仍保持 basename，避免同名文件误读和 dedupe 不一致 |
| Ambiguous prompt transport failure | ✅ 已按多实例架构移植 | 普通 prompt 与 steer POST 都只发送一次，旧 retry helper 已从该路径清除；错误保留 HTTP status，408/503/504、timeout 或网络断响应时以同一 message ID 沿 authoritative `serverId + directory` 回查两次，已落库则 materialize 并清 optimistic shadow，未落库才回滚并抛原错误 |
| Browser tab / deep-link route stability | ✅ 已移植适用部分 | Electron webview 的初始 `src` 固定，不因 frame 内 SPA 导航写回 tab state 而重新挂载；初始 `?session=` 使用 Session directory hint，并以 parsed route 强制完成首次 URL normalization，避免 bootstrap 窗口把深链折回 `/`。fork 无官方 iframe browser surface，未引入无调用方状态 |
| Code wrap / synced line numbers / streaming defer | ✅ fork 已提前完成 | Markdown code block 已有持久化 wrap toggle，高亮和纯文本 renderer 都显示同步行号；streaming 复用稳定 code block DOM，不再叠加官方 renderer-specific observer |
| Mermaid zoom controls | ✅ fork 已提前完成 | inline diagram 可展开，fullscreen Mermaid preview 已启用 pan/zoom 与 wheel zoom，并保留 fork 的本地文件读取、下载和多实例 raw-file route |
| Context raw message rows | ✅ fork 已有不同简化实现 | 当前只渲染角色、message ID、时间与按需 JSON，不存在上游待删除的 parts/token/snippet 四列布局；不为套补丁重新引入派生列 |
| OpenCode SDK bump | ✅ lock 已超前 | workspace manifest 范围仍为 `^1.17.9`，`bun.lock` 实际统一解析 `@opencode-ai/sdk@1.18.4`，高于官方本版的 `1.17.18` |
| Last-turn Diff | ✅ 已移植并验证；Work Item [#13](https://coding.s-s.city/songsong/openchamber/-/work_items/13) 已关闭 | DiffView 新增 `working` / `turn` scope：`turn` 读取最新 user message 的 `summary.diffs`（sanitize 后靠 `patch` 重建 before/after），不走 live git。Chat 最新回合 changed-files 经 `openContextDiff`/`navigateToDiff(..., 'turn')` 进入；历史回合只读。Git 仓库优先用 summary snapshot，不再只交给 PendingChangesBar。未引入上游 staged scope。定向 `turnSnapshotDiff` 测试与 type-check/lint 通过 |
| Navigable JSON summaries | ✅ 已移植并验证；Work Item [#14](https://coding.s-s.city/songsong/openchamber/-/work_items/14) 已关闭 | 新增 `JsonSummaryView`：对象身份摘要、`depth < 2` 默认展开、`http(s)` URL 可点。`ToolScrollableTextOutput` 三视图 `summary`（默认）/ `formatted`（JsonTreeViewer）/ `raw`；summary 限高 400px。未收紧工具 expandable 策略，未做 edit→diff。定向 `JsonSummaryView` 测试与 type-check/lint 通过 |
| Project edit / per-project default model | ✅ 已移植并验证；Work Item [#15](https://coding.s-s.city/songsong/openchamber/-/work_items/15) 已关闭 | 抽取 `defaultModel`（`providerID/modelID`）数据契约：`projectDefaultModel` helper、`ProjectEntry.defaultModel`、settings sanitize/persist、`updateProjectMeta(..., null` 清除）。ProjectEditDialog / Settings ProjectsPage / MobileSessionStatusBar 接入 `ModelSelector`（可清空）。新建草稿经 selected project 的 `serverId + path` activate 后 `applyDefaultModelAgentSelection({ projectDefaultModel })` 冻结 provider/model/variant；不整包上游 sidebar/settings shell。定向 `projectDefaultModel` 测试与 UI type-check 通过 |
| Private relay / pairing v2 / desktop transports | ⏸ 架构批次；Work Item [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) | 会贯穿 HTTP/SSE/WS/auth、server list 和多实例 registry，必须以 fork 的多 `serverId + directory` 为权威单独设计 |
| Windows tray/startup | ✅ 已移植并验证；Work Item [#17](https://coding.s-s.city/songsong/openchamber/-/work_items/17) 已关闭 | 上游 `4a9aebdb6`（#2112）叠在 fork #27 macOS tray 上：`setupTray`/`isTrayEnabledForPlatform` 含 win32（不依赖 `desktopMacMenuBarEnabled`）；`icon.ico` + extraResources/win NSIS；`getLoginItemOptions` + `--background` 开机自启；`desktopMinimizeToTrayEnabled` + minimize/close hide；`useTraySync` 扩 win32；Quit 仍走 `requestQuitWithConfirmation`。8 locale + settings-helpers 测试；macOS 菜单栏开关/呼吸图标不变。Windows 交互 QA（托盘点击 / minimize-to-tray / login item / Keep·Stop OpenCode）随下次 Windows 包补测 |
| Startup OpenCode config 非阻塞 | ✅ 已移植并验证；Work Item [#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2) 已关闭 | 上游 `0542bcfc5` 逐段适配（禁止整文件覆盖）：`sync-refs` `getSyncConfig`/`emit`/`subscribe`（扫 default + `getAllSyncStores`）；`client.getConfig` 按 `baseUrl+directory` 缓存/去重；bootstrap Phase2/seed `emitSyncConfigChanged`；`useConfigStore` 去掉 `loadAgents`/`initializeApp` 对 `config.get` 的阻塞等待，新增 `selectionSource` + `applyOpenCodeConfigDefaults`（manual 优先）。定向 9 tests；UI type-check 目标文件绿 |
| Native mobile / mobile release/update/iPad split | ➖ 当前架构不适用；Work Item [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) | fork 无 `packages/mobile`/Capacitor workspace；CI、iOS/Android signing、native update UI 与 connect sheet 不导入 |

**v1.15.0 收口**：50 个官方提交已逐项分类。Loose diff、ambiguous prompt、browser/deep-link、右栏 resize、VS Code 相对路径、Last-turn Diff 与 Navigable JSON summaries 已按 fork 架构移植；code wrap/line numbers、Mermaid zoom、sticky header、CORS encoding 与 SDK 版本已有等价或更强实现。Native mobile 不适用，relay/pairing、project default model 和 Windows shell 明确保留为独立批次，不把延期能力计作已合并。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.15.0-sscity`。

### v1.16.0 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Fork PR 来源仓库上下文 | ✅ 已移植并验证 | PR status 已返回实际 `repo`，正文 hydration、checks、comments 和发送到 Chat 的后续请求现在继续携带 `sourceRepo`，避免 fork 分支的 PR 被错误地转回 origin 仓库查询；不改变现有 GitHub 多 remote 排名与缓存 |
| 文件编辑器字号 | ✅ 已移植，局部验证通过 | 新增独立 9–32px 编辑器字号，直接进入 CodeMirror theme；Zustand、本地持久化、appearance autosave、server settings sanitizer、各 runtime settings contract 与 fork 现有 8 套 locale 同步，默认 13px，不影响界面字号、终端字号或 Markdown 预览；server clamp/拒绝非法类型有 focused test |
| Markdown 文件预览 | ✅ fork 已提前完成 | FilesView 已有 Markdown edit/preview 状态、持久化 toggle、TTS 与本地文件渲染；本轮不复制官方只改变按钮外观和默认模式的较弱实现 |
| VS Code Insiders / Agent YAML 未定义字段 | ✅ fork 已提前完成 | Open-in app registry 已包含 VS Code Insiders；Web agent PATCH 已跳过 `undefined` 并保留 parse 出来的完整 frontmatter，VS Code writer 也在原 frontmatter 上逐字段更新 |
| Windows drive-letter casing | ✅ 已按多实例架构移植 | 新增共享 `normalizePath` 及 focused tests，只统一分隔符、首位 Windows 盘符和尾斜杠，不折叠 POSIX 大小写；接入 project 持久化/解析、`serverId + path` worktree key、全局 Session、config scope、Session 路由缓存与 child-store、worktree attachment/bootstrap、侧栏比较。文件 API、remote ownership 和 reconnect 的直接 child-store 查询统一改走规范化入口。`serverId` 仍单独分域，同一实例内 `c:`/`C:` 不再生成重复项目、Session store、bootstrap waiter 或配置快照；补 shared/project/worktree/routing focused tests |
| Queue idle dispatch / 失败退避 | ✅ fork 已提前完成 | idle 且已有 queue 时会立即触发；失败按 2s→4s→…→60s 退避并保持原 queued item、`sendConfig` 与 `sendTarget`，focused tests 已覆盖，不重复套上游 hook |
| 重启后的 pending Question | ✅ fork 已有更完整实现 | bootstrap、SSE gap recovery、Session switch 都会按目标 server/directory 调 `question.list`；fetch 失败与空成功分离，失败保留现有 Question，未知 Session 不污染当前 store，并有独立 recovery tests |
| Session rename flicker | ✅ 已移植并验证 | directory reducer 与多实例 global Session store 都按 `time.updated`（缺失时 `time.created`）拒绝较旧的 created/updated echo；rename SDK 返回的新 Session 先进入 global store后，不再被乱序 SSE 改回旧标题；纯 helper、reducer 与 global store 均补测试 |
| Command Palette 项目搜索 | ✅ 已按多实例架构移植并验证 | 项目与 commands/settings/sessions/files 一起参与模糊排序；选择项目只打开绑定 `selectedProjectId + directoryOverride` 的新 Session 草稿，后续 materialize 从唯一 project ID 恢复其 `serverId`，不会把远程项目误发到当前实例，也不改变 sidebar 排序或全局 SDK |

**v1.16.0 收口**：63 个官方提交已逐项分类。适用于当前 fork 的编辑器字号、fork PR 上下文、乱序 rename 防回滚、queue idle dispatch/退避、pending Question 恢复、Command Palette 项目搜索、子智能体直接消息、host spoof 防护、通知可靠性、文件树刷新、项目排序、Windows 路径身份键和 Chat 设置分组均已移植或确认等价。Session Goals、server-persisted Autoaccept、private relay/native mobile 与 Small Model 完整基础仍作为独立高风险 milestone，不计入当前源码能力；Markdown preview、VS Code Insiders、Agent YAML 和 pinned refresh 已确认 fork 等价。focused tests 67 条、全 workspace type-check 和隔离前端 Chat 设置实测通过；隔离页面并发引导远程目录触发的 `429` 与本批次无关。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.16.0-sscity`。

**验证清理**：子智能体直接消息设置同步在同上下文函数失败时继续回退到 `postMessage`；补充说明性注释，消除 `no-empty` lint，不改变传输或多实例路由行为。

### Fork 稳定性：本地项目注册表启动保护（2026-07-22）

| 故障 | 状态 | Fork 处理 |
|---|---|---|
| 远程项目发现覆盖全部本地项目 | ✅ 已修复并补回归测试 | 启动时 shared settings 尚未 hydrate，`RemoteProjectDiscovery` 会先发现远程目录；旧实现随后把“空初始列表 + 远程项目”作为完整 `projects` 写回 `settings.json`，导致本地项目和侧栏 Session 分组全部消失。`useProjectsStore` 现在显式记录 shared settings hydration，hydrate 完成前禁止自动远程发现和持久化；hydrate 后远程项目只能追加到已加载的本地项目。测试覆盖未 hydrate 时阻断、hydrate 后允许，以及本地项目不被远程追加替换三条路径。OpenCode 数据库未受损；恢复数据从 Electron Local Storage 的只读副本提取，并与当前远程项目合并后再部署。 |

### 中等难度 / 需要逐段适配

| 功能 | 影响文件/模块 | 风险点 |
|---|---|---|
| queue drag reorder | `messageQueueStore.ts`、`QueuedMessageChips.tsx` | ✅ 已完成；拖拽只改变队列次序，保留 queued item 对象及 `sendConfig` + `sendTarget` 快照 |
| model picker reorder/accordion/Shift+Delete + thinking variant | `ModelPickerList.tsx`、`ModelControls.tsx`、agents settings | ✅ provider order + accordion 已按 `serverId` 落地（#5）；Shift+Delete 永久删除仍不移植；thinking variant 已有 |
| agent temp/topP/thinking save/clear | `AgentsPage.tsx`、`useAgentsStore.ts`、server agents/config | 本 fork 已做过 prompt/permission persistence；新增字段要按 custom/project/user 层级合并 |
| session project binding / pinned/folder empty refresh / worktree snap-back | sidebar hooks、global sessions store、project selection | fork 有 remote instance、Global Pinned、session markers；所有 fallback 必须使用 session/directory authoritative context |
| worktree session bootstrap gate / draft generate materialization | worktree store、session actions、GitView generate | 不能破坏 `[OPENCHAMBER-FORK] ensureWorktreeProject` 和 pending draft flow |
| subagent 删除级联 | `SessionNodeItem`、`useSessionActions`、delete/archive flow | fork 已有 export/delete subtask 文案和运行中跳过逻辑；需保留 per-child partial failure |
| VS Code font prefs / mobile exact grouping / mobile history | `packages/vscode/*`、mobile apps | 可做，但建议平台批次，不和 web/desktop 混合 |
| Desktop remote custom headers / SSH saved password unlock | `packages/electron`、`remote-instances`、`ssh-manager`、remote proxy/SSE relay | Work Item [#10](https://coding.s-s.city/songsong/openchamber/-/work_items/10)。本 fork remote instance proxy 是深改区域；header forwarding 必须贯穿 HTTP + WebSocket + SSE，不能只改设置页 |
| Voice input / local STT / Kokoro read-aloud refresh | `VoiceSettings.tsx`、`useBrowserVoice.ts`、`lib/voice/*`、`web/server/lib/tts/*` | Work Item [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11)。本地已有旧实现，官方 v1.14.0 是 UX + runtime 重构；应先抽取 local model picker/STT/TTS capability，不直接套 mobile composer 改动 |
| Small Model utility consumers | ✅ 基础 + Notes；其余 consumer 延期 | Work Item [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12) 已关：`small-model` runtime、settings、Notes 选区摘要。session-assist / TTS summarized / git generation 后续单独加，且必须带 directory + preferred provider |
| Unified list virtualization / chat history loading | `MessageList.tsx`、desktop history、scroll preservation | ✅ desktop 已对齐统一 `@tanstack/react-virtual`、server-only pagination、提前预取和 scroll invariants；375px 响应式视口已验证，原生 mobile momentum 仍需平台验证 |

### 高风险 / 不建议作为第一批

| Milestone | 原因 | 处理方式 |
|---|---|---|
| Chat scroll 全链路稳定 (v1.13.3~7) | ✅ desktop 长会话、自动历史预取、Load older 保底、process folding 和空闲 auto-follow 已完成；仅原生 mobile momentum 仍待平台验证 | 保留为平台收尾 milestone，不再重复改 desktop scroll writer |
| Markdown/Shiki worker rewrite 相关后续 fixes | 本地没有上游 `chat/markdown/` 目录，`MarkdownRendererImpl.tsx` 仍承载 agent/skill links、文件路径点击、table copy 等 fork 功能 | 暂不混入 v1.13.3~8；若做，必须先迁移 fork 自定义渲染能力 |
| OpenCode never auto-attach / orphan cleanup / process killer port ownership | 本 fork Electron 在同进程启动 web server，并有自定义 managed OpenCode keep-alive / detach / quit 语义 | 先读 `opencode` 模块 docs + Electron lifecycle，做 runtime-truth 验证；不能照搬上游 kill/attach 判断 |
| v1.13.4 dead-code cleanup / knip sweep | compare 删除大量 UI/shared 文件；fork 仍有远程实例、session markers、custom UI 依赖 | 暂缓。cleanup 不应和功能合并混在一起 |
| Japanese docs/i18n bulk import | 文件量很大但业务风险低；容易污染 diff | Work Item [#31](https://coding.s-s.city/songsong/openchamber/-/work_items/31)。等功能批次稳定后单独做 docs/i18n 批次 |
| Native iOS/Android app project | v1.13.9 新增 `packages/mobile`，当前 fork 无该 workspace，且本 fork desktop/web runtime 已有自定义远程实例/managed runtime 语义 | Work Item [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9)。不作为第一阶段；除非明确决定引入 mobile workspace，否则只选合 PWA/mobile web 修复 |
| 官方 bundled OpenCode CLI / updater | 官方 v1.13.9 打包 pinned official CLI；本 fork 已完成 custom merged binary staging/signing/runbook，并强制 shared `opencode.db` channel | 不直接 port 官方 binary 或自动升级；后续只评估 updater UX，custom binary provenance 与 shared-data invariant 不变 |
| Mobile composer/keyboard full redesign | v1.14.0/1 大面积改 `MobileApp`/`ChatInput`/autocompletes/keyboard choreography；本 fork 没有 native mobile package，且 ChatInput 深改 | 先处理小的 PWA auth/safe-area bug；大重构单独排 |

### 建议下一步批次

**当前确认（2026-07-25）**：`#28` / `#15` / `#12` / **[#29](https://coding.s-s.city/songsong/openchamber/-/work_items/29)（v1 local-only）** / [#33](https://coding.s-s.city/songsong/openchamber/-/work_items/33) / [#34](https://coding.s-s.city/songsong/openchamber/-/work_items/34) / **[#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) Remote Goals** / **[#27](https://coding.s-s.city/songsong/openchamber/-/work_items/27) macOS tray** / **[#8](https://coding.s-s.city/songsong/openchamber/-/work_items/8) Pierre diff runtime** / **[#6](https://coding.s-s.city/songsong/openchamber/-/work_items/6) automatic review loop** / **[#7](https://coding.s-s.city/songsong/openchamber/-/work_items/7) CLI live-port** / **[#17](https://coding.s-s.city/songsong/openchamber/-/work_items/17) Windows tray** / **[#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2) startup config 非阻塞** 已关闭。

1. **Queue reliability 批次 A (已完成)**: v1.16 idle dispatch、failed auto-send backoff 和 queue drag reorder 已移植；queue snapshot 继续作为权威。
2. **CLI/Startup/Desktop auth 批次 B**: pid identity、live port check、update helper、quota/provider startup、Bun global CLI fix、LAN-bound local auth token，按 helper/route 切，不做 v1.13.4 cleanup。
3. **小修批次 C**: header encoding、MiniMax quota、skills catalog refresh、provider disconnect、Git push sync、Preview duplicate token；VS Code Insiders、line-range refs / first changed line 与第二轮 JSON/VS Code/Windows CLI 小修已完成。
4. **GitHub PR status 批次 D**: timeout/rate-limit/cooldown/concurrent metadata，并验证启动时 session/diff/message 不被 PR status 阻塞。
5. **Queue/Steer 批次 E (已完成)**: boolean 已迁到 Follow-up behavior (`steer` / `queue`) 并复用本 fork `steer-side-channel`；后续 queue drag reorder 单独处理。
6. **Session/worktree 批次 F**: selected project binding、folder/pinned refresh、worktree snap-back、subagent delete cascade；timeline dialog load earlier 已完成。其余项必须按 `openchamber-context-authority` 校准 directory/serverId。
7. **Chat input/abort 批次 G**: pasted `@`、ArrowUp、question dismiss、slash skill 调用、cross-project abort routing，全部补 focused tests。
8. **Voice/Small Model 批次 H（#12 基础已完成）**: capability + settings + Notes consumer 已落地；session-assist / TTS summarized / git generation 仍可后续加。Goals：`#29`/`#33`/`#34`/`#35` 已落地（remote 需远端 OC 广告 `/api/goals/capability`）。
9. **v1.15 UI 批次 I (部分完成)**: code line number/wrap 已按现有 Markdown 架构适配；Mermaid zoom、ambiguous transport failure、Markdown preview 继续逐项处理。
10. **高风险 milestone**: server-persisted auto-accept、chat scroll + auto-follow、OpenCode process ownership、Markdown/Shiki rewrite、mobile/native app、private relay/pairing、bulk docs/i18n，分别处理。`#35` Remote Goals / `#27` macOS tray / `#8` Pierre / `#6` auto-review / `#7` CLI live-port / `#17` Windows tray 已关闭。
