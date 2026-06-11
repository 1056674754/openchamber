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
- `MessageList` 的官方虚拟化优化和 `TurnChangedFilePills` / `changedFiles` 仍需单独批次验证。
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
| **消息改动文件标记** | 回复消息中显示本次改动涉及的文件列表 (TurnChangedFilePills)，含 `changedFiles` 字段 | 🟡 中 |
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
**当前状态**: 已完成 release-note feature inventory + 本地 `rg` 初查；Multi-Run hidden models 和 table Markdown copy 已单独移植。其余项尚未逐 commit / file diff。后续仍需按官方实际提交逐项比对，不能整批套 patch。

### 状态校准 (2026-06-11)

| 类别 | Feature | 本 fork 初查状态 | 处理建议 |
|---|---|---|---|
| Chat | `/handoff-review` linked review session | 🟡 部分相近：本地已有 `/workspace-review` magic prompt，但只是当前 workspace review，没有 linked review session，也没有 feedback/reply 双向动作 | 高风险手工移植。需要先看官方会话关联数据结构，再映射到本 fork 的 multi-remote / serverId / directory context |
| Chat/UI | Collapse long user messages setting | 🔴 未实现。现有 collapse 命中主要是 tool/activity/folder，不是长 user message 设置 | 可独立做，优先级中；注意不要让 MessageList/TurnItem 热路径多订阅大 store |
| Chat | Rendered `@agent` mentions use primary accent | ✅ 基本覆盖：`UserTextPart` 已将 agent mention link 渲染为 `text-primary` | 低风险核对即可；后续可确认是否要改成更明确的 primary accent token |
| Chat | Table copy action adds Markdown format | ✅ 已落地：copy dropdown 新增 Markdown 选项；表格导出逻辑抽到 `markdownTableExport.ts` 并加测试 | 已完成，后续只需和官方实现复核文案/i18n 是否一致 |
| Chat | Mermaid diagram dedicated editor | 🟡 部分较强：本地已有 Mermaid render/preview dialog/zoom/copy/source 相关逻辑，但未看到 dedicated editor | 需看官方 editor 的数据流；避免破坏现有 preview dialog |
| Models | Hidden models stay hidden in multi-model controls | ✅ 已落地：`useModelLists()` 暴露 `hiddenModels`，Multi-Run `ModelMultiSelect` 已传入 `ModelPickerList`，测试覆盖隐藏模型仍从 favorite/recent 排除 | 已完成，后续复核 Fusion/其它多模型入口即可 |
| Worktrees | Single new worktree session opens immediately while setup continues | 🟡 部分：本地已有 pending draft worktree flow，但真实 session 仍在 worktree 创建后才完成 | 高风险。必须保留 `[OPENCHAMBER-FORK] ensureWorktreeProject` 和 remote project 注册 |
| Multi-Run | Isolated runs open sessions immediately while setup continues | 🟡 部分：本地 waits worktree + session creation，只有 send message 阶段是 async fire-and-forget | 高风险。需重新设计 pending run/session 映射，不能丢 directory/serverId |
| Sessions | Chat folder assignments persist after reload | ✅ 已覆盖：`useSessionFoldersStore` 同步 `oc.sessions.folders` / collapsed state，并有 server persistence | 只需用官方 diff 复核是否有边界修复 |
| Sessions | Right-click menus for session/folder/project/worktree rows | 🟡 部分：session/temp session 已有 context menu；folder/project/worktree 覆盖面需逐文件对齐 | 中高风险，和 sidebar/tree 结构相关，需避免重复/错 server 操作 |
| Settings | Search across settings pages | 🔴 未实现。`settings/metadata.ts` 有 keywords，但 `SettingsView` 没有全局 search UI | 中等 UX 功能，可独立做 |
| Settings/Agents | Agent prompt and permission edits stay saved | ✅/🟡 看起来已覆盖：`useAgentsStore.updateAgent()` 会 PATCH `prompt`/`permission`，server `updateAgent()` 写 md/json/prompt file | 需要针对 md agent、json agent、builtin override 三类手动复测 |
| Files | Editor Vim mode setting | 🔴 未实现。未看到 Vim mode / CodeMirror Vim keymap 设置 | 中等功能；确认依赖是否已在 lockfile 中，避免新增依赖 |
| Files | Safer writes via temporary files | 🟡 部分：settings 写入已有 tmp + rename；`/api/fs/write` 仍直接 `writeFile` | 数据安全优先级高；应先改 server write path，再回归 rename/delete/read |
| Git | Changed-file folders have revert action | 🔴 未实现。现有 git revert 只看到单文件 revert 和 commit revert | 中等风险；目录 revert 必须限制到 changed-file group，不可扩大删除范围 |
| GitHub | Issue/PR pickers use server-side search | 🔴 未实现。UI 仍先分页拉取，再前端 query 过滤；server list route 未收 search query | 中等风险；保留 fork 的 repo network/fork detection |
| Preview | Inline module scripts rewritten in proxied HTML | 🟡 部分：preview proxy 已重写 HTML attrs、CSS URL、JS import/from；未看到对 HTML 内联 `<script type="module">...</script>` body 的改写 | 需移植官方 parser/rewriter 或最小安全实现，并补测试 |
| Voice | Plan/file preview markdown TTS buttons + selected/full setting | 🟡 部分：voice service/settings 已很完整；PlanView/File preview 上未看到 TTS button 和 selection/full-document setting | 中等 UX；不要把 TTS 控件接进高频 markdown render 热路径 |
| Desktop/macOS | Menu bar tray with live session status, Mini Chat, provider usage submenu | 🔴 未实现。Mini Chat window 已有，但 Electron main 未见 Tray/menu-bar status item | macOS 独立批次；要考虑 remote/live session status source |
| Desktop/macOS | Optional vibrancy for left sidebar | 🔴 未实现且当前强制禁用：`desktop_set_vibrancy` handler 会写 `desktopVibrancy=false` | 需重新评估 Electron 可行性；不能直接按旧 Tauri/SwiftUI 思路套 |
| Desktop/macOS | Startup no longer opens unnecessary folder prompts | 🟡 待比对。本地 native open dialog 仍存在，但未确认是否由 startup 触发 | 需逐 commit 看官方修的是哪个启动路径 |
| Mobile | Refreshed session controls/worktree deletion/MCP/update/usage layout | 🟡 延后/部分。本 fork 已有大量 mobile-specific UI，但此前 mobile 批次是延后策略 | 继续延后，除非用户明确优先移动端 |
| Terminal/Mobile | Touch scrolling conflicts less with terminal input | 🟡 可能部分覆盖：`TerminalViewport` 已有 pointer/touch scroll 转 terminal scroll、tap threshold、passive false | 需真机/移动视口复测后决定是否还需官方 diff |
| Usage | Cursor quota tracking | 🔴 未实现。quota providers 未见 Cursor provider | 中等功能；需确认 Cursor quota 数据源和 auth |
| UI/Localization | French UI translations and French docs | 🔴 未实现。未见 `fr` locale files | 可低风险批量补，但应排在功能后 |
| VSCode | Archive all sessions action | 🔴 未实现。未看到 extension action/command | VS Code 批次处理 |
| VSCode | Multi-root workspace support + folder switching | 🔴 未实现。VS Code 多数路径仍取 `workspaceFolders[0]` | 高风险 VS Code 架构改动；需避免 web/desktop 假设污染 extension |

### 建议制作顺序

1. **先确认/补小 UI**：`@agent` accent 校准、长 user message collapse、Settings search。
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

## 当前状态 & 已知问题 (2026-06-08 Batch A 后)

| 项目 | 状态 |
|---|---|
| `bun run type-check` | ✅ 0 errors |
| `bun run lint` | ✅ 0 errors, 1 pre-existing warning (`MainLayout.tsx` hook dependency) |
| Targeted sync/client tests | ✅ 77 pass (`event-reducer`, `event-pipeline`, `session-routing`, `session-actions`, `session-switch-resync`, `reconnect-recovery`, `session-list-bootstrap`, `streaming`, `client-health`) |
| Electron | ✅ 正常，不会多开窗口 |
| 聊天区域 | ✅ 正常 |
| 远程实例侧边栏 | ✅ 已修复（还原 sync-context.tsx + session-list-bootstrap.ts） |
| `ENOENT` 项目清理日志 | ⚠️ 非新功能 — 服务端 `validateProjectEntries` 原有项目校验逻辑，与 v1.12 移植无关 |
| 上游版本差距 | ⚠️ v1.12.2 + v1.12.3 部分落地；下一批优先 `useConfigStore` startup/并行加载与服务端 tunnels/lifecycle |
