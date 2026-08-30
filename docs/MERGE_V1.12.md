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

### Fork 自研：RPC 传输重构（Work Item [#106](https://coding.s-s.city/songsong/openchamber/-/issues/106)）

**日期**: 2026-08-03
**类别**: fork 自研架构重构（非上游迁移）— 浏览器 ↔ 本地服务端 WebSocket RPC 传输从"按路径猜超时"改为"语义类别调度 + 超时安全网"。

**背景**：`rpcFetch.ts` 全局替换 `fetch` 后，所有同源 `/api/*`（除 5 个 SSE/WS 排除项）都走 WebSocket RPC 中继。该机制最初是 `/api/fs/list` 高频轮询打爆系统时的临时止血（git 侧同类见 `perf(git) #1398`）。现状问题：
1. 超时按 URL 路径 if 链猜（`proxy.js getRemoteProxyRequestTimeoutMs`），漏配落 5s 默认，60+ 路由被误杀。
2. 本地 RPC（`target: 'local'`）`releaseLane: null`，lane 并发设施只接 remote 分支，浏览器主链路裸奔。
3. 快慢不分流：小模型内部预算 60s vs RPC 5s → `session-title-candidates`/`summarize`/`small-model/generate` 必然随机失败（UI 报 "Local RPC request aborted"）。

**实现**（全部已落地，见下方证据）：
- 新建共享包 `packages/shared`（纯 JS + 相邻 `.d.ts`）：`classifyRpcPath(pathname, method)` 语义归类（critical/fast/normal/io/ai/stream）+ 类别→默认超时表，client/server 单一事实来源。Node（Electron 生产路径）裸跑零风险，ui 侧 tsc 拿类型。
- `config.js` lane 3→7 类（health/critical/fast/normal/io/ai/stream），normal 并发 4→32（实测），`getRequestPressure` queued 改为按 lane 键派生。
- `proxy.js` `getRemoteProxyRequestTimeoutMs` 删除路径 if 链，改查共享类别表（签名保留，rpc-ws 两处调用点零改动）。
- `rpc-ws.js` 本地分支接入 lane（key `'local'`）+ frame.class 解析（客户端声明优先，服务端归类兜底）。
- `rpcFetch.ts` frame 加 `class` 透传 + `/api/fs/list` 同 path 并发请求单飞合并（fs/list 卡死真正解法，各调用方仍拿到独立 Response）。

**验证证据**（2026-08-03）：
- `packages/shared`: type-check ✅、lint ✅、10 tests ✅（归类/超时表/查询串鲁棒性）。
- `config.test.js` 12 ✅（新增 ai 隔离、lane 集快照；normal 4→32 用例更新）。
- `proxy.test.js` 7 ✅（类别超时断言重写：critical 3s/fast 15s/normal 30s/io+ai 120s）。
- `rpc-ws.test.js` 7 ✅（新增本地 lane 归类、frame.class 覆盖、lane busy 429 三用例）。
- `rpcFetch.test.ts` 6 ✅（新增 frame.class 声明、fs/list 单飞合并）。
- web + ui `type-check` ✅、shared/ui eslint ✅。
- plain Node（无 flag）可 `import('@openchamber/shared')` 并正确归类 — Electron 生产路径兼容。
- 全量 server 启动（含 embedded OpenCode）未做端到端 curl 验证（需 OpenCode 环境），传输层改动由上述单测覆盖。

**同步清单状态**：WI #106 `status::backlog`（实现完成待 UI 冒烟后转 `status::done`）；总览 #1 已登记。fork 多实例 `serverId + directory` 权威未受影响（lane key 用保留 id `'local'`，与 config.js 保留 id 池一致）。

---

## Mobile 产品轨道

联结现实（fork 今天）：手机 = 浏览器/PWA 打开桌面暴露的 URL（LAN / Tunnel `/connect?t=` / 反代）。UI 现实：共享 `packages/ui` 组件；Capacitor 另有入口壳 `MobileApp`。业务组件一套，App 壳不是同一文件。权威镜像：GitLab epic [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) 独立 `## Mobile` 分区；fork ADR：[`docs/NATIVE_MOBILE_FORK_ADR.md`](NATIVE_MOBILE_FORK_ADR.md)。

**Instances 契约（纠正）**：多 host **要有**。权威在 Electron；手机与桌面 UI 拉取 host **已聚合**的 instances 列表，**禁止**客户端为列表/侧栏对每个 remote 再挂一套 sync fanout。一次会话连接仍是单 URL；列表 ≠ 并行多 Sync 引擎。空闲 CPU 问题见 index [#40](https://coding.s-s.city/songsong/openchamber/-/work_items/40)——根因是误 fanout / 抽屉常驻 / Diff warmup，不是「有 remote」。

### A. 已做（Web / PWA mobile surface — 无原生壳）

这些是「手机浏览器可用」的选合，**不等于** native app 已落地：

- [x] PWA keyboard / safe-area / auth fallback（web）
- [x] Mobile typography + composer controls（web）
- [x] Mobile history prefetch / virtualizer overscan（web）
- [x] Mobile Markdown file-reference probe guard（web）
- [x] Mobile 子会话箭头触摸尺寸（web）
- [x] VS Code 不被 `mobile.css` 误伤（desktop-runtime 判定）
- [x] Terminal：mobile web hidden-input autofocus（[#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) 协议已关；web touch only）
- [x] `MobileSessionStatusBar` 等沿用共享侧栏（已删上游独立 `MobileSessionsSheet` 路径）

跳过 / 架构不适用（记为不做，勿再开卡重复）：

- 官方独立 `MobileSessionsSheet` / `MobileChangesSurface` 整包（fork 共用多实例 `SessionSidebar`）
- 上游 v1.14 composer/keyboard mega-refactor 整包
- Oniro / ArkUI 鸿蒙原生壳
- 纯视觉 mobile shadows（无设计目标不跟）

### B. 进行中 / 已规划（Native Capacitor）

- [x] **[#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) Native Capacitor iOS + Android（第一刀落地）**
  - 引入 `packages/mobile` + `mobile.html` / 薄壳 `MobileApp`
  - 连接：URL + 密码解锁 + Saved instances；`connectMobileEndpoint` = `switchRuntimeEndpoint` **+** `serverRegistry`（`mobile-active` / retarget `default`）
  - CORS packaged origins：`capacitor://localhost` / `https://localhost` / `openchamber-ui://app`
  - UI session：`POST /auth/session` 返回 `token`/`clientToken`；Bearer 与 cookie 等价（原生跨 Origin）
  - 验证：`mobileRuntimeBridge` tests；`build:web` 产出 `mobile.html`；iOS Simulator `sim:run` 已启动；Android `assembleDebug`（见 runbook）
  - ADR / runbook：[`NATIVE_MOBILE_FORK_ADR.md`](NATIVE_MOBILE_FORK_ADR.md) / [`NATIVE_MOBILE_RUNBOOK.md`](NATIVE_MOBILE_RUNBOOK.md)
  - **非 DoD（仍后置）**：鸿蒙侧载验收、商店上架、Push、pairing v2
- **#9 follow-up 拆卡（合并顺序：chrome → composer → sidebar → packaging）**
  - [x] [#36](https://coding.s-s.city/songsong/openchamber/-/work_items/36) Capacitor native chrome：safe-area / keyboard inset / Instances·Disconnect
  - [x] [#37](https://coding.s-s.city/songsong/openchamber/-/work_items/37) Mobile composer/keyboard **增量**（非整包上游 v1.14）— pick-list 见 [`NATIVE_MOBILE_RUNBOOK.md`](NATIVE_MOBILE_RUNBOOK.md)
  - [x] [#38](https://coding.s-s.city/songsong/openchamber/-/work_items/38) 窄屏会话侧栏 UX（共享 `SessionSidebar`，drawer↔switcher 双向同步）
  - [x] [#39](https://coding.s-s.city/songsong/openchamber/-/work_items/39) Android APK/AAB 更新器 + iPad 共享侧栏 + 本地 debug 脚本（无商店 CI）
- **P0 — 变轻 / 纠正 fanout（index [#40](https://coding.s-s.city/songsong/openchamber/-/work_items/40)）**
  - [x] [#41](https://coding.s-s.city/songsong/openchamber/-/work_items/41) M1 — instances 由 Electron 聚合下发；禁客户端逐 host Sync fanout（手机+桌面）
  - [x] [#42](https://coding.s-s.city/songsong/openchamber/-/work_items/42) M2 — 抽屉懒挂载 SessionSidebar / GitView
  - [x] [#43](https://coding.s-s.city/songsong/openchamber/-/work_items/43) M3 — Diff/shiki warmup 延后
  - [x] [#44](https://coding.s-s.city/songsong/openchamber/-/work_items/44) M4 — 抽屉关闭停轮询（open-only mount + hooks `enabled`）
  - [x] [#45](https://coding.s-s.city/songsong/openchamber/-/work_items/45) M5 — 空闲 CPU 验收写入 runbook（真机复测补 Evidence）
- **P1 — 机感（仍共用侧栏）**
  - [x] [#46](https://coding.s-s.city/songsong/openchamber/-/work_items/46) M6 — Capacitor 显示密度
  - [x] [#47](https://coding.s-s.city/songsong/openchamber/-/work_items/47) M7 — 键盘/composer 收口（不回归黑屏）
  - [x] [#48](https://coding.s-s.city/songsong/openchamber/-/work_items/48) M8 — 连接页 / 空会话密度
- **P2 — 产品收尾 / 独立跟踪**
  - [x] [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) M9 — Voice 已按 fork 架构等价完成：browser/server/WASM STT、移动端 `ComposerDictation` overlay、Capacitor resume、模型选择持久化，以及 Browser/OpenAI/Kokoro/macOS Say TTS。未整包复制上游 mobile composer；375px touch 隔离 E2E 已验证 Local 模型跨 reload 保留、Server 切换和录音开始/取消。
  - [ ] [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) M10 — Push（APNs / FCM）— **有意延期（P2）**；现状仅 web-push：浏览器 service-worker 订阅 + `web-push` 发送 + presence suppression 已通；原生 token 注册（iOS `register()` / Android `FirebaseMessagingService`）与服务端 APNs/FCM sender 未接，iOS `AppDelegate` 仅转发 APNs 回调、Android 仅有 Firebase 脚手架。`HANDOFF.md` 已纠偏
  - [x] [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) M11 — Pairing / redeem 移动面（QR + `openchamber://` + Instances transport）
  - [ ] [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) M12 — 商店签名 / CI release — **有意延期（P2）**
  - [ ] [#56](https://coding.s-s.city/songsong/openchamber/-/issues/56) 连接/onboarding UX 改进 — auto-connect 状态应占满（brand + spinner，隐藏可操作元素）、启动闪屏白→黑→首屏序列需平滑、整体工具感打磨；真机反馈"依旧非常非人类"

### C. 相关但非 Mobile 主轨（交叉引用）

- [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) Private relay / pairing — **已实现**（桌面 Anywhere + 官方中继 + Mobile M11）；ADR Implemented
- [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) Voice — **已完成 fork 等价实现**；browser/server/WASM STT、Capacitor resume/overlay 与 TTS 均有独立验证
- [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) Terminal v3 — **已关闭**；后置 terminalContext / shell UI / mobile fullscreen quick keys（仍不引入鸿蒙壳）

### D. 明确不做 / 后置说明

| 主题 | 状态 | 说明 |
|---|---|---|
| Oniro Capacitor-OpenHarmony | 不采用 | 0.1.x、插件不全；不进 #9 |
| ArkUI / 鸿蒙原生壳 | 不做（本轨） | 若做鸿蒙 App，优先独立 WI，不绑 Capacitor |
| 鸿蒙 NEXT 官方支持 | 未规划 | 用户可自测 Android APK；失败不阻塞 #9 |
| App Store / 华为商店上架与签名流水线 | 有意延期（P2） | [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) |
| APNs / FCM Push | 有意延期（P2） | [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) |
| Pairing v2 / `openchamber://` mobile redeem | ✅ #16 | M11 已落地（扫码 / deep link redeem） |
| 上游 Mobile composer/keyboard 大重构整包 | 不做 | 增量见 [#37](https://coding.s-s.city/songsong/openchamber/-/work_items/37) / [#47](https://coding.s-s.city/songsong/openchamber/-/work_items/47) |
| Terminal mobile fullscreen workspace / quick keys | 未规划 | #19 Phase4；web touch 另议 |
| 中央 `api.openchamber.dev` push relay | 未规划 | 产品/合规另定 |

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
| `e88afff2` | Chat/Performance: 长会话和大 session list streaming 更顺 | 47 files, +3167/-1828；chat streaming、turn projection cache、sidebar memo、sync stale guard、history preload | ✅ 三块缺口已移植（不整包）；Work Item [#4](https://coding.s-s.city/songsong/openchamber/-/work_items/4)：chat tail isolation + sidebar precomputed memo + `syncSessionGenerationByKey`；未采用 virtua / 未替换 TanStack MessageList |
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
| 独立 milestone | Chat/sidebar streaming 性能大改 (`e88afff2`) | ✅ 三块缺口已完成；Work Item [#4](https://coding.s-s.city/songsong/openchamber/-/work_items/4)。定向：`streamingTailEntry` / `sessionNodeItemUtils` / `sync-session-generation`；保留 fork MessageList + 多实例 sidebar |

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
| Tool result/JSON summary、Mermaid zoom、code line number/wrap、Last turn diff | ✅ 已完成 | Last-turn Diff [#13](https://coding.s-s.city/songsong/openchamber/-/work_items/13) 与 Navigable JSON [#14](https://coding.s-s.city/songsong/openchamber/-/work_items/14) 已关闭；code line number/wrap 已适配本地 `MarkdownRendererImpl`；**Mermaid zoom controls 已合并**（`de1cc4b5f`，+/-/reset 按钮补全现有 wheel zoom） |
| Project default model / project sort / command palette project search | 🟡 部分完成 | project sort 与 Command Palette 项目搜索已按唯一 project ID、`serverId + directory` 适配；project default model 仍需独立按实例隔离，不能引入全局 active-project fallback |
| Server-persisted permission auto-accept (`6231375b`) | ✅ fork 已有等价实现 | fork 的 `permission-auto-accept/runtime.js` 已通过 `persistSettings` 持久化到磁盘（`persistUpdate` 调用 `persistSettings({ [SETTINGS_KEY]: next })`），支持 revision、broadcast 和重加载。早先"server 只保存进程内 Set"记述已过时。 |
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
| Private relay / pairing v2 / native mobile | ✅ #16 已实现；#9 壳继续 | Work Items [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) / [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9)。#16：官方 `wss://relay.openchamber.dev/ws` host/client E2EE、pairing redeem→add host/instance、desktop multi-transport、Mobile QR/`openchamber://`；ADR Implemented。#9 继续 Capacitor 壳与 `serverRegistry`/`serverId`。不整包上游单 runtime MobileApp |
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
| Android 更新器区分 APK/AAB | ✅ #39；Work Item [#39](https://coding.s-s.city/songsong/openchamber/-/work_items/39) | `resolveAndroidApkUrl` + `useUpdateStore` `mobile-capacitor`；iPad 持久共享侧栏；本地 `mobile:android:*` / `mobile:sim:*`；无商店 CI |
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
| Linux AppImage window controls / updater polish | ✅ 已完成；Work Item [#32](https://coding.s-s.city/songsong/openchamber/-/work_items/32) | Electron Linux 使用 frameless 标题栏，菜单、最小化、最大化/还原和关闭均经 preload IPC 接入；AppImage 构建、静态载荷检查、Xvfb + Openbox 实机 UI 冒烟和真实旧包自更新演练均通过。正式包默认禁用更新，只有构建时嵌入内部 HTTPS feed 才启用，不回落到社区 GitHub release |
| Quota toast / Shell 状态与输出 / Task 权威绑定 | ✅ 已完成 | Quota 已有专用本地化；Shell optimistic card 与流式状态已补 comparator；Task 已移除时间/状态猜测并只消费明确 child Session ID |
| 删除 Share Opinion sidebar prompt | ✅ fork 无对应 surface | 当前 sidebar、footer、设置与 i18n 均不存在 `ShareOpinionDialog` 或 opinion CTA，无需删除不存在的社区推广入口 |
| Session goal child-activity gate / evaluation diagnostics | ✅ 已随 #29 v1 local-only 落地；Remote 扩展见 [#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) | local runtime 已按 directory 拉 parent/children status，并记录 evaluation provider/model；非 default `serverId` 事件忽略。Remote 权威 status 订阅留在 #35 |
| Chat input 与 Editor font size 解耦 | ✅ fork 已等价 | `editorFontSize` 仅用于 FilesView CodeMirror theme；ChatInput 使用聊天 typography/token，不读取 editor font setting，因此不存在官方修复的输入字号串联 |
| 新 Session draft 所选项目 / 创建失败恢复 | ✅ 已完成 | selected project、directory、serverId 和完整输入/附件/inline drafts 均在 draft snapshot 中恢复，覆盖官方两个小修 |
| 固定消息跨 compaction 恢复 | ✅ 已完成（[#18](https://coding.s-s.city/songsong/openchamber/-/work_items/18)） | UI pin/unpin 写入 `session.metadata.openchamber.context_obligatory_messages`（fresh-read merge）；host `context-obligatory` runtime 监听 local hub + remote fanout 的 `session.compacted`，按 `serverId + directory + sessionID` 回读 pinned 文本并 `prompt_async` 注入；cursor `context_obligatory_last_compaction_message_id` 防重放；VS Code 隐藏 pin；`/compact` 改为 `sdkForSession` + session directory |
| VS Code Autoaccept / missing-directory project routing | ✅ 已完成 | 已按 VS Code `globalState`、父链继承和显式多实例权限目标移植；新 Session 路由以服务端 directory 优先、冻结目录兜底并按最长注册项目匹配 |
| Terminal runtime refactor + mobile workspace | ✅ v3 协议已落地（desktop-first）；Work Item [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) | 兼容矩阵见 [`docs/TERMINAL_PROTOCOL_COMPAT_V2_V3.md`](TERMINAL_PROTOCOL_COMPAT_V2_V3.md)。已 adapt 上游 v3（attach/snapshot/sequence，WS-only，`history`/`shells`/`theme-response`）；保留 fork sacred cows：`serverId:directory` store、per-baseUrl transport、Context Panel、Electron SSH 外开、ghostty viewport。已删 SSE/HTTP input/`output-replay-buffer`。后置：terminalContext 选区→chat、shell settings UI、mobile workspace/quick keys（不引入 `packages/mobile`） |
| Project action auto-discover tooltip/icon | ✅ 核心能力已有，视觉微调暂缓 | fork 已有自动检测 dev server、实时终端输出 URL、Preview 自动打开、等待状态、停止和多 server terminal 路由；当前 search icon 与动态 aria-label 已提供语义，官方 scan icon/tooltip 仅视觉微调，待 Terminal 批次统一处理 |
| Settings layout 标准化 + AgentPermissionsEditor 抽取 | ✅ 功能已有，布局不覆盖 | Agent permission 的 allow/ask/deny、pattern、继承和序列化已在 fork AgentsPage；Settings 正在做 remote-instance wiring，官方大规模单实例页面重排会覆盖 fork 的可见性和路由。继续按页面逐项迁移功能，不机械替换 layout |
| Chat/sidebar/mobile shadows | ➖ 不移植纯视觉差异 | 不为版本号同步引入独立阴影；遵循 fork 现有 theme token 和密度，待对应 surface 有明确设计目标时统一调整 |
| Desktop update check install ID / web schedule | ✅ 按内部发行边界完成 | fork 使用 `-sscity` 内部包、custom embedded OpenCode 和内部下载渠道；Linux updater 只有在构建时嵌入无凭据、无 query/hash 的内部 HTTPS feed 后才启用，未配置时设置页明确显示不可用。E2E 测试 feed 还需编译期 marker 与运行期 `OPENCHAMBER_E2E=1` 双重门禁且仅接受 loopback，不会让社区 release API 或运行时环境变量静默替换正式包。usage telemetry 仍只按现有显式设置上报 |
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
| Parent Session bootstrap recovery / session loading overhaul | ✅ 不变量已落地并验证；Work Item [#23](https://coding.s-s.city/songsong/openchamber/-/work_items/23) 已关闭 | 移植 `mergeBootstrapSessions`（roots + all、`allSessions: null`、revision overlay）；bootstrap `loadSessions` 闭包合并且 fail≠empty；`applyDirectorySnapshot` 按 `serverId+directory` 权威 delete-missing + `completeSnapshotScopes`；`persist-cache` v2 键含 serverId 并迁移 legacy。未整包覆盖 #2360（SessionMessageLoader / bootstrap demand scheduler / 单活 runtime 清场）— 留作非阻塞 follow-up。定向测试：reconnect-recovery / persist-cache / session-list-bootstrap / useGlobalSessionsStore |
| Worktree stale `index.lock` 恢复 | ✅ Web / VS Code 均已移植并验证；Work Item [#22](https://coding.s-s.city/songsong/openchamber/-/work_items/22) 已关闭 | 两端 bootstrap 都先重试两次，再比较锁文件 `dev/ino/size/mtime`，只有第三次仍失败且锁身份完全不变才删除并重试；变化中的锁绝不删除。两端均保留 Git error 文本识别和 worktree `.git` 文件 fallback。VS Code 抽出无 extension-host 依赖的 `git-lock-recovery-runtime`，真实临时仓库/worktree 测试覆盖“稳定旧锁恢复”与“变化活锁保留” |
| Session 移动到新 worktree | ✅ 已移植并验证；Work Item [#24](https://coding.s-s.city/songsong/openchamber/-/work_items/24) 已关闭 | 上游 `683b51759`：bootstrap 三阶段 `directory-created` → `git-ready` → `setup-ready`（web/VS Code）；空闲根会话经 `experimental.controlPlane.moveSession` 迁父+后代（仅 root `moveChanges`）；fork 补齐 folder scope、queue `sendTarget.directory`、worktree metadata/attachment、`ensureWorktreeProject`、双目录 catalog refresh 与部分失败回滚。UI 仅 web/desktop（VS Code 侧栏隐藏）。权威：`serverId + directory`，无 `getDirectory()` / `activeProjectId` 回退。定向测试：bootstrap phases、move/reconcile、folder+queue rewrite；全仓 `type-check`/`lint` 通过 |
| Tool/Office/图片附件标准化 | ✅ 已移植并验证；Work Item [#25](https://coding.s-s.city/songsong/openchamber/-/work_items/25) 已关闭 | 终态移植 `attachment-files` + `document-attachments`（`fflate`）、input-store prepare/expand、composer allowlist + modality warning、materializer/ToolPart 保留并渲染 `state.attachments`、VS Code pick extensions + `worker-src blob:`。保留 fork session 分桶、queue snapshot、`file://` 路径附件与多实例 send 权威。定向测试：attachment-files / document-attachments / materialization / input-store / webviewHtml |
| Remote-only desktop startup / Windows SSH | ✅ 已移植并验证；Work Item [#26](https://coding.s-s.city/songsong/openchamber/-/work_items/26) | 上游 `fd01af35c`/`1c63683f0` 按 fork 适配：remote-only = 跳过 managed OpenCode（`OPENCHAMBER_SKIP_OPENCODE_START` / `desktopRemoteOnly`），保留 in-process UI/proxy；boot 契约 `localOpenCodeAvailable`；chooser/recovery 隐藏坏掉的本地修复。Windows SSH：`ControlPath=none`、askpass.cmd/ps1、`windowsHide`；Unix 仍用 ControlMaster。定向 `desktopBoot` + `ssh-manager` 测试通过。不引入 pairing/relay redeem UI（见 [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) ADR） |
| Scheduled task permission autoaccept | ✅ 已移植并验证 | 补齐 fork 缺失的服务端 `permission-auto-accept` 权威策略、持久化 revision、最近显式父子继承、事件监听、失败重试和 pending reconciliation；scheduled task 在首次 prompt 前登记 session policy，登记失败时仍执行任务并退回人工审批。编辑器提供与 composer 一致的 shield toggle，并完成项目配置/API schema、8 个 locale 和旧 IANA timezone canonicalization。保留 fork 现有交互式客户端 autoaccept，通知抑制同时检查客户端和服务端策略 |
| macOS 菜单栏开关 | ✅ 已移植并验证；Work Item [#27](https://coding.s-s.city/songsong/openchamber/-/work_items/27) 已关闭 | 完整 tray runtime：`packages/electron/tray.mjs`、`resources/icons/tray/**`、`setupTray`（darwin-only）、preload `trayEnabled` + platform hint、`useTraySync`（`getAllSyncStores` + `batchLoadStatuses`）、`desktopMacMenuBarEnabled` 默认 true（Settings + settings-helpers + restart）。Tray Quit 走 `requestQuitWithConfirmation`，禁止裸 `app.exit`。定向 settings-helpers 含 `desktopMacMenuBarEnabled`；全仓 type-check/lint 通过。隔离桌面交互 QA（busy 图标 / toggle restart / OpenCode PID）随下次 local app-only 包补测 |
| Hidden-user turn 合并 / footer metadata / streaming jitter | ✅ 已移植并验证；Work Item [#28](https://coding.s-s.city/songsong/openchamber/-/work_items/28) 已关闭 | 新增 `hiddenUserMessage.ts`；`projectTurnRecords` 在 `mergeHiddenUserTurns` 下把无可见 parts 的 user turn 并入上一 turn；assistant `MessageHeader` 移除，provider/model/agent/variant/duration/time 进 turn footer（metadata 左、actions 右 hover 显）；Working 指示器显示 provider logo + `chat.statusRow.modelStatus`；`FadeInOnReveal` mount latch 防 snap；assistant 完成 turn `pb-2`；message text `leading-relaxed` 像素取整 + auto-follow 贴底 overshoot。定向 `projectTurnRecords` 17/17；UI type-check 通过。保留 fork 单 writer scroll、directive fold 与 turn identity reuse |
| React Scan、PR review workflow、LF/docs/mobile native | ➖ 不作为运行时迁移 | React Scan 仅官方 dev helper；PR workflow/agent guidance 属维护策略；`.gitattributes`、纯换行和无 `packages/mobile` 的 native 文件不混入功能批次 |

验证：4 个定向测试文件共 10 条用例通过，覆盖 parent-frame 判定、VS Code API 缺失 fallback、项目排序持久化迁移和 permission pattern 去重；全仓 `bun run type-check`、`bun run lint`、`bun run build` 通过。未重启或替换当前桌面应用；独立浏览器 QA 因本机 `127.0.0.1:5191` 当时无监听进程而未执行。

Scheduled task autoaccept 验证：permission policy、settings sanitizer、project config、scheduled runtime 和 timezone 共 41 条定向测试通过；全仓 type-check、lint、build 通过。隔离运行态驱动真实 scheduled runtime 与临时 OpenCode HTTP surface，观察到 `Session 创建 -> autoaccept policy 登记 -> prompt_async`，且运行结果返回目标 Session ID；未连接或修改正在使用的 OpenCode/OpenChamber。

FilesView focus / worktree lock 验证：stale-lock 两条真实 Git worktree 集成用例通过；全仓 `type-check`、`lint`、`build`、Git service `node --check` 与 docs validation 通过。完整 `service.test.js` 另有 19 条既存环境失败（Bun 下测试 helper 获取 Git stdout/commit hash 为空及签名配置差异），不属于本批回归；新增两条用例可独立通过。未启动、终止或替换当前 OpenChamber/OpenCode。

PR summary / VS Code bootstrap 验证：两个纯函数回归文件共 4 条用例通过，实际使用规范化 GitHub lookup key 验证 `${directory}::${branch}` 映射，并驱动“runtime API 尚未注册但 bootstrap config 已存在”的 VS Code 初始化场景；全仓 `type-check`、`lint`、`build` 与 docs validation 通过。未启动、终止或替换当前 OpenChamber/OpenCode。

VS Code worktree lock 验证：在两个真实临时 Git 仓库及 `--no-checkout` worktree 上分别制造稳定旧锁和观察窗口内变化的活锁；旧锁路径经 `.git` 文件解析后被删除，worktree 成功填充，活锁内容保持为 `active-lock` 且 bootstrap 明确失败。定向测试 2/2、VS Code 专用 type-check、全仓 `type-check`、`lint`、`build` 与 docs validation 通过；未启动、终止或替换当前 OpenChamber/OpenCode。

### v1.17.0 差距审计与 Work Item 拆分（2026-07-29）

官方 [`v1.17.0`](https://github.com/openchamber/openchamber/releases/tag/v1.17.0) 于 2026-07-28 发布；`v1.16.3...v1.17.0` 共 50 个提交、318 个文件变化。差距已拆入 GitLab backlog，后续逐项实现并在本节追加验证证据；未实现能力不记为已合并。

| 官方能力 / 修复 | 状态 | Fork 处理 / Work Item |
|---|---|---|
| Agent + CLI control plane | ✅ 已合并并验证 | [#59](https://coding.s-s.city/songsong/openchamber/-/work_items/59)。新增 managed-local `agent-tool`、`openchamber-control`、`openchamber-sessions` 与 CLI `session/schedule/projects/models`；Session 操作强制权威 `serverId + directory`，remote 显式拒绝。Desktop CLI 从共享 settings 发现端口并附带本地 bearer token；`Schedule a Task` starter、设置开关和 9 个 locale 已接入，VS Code 不展示不支持的入口 |
| CodeMirror composer + unified prompt language | ✅ 已合并并验证 | [#60](https://coding.s-s.city/songsong/openchamber/-/work_items/60)。按模块接入 CodeMirror editor、统一 `@`/`/`/`#`/Markdown/`~path` language、caret popup 定位、文本拼接及附件拖放/path helper；未覆盖 `ChatInput`，保留 fork 的 queue/steer snapshot、草稿、inline comments、移动端键盘和 `serverId + directory` 发送权威 |
| Sidebar project zones / grouping modes / full-page surfaces | ✅ 已合并并验证 | [#61](https://coding.s-s.city/songsong/openchamber/-/work_items/61)。fork 的共享多实例 `SessionSidebar` 已加入 worktree/flat 分组、Recent/Global Pinned/项目 sticky zones，以及 Archive/Worktrees/Scheduled/Multi-run 全页 surface；Session 与项目归属继续使用 `serverId + directory`，desktop archive 不套用 VS Code 的内联 archived bucket |
| Context Panel 2.0 surface rail | ✅ 已合并并验证 | [#62](https://coding.s-s.city/songsong/openchamber/-/work_items/62)。新增统一 surface registry/rail，接入 Context、Git、PR、Diff、Files、Terminal、Notes、Plan、Browser、Preview 与嵌入 Chat；顺序和各 surface 宽度按目录持久化，PR/Git/文件仍沿用 active instance 的 `serverId + directory` 路由 |
| Send 时拒绝 pending permissions 并 queue 一次 | ✅ 已合并 | [#63](https://coding.s-s.city/songsong/openchamber/-/work_items/63)。`session-actions` 现在按请求所属 `serverId + directory` 收集并拒绝当前 Session 子树的 Permission；失败项恢复到原 owning store。`ChatInput` 与 Question dismissal 并行执行，并以一次 OR 分支进入既有 queue snapshot |
| 隐藏 new-session draft starters | ✅ 已合并 | [#64](https://coding.s-s.city/songsong/openchamber/-/work_items/64)。Chat 设置新增持久化开关，仅控制新 Session 欢迎页是否渲染 starter chips，不删除或改写 global/project starter 列表；设置按当前 host/runtime 保存，切换到未保存该项的实例时恢复默认显示 |
| Small Model GitHub Copilot endpoint dispatch | ✅ 已合并并验证 | [#65](https://coding.s-s.city/songsong/openchamber/-/work_items/65)。先从当前 Copilot/enterprise 主机查询 `/models`，按模型声明优先选择 Messages、Responses 或 Chat Completions；OAuth bearer、enterprise URL、目录与 preferred-provider 约束保持不变 |
| Crof / NeuralWatt quota | ✅ 已合并并验证 | [#66](https://coding.s-s.city/songsong/openchamber/-/work_items/66)。Web 与 VS Code 双端均注册 provider；Crof 显示 credits，NeuralWatt 分离 subscription kWh、key allowance 与 credits fallback。Web/remote 继续按显式 base URL 请求 active instance，VS Code 只读 extension host auth |
| Markdown code selection / code-block layout stability | ✅ 已合并并验证 | [#67](https://coding.s-s.city/songsong/openchamber/-/work_items/67)。在现有 `MarkdownRendererImpl` 上统一高亮/纯文本代码行语义，不引入上游 Markdown/Shiki 重写；选区保留 fence、language、块结构和原始代码文本，当前对话与新 Session 使用可容纳内层 fence 的动态外层 fence |
| iOS APNs production + sandbox/production token routing | ⏸️ **有意延期（P2）** | 归入现有 [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) Mobile Push，不阻塞 desktop/runtime 的 v1.17 追平 |
| Mobile 商店签名 / CI release | ⏸️ **有意延期（P2）** | 继续由 [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) 管理，不因版本追平自动启动 |
| Linux AppImage / updater / window controls | ✅ 已完成 | [#32](https://coding.s-s.city/songsong/openchamber/-/work_items/32) 已关闭；可复现 AppImage、真实窗口控件 QA、旧包自更新与内部 feed 安全门禁的完整证据见本节上方及 v1.17.0 跨版本收口表 |

当前源码已等价、不重复建卡：PR checks/comments attach-to-chat、未加载 Parent 时 direct subagent prompting、长会话虚拟列表目标跳转、Android terminal hidden-input/退格、double-Escape active-session gate、wide chat setting、remote-only desktop startup。

**合并顺序**：先 [#63](https://coding.s-s.city/songsong/openchamber/-/work_items/63) → [#64](https://coding.s-s.city/songsong/openchamber/-/work_items/64) → [#65](https://coding.s-s.city/songsong/openchamber/-/work_items/65) → [#66](https://coding.s-s.city/songsong/openchamber/-/work_items/66)；再处理 [#67](https://coding.s-s.city/songsong/openchamber/-/work_items/67)；[#59](https://coding.s-s.city/songsong/openchamber/-/work_items/59)、[#60](https://coding.s-s.city/songsong/openchamber/-/work_items/60)、[#61](https://coding.s-s.city/songsong/openchamber/-/work_items/61)、[#62](https://coding.s-s.city/songsong/openchamber/-/work_items/62) 各自作为独立高风险 milestone，不互相混批。

**#60 验证证据（2026-07-30）**：

- `ChatInput` 的文本/caret surface 已由透明 textarea + mirror 改为受控 `ComposerEditor`；所有旧的 textarea focus 路径改为 `focusChatInput()`，Model 菜单关闭、全局 shortcut 与 mini chat 均聚焦 `.cm-content`。
- `resolveAutocompleteTrigger` 统一决定 command、skill、snippet、mention 弹层且一次只允许一个；tokenization 同一遍覆盖已注册引用、Markdown 粗体/斜体、attention 与 `~path`。Shell mode 明确关闭 prompt language。
- 粘贴链接、图片 citation 边界、VS Code URI/drop、project-relative mention 与 server `file://` URL 已统一到 `composer/text.ts` 和 `composer/attachments/*`，不再在 `ChatInput` 维护第二套规则。
- 上游 submit/mobile state 没有作为无调用方副本保留：fork 继续使用既有 queue/steer captured config、session draft、inline comment、attachment rollback、移动端 viewport 与 `serverId + directory` 路由。
- 定向测试 `220 pass / 0 fail`（12 files）；全 workspace `bun run type-check` 通过。
- 隔离 Vite + Chrome 真实交互 QA：输入中文后 value 正确；Select All 返回 `0:66`；粗体计算 weight `600`、斜体为 `italic`；`@src/main.ts`、`/review`、`#release`、`~docs/plan.md` 均生成 decoration。375×667 viewport 下长中文自动换行，8 行后 `.cm-scroller` 为 `clientHeight 192 / scrollHeight 456 / overflowY auto`，无横向溢出。QA 仅加载临时 composer fixture，未连接或重启正在使用的 OpenCode/OpenChamber，fixture 已删除。

**#59 验证证据（2026-07-30）**：

- 控制服务按显式 `serverId + directory` 解析项目、Session、worktree 和 scheduled task；managed-local 能力遇到 remote serverId 时明确失败，不回退到全局当前目录。已有 Session 继续发送时从最新 user message 继承 model、Agent 和 variant。
- OpenCode agent bridge 使用版本化请求/响应、结构化 tool result、AbortSignal 和运行时错误；OpenChamber HTTP listener 建立并登记实际端口后才注入插件和启动 managed OpenCode，避免插件拿到尚未监听的端口。
- CLI `projects/models/session/schedule` 在 interactive、plain、quiet、JSON 共用同一参数校验和 action service；Desktop 自动发现共享 settings 中的端口并附带本地 bearer token，显式 `--port` 仍具有最高优先级。
- 匹配面 QA：隔离回环 Desktop fixture 上实际启动 CLI 进程执行 `projects list --json`，观察到 `/api/system/info` 探测、带 bearer 的 `/api/openchamber/control` 请求、`action=projects.list` 与 `input.serverId=default`，CLI 返回预期项目 JSON，未连接或终止当前 OpenChamber/OpenCode。
- `bunx vitest run packages/web/bin/cli.test.js packages/web/server/lib/opencode/startup-pipeline-runtime.test.js packages/web/server/lib/agent-tool/runtime.test.js`：38 pass / 0 fail。
- `bun test` 六个相关 persistence、autocomplete、settings、control、Session 和 CLI policy 文件：44 pass / 0 fail。
- `bun run type-check`、`bun run build`、`bun run docs:validate`：通过；changed-source LSP error diagnostics 为 0。
- 全仓 `bun run lint` 仍仅被 4 个本批前已存在的未使用变量挡住：`remoteProjectLoadState.test.ts:_serverId`、`ScrollShadow.tsx:bothKey`、`TerminalView.tsx:terminalLifecycle`、`session-actions.ts:_archived`。本批 web/electron/plugin/mobile lint 均通过，未借迁移任务改动无关基线。

**#63 验证证据（2026-07-29）**：

- `bun test packages/ui/src/sync/session-actions.test.ts`：37 pass / 0 fail，覆盖父子 Session、无关 Session 隔离、远程 owning server/directory、单项拒绝失败回滚。
- `bun run type-check`：全部 workspace 通过。
- `bun run docs:validate`：通过。
- 全仓 `bun run lint` 仍被 4 个本轮前已存在的未使用变量挡住；`ChatInput.tsx` 与新增测试定向 lint 通过，`session-actions.ts` 仅报告原有 `unarchiveSession` `_archived`（line 986），本轮未借迁移任务改动无关基线。
- 匹配面 QA 使用真实 Zustand child stores 与 SDK wire mock 执行：父/子 Permission 均发出 `response=reject`，远程请求携带 `/remote/project`，失败子项恢复、成功父项保持移除。`ChatInput` 只在 `deniedPermissions || dismissedQuestions` 后调用一次 `handleQueueMessage()`。

**#64 验证证据（2026-07-29）**：

- `packages/ui/src/lib/persistence.settings.test.ts`：7 pass / 0 fail，覆盖当前 host 保存的 `false` 能恢复，以及切换到未保存该字段的 host 时不会继承上一个实例的隐藏状态。
- `packages/web/server/lib/opencode/settings-helpers.test.js`：26 pass / 0 fail，覆盖 `draftStartersVisible` 仅接受 boolean，拒绝字符串等非布尔输入。
- `bun run type-check`：全部 workspace 通过；本轮改动文件定向 ESLint 通过；全仓 `bun run lint` 仍仅被 4 个本轮前已有的无关未使用变量挡住。
- `bun run build`：Web、Electron workspace、VS Code webview 与 mobile assets 全部构建通过。
- 匹配面浏览器 QA：默认新 Session 显示 7 个 starter；关闭设置后全部隐藏但输入区仍保留；刷新后继续隐藏；重新启用后 starter 恢复。验收结束已恢复“显示”偏好并关闭独立 HMR 服务器，未安装 runtime、未修改 `/Applications/OpenChamber.app`。

**#61 验证证据（2026-07-30）**：

- `useSessionDisplayStore` 将 `by-worktree` / `flat` 分组、sticky zone headers 与现有 display/recent/archive 偏好一起持久化；flat 只改变项目区呈现，不重排或重建 Global Pinned、folders、Session 对象及其多实例归属。
- Archive、Worktrees、Scheduled Tasks 与 Multi-run 从 overlay/侧栏入口提升为 MainLayout 全页 surface；切换 Session 会关闭这些 surface 并回到 Chat，避免旧全页覆盖新 Session。VS Code 保留其原有内联 archived bucket，web/desktop 不重复展示。
- 定向测试覆盖 store 默认值、持久化、模式切换及无关字段引用稳定；隔离 Playwright fixture 实际切换 Flat project list / Group by worktree，打开 Archive 全页并返回当前 Chat，期间阻断所有非 loopback 请求且未连接用户 OpenCode。
- sticky Recent、Global Pinned 和项目/worktree zone 继续在 fork 的共享 desktop/mobile 侧栏内渲染；375px 窄视口由同一 Sidebar surface 承担，没有引入上游单实例 `MobileSessionsSheet`。

**#62 验证证据（2026-07-30）**：

- 新增统一 surface registry 与可拖拽 rail；仅展示当前 runtime 可用且有实际内容的 surface，Plan 继续受现有 feature flag 控制，Preview/Chat 不制造空 tab。点击当前 surface 会折叠 panel，其他点击复用对应 mode tab。
- Context Panel 新增 Git、Pull Request 与 Project notes mode；PR 与 Git 共享 active project/base-branch 解析，Notes、Terminal、Files、Last-turn Diff、Browser、Preview 和嵌入 Chat 均保留既有实现与身份。宽度按 `directory + mode` 保存，切换项目不会串用另一个项目的 panel 宽度。
- resize 在 pointerdown 后同步锁定，首个 pointermove 不再丢失；720px 仍显示完整 rail 且无横向溢出，375px 隐藏 desktop rail/panel，避免挤压 Chat。`widthByMode`、rail order 和旧 persistence migration 均有定向测试。
- 隔离 Playwright fixture 逐一打开 Context/Git/PR/Diff/Files/Terminal/Notes/Browser，观察 `aria-pressed` 与内容 surface 同步；Git 拖宽超过 80px，720/375 两档均无横向 overflow，页面错误为 0。fixture 使用临时 HOME 和 fake OpenCode，所有非 loopback 请求均被阻断。

**#65 验证证据（2026-07-29）**：

- `packages/web/server/lib/small-model/call.test.js`：24 pass / 0 fail，其中 7 条 Copilot 定向用例覆盖 `/v1/messages`、`/responses`、`/chat/completions`、缺失 endpoint metadata 的 legacy fallback、enterprise host、模型列表 HTTP 失败、模型缺失和不支持的 endpoint。
- 独立 Bun 驱动通过真实 `callSmallModel` consumer surface 注入 HTTP fixture，分别观察到 `claude-opus-4.7 -> /v1/messages -> messages-ok`、`mai-code-1-flash-picker -> /responses -> responses-ok`、`gpt-5.4-nano -> /chat/completions -> chat-ok`。
- `/models` 只携带 Copilot auth headers；generation 请求继续携带既有 intent/initiator headers。请求体测试确认 OAuth token 不进入 payload，enterprise URL 同时约束 endpoint discovery 与 generation。

**#66 验证证据（2026-07-29）**：

- Web provider 定向测试：`crof.test.js`、`neuralwatt.test.js`、registry 共 12 pass / 0 fail，覆盖 credits 数字/缺失、subscription kWh、overage、独立 allowance、funded ceiling、credits fallback、空 payload、401 与 JSON 失败。
- VS Code extension-host fixture：`quotaProviders.test.js` 4 pass / 0 fail，直接调用 `fetchQuotaForProvider`，确认 auth discovery、Crof/NeuralWatt payload 与 provider-specific 401 语义和 Web 一致。
- active-instance UI 路由：`useQuotaStore.test.ts` 5 pass / 0 fail；新增 Crof 场景实际观察请求为 `/api/remote/test-server/quota/crof`，本地/远程同 provider 的 in-flight key 保持隔离。
- VS Code 双 tsconfig type-check 与本批新增/修改文件定向 ESLint 均通过。

**#67 验证证据（2026-07-29）**：

- 新增独立 `selectionMarkdown` 序列化模块，10 条定向测试覆盖完整/局部代码块、Markdown block wrapper、缩进与空行、CRLF、内嵌反引号、`c++` language、行号和缺失文件 `✗` 装饰剔除，以及外层动态 fence。
- `MarkdownRendererImpl` 的 Prism 与 plain/terminal-cell 两条路径统一输出 `data-md-code-line*` 语义；逐行 grid 固定行号栏，缺失文件上标使用不参与布局的 transform。真实会话 `ses_067cc3aa0ffeoQxhJGvi2UCIWD` 中原先 16px/20.328px 交替的五行代码实测统一为 16px。
- 隔离 HMR 匹配面 `http://127.0.0.1:5197` 实测：跨两行选择后“加入当前对话”写入四反引号 `md` 外层 fence，内层 `js` fence、缩进和源码保留；代码块 Copy 写入剪贴板的文本不含行号或 `✗`。验收后已清空输入框，未发送消息、未创建 Session。
- 定向 ESLint、全仓 type-check、全仓 build 与 docs validation 通过。全仓 lint 仍只报告本批前已有的 4 个无关未使用变量：`remoteProjectLoadState.test.ts` 的 `_serverId`、`ScrollShadow.tsx` 的 `bothKey`、`TerminalView.tsx` 的 `terminalLifecycle`、`session-actions.ts` 的 `_archived`。

**Desktop 部署权威**：后续普通 UI/server/preload/OpenCode TypeScript 变更只运行 `bun run electron:runtime:install`，原子切换 `~/Library/Application Support/OpenChamber/runtime/current`；`/Applications/OpenChamber.app` 是不可变已公证壳，不复制、不覆盖、不修改 `Contents`。runtime native CodeDirectory 与壳不一致时必须失败并另行安排壳级签名/公证，不能绕过兼容门禁。

### 内部发行版本与许可证（2026-07-21）

- OpenChamber 的 merge baseline 已于 2026-07-30 提升到 `1.17.1`；源码版本使用 `1.17.1-sscity`，Electron 每次打包生成 `1.17.1-sscity.YYYYMMDD-HHMMSS`，About、包元数据和内部下载记录使用同一个构建版本。下一次 baseline 提升仍需先完成对应官方区间的逐项审计和验证。
- 自定义 OpenCode 统一使用 `-sscity` 后缀；当前 Linux AppImage 嵌入并核验的是 `1.18.9-sscity`，且必须以 `OPENCODE_CHANNEL=latest` 构建以继续使用共享数据库。
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
| Japanese locale | ✅ 已完成（[#31](https://coding.s-s.city/songsong/openchamber/-/work_items/31)） | 已注册 `ja`（runtime/store/bootstrap）；`ja.ts` + `ja.settings.ts` 以 upstream/main 为底并对齐 fork `en` keyset；约 445 个 fork 独有 key（远程实例、subscriptions、Goals 等）补全日译；各 locale 增加 `common.language.japanese`；docs 日语站仍不在范围 |
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
| Desktop remote custom headers / realtime proxy | ✅ 已移植并验证；Work Item [#10](https://coding.s-s.city/songsong/openchamber/-/work_items/10) 已关闭 | 未整包上游 realtime-proxy/runtime-switch。在 fork `remoteInstances` 上增加 per-`serverId` `requestHeaders`，统一 `buildRemoteUpstreamHeaders` 注入 health/HTTP/SSE/event-WS/RPC/fanout；Authorization 仍由 auth 独占。API 红acted 空值 + preserve；Web ConfigCard 可编辑。定向 `request-headers`/`config`/`rpc-ws`/`settings-helpers` 测试通过。双远端 CF Access 交互 QA 随环境补测 |
| Native mobile workspace / official bundled CLI | ✅ #9 第一阶段已完成；CLI 有意不移植；Work Item [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) | fork 适配的 `packages/mobile` + `MobileApp`/`serverRegistry` 桥及 #36–#39 已落地；官方 bundled CLI 与 custom `1.18.4-sscity`、shared database 和签名 runbook 冲突，继续保留 fork packaging authority。Push #49 与商店签名/CI #50 是独立的有意延期项 |

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
| Voice/mobile composer/native keyboard | ✅ 后续按 fork 架构等价完成 | 已落地 native workspace、移动 composer/keyboard 增量、browser/server/WASM STT、Capacitor resume/overlay 与 TTS；未机械复制会破坏多实例和自定义 ChatInput 的上游整包重构 |
| 用户 CLI 优先于 bundled CLI | ⛔ 保留 fork 分歧 | custom embedded `1.18.4-sscity`、shared database、双签名和 provenance 是发行约束；不允许任意用户 PATH CLI 静默替换包内权威二进制，显式外部配置仍受支持 |

**v1.14.0 收口**：26 个官方提交已逐项审计。Load older 完成态、preset 直接发送、首连 materialization 去重、authoritative abort 与 tooltip token 已按 fork 架构移植；Windows CLI、LAN 本机 token、浏览器密码解锁和统一虚拟列表判定为已有等价或更强实现。Native mobile keyboard/composer 与 first-class voice 保留为独立产品批次，用户 PATH CLI 优先策略因 custom embedded binary 约束不采用。源码、workspace lock、Electron 构建前缀和打包 runbook 已推进到 `1.14.0-sscity`。

### v1.14.1 逐项推进（2026-07-21）

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Line-range file refs / first changed diff line | ✅ 已提前移植 | 当前 parser 已支持 `file:start-end` 与 `#Lx-Ly`；DiffView 从 patch hunk 计算首个变化行，focused tests 已存在 |
| Timeline load earlier | ✅ 已提前移植 | TimelineDialog 使用当前 Session 的 timeline controller、server cursor、loading 状态和 prepend anchor，不新增第二套分页状态 |
| VS Code favorites / settings return | ✅ 已提前移植 | favorites 已持久化，退出 settings 恢复 previous view |
| Mobile auth fallback / PWA safe area | ✅ fork 已等价或更强 | 非 desktop status probe 失败进入 network error；只有 desktop remote password fallback 显示 unlock。PWA keyboard mode、safe-area composer/dialog/toast 已按现有 DOM 适配 |
| Small Model + session recap/suggestion | ✅ 后续批次已完整收口；Work Items [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12) / [#54](https://coding.s-s.city/songsong/openchamber/-/issues/54) | `small-model` runtime/settings、Notes、标题重生成、session recap/suggestion、TTS summarized 与 Git/PR generation 均已接线。所有消费者动态携带当前 directory 与 preferred provider/model；远程实例经 `runtimeFetch` 访问活动 runtime，不回退全局目录 |
| Native mobile resume/focus/dictation overlay | ✅ 后续批次已完成；Work Item [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) | `ComposerDictation` 移动 portal、interim transcript、Capacitor resume 和模型持久化均已落地；desktop inline voice 行为保持不变 |
| Share opinion prompt / `oc-dev` Bun global helper | ➖ 不移植 | 临时社区调查不属于产品功能；当前仓库无官方 `oc-dev.mjs` 部署 surface |

**v1.14.1 当时收口**：17 个官方提交已逐项审计。文件范围、Diff 首行、Timeline、VS Code favorites/返回页和 auth/PWA 边界已有实现；native mobile 与临时调查不适用。当时延期的 Voice 与 Small Model/session-assist 后续已由 #11/#54 按 fork 架构收口；本段保留版本审计时间线，不再代表当前 backlog 状态。源码、workspace lock、Electron 构建前缀和打包 runbook 当时推进到 `1.14.1-sscity`。

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
| Private relay / pairing v2 / desktop transports | ✅ 已移植并验证；Work Item [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) 已关闭 | ADR Implemented：[`docs/PRIVATE_RELAY_TRANSPORT_COMPAT_ADR.md`](PRIVATE_RELAY_TRANSPORT_COMPAT_ADR.md)。Host `packages/web/server/lib/relay/*` + client-auth pairing；UI `packages/ui/src/lib/relay/*` 隧道（runtime-fetch/WS）；Electron 持久化 LAN+relay、`expectedServerId` probe、install id；Settings `PairingDevicesPanel` Import Link；DesktopHostSwitcher / `restoreDesktopRelayRuntime` multi-transport；Mobile QR + `openchamber://` redeem。默认官方中继 `wss://relay.openchamber.dev/ws`。定向 crypto/handshake/codec/tunnel/cross-compat/pairing/host-lock + `serverIdAuthority` 测试通过；`bun run type-check` 绿。不整包上游单 runtime |
| Windows tray/startup | ✅ 已移植并验证；Work Item [#17](https://coding.s-s.city/songsong/openchamber/-/work_items/17) 已关闭 | 上游 `4a9aebdb6`（#2112）叠在 fork #27 macOS tray 上：`setupTray`/`isTrayEnabledForPlatform` 含 win32（不依赖 `desktopMacMenuBarEnabled`）；`icon.ico` + extraResources/win NSIS；`getLoginItemOptions` + `--background` 开机自启；`desktopMinimizeToTrayEnabled` + minimize/close hide；`useTraySync` 扩 win32；Quit 仍走 `requestQuitWithConfirmation`。8 locale + settings-helpers 测试；macOS 菜单栏开关/呼吸图标不变。Windows 交互 QA（托盘点击 / minimize-to-tray / login item / Keep·Stop OpenCode）随下次 Windows 包补测 |
| Startup OpenCode config 非阻塞 | ✅ 已移植并验证；Work Item [#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2) 已关闭 | 上游 `0542bcfc5` 逐段适配（禁止整文件覆盖）：`sync-refs` `getSyncConfig`/`emit`/`subscribe`（扫 default + `getAllSyncStores`）；`client.getConfig` 按 `baseUrl+directory` 缓存/去重；bootstrap Phase2/seed `emitSyncConfigChanged`；`useConfigStore` 去掉 `loadAgents`/`initializeApp` 对 `config.get` 的阻塞等待，新增 `selectionSource` + `applyOpenCodeConfigDefaults`（manual 优先）。定向 9 tests；UI type-check 目标文件绿 |
| 长会话 streaming 性能三块缺口 | ✅ 已移植并验证；Work Item [#4](https://coding.s-s.city/songsong/openchamber/-/work_items/4) 已关闭 | 上游 `e88afff2` 仅 port 剩余缺口（不整包、不 virtua）：`streamingTailEntry` + `MessageList`/`useSessionParts` 尾叶 live reinject（session directory/serverId）；sidebar `sessionNodeItemUtils` 预计算 subtree/menu/structure 经 `SessionGroupSection`/`SidebarActivitySections` 下传；`sync-session-generation` + `loadMessages(isStale)` 写守卫（`serverId+directory+sessionID`）。定向 10 tests；大会话/大侧栏 runtime QA 随交互补测 |
| Native mobile / mobile release/update/iPad split | ✅ #9 第一阶段 + #36–#39 已完成；Work Items [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9)/[#36](https://coding.s-s.city/songsong/openchamber/-/work_items/36)–[#39](https://coding.s-s.city/songsong/openchamber/-/work_items/39) | 原生 chrome/Instances、composer 增量、侧栏同步、APK/AAB 更新器与 iPad 共享侧栏已落地；pairing #16 已完成。Push #49 与商店签名/CI #50 为有意延期，不阻塞版本功能收口 |

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

**v1.16.0 当时收口**：63 个官方提交已逐项分类。适用于当前 fork 的编辑器字号、fork PR 上下文、乱序 rename 防回滚、queue idle dispatch/退避、pending Question 恢复、Command Palette 项目搜索、子智能体直接消息、host spoof 防护、通知可靠性、文件树刷新、项目排序、Windows 路径身份键和 Chat 设置分组均已移植或确认等价。Markdown preview、VS Code Insiders、Agent YAML 和 pinned refresh 已确认 fork 等价。当时独立排期的 Session Goals、server-persisted Autoaccept、private relay/native mobile 与 Small Model 后续均已按各自 Work Item 收口；本段保留版本审计时间线。focused tests 67 条、全 workspace type-check 和隔离前端 Chat 设置实测通过；隔离页面并发引导远程目录触发的 `429` 与本批次无关。源码、workspace lock、Electron 构建前缀和打包 runbook 当时推进到 `1.16.0-sscity`。

**验证清理**：子智能体直接消息设置同步在同上下文函数失败时继续回退到 `postMessage`；补充说明性注释，消除 `no-empty` lint，不改变传输或多实例路由行为。

### Fork 稳定性：本地项目注册表启动保护（2026-07-22）

| 故障 | 状态 | Fork 处理 |
|---|---|---|
| 远程项目发现覆盖全部本地项目 | ✅ 已修复并补回归测试 | 启动时 shared settings 尚未 hydrate，`RemoteProjectDiscovery` 会先发现远程目录；旧实现随后把“空初始列表 + 远程项目”作为完整 `projects` 写回 `settings.json`，导致本地项目和侧栏 Session 分组全部消失。`useProjectsStore` 现在显式记录 shared settings hydration，hydrate 完成前禁止自动远程发现和持久化；hydrate 后远程项目只能追加到已加载的本地项目。测试覆盖未 hydrate 时阻断、hydrate 后允许，以及本地项目不被远程追加替换三条路径。OpenCode 数据库未受损；恢复数据从 Electron Local Storage 的只读副本提取，并与当前远程项目合并后再部署。 |

### Fork 稳定性：OpenCode 生命周期取证（2026-07-28）

| 故障 | 状态 | Fork 处理 |
|---|---|---|
| OpenCode 停止响应并被重启时缺少可关联的生命周期证据 | ✅ 已补取证链、进程句柄修复和独立 Runbook | managed process wrapper 现在保留真实 `pid/exitCode/signalCode`，并在 ready 后继续监听 `exit/error`；修复旧 wrapper 因字段缺失而把仍存活子进程判成已退出的问题。新增 `${OPENCHAMBER_DATA_DIR}/logs/opencode-lifecycle.jsonl`（默认 `~/.config/openchamber/logs/opencode-lifecycle.jsonl`，2 MB 单代轮转），记录 spawn/ready/exit、主动 stop 原因、health 连续失败、端口监听 PID、busy defer 和 restart 原因/结果，不记录 prompt、消息、凭据或环境。检查方法已固化到 [`OPENCODE_LIFECYCLE_INCIDENT_RUNBOOK.md`](OPENCODE_LIFECYCLE_INCIDENT_RUNBOOK.md)，并由根 `AGENTS.md` 强制索引，覆盖证据保全、live process sample、OpenCode 日志、macOS `.ips`/unified log 关联和结论模板。当前历史事件只能确认旧 OpenCode 日志中断后约 6 分钟出现新 PID，不能反推是进程退出还是仍占端口但 health 卡死；下一次事件可由 `process_exit` + `listeningProcessIds` + `restart_*` 时间线定性。lifecycle/journal focused tests 覆盖进程状态、ready 后退出事件、首次 health 失败不误杀和日志轮转。 |

### 中等难度 / 需要逐段适配

| 功能 | 影响文件/模块 | 风险点 |
|---|---|---|
| queue drag reorder | `messageQueueStore.ts`、`QueuedMessageChips.tsx` | ✅ 已完成；拖拽只改变队列次序，保留 queued item 对象及 `sendConfig` + `sendTarget` 快照 |
| model picker reorder/accordion/Shift+Delete + thinking variant | `ModelPickerList.tsx`、`ModelControls.tsx`、agents settings | ✅ provider order + accordion 已按 `serverId` 落地（#5）；Shift+Delete 永久删除仍不移植；thinking variant 已有 |
| agent temp/topP/thinking save/clear | `AgentsPage.tsx`、`useAgentsStore.ts`、server agents/config | 本 fork 已做过 prompt/permission persistence；新增字段要按 custom/project/user 层级合并 |
| session project binding / pinned/folder empty refresh / worktree snap-back | sidebar hooks、global sessions store、project selection | ✅ 收口（[#52](https://coding.s-s.city/songsong/openchamber/-/issues/52)）：`projectResolution` + draft 冻结；folder/pinned 空刷新保护；worktree passive selection；abort fail-closed（无 session directory 不回退 live UI dir） |
| worktree session bootstrap gate / draft generate materialization | worktree store、session actions、GitView generate | 不能破坏 `[OPENCHAMBER-FORK] ensureWorktreeProject` 和 pending draft flow |
| subagent 删除级联 | `SessionNodeItem`、`useSessionActions`、delete/archive flow | fork 已有 export/delete subtask 文案和运行中跳过逻辑；需保留 per-child partial failure |
| VS Code font prefs / mobile exact grouping / mobile history | `packages/vscode/*`、mobile apps | 可做，但建议平台批次，不和 web/desktop 混合 |
| Desktop remote custom headers / SSH saved password unlock | ✅ headers 已完成（#10）；SSH saved password 仍独立 | Work Item [#10](https://coding.s-s.city/songsong/openchamber/-/work_items/10) 已关：`requestHeaders` 经 `/api/remote/:id` 全路径注入。SSH saved-password unlock 不在本 WI DoD，另排 |
| Voice input / local STT / Kokoro read-aloud refresh | ✅ fork 等价实现已完成 | Work Item [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11)。browser/server/WASM STT、移动 overlay/Capacitor resume、模型持久化和 Browser/OpenAI/Kokoro/macOS Say TTS 已落地；保留 fork ChatInput 与多实例结构 |
| Small Model utility consumers | ✅ 全部收口 | Work Items [#12](https://coding.s-s.city/songsong/openchamber/-/work_items/12) / [#54](https://coding.s-s.city/songsong/openchamber/-/issues/54)：Notes、标题重生成、session-assist、TTS summarized、Git/PR generation 均使用 Small Model；动态传递 directory + preferred provider/model，并通过活动 runtime 路由 |
| Unified list virtualization / chat history loading | `MessageList.tsx`、desktop history、scroll preservation | ✅ desktop 已对齐统一 `@tanstack/react-virtual`、server-only pagination、提前预取和 scroll invariants；375px 响应式视口已验证，原生 mobile momentum 仍需平台验证 |

### 高风险 / 不建议作为第一批

| Milestone | 原因 | 处理方式 |
|---|---|---|
| Chat scroll 全链路稳定 (v1.13.3~7) | ✅ desktop 长会话、自动历史预取、Load older 保底、process folding 和空闲 auto-follow 已完成；仅原生 mobile momentum 仍待平台验证 | 保留为平台收尾 milestone，不再重复改 desktop scroll writer |
| Markdown/Shiki worker rewrite 相关后续 fixes | 本地没有上游 `chat/markdown/` 目录，`MarkdownRendererImpl.tsx` 仍承载 agent/skill links、文件路径点击、table copy 等 fork 功能 | 暂不混入 v1.13.3~8；若做，必须先迁移 fork 自定义渲染能力 |
| OpenCode never auto-attach / orphan cleanup / process killer port ownership | 本 fork Electron 在同进程启动 web server，并有自定义 managed OpenCode keep-alive / detach / quit 语义 | 先读 `opencode` 模块 docs + Electron lifecycle，做 runtime-truth 验证；不能照搬上游 kill/attach 判断 |
| v1.13.4 dead-code cleanup / knip sweep | compare 删除大量 UI/shared 文件；fork 仍有远程实例、session markers、custom UI 依赖 | 暂缓。cleanup 不应和功能合并混在一起 |
| Japanese docs/i18n bulk import | 文件量很大但业务风险低；容易污染 diff | Work Item [#31](https://coding.s-s.city/songsong/openchamber/-/work_items/31)。等功能批次稳定后单独做 docs/i18n 批次 |
| Native iOS/Android app project | v1.13.9 新增 `packages/mobile`；fork 按 [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) 引入并适配 `serverRegistry` | ✅ 第一阶段完成。薄壳 `MobileApp` + registry 桥、#36–#39 和 pairing #16 已落地；Push #49 与商店签名/CI #50 明确有意延期。见 [`docs/NATIVE_MOBILE_FORK_ADR.md`](NATIVE_MOBILE_FORK_ADR.md) |
| 官方 bundled OpenCode CLI / updater | 官方 v1.13.9 打包 pinned official CLI；本 fork 已完成 custom merged binary staging/signing/runbook，并强制 shared `opencode.db` channel | 不直接 port 官方 binary 或自动升级；后续只评估 updater UX，custom binary provenance 与 shared-data invariant 不变 |
| Mobile composer/keyboard full redesign | v1.14.0/1 大面积改 `MobileApp`/`ChatInput`/autocompletes/keyboard choreography | ✅ 以 #37/#47 增量方式完成目标行为；有意不整包覆盖 fork 的多实例 ChatInput、queue/steer 和附件发送路径 |

### 建议下一步批次

**当前确认（2026-07-25）**：`#28` / `#15` / `#12` / **[#29](https://coding.s-s.city/songsong/openchamber/-/work_items/29)（v1 local-only）** / [#33](https://coding.s-s.city/songsong/openchamber/-/work_items/33) / [#34](https://coding.s-s.city/songsong/openchamber/-/work_items/34) / **[#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35) Remote Goals** / **[#27](https://coding.s-s.city/songsong/openchamber/-/work_items/27) macOS tray** / **[#8](https://coding.s-s.city/songsong/openchamber/-/work_items/8) Pierre diff runtime** / **[#6](https://coding.s-s.city/songsong/openchamber/-/work_items/6) automatic review loop** / **[#7](https://coding.s-s.city/songsong/openchamber/-/work_items/7) CLI live-port** / **[#17](https://coding.s-s.city/songsong/openchamber/-/work_items/17) Windows tray** / **[#2](https://coding.s-s.city/songsong/openchamber/-/work_items/2) startup config 非阻塞** 已关闭。

1. **Queue reliability 批次 A (已完成)**: v1.16 idle dispatch、failed auto-send backoff 和 queue drag reorder 已移植；queue snapshot 继续作为权威。
2. **CLI/Startup/Desktop auth 批次 B**: pid identity、live port check、update helper、quota/provider startup、Bun global CLI fix、LAN-bound local auth token，按 helper/route 切，不做 v1.13.4 cleanup。
3. **小修批次 C**: header encoding、MiniMax quota、skills catalog refresh、provider disconnect、Git push sync、Preview duplicate token；VS Code Insiders、line-range refs / first changed line 与第二轮 JSON/VS Code/Windows CLI 小修已完成。
4. **GitHub PR status 批次 D**: timeout/rate-limit/cooldown/concurrent metadata，并验证启动时 session/diff/message 不被 PR status 阻塞。
5. **Queue/Steer 批次 E (已完成)**: boolean 已迁到 Follow-up behavior (`steer` / `queue`) 并复用本 fork `steer-side-channel`；后续 queue drag reorder 单独处理。
6. **Session/worktree 批次 F**: ✅ 收口（[#52](https://coding.s-s.city/songsong/openchamber/-/issues/52)）。selected project binding、folder/pinned refresh、worktree snap-back、subagent delete cascade、timeline earlier load 已在树；`abortCurrentOperation` 缺 session directory 时 fail closed（不回退 `_getDirectory()`）。
7. **Chat input/abort 批次 G**: ✅ 收口（[#53](https://coding.s-s.city/songsong/openchamber/-/issues/53)）。pasted `@` / question dismiss / slash skill / cross-project abort 已有 focused tests；ArrowUp/Down history 抽为 `composerHistoryNavigation` + 测试，条件与 1.16.x 一致（无 autocomplete、折叠光标在首/尾）。
8. **Voice/Small Model 批次 H（已完成）**: capability + settings + Notes consumer 已落地；**TTS summarized 去 stub 已落地**（`summarizeText` 走 small-model，失败回退本地 distillation）；**git generation 已迁移到 small-model first**（`generateCommitMessage` / `generatePullRequestDescription` 先 `/api/small-model/generate`，session-agent 仅 404/no-small-model fallback；用 `runtimeFetch` 走连接 instance）；**session-assist（recap + suggested next message）已合并**（`session-assist/runtime.js` SSE watcher，idle ~60s → small-model → `metadata.openchamber.assist`；UI `SessionRecapNote` + `SessionSuggestionChip` + `useSessionAssist`；适配 fork instance authority + read-modify-write 保留 goal namespace + restrictToPreferredProvider）。TTS 摘要消费者也已改为从活动 runtime 发送动态 directory + preferred provider/model。Work Items [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) / [#54](https://coding.s-s.city/songsong/openchamber/-/issues/54) 收口。Goals：`#29`/`#33`/`#34`/`#35` 已落地（remote 需远端 OC 广告 `/api/goals/capability`）。
9. **v1.15 UI 批次 I (部分完成)**: code line number/wrap 已按现有 Markdown 架构适配；Mermaid zoom、ambiguous transport failure、Markdown preview 继续逐项处理。
10. **高风险 milestone**: 已完成 server-persisted auto-accept、chat scroll + auto-follow、mobile/native 第一阶段和 private relay/pairing；OpenCode process ownership 已增加生命周期取证并保留独立事故跟踪。Markdown/Shiki 整包 rewrite 与 bulk docs/i18n 仍按架构风险单独处理，不作为 1.17.0 功能缺口。`#35` Remote Goals / `#27` macOS tray / `#8` Pierre / `#6` auto-review / `#7` CLI live-port / `#17` Windows tray 已关闭。

### v1.17.0 跨版本收口审计（2026-07-30）

| 跟踪项 | 最终状态 | 收口证据 |
|---|---|---|
| [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) Native mobile 第一阶段 | ✅ 完成 | `packages/mobile`、`MobileApp`/`serverRegistry`、#36–#39 与 pairing #16 已落地；APK/AAB、iPad 共享侧栏和本地 debug 流程均覆盖。Push #49、商店签名/CI #50 是用户确认的独立有意延期，不阻塞版本合并 |
| [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) Voice | ✅ fork 等价完成 | browser/server/WASM STT、移动 dictation overlay、Capacitor resume、模型持久化及 Browser/OpenAI/Kokoro/macOS Say TTS；375px touch 隔离 E2E 验证 Local 跨 reload、Server 切换和录音开始/取消 |
| [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) Terminal v3 | ✅ 已关闭并对齐总览 | attach/snapshot/sequence、WS-only、history/shells/theme-response 已适配；保留 `serverId:directory`、Context Panel、Electron SSH 外开和 ghostty viewport |
| [#32](https://coding.s-s.city/songsong/openchamber/-/work_items/32) Linux AppImage | ✅ 完成 | `scripts/build-linux-appimage-docker.sh` 在 amd64 Docker 中复现 `OpenChamber-1.17.0-sscity.20260730-053630-linux-x86_64.AppImage`；静态检查确认自定义 OpenCode `1.18.9-sscity` 与 8 个 x64 native modules。Xvfb + Openbox 实际启动 AppImage，观察到菜单、最小化、最大化/还原、关闭控件并操作最大化切换；旧 `1.16.0-sscity.e2e.1` 经真实 electron-updater 下载、进度事件和重启链升级到 `1.17.0-sscity.e2e.2`，安装文件 SHA-512 与目标一致。未修改 `/Applications`，未触碰多实例 `serverId + directory` authority |
| [#54](https://coding.s-s.city/songsong/openchamber/-/issues/54) Small Model consumers | ✅ 完成 | Notes、标题重生成、session recap/suggestion、TTS summarized、Git/PR generation 全部接线；消费者使用动态 directory、preferred provider/model 和活动 runtime，不从可变全局状态猜实例 |
| [#59](https://coding.s-s.city/songsong/openchamber/-/work_items/59)–[#67](https://coding.s-s.city/songsong/openchamber/-/work_items/67) v1.17.0 批次 | ✅ 全部关闭 | Prompt Navigator、草稿 starters 设置、Copilot endpoint dispatch、队列/会话/桌面与平台批次已逐项记录在上方 v1.17.0 表 |

**不阻塞 1.17.0 的独立跟踪**：[#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) 原生 Push、[#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) 商店签名/CI、[#51](https://coding.s-s.city/songsong/openchamber/-/issues/51) OpenCode 长期版本跟踪，以及 [#56](https://coding.s-s.city/songsong/openchamber/-/issues/56) Mobile onboarding 产品体验改进。#49 与 #50 是用户确认的有意延期；这些条目不是遗漏的上游 1.17.0 runtime capability，也不应伪装成已完成。

**最终验证**：Small Model/session-assist focused tests 50 条、Mobile focused tests 26 条、Voice/摘要/持久化 focused tests 24 条通过；全 workspace type-check、定向 changed-file lint、完整 build 通过。隔离 Playwright 4 条全部通过，其中 375px touch 场景实际打开移动 dictation surface，验证 Local 模型跨 reload 持久化、切换 Server、进入 Listening 和 Cancel 关闭；fixture 使用伪 OpenCode、临时 HOME，并阻断全部非 loopback 请求。全量 lint 仍只有 4 个本批未触碰的既有 `no-unused-vars` 基线错误：`remoteProjectLoadState.test.ts`、`ScrollShadow.tsx`、`TerminalView.tsx`、`session-actions.ts`。

### v1.17.1 差距审计（2026-07-30）

官方 `v1.17.0...v1.17.1` 共 28 个提交、106 个文件（`+2631/-359`）。本轮按用户可观察能力归并 Work Item，不按提交机械覆盖；迁移继续以 `serverId + directory`、自定义多实例侧栏、custom embedded OpenCode 与共享数据库约束为前提。

| 能力 | 当前状态 | Fork 处理 / Work Item |
|---|---|---|
| OpenCode stalled SSE 恢复与 managed restart-loop 抑制 | ✅ 已合并 | [#68](https://coding.s-s.city/songsong/openchamber/-/work_items/68)：Web 与 VS Code SSE proxy 均以 OpenCode 上游字节为唯一活性信号，静默超时后结束 downstream 促使 UI 重连；proxy 自己发送的 heartbeat 不会掩盖上游卡死。health 失败最多每个配置 interval 计数一次，同时保留 missing-listener 立即恢复、busy grace、detached process ownership、shared database 与 lifecycle journal |
| Bash 卡片实时输出、固定高度与无 5 分钟计时上限 | ✅ 已合并 | [#69](https://coding.s-s.city/songsong/openchamber/-/work_items/69)：`ToolPart` 局部消费 Bash `metadata.output`，运行中使用固定高度输出区并只追加新增文本；自动跟随在用户向上滚动后停止，回到底部后恢复。计时器不再截断于 300s；未向共享 store 扩散高频订阅 |
| 历史完整性与 revert optimistic 清理 | ✅ 已合并 | [#70](https://coding.s-s.city/songsong/openchamber/-/work_items/70)：本 fork 的真实权威点 `use-sync + sync-meta` 在 tail/force refresh 时保留既有 complete coverage，避免重新出现 Load older；revert 后新分支发送成功才从 optimistic shadow 确认删除旧分支，失败则恢复 Session/message/part。保留 server-only pagination、同步 scroll anchor 和 `serverId + directory` 路由，未增加 scroll writer |
| bundled OpenCode 不显示独立 updater | ✅ 已合并 | [#71](https://coding.s-s.city/songsong/openchamber/-/work_items/71)：Web/desktop 与 VS Code 统一返回显式 `upgrade` capability；bundled/external fail closed，事件通知也必须重新读取当前 runtime status 后才展示。managed non-bundled 保留升级能力，自定义 `-sscity` binary/runbook 仍是内嵌版本唯一升级通道 |
| Slash starter 携带 draft 参数；Goal 使用展开后的 command template | ✅ 已合并 | [#72](https://coding.s-s.city/songsong/openchamber/-/work_items/72)：command starter 将现有 draft 作为同行参数，skill starter 保持多行；interactive Goal 按目标 Session 的 directory 解析 command template，scheduled Goal 复用同一套 `$ARGUMENTS` / positional 语义，均在消息派发前写入目标。attachments、queue-time config 与 `serverId + directory` 路由未改 |
| OpenAI Business Codex spend limit | ✅ 已合并 | [#73](https://coding.s-s.city/songsong/openchamber/-/work_items/73)：Web 与 VS Code Codex provider 统一解析 `spend_control.individual_limit`，复用现有 `credits` window 渲染 `used / limit used`；`0` 作为真实额度保留，字段缺失/空对象不伪造 window。UI 仍按 active runtime base URL 请求，remote instance 不回落 local |
| Prompt Navigator 底部最新 turn anchor | ✅ 已合并 | [#74](https://coding.s-s.city/songsong/openchamber/-/work_items/74)：`scrollSpy` 底部 anchor 从固定 8px 调整为 `max(48px, viewport × 10%)`；进入近底部区间后保持最新 turn，离开边界立即恢复 reading-line 判定。保留 fork 的 timeline controller、完整 Prompt 键盘遍历与多实例上下文，不引入第二个 scroll writer |
| Settings 可见纵向 scrollbar | ✅ 已合并 | [#75](https://coding.s-s.city/songsong/openchamber/-/work_items/75)：移植上游 Settings 外层 `overflow-y-scroll overflow-x-hidden` 边界，并让 Settings 根作用域内的现有 `ScrollableOverlay` 继承常驻纵向 scrollbar；不改变聊天、侧栏或其他非 Settings surface |
| Linux AppImage tray Show/Hide/Close 与 system icons | ✅ 已合并 | [#76](https://coding.s-s.city/songsong/openchamber/-/work_items/76)：Linux tray 左键切换窗口显隐，右键提供 Show/Hide/Close；22px tray 图标适配 StatusNotifier host。Open-in 从 `xdg-mime` 默认文件管理器与 FreeDesktop theme/pixmaps 解析 PNG，找不到时保留安全 fallback。macOS/Windows tray 文案与行为不变 |
| Mobile relay image preview | ✅ 已合并 | [#77](https://coding.s-s.city/songsong/openchamber/-/work_items/77)：上游 `MobileFilesSurface` 在 fork 中不存在，因此在共享 `FilesView` 中通过 `runtimeFetch` 读取 bitmap，并将响应 Blob 转为受生命周期管理的 object URL；请求继续携带 owning runtime 的 base URL、directory 与 workspace 边界，relay 由现有 runtime tunnel 接管，未恢复 per-host sync fanout。SVG 与 Electron binary IPC 路径保持不变 |
| built-in build/plan system prompt 优化 | ✅ 已按权威 agent 元数据适配 | [#78](https://coding.s-s.city/songsong/openchamber/-/work_items/78)：默认关闭，只在本地 managed runtime 的 first-party plugin 上启用，并仅匹配 OpenCode agent registry 中标记为 `builtIn/native` 的 `build` / `plan`；自定义 agent（包括同名覆盖）、外部实例与 VS Code 均不变。只裁剪 provider boundary 之前的前缀，环境、项目、MCP、技能、历史和工具上下文保持 |
| Sidebar sticky header fixes | ✅ 已按 fork 多实例侧栏适配 | [#79](https://coding.s-s.city/songsong/openchamber/-/work_items/79)：Global Pinned、Recent 与项目/worktree headers 保持现有 `serverId + directory` 顺序和各自独立 sticky sentinel；vibrancy backing 只在 header 实际 stuck 时启用，关闭设置或离开 desktop shell 会清除 stale stuck state，没有覆盖上游单实例 sidebar modules |
| SDK `1.18.9`、iOS simulator dev loop、review CI timeout | ➖ 维护项 | SDK manifest/lock 在对应 capability 验证时统一评估；dev loop 和 CI timeout 不创建 runtime backlog，不用纯维护提交伪装成功能合并 |

**#75 验证证据（2026-07-30）**：`OverlayScrollbar` visibility focused tests 2 条、改动文件定向 ESLint、全 workspace type-check/build 通过。matching-surface QA 在真实 Chat Settings 长页面确认纵向 thumb 静置时 `opacity=1`，滚动到 `scrollTop=500` 并等待自动隐藏周期后仍为 `opacity=1`；滚动容器 `scrollWidth=clientWidth=923` 且未生成 horizontal thumb。实现使用 Settings 根级 context 覆盖该 surface 内直接创建 `ScrollableOverlay` 的页面，避免仅覆盖共享 `SettingsPageLayout` 而遗漏 OpenChamber/legacy settings 页面。

**#74 验证证据（2026-07-30）**：focused `scrollSpy` 测试覆盖物理底部、800px 视口的 80px anchor 边界、81px 退出边界，以及 100px 小视口下由 48px 最小值接管的 30px 场景；4 条测试、改动文件定向 ESLint、全 workspace type-check/build 通过。matching-surface QA 在真实 OpenCode 会话 `ses_04d1d70f4ffeK7C5QHSP6gBjRc` 操作 Prompt Navigator，选择最新刻度后确认聊天滚动区 `distanceFromBottom=0`，active tick 为最新的 `2/2`；未改动 timeline controller 或 rail 的键盘遍历实现。

**#69 验证证据（2026-07-30）**：focused helper tests 6 条覆盖完成态 output 权威、仅 Bash 使用 live metadata、增量追加与重写、stream throttle replacement 和超过 5 分钟的 elapsed time；改动文件定向 ESLint、全 workspace type-check/build 通过。matching-surface QA 在真实 OpenCode 会话 `ses_04d00c54dffehmxfAdlPLtKi4A` 展开运行中的 Bash 卡片：命令执行到 `13.0s` 时已显示 `verified-live-start`，状态仍为 running，`verified-live-finish` 尚未出现，确认不是完成后才渲染的 final output。实现保持 `ToolPart` 局部订阅和单文本节点增量更新，未改变多实例或 Session 数据流。

**#71 验证证据（2026-07-30）**：focused tests 65 条覆盖 capability、bundled canonical path、Web HTTP routes、UI fail-closed toast decision、VS Code managed/external contract 和 `-sscity` 同 core 版本比较；改动文件定向 ESLint与全 workspace type-check 通过。matching-surface HTTP QA 启动真实 Express route surface：bundled `1.18.5-sscity` 的 status 返回 `available:false`、`latestVersion:null`、`upgrade:{supported:false,manager:"openchamber",reason:"bundled"}`，POST upgrade 返回 409 `OPENCODE_UPGRADE_MANAGED_BY_OPENCHAMBER`；请求记录仅包含 `/global/health`，未访问 npm/GitHub 或 `/global/upgrade`。v1.17.1 最终总验收又修正 VS Code webview upgrade POST bridge 的残留 request-body 引用；VS Code 双 tsconfig type-check、该文件 ESLint 与 4 条 updater runtime tests 重新通过。

**#72 验证证据（2026-07-30）**：focused tests 27 条覆盖 command starter 同行参数、skill starter 多行、空 draft、`$ARGUMENTS` 全量替换、引号参数、末位 positional 吞并剩余参数、无模板 raw fallback，以及 scheduled command objective 展开；改动文件定向 ESLint、全 workspace type-check/build 通过。matching-surface driver 直接执行 UI starter builder 与 scheduled runtime export，观察 `/review src/components`、`/frontend\nAudit the page` 和 `Move src old to dist extra` 三类最终发送/目标文本。interactive Goal 在写 metadata 前以目标 Session 的 `goalDirectory` 查询 command，写入失败会重新 arm 且不派发消息；未改 attachments、queued item 或 send target 快照。

**#73 验证证据（2026-07-30）**：Web/VS Code Codex provider 与 active-runtime quota store focused tests 15 条通过，覆盖 Business 正常额度、全零额度、字段缺失/空对象、既有 5h/weekly windows，以及 local/remote endpoint 隔离和并发刷新；改动文件定向 ESLint、全 workspace type-check/build 通过。matching-surface driver 将 provider 输出交给 UI `formatQuotaValueLabel`，实际观察 `2675 / 7500 used`、`0 / 0 used`，缺失字段没有 window。未改变 quota route 或 active runtime base URL 解析。

**#68 验证证据（2026-07-30）**：Web lifecycle/proxy Vitest 27 条与 VS Code SSE focused tests 2 条通过。Web matching-surface 真实启动上游与 Express proxy：上游在 40/80ms 发字节时重置 watchdog，proxy 每 10ms 发 downstream heartbeat，最终仍在上游静默 100ms 后结束 response；响应同时包含 heartbeat 和两段上游数据，证明 heartbeat 不会伪造 OpenCode 活性。25 次同一时间点的 transport health trigger 只计一次，跨 15s 后才计第二次；现有 busy/missing-listener/lifecycle tests 全部保持通过。UI/VS Code type-check 通过。

**#70 验证证据（2026-07-30）**：sync meta 与 session actions focused tests 43 条通过。matching-surface 状态驱动验证观察到 authoritative `{complete:true,cursor:undefined}` 与 stale tail cursor 合并后仍保持 complete；模拟 Session `revert=msg_2`、optimistic shadow 含 `msg_2` 后发送新分支，最终 store 仅保留 `msg_1 + 新 message`、旧 part 删除、旧 shadow 删除而新 shadow 保留。失败路径在实现中先 rollback store 且不会确认旧 shadow。UI type-check 通过；未触碰 chat scroll controller。

**#77 验证证据（2026-07-30）**：`runtimeFetch` transport focused tests 22 条通过，其中新增 relay binary driver 以活动 tunnel 请求 `/api/fs/raw?path=...&directory=...`，实际收到 `image/png` Blob 与完整 body；UI type-check 与改动文件定向 ESLint 通过。matching-surface QA 在真实 HMR OpenChamber 中从会话 Markdown 文件引用进入实际 `FilesView` editor surface，确认该共享渲染面正常挂载；relay 专属传输边界由上述 tunnel driver 覆盖。实现只为非 Electron bitmap 创建 object URL，并在切换文件/卸载时 revoke；SVG data URL、Electron `readFileBinary`、多实例 `serverId + directory` authority 均未改。

**#76 验证证据（2026-07-30）**：Linux app discovery smoke 从缺少 `resolveLinuxIconFile` 的预期失败开始，完成后解析 Thunar `xdg-mime` 默认文件管理器、hicolor theme PNG 与 VS Code `Icon=code`，`buildLinuxInstalledApps` 和 `fetchLinuxAppIcons` 均返回真实 `data:image/png;base64,...`。Electron/UI type-check、改动文件定向 ESLint 与 JavaScript syntax check 通过。匹配平台使用 amd64 Docker 重建 `OpenChamber-1.17.0-sscity.20260730-220337-linux-x86_64.AppImage`，静态验证确认内嵌 OpenCode `1.18.9-sscity` 与 8 个 x64 native modules；Xvfb + Openbox 实际启动 AppImage payload，菜单和 frameless 窗口控件可见且 maximize/restore 可操作，随后真实 updater E2E 从 `1.16.0-sscity.e2e.1` 升到 `1.17.0-sscity.e2e.2` 并校验安装文件 hash。Linux tray 使用 22px 图标、左键 toggle 与右键 Show/Hide/Close；Windows 仍左键 Show 且保持 Show OpenChamber/Quit 菜单，macOS 逻辑未改。构建仅输出到 `artifacts/linux-appimage`，未替换 `/Applications`。

**#78 验证证据（2026-07-30）**：plugin optimizer、plugin bootstrap/overlay 与 settings sanitizer focused tests 共 44 条通过；machine-consumed tests 通过 OpenCode `builtIn/native` 标记验证 build/plan 路由、同名 custom agent fail closed、agent switch 清理、未知 provider boundary 不改写、agent registry 失败不改写，以及用户 plugin/config 字段保留。OpenCode `1.18.9-sscity` 源码确认 tuple plugin 配置会把第二项作为 factory options 传入；本实现只在 `settings.json` 为严格布尔值 `true` 时给现有 first-party plugin 附加 `{ optimizeSystemPrompt: true }`。Plugin/UI/Web type-check、plugin build 与改动文件定向 ESLint 通过。matching-surface QA 在 5190 真实 Behavior Settings 页面确认默认未勾选且 Save + Reload 禁用，切换后按钮启用、回切后恢复禁用；未执行保存或重启正在使用的 OpenCode。设置只在 managed Web/Electron surface 显示，VS Code 隐藏；remote `serverId + directory` 路由不变。

**#79 验证证据（2026-07-30）**：sticky state focused tests 3 条、12 个断言通过，覆盖 no-op Set 引用保持、不可变 add/remove 与 disabled stale-state 清理；UI type-check、改动文件定向 ESLint 与 workspace build 通过。matching-surface Playwright 使用真实 build、Electron runtime identity、40 个 local Session、1 个 remote project、Global Pinned 与 Recent：顶部顺序为 Global Pinned → Recent → local project → remote project，未 stuck 时三类 header 均无 backing；滚动 900px 后 local header 固定在 sidebar 顶部 1px 范围内且仅实际 stuck headers 获得 `oc-zone-header-backing`；关闭 Sticky project headers 后 sticky/backing 同步清空。720×900 与 375×812 均无横向溢出、无 page error。实现复用 fork 现有 local/remote section 和 Global Pinned 顺序，没有引入上游单实例目录权威或 sidebar modules。

**执行总览**：GitLab Overview [#1](https://coding.s-s.city/songsong/openchamber/-/work_items/1) 已推进到 v1.17.1，并加入 [#68](https://coding.s-s.city/songsong/openchamber/-/work_items/68)–[#79](https://coding.s-s.city/songsong/openchamber/-/work_items/79)。#68–#79 均已按实现、focused tests / workspace checks、matching-surface QA 和本台账证据闭环；v1.17.1 用户可观察能力已完成迁移。源码与六个 workspace manifest、Bun workspace lock、Electron 构建版本前缀和 standalone CLI 已统一提升到 `1.17.1-sscity`；`version:bump` 同时移除失效的 Tauri/Cargo 路径并纳入 Mobile workspace。

**v1.17.1 版本收口验证（2026-07-30）**：升级脚本幂等执行成功；六个 manifest 与 Bun workspace lock 一致性检查通过；Electron build-version 3 条测试通过；standalone CLI 实际输出 `1.17.1-sscity`，构建版本生成器实际输出 `1.17.1-sscity.20260730-000000`。全 workspace type-check、完整 Web/UI/VS Code/Mobile build、docs validation 与版本相关文件定向 ESLint 均通过。

### Fork 稳定性：Markdown 相对文件链接整页导航（2026-07-30）

| 故障 | 状态 | Fork 处理 |
|---|---|---|
| Chat 中蓝色相对 Markdown 文件链接触发 SPA reload | ✅ 已完成；Work Item [#80](https://coding.s-s.city/songsong/openchamber/-/work_items/80) | 根因是文件引用增强在 streaming / effect 尚未完成时不会标注 anchor，而常驻 capture guard 只拦截 `file://`，导致 `AGENTS.md`、`.okf/.../*.md` 等相对路径短暂保留浏览器默认导航。现将常驻 guard 与文件路径分类器统一：相对/绝对 workspace 路径始终阻止默认导航并交给 owning `serverId + directory` 文件打开链路；`http(s)`、`mailto:`、fragment、query 继续保持原生语义。目标单测 4 条、改动文件 LSP/lint、全 workspace type-check/build 通过。隔离 matching-surface QA 使用会话 `ses_0d2d201d1ffeNBX7bbbM72yzJA`，主动关闭文件引用标注模拟竞态窗口；点击未标注的 `.okf/infrastructure/server-topology.md` 后 Session URL 未改变、页面未 reload，并成功打开 `server-topology.md` 内部文件 surface |

### v1.17.2 差距审计与 Work Item 拆分（2026-08-02）

官方 `v1.17.1...v1.17.2` 共 43 个提交。Release notes 的 17 项用户可观察能力中，当前 fork 已等价 3 项、部分具备 6 项、未合并 8 项。GitLab Overview [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) 已重新打开并推进到 v1.17.2；所有部分具备或未合并能力均有独立 Work Item，三个已等价项不重复制造 backlog。

| 官方能力 | 审计状态 | Fork 处理 / Work Item |
|---|---|---|
| Mobile 双抽屉导航、跨项目树、滑动操作、最近 Session 与冷启动恢复 | ✅ 已按 fork 多实例架构移植 | [#93](https://coding.s-s.city/songsong/openchamber/-/work_items/93)。复用共享 `MainLayout` 与多实例 `SessionSidebar`，增加 Sessions/Workspace 双抽屉、跨项目树、rename/archive/delete 滑动操作、带 live indicator 的最近 Session 切换器，以及按 runtime + `serverId + directory` 持久化的 last-active-session 恢复；保留 LAN/relay、显式连接失败页和禁止 per-host sync fanout，不覆盖上游单实例 MobileApp |
| Windows ARM64 | ✅ 已移植并保留 custom OpenCode | [#98](https://coding.s-s.city/songsong/openchamber/-/work_items/98)。Windows release matrix 增加 x64/arm64 独立 channel；ARM64 继续构建并校验 `1056674754/opencode` `sscity`，embedded CLI 使用 Windows x64 baseline 兼容路径，未替换为官方 binary，shared database 与双签名顺序保持不变 |
| OpenChamber light/dark 成为默认主题 | ✅ 已按兼容策略移植 | [#94](https://coding.s-s.city/songsong/openchamber/-/work_items/94)。新增上游 hybrid 主题为 `openchamber-hybrid-light/dark` 并设为缺省值；保留 fork 原有 `openchamber-light/dark` Fields of the Shire ID，因此既有持久化选择、custom theme 与 hot reload 不被静默改写 |
| Active Session Header 菜单：rename/share/export/archive/delete/copy ID | ✅ 已按 fork 架构移植 | [#95](https://coding.s-s.city/songsong/openchamber/-/work_items/95)。Header 复用既有 Session action 与 worktree move 核心，提供 rename、share/unshare、export、archive、delete、copy ID 和 root tree move；创建 share 后自动复制链接。所有操作从当前 Session 的 `serverId + directory` 解析目标，不新增第二套 Session authority |
| 首个 Session 打开性能与 desktop startup 调度 | ✅ 已按 fork 架构移植 | [#99](https://coding.s-s.city/songsong/openchamber/-/work_items/99)。共享 background-network gate 最多并发 3 个全局 Session、Git/worktree、command/skill discovery 请求；selected Session bootstrap/message pagination 保持前台直通。Electron 仅对 `127.0.0.1,localhost` 解除 Chromium connection limit；保留 fork 多实例 bootstrap queue、timeline 与远端默认连接策略 |
| Root Session 连同 sub-sessions 移到新 worktree | 🟡 核心已具备 | [#95](https://coding.s-s.city/songsong/openchamber/-/work_items/95)。`moveSessionTreeToQuickWorktree` 已实现父子迁移、queue/folder rewrite 与 rollback；仅补 active Header 入口，不重写核心 |
| Symlink diff 显示 link target | ✅ 已移植 | [#100](https://coding.s-s.city/songsong/openchamber/-/work_items/100)。`lstat/readlink` 识别 symlink，untracked link 生成 Git mode `120000` patch，split diff 读取 link target 而非目标文件内容；workspace 边界仍由 Git service 权威校验 |
| Linux Window Controls Style | ✅ 已移植 | [#101](https://coding.s-s.city/songsong/openchamber/-/work_items/101)。Appearance 增加 Classic / traffic-lights 持久设置并补齐 9 个 locale；只有 Electron Linux 启用样式分支，Windows 继续使用 classic 控件，macOS 原生标题栏行为不变 |
| Settings → General 全局 Auto-save，排除 binary/PDF/Office | ✅ 已移植并加固 | [#96](https://coding.s-s.city/songsong/openchamber/-/work_items/96)。局部 localStorage toggle 已迁入全局 UI/settings 持久层；只有当前文件完全加载且路径仍匹配时才允许保存，binary/PDF/Office/image 明确排除自动保存并进入只读下载 surface，避免 load-lag 覆盖文件 |
| Terminal tab 切换不重建连接 | ✅ 已按多实例架构移植 | [#102](https://coding.s-s.city/songsong/openchamber/-/work_items/102)。PTY scrollback 从持久 tab metadata 拆到 `serverId + directory + tabId` hot buffer；切 tab 的健康 per-baseUrl WebSocket 保留 15 秒复用，关闭/重启仍立即执行原语义。Project Action run key 同步分域，Ghostty 增量 chunk 查找从尾部开始 |
| Sidebar 折叠时显示 live activity | ✅ 已按 fork 多实例侧栏适配 | [#103](https://coding.s-s.city/songsong/openchamber/-/work_items/103)。新增只订阅各 child store `session_status` 的窄聚合，以 `serverId + directory + sessionId` activity key 驱动折叠态 indicator；remote unread 不回退到 local ID-only store，未引入上游单实例 sidebar 或扩大 message streaming render fanout |
| VS Code per-session Autoaccept 回复 live permission | ✅ Fork 已等价；审计结论已纠正 | [#97](https://coding.s-s.city/songsong/openchamber/-/work_items/97)。VS Code webview 已在 `permission.asked` live event 直接调用 runtime helper；保留 lineage policy、target routing、retry 与 dedupe，并补充相同 permission ID 在不同 `serverId + directory` 下互不吞并的回归测试 |
| Z.ai usage 显示全部窗口 | ✅ 已移植 | [#104](https://coding.s-s.city/songsong/openchamber/-/work_items/104)。Web/VS Code 遍历全部 `TOKENS_LIMIT`，显示 5 小时、周和 MCP Tools 窗口；保留零值、过滤 malformed window，并继续按 active runtime 隔离 local/remote |
| Sticky Session Header 页面切换不闪烁/位移 | ✅ 已在 fork sticky 基础上修复 | [#105](https://coding.s-s.city/songsong/openchamber/-/work_items/105)。sticky 判定改为明确的 scroll root / sentinel 几何关系，顶部 shadow 由稳定 CSS overlay 控制；页面切换不重建 header backing，也没有增加 scroll writer 或单实例顺序假设 |
| Composer padding 点击正确放置 caret | ✅ Fork 已等价 | `ComposerEditor.handleHostMouseDown` 已通过 `posAtCoords` 设置 selection 并 focus；不重复开 Work Item |
| `/` command 与同名 skill 去重 | ✅ Fork 已等价 | `dedupeCommandAutocompleteEntries` 以 normalized command name 去重，优先级 system → command → skill；不重复开 Work Item |
| Tool description 显示 glob pattern | ✅ Fork 已等价 | `toolInputPresentation` 已将 `pattern` 纳入 summary priority，ProgressiveGroup 也显式展示 glob；不重复开 Work Item |

**第一批执行顺序**：[#104](https://coding.s-s.city/songsong/openchamber/-/work_items/104) Z.ai 全窗口 → [#100](https://coding.s-s.city/songsong/openchamber/-/work_items/100) symlink diff → [#102](https://coding.s-s.city/songsong/openchamber/-/work_items/102) Terminal 连接保活 → [#99](https://coding.s-s.city/songsong/openchamber/-/work_items/99) 首 Session / desktop startup 性能。每项只有在 focused tests、workspace checks、matching-surface QA 和本文证据均完成后才关闭，并同步勾选 Overview #1。

**第一批验证证据（2026-08-02）**：#104 的 Web/VS Code provider fixtures 已验证 5 小时、周、MCP Tools 三窗口；#100 使用真实临时 Git 仓库验证 untracked directory symlink 的 patch/split 两条路径；#102 的 store/transport driver 验证 90 次输出不改持久 Session 引用、local/remote buffer 隔离和 tab 切换复用同一 WebSocket；#99 的并发门 driver 验证最多 3 个后台请求且 FIFO 释放，Electron 参数静态进入启动路径。第一批 focused tests 共 12 条 UI/store 基线、2 条 Web feature path（另 41 条同文件测试跳过）和 5 条 VS Code provider 测试通过；全 workspace type-check、lint、完整 build、Electron 主进程 syntax check、docs validation 与 `git diff --check` 均通过。四个 matching surface 分别由 provider fixture、真实 Git 仓库、fake WebSocket/真实 Zustand store 和后台调度 driver 覆盖；未替换或重启当前 `/Applications/OpenChamber.app`。

**第二批验证证据（2026-08-02）**：#95 的 active Header 菜单在独立 5192 HMR 实例中实际显示 Rename、Copy session ID、Share、Export Markdown、Move to new worktree、Archive 和 Delete；未执行会改变真实 Session 的操作。Header 解析当前 Session owning server，并复用现有 share/export/archive/delete 与父子 Session worktree move 核心；侧栏创建 share 同步自动复制链接。#96 将 auto-save 纳入全局 settings/persistence，独立实例 Appearance 页面实际显示且保持 `Auto-save files` 开启；focused tests 覆盖未加载完成、路径错位、只读、binary/PDF/Office/image 与 decoded binary 阻断。#97 代码审计确认 VS Code live `permission.asked` 已接入 auto-accept runtime，新增测试验证相同 permission ID 在 local/remote target 下分别回复。三组 focused tests 共 12 条通过；全 workspace type-check、lint、build、docs validation 与 diff whitespace 检查通过。未替换或重启当前 runtime。

**第三批验证证据（2026-08-02）**：#94 将上游 OpenChamber hybrid light/dark 作为新缺省主题，同时保留 fork 原有 Fields of the Shire IDs。独立 5193 HMR 实例实际显示两套主题；OpenChamber dark 切换后使用新背景 token 并在刷新后保持，随后切回 Fields of the Shire 再刷新也仍保持旧选择。#101 的 normalization、settings store migration、Web sanitizer focused tests 覆盖合法样式与非法值回落；Linux-only capability gate 保证 Web、Windows 和 macOS 不进入 traffic-lights 分支。全 workspace type-check、lint、build、docs validation 与 diff whitespace 检查通过。未替换、重启或修改 `/Applications/OpenChamber.app`。

**第四批验证证据（2026-08-02）**：#98 的 Windows release/embedded OpenCode tests 共 10 条通过，覆盖 x64/arm64 channel、ARM64 x64-baseline CLI 选择、custom `-sscity` 校验与 updater finalizer；workflow 静态检查确认两个 Windows 架构分别产物化。#103 的 activity key/折叠 indicator tests 3 条通过，覆盖 local/remote 同 ID 隔离、remote unread 不串入 local 和 idle 清除；实现只订阅 `session_status` leaf。#105 在 5195 独立 production build 实例中滚动侧栏 700px 后，`Openchamber` header 固定于 scroll root 顶部 88px，切换项目后仍为 88px，未观察到闪烁或位移。#93 的 cache/restore/swipe focused tests 8 条通过，覆盖 runtime 分桶、容量上限、重复 Session ID 的 `serverId + directory` 权威选择、stale target 拒绝和 swipe clamp/reveal；iOS 26.5 Simulator build 成功并实际连接 5195，观察到 Sessions/Workspace 双抽屉、跨项目树、最近 Session popover、Diff/Files/Terminal/Notes/MCP 五标签，以及 Terminal → Files → Terminal 返回时原 pane 保持挂载。冷启动不可达时显示保存实例与明确错误，不闪空白 draft。全 workspace type-check、lint、production build 与 iOS Simulator build 通过；未替换或重启当前 `/Applications/OpenChamber.app`。

### v1.18.0 差距审计与 Work Item 拆分（2026-08-04）

**比较边界**：用户给出的起点是 `1.17.1-sscity`，但本文和 GitLab 已有完整证据确认 fork 后续又完成了官方 `v1.17.2`。因此本轮不重复迁移 `v1.17.2`，实际审计区间为上游 `v1.17.2..v1.18.0`（tag `7f0d87cbeffec08a320c39fbb955664e458a4637`，121 commits）。GitLab Overview [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) 已重开并推进到 `v1.18.0`。

| 官方 v1.18.0 功能 | 状态 | Fork 处理 / Work Item |
|---|---|---|
| Diff / branch / PR Guided Walkthrough；按界面语言生成并可切换语言 | ⬜ 待合并，高风险 | [#107](https://coding.s-s.city/songsong/openchamber/-/issues/107)。复用 fork 现有 Diff、PR 与生成能力；只允许用户显式启动，不覆盖多实例 Git/PR authority |
| Tablet / foldable 双侧栏、旋转后保留 diff/file/terminal | ✅ 已合并并验证 | [#108](https://coding.s-s.city/songsong/openchamber/-/issues/108)。`device.ts` 新增 `TabletLayout` 接口 + `readTabletLayout()` + `useTabletLayout()` hook（foldable-ready size class：`isIPadApp()` OR min viewport side ≥600 → `enabled`；landscape + width ≥1000 → `roomyForPanels`）；`MainLayout.tsx` 把 `useIpadSplitLayout` 泛化为 `useTabletSplitLayout`（用 `useTabletLayout().enabled` + `roomyForPanels`），Android tablet/foldable 现在也能获得 persistent SessionSidebar split（fold 是 resize，sw600dp 以下回退 phone drawers），保留 fork 多实例 drawer 编排；`index.css` 的 `changed-label` 阈值 24rem→30rem（#2590 窄屏 status row overlap fix）。**QR without Play Services 已被 fork 现有实现覆盖**——fork 的 `mobileQrScan.ts` 已有 superior bundled CameraX scanner（`scanWithCameraPreview`）+ BarcodeDetector fallback，AndroidManifest 已声明 bundled `barcode` model。**Android edge swipe zones 不适用**——fork 没有 `useEdgeSwipe.ts`，drawers 是 toggle-opened（deliberately removed edge-pan for perf）。`hardwareKeyboard.ts` 跳过（iOS GCKeyboard native bridge，fork 无 native publishing） |
| Android 无 Play Services QR 扫描；扩大抽屉手势起点 | ✅ Fork 已等价 / 不适用 | 见上行 #108。QR 已有 bundled CameraX；edge swipe fork 无对应实现 |
| Settings 添加/编辑 OpenAI-compatible provider | ✅ 已合并并验证 | [#109](https://coding.s-s.city/songsong/openchamber/-/issues/109)。Web/VS Code 添加 `validateCustomProviderConfig` + `upsertProviderConfig`（fork 已有的 `getProviderSources` / `removeProviderConfig` 已对齐 directory 签名）；`PUT /api/provider` 路由 + `/api/provider` 加入 express.json allowlist；`shared.js` 的 `getConfigPaths.customPath` 改为调用时解析 `OPENCODE_CONFIG`（上游 `9101eac3`）；UI 新增 `CustomProviderForm.tsx` + `custom-provider-form.ts`（自包含，不依赖 fork 未移植的 `SettingsStackedField` 等 shared primitives），通过 `resolveApiUrl` 发到 active runtime；ProvidersPage 集成 create/edit 入口；9 个 locale settings 补齐 49 个 custom provider i18n key |
| Bun chunk 修复与重型库 lazy load | ✅ 已合并并验证 | [#110](https://coding.s-s.city/songsong/openchamber/-/issues/110)。`vite.config.ts` 与 `packages/web/vite.config.ts` 的 `manualChunks` 改为从最后一个 `node_modules/` 段解析真实包名（修复 Bun `.bun/<pkg>@<ver>/node_modules/<pkg>` 隔离安装下首段恒为 `.bun`、把所有依赖塌缩成单个巨型 eager chunk 的 bug），并把 Vite `__vitePreload` / `modulepreload-polyfill` 运行时助手独立成 `vendor-vite-runtime` chunk 避免 Rollup 把它塞进任意 vendor（原本会拖 shiki core + 629KB oniguruma 进 eager bootstrap）。`MessageBody.tsx` 的 `html-to-image` 改为按需 dynamic import（用户触发"导出为图片"时才加载，移出 eager app shell）。保留 fork 独有差异：`vendor-syntax`（react-syntax-highlighter）chunk 规则保留——fork 未迁 Shiki，10 个 UI 文件仍 import 该库；Capacitor `.bun` 点号 workaround 保留——Android aapt ignoreAssetsPattern 视 `.` 开头为隐藏资产 |
| 大量 worktree 展开不反复拉 Session；非项目目录不刷 Git 错误；新 worktree Session 即时出现；CLI provisioning 不误报 timeout | ✅ 已合并并验证 | [#111](https://coding.s-s.city/songsong/openchamber/-/issues/111)。`git/service.js` 的 `createGit` 要求 baseDir + `createGitForGlobalConfig` + `createRepositoryGitContext` directory 校验 + `getStatus` 预检 `isGitRepository` + `parseGitErrorText` fallback；`git/routes.js` 提取 `resolveDirectoryQuery` / `extractGitErrorText` / `isNonRepoGitError` / `nonRepoStatusPayload` 共享 helper，check + status 路由 soft-handle 非仓库错误；新增 `session-directory-resolution.ts`（pure precedence 模块）+ `send-failure-log.ts`；`sync-refs.ts` 新增 `getSyncSessionDirectory`（适配 fork 多 server registry）；`session-ui-store.ts` 重构 directory resolution 为 record-first 权威 + `adoptAuthoritativeSessionDirectory`；`sync-context.tsx` bootstrap 完成 时调用 adoption；`useQueuedMessageAutoSend` 加 retry scheduler；`control-commands.js` 加 worktree provisioning timeout |
| German UI 与文档 | ⬜ 待合并 | [#112](https://coding.s-s.city/songsong/openchamber/-/issues/112)。必须补齐 fork 自有设置/功能文案，不能只复制上游基础 locale |
| shared worktree 去重；archive/unarchive 限定当前 instance/workspace | ✅ 已合并并验证 | [#113](https://coding.s-s.city/songsong/openchamber/-/issues/113)。`worktreeManager.ts` 新增 `partitionWorktreesByRegisteredProject`（多 configured 项目共享同一 Git 仓库时，仅一个 owner 持有 worktree topology，且配置项目本身是 worktree 时从父项目列表中剔除）；`SessionSidebar.tsx` 的 `publishWorktreeResult` 应用 partition 后再存；`session-actions.ts` 新增 `isStaleRuntime` + `expectedRuntimeKey` 参数（默认 `getRuntimeKey()`），`archiveSession` / `patchSessionMetadata` 在每个 await 边界检查 stale，`archiveSessions` 批量在首个 stale 时停止；`session-ui-store.ts` 的 `archiveSessions` 改为委托 action + `ArchiveSessionsOptions` 类型；`globalSessions.ts` 在数据边界过滤 archived records（`isArchivedSession`），`onPage` 只收 accepted records |
| Diff 打开定位 header；live refresh 只刷新变化文件并保持 review position；editor save 更新 diff | ✅ 已合并并验证 | [#114](https://coding.s-s.city/songsong/openchamber/-/issues/114)。只移植 `68d7247a`（targeted refresh）的 2 个有效 commit——3 个 VS Code apply_patch commit 已被 #120 覆盖。`toolDiffUtils.ts` 加 `getMutatedToolPaths`；`useGitStore.clearDiffCache(directory, filePaths?)` 支持只清指定路径；`sessionEvents.GitRefreshHint` 加 `paths?`；`ToolPart.tsx` 改 `observedActiveGitToolRef`（防历史 remount 触发 refresh），发 targeted `paths`，移除 `'task'` from `GIT_REFRESH_MUTATING_TOOLS`；`DiffView.tsx` / `GitView.tsx` / `PendingChangesBar.tsx` 处理 `hint.paths` + `silent` fetch；新增 `diffScrollAnchor.ts`（**pure 位置 helper，不是 scroll writer**）+ `fileDiffRefreshNonce` key bump + `useLayoutEffect` anchor 还原；`FilesView.tsx` save 后发 targeted refresh。`fe867cd4`（multi-file patch interactions）**已被 fork 现有实现覆盖**（#120 的 uniform whole-row clickable + stopPropagation + hover swap）—— 不重复移植 |
| Terminal 在 view mount 前启动并保留 startup output | ⬜ 待合并 | [#115](https://coding.s-s.city/songsong/openchamber/-/issues/115)。叠加现有按 `serverId + directory + tabId` 的连接复用，不回退单全局 terminal |
| Linux AppImage 清理 OpenCode / PTY shell ARGV0 | ⬜ 与 Terminal 批次处理 | [#115](https://coding.s-s.city/songsong/openchamber/-/issues/115)。必须在真实 AppImage matching surface 验证 zsh startup |
| Bash 完成态应用 CR/backspace/cursor/erase 并清 ANSI/OSC | ✅ 已合并并验证 | [#116](https://coding.s-s.city/songsong/openchamber/-/issues/116)。只规范化完成态，运行中继续保留 fork 的 live append / rewrite 行为 |
| queue 临时失败/中断后重试 | ✅ Fork 已等价 | `useQueuedMessageAutoSend` 已保持原 queued item、`sendConfig`、`sendTarget`，失败按 2s→4s→…→60s 退避；不重复建卡 |
| relay 断连后避免重复回复；in-flight queue 不并入另一发送 | ✅ Fork 已等价或更强 | ambiguous send 以同一 `messageID` 沿权威 runtime 回查；queue 有 session-scoped in-flight guard，不重复建卡 |
| active-project `.agents/skills`；rename 保留内容/支持文件并限制安全 root | ✅ 已合并并验证 | [#117](https://coding.s-s.city/songsong/openchamber/-/issues/117)。`skills.js` 新增 `renameSkill`（rename directory in place 保留 SKILL.md body + 支持文件，frontmatter mismatch 回滚，managed-roots 校验）+ `isManagedSkillPath` / `getManagedSkillRoots` + `assertValidSkillName`；`skill-routes.js` 加 `resolveSkillsDirectory` soft-fallback（optional → `resolveProjectDirectory`），list 响应暴露 `renamable`，PATCH 处理 `renameTo`；`useSkillsStore.ts` 把 `getCurrentDirectory` 改为 `getRequestDirectory`（active-project，对齐 sibling stores），加 `renamable` 字段 + `renameSkill` action（用 fork 的 `resolveApiUrl` + `fetch` + `serverBaseUrl`，不用上游 `runtimeFetch`）；`useSkillsCatalogStore.ts` 同步 active-project resolution；`SkillsSidebar.tsx` rename gating 从 server `renamable` flag 驱动（移除 client heuristic），用 `renameSkill` action 替代 create+delete；VS Code `opencodeConfig.ts` + `bridge-config-runtime.ts` 同步 renameSkill + isManagedSkillPath + renamable |
| DeepSeek quota；Kimi 同时兼容 `used` / `remaining` | ✅ 已合并并验证 | [#118](https://coding.s-s.city/songsong/openchamber/-/issues/118)。Web 与 VS Code provider 同步，UI 仍从 active runtime quota route 读取 |
| Browser export 显示 Download 且不显示 desktop reveal | ✅ 已合并并验证 | [#119](https://coding.s-s.city/songsong/openchamber/-/issues/119)。Web runtime 仅在非 Electron shell 时使用 browser file 行为；文件树与 FilesView 均显示 Download 并隐藏 Finder/Explorer reveal，remote 文件仍沿 owning runtime 下载 |
| Assistant messages 不渲染 active HTML | ✅ Fork 已等价 | 当前 `ReactMarkdown` 未启用 `rehypeRaw`，raw HTML 默认保持惰性且不会进入 DOM；不迁入上游 `marked + DOMPurify` 架构，只补安全回归测试时再开卡 |
| VS Code apply_patch 每个文件打开各自路径 | ✅ 已合并并验证 | [#120](https://coding.s-s.city/songsong/openchamber/-/issues/120)。每个 metadata file 保留 authoritative `filePath` / `movePath`，点击时按该项独立解析 patch、行号和 workspace absolute path，不再复用第一项路径 |
| Session title 行尾不裁切 | ✅ Fork 已等价 | `SessionNodeItem` 已使用 `min-w-0` / `overflow-hidden` / `truncate` 的稳定 flex 边界，不重复建卡 |

**第一批执行顺序**：[#116](https://coding.s-s.city/songsong/openchamber/-/issues/116) Bash 完成态规范化 → [#118](https://coding.s-s.city/songsong/openchamber/-/issues/118) DeepSeek/Kimi quota。两项均是局部纯数据转换，不触碰自定义 sidebar、多实例 Session ownership 或 OpenCode embedded packaging；完成 focused tests、matching-surface driver、workspace checks 和本文证据后才关闭。

**第一批验证证据（2026-08-04）**：#116 在共享 `getToolOutput` 边界只对非 running Bash 输出执行终端归一化，支持 CR、backspace、CSI cursor/erase、SGR 与 OSC；running 输出保持原字符串，继续由既有局部 throttle 处理。#118 新增 Web DeepSeek registry/provider，并在 Web 与 VS Code 的 Kimi provider 中统一采用 `used` 优先、`remaining` fallback；DeepSeek 优先 USD、回退 CNY，余额保持 label-only，不伪造百分比。focused tests：UI 6 条、Web provider/registry 7 条、VS Code provider 8 条全部通过；UI 与 VS Code 定向 type-check 通过。matching-surface driver 在临时 HOME 通过真实 Web provider registry 观察到 Bash `downloaded\nready`、DeepSeek `$7.54`、Kimi weekly 25% 和 5h 75%。全 workspace type-check、lint、production build、docs validation 与 `git diff --check` 均通过；未修改 sidebar、多实例 Session authority、embedded OpenCode 或安装 runtime。

**第二批验证证据（2026-08-04）**：#119 在隔离 `5196` HMR Web 实例的真实文件树右键菜单中观察到 `Rename / Copy Path / Copy Relative Path / Download / Delete`，且不存在 Finder/Explorer reveal；Electron shell 即使复用 Web runtime descriptor 也由独立 capability gate 保持 desktop 行为。#120 的多文件 driver 使用两个带独立 authoritative path 和 patch 的 metadata entry，实际解析为 `/workspace/project/src/first.ts` + `old-a` 与 `/workspace/project/src/second.ts` + `old-b`；共享 `ToolPart` 在 VS Code runtime 对每个标签分别调用 `openDiff` / `openFile`，移动文件优先打开 destination。focused tests 12 条通过；完整 workspace type-check、lint、production build 与 VS Code extension/webview build 均通过。build 仅保留既有 Vite dynamic-import/chunk-size 警告；隔离 dev 实例已关闭，未替换当前 runtime。

**第三批验证证据（2026-08-05）#110**：移植上游 `317ee201`（`.bun` chunk 解析 + Vite preload 隔离）与 `1edf2785`（`html-to-image` lazy-load）到 fork，**未移植** `screenshot-capture.ts` 部分因 fork 无 preview 标注截图功能、无 `@zumer/snapdom` 依赖。`bun run build` 后实际 chunk 分布：未观察到 `vendor-.bun` 巨型 chunk（bug 已修），最大 vendor chunks 按真实包名正确拆分：`vendor-shikijs-langs` 7.4MB（lazy）、`vendor-mermaid` 1.4MB（lazy）、`vendor-heic2any` 1.35MB（lazy）、`vendor-shikijs-themes` 1.3MB（lazy）、`vendor-shikijs-engine-oniguruma` 629KB（lazy）、`vendor-ghostty-web` 638KB、`vendor-codemirror-legacy-modes` 484KB、`vendor-cytoscape` 443KB。新增 `vendor-vite-runtime` 1.8KB chunk 验证 `__vitePreload` 已隔离。保留 `vendor-syntax` 17KB（react-syntax-highlighter，fork 未迁 Shiki）。fork 独有 Capacitor `.bun` 点号 workaround（Android aapt）保持不变。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors、`bun run build` 通过。`cli-standalone.mjs` Bun compile 入口未改、react-markdown 渲染器未换。未替换 `/Applications/OpenChamber.app`。

**第四批验证证据（2026-08-05）#109**：移植上游 `2f5677a3` + `07248a3b` + `9101eac3` + `fe2ae248` + `5c4b822b`。server：`providers.js` 新增 `validateCustomProviderConfig` + `upsertProviderConfig`（签名保留 fork 的 `workingDirectory` scope），`routes.js` 新增 `PUT /api/provider`（使用 fork 的 `getProviderAuthStates` adapter 检查 `hasStoredAuth`，不直接 import `getProviderAuth`），`shared.js` 的 `getConfigPaths.customPath` 改为调用时解析 `OPENCODE_CONFIG`（`9101eac3`），`core-routes.js` 将 `/api/provider` 加入 express.json allowlist（`fe2ae248`），`index.js` + `feature-routes-runtime.js` 导出/接线 `upsertProviderConfig`。UI：新增 `custom-provider-form.ts`（pure logic：`resolveProviderConfigScope` / `isConfigDefinedCustomProvider` / `buildProviderUpsertRequest`）+ `CustomProviderForm.tsx`（自包含组件，不依赖 fork 未移植的 `SettingsStackedField` / `SETTINGS_FIELDS_STACK_CLASS` 等 shared primitives，使用 fork 已有的 `SettingsSection` API），`ProvidersPage.tsx` 集成 create/edit 入口（add dropdown + edit button for config-defined custom providers），9 个 locale settings 文件 × 49 个 custom provider i18n key。VS Code：`opencodeConfig.ts` 新增 `validateCustomProviderConfig` + `upsertProviderConfig`（复用 fork 已有的 `getProviderSources` / `removeProviderConfig` + `getConfigForPath` / `writeConfig` / `readConfigLayers`）。focused tests：`providers.test.js` 11/11 ✅（含 fork 多实例 directory scope 隔离测试）、`core-routes.test.js` 4/4 ✅（JSON body 解析）、`opencodeConfig.providers.test.ts` ✅。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。matching-surface QA 延后到集成 QA 阶段（需真实 OpenCode runtime）。

**第五批验证证据（2026-08-05）#111**：移植上游 `8d604397` + `d33cf518` + `57bc8227` + `2d183a15` + `1b22bf21`。git 后端：`service.js` 的 `createGit` 改为要求 baseDir（不再允许 no-baseDir 裸 simpleGit），新增 `createGitForGlobalConfig()` 用 `os.homedir()`，`createRepositoryGitContext` 校验 directory 必填，`getStatus` 预检 `isGitRepository` 并在非仓库时抛出规范化错误，`parseGitErrorText` 加 `String(error)` fallback；`routes.js` 提取 `resolveDirectoryQuery` / `extractGitErrorText` / `isNonRepoGitError` / `nonRepoStatusPayload` 为共享 helper，check + status 路由 soft-handle 非仓库错误（不再刷错误）。sync 层：新增 `session-directory-resolution.ts`（pure precedence 模块：authoritative → selected → attachment → metadata → remembered）+ `send-failure-log.ts`（pure failure 记录）；`sync-refs.ts` 新增 `getSyncSessionDirectory`（适配 fork 多 server registry，遍历 `getAllSyncStores()` 查 child store 是否含该 session——**containment ≠ ownership**，这是 `57bc8227` 的核心修复）；`session-ui-store.ts` 重构 directory resolution 为 record-first 权威（`getAuthoritativeSessionDirectory` 先查 record 再查 store），新增 `adoptAuthoritativeSessionDirectory` 方法（`2d183a15` 的 guessed-directory settle），`setCurrentSession` 跟踪 guessed selection 但不持久化；`sync-context.tsx` 在 bootstrap 完成时调用 `adoptAuthoritativeSessionDirectory()` 让 guessed directory 一旦 owner 已知就 settle；`useQueuedMessageAutoSend` 加 retry scheduler（失败按指数退避）；`control-commands.js` 加 worktree provisioning timeout（`wait=true` + worktree 时给 120s 而非 default）。focused tests：`session-directory-resolution.test.ts` 9/9 ✅、`control-commands.test.js` 5/5 ✅（worktree timeout）、`session-ui-store.test.js` 15/15 ✅、`service.test.js` 24 pass（HEAD 基线 22 pass，agent 额外修了 2 个；20 个 fail 是 pre-existing 环境问题，stash 验证 HEAD 上就 20 fail）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。matching-surface QA 延后到集成 QA 阶段。

**第六批验证证据（2026-08-05）#113**：移植上游 `7bb9b898` + `9e5751f0` + `e6b73679` + `906cabf1` + `babe06a2`。`worktreeManager.ts` 新增 `partitionWorktreesByRegisteredProject(projects, byProject)` —— 多 configured 项目共享同一 Git 仓库时，按 `configuredProjectOrder` 选 owner（repo root 是 configured 则它 own，否则首个 configured checkout own），配置项目本身是某项目 worktree 时从父列表剔除；`SessionSidebar.tsx` 的 `publishWorktreeResult` 在存入 store 前应用 partition（适配 fork 的 incremental publish 模式，每次 publish 都用完整 `projectQueue` 重 partition，正确且无闪烁）。`session-actions.ts` 新增 `isStaleRuntime(expectedRuntimeKey)` + `ArchiveSessionsOptions` 类型；`archiveSession` 和 `patchSessionMetadata` 加 `expectedRuntimeKey` 参数（默认 `getRuntimeKey()`，即 `e6b73679` 的 default guard），在 SDK 调用前和 store reconciliation 前各检查一次 stale；新增 `archiveSessions(ids, options)` 批量 action 在首个 stale 时停止。`session-ui-store.ts` 的 `archiveSessions` 类型改为 `ArchiveSessionsOptions`，实现委托给 action。`globalSessions.ts` 在数据边界用 `isArchivedSession` 过滤 archived records，分 `appended` / `accepted` 计数，`onPage` 只收 accepted（`906cabf1`）。未移植：`cleanupReviewMetadataBeforeDelete`（fork 无此函数）、`ElectronMiniChatApp` / `MobileSessionsSheet` partition（fork 无此文件，shared `SessionSidebar` 已覆盖全部 runtime）。focused tests：`worktreeManager.partition.test.ts` 3/3 ✅（primary ownership / first checkout fallback / cross-checkout ownership）、`globalSessions.test.ts` 7/7 ✅（含 5 个 archived query boundary 测试）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。

**第七批验证证据（2026-08-05）#114**：只移植 `68d7247a`（keep diff refreshes targeted）的 2 个有效 commit。`fe867cd4`（multi-file patch interactions）**已被 fork 现有实现覆盖**——fork 的 `ToolPart.tsx` 已实现 uniform whole-row clickable（所有 tool 不只 multi-file）+ toggle `stopPropagation` + arrow-right-s/down-s hover swap，这是 #120 的等价或更强实现，不重复移植。3 个 VS Code apply_patch commit（`086b6597` / `911e580e` / `4e9f4510`）已被 #120 覆盖。`toolDiffUtils.ts` 加 `getMutatedToolPaths(toolName, input, metadata)`：apply_patch 返回所有 file 含 move 两端，其他 tool 返回 primary path。`useGitStore.clearDiffCache(directory, filePaths?)` 改为只清指定路径（`filePaths` 省略时清全部，保持 back-compat）。`sessionEvents.GitRefreshHint` 加 `paths?: string[]`。`ToolPart.tsx`：`lastGitRefreshSignatureRef` → `observedActiveGitToolRef`（只在组件实际观察过 active 状态后才 refresh，防历史 remount 触发），发 targeted `paths`，移除 `'task'` from `GIT_REFRESH_MUTATING_TOOLS`。新增 `diffScrollAnchor.ts`（**pure 位置 helper，不是 scroll writer**——`findDiffScrollAnchor` 返回 `{path, topOffset}`，`getRestoredDiffScrollTop` 做纯数学还原；所有 scroll 写入仍走 DiffView 现有 `scrollRoot.scrollTop =`）。`DiffView.tsx` 加 `fileDiffRefreshNonce` Map state bump React `key` → 强制 remount 拿 fresh diff；`captureScrollAnchor()` 在 refresh 前 capture，`useLayoutEffect` 在 refresh 后 restore。`GitView.tsx` / `PendingChangesBar.tsx` 处理 `hint.paths` + `silent` fetch（fork 用 `PendingChangesBar` 替代上游 `ChatInput` 的 listener）。`FilesView.tsx` save 后发 `requestGitRefresh({ directory, paths: [relativePath] })`。focused tests：`diffScrollAnchor.test.ts` 3/3 ✅、`toolDiffUtils.test.ts` 12/12 ✅（含 2 个 `getMutatedToolPaths` 测试）、`useGitStore.test.ts` 7/7 ✅（含 2 个 `clearDiffCache` 测试）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。

**第八批验证证据（2026-08-05）#117**：移植上游 `8d675a55` + `fd9d73f8` + `be77d926` + `68e0b471` + `35f0a31d`。Server：`skills.js` 新增 `isValidSkillName` / `assertValidSkillName`（重构 `createSkill` 复用），`isPathInside` / `getManagedSkillRoots` / `isManagedSkillPath`（检查 `.agents/skills` + `~/.config/opencode/skills` 是 managed root，worktree 临时目录不是），`renameSkill(skillName, renameTo, workingDirectory)`（rename directory in place 保留 SKILL.md body + 支持文件；frontmatter `name` mismatch 或 rename 失败时回滚；`getSkillScope` conflict check）；`updateSkill` 加 `renameTo` 到 skip-list。`skill-routes.js` 加 `resolveSkillsDirectory`（soft-fallback：`resolveOptionalProjectDirectory` 返回 null 时退到 `resolveProjectDirectory`，让 client 省略 directory 时 repo-local `.agents/skills` 仍可见——`8d675a55` 的核心修复），list 响应暴露 `renamable: isManagedSkillPath(...)`（`35f0a31d`），PATCH 处理 `updates.renameTo` → `renameSkill`（`be77d926`）。`feature-routes-runtime.js` + `index.js` 接线 `renameSkill` + `isManagedSkillPath`。UI：`useSkillsStore.ts` 把 `getCurrentDirectory` 改为 `getRequestDirectory`（active-project pattern：`useProjectsStore.getState().getActiveProject()` primary，对齐 `useCommandsStore` / `useAgentsStore`），加 `renamable` 字段到 `DiscoveredSkill` + `RawSkillResponse`，加 `renameSkill` action（用 fork 的 `resolveApiUrl` + `fetch` + `serverBaseUrl`，**不**用上游 `runtimeFetch`，保持 fork 多实例隔离）。`useSkillsCatalogStore.ts` 同步 active-project resolution。`SkillsSidebar.tsx` rename gating 从 server `renamable` flag 驱动（`isRenamableSkill` 检查 `skill.renamable === true`，移除 client path heuristic——`35f0a31d` 的 final state），用 `renameSkill` action 替代旧的 create+delete 模式（`be77d926`）。VS Code：`opencodeConfig.ts` 加 `isPathInside` / `getManagedSkillRoots` / `isManagedSkillPath` / `renameSkill`（复用 fork 已有的 `findWorktreeRoot` / `getAncestors` / `getConfigForPath` / `writeConfig`），`bridge-config-runtime.ts` 加 rename 处理 + `renamable` in list。i18n：9 个 locale settings 文件加 `skillRenamed` toast key。focused tests：`skills.test.js` 12/12 ✅（含 repo-local discovery、rename preserves SKILL.md body + supporting files、rename rollback on frontmatter mismatch、rename rejects invalid/missing/conflict）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。

**第九批验证证据（2026-08-05）#108**：移植上游 `d6848ff7`（tablet/foldable size class）。`device.ts` 新增 `TabletLayout` 接口（`enabled` / `roomyForPanels`）+ `readTabletLayout()` 纯函数 + `useTabletLayout()` hook（用 fork 已有的 `attachMediaQueryListener` + `isIPadApp`）。`tabletLayout.test.ts` 5/5 ✅（phone/tablet/foldable portrait/landscape/fold geometry）。`MainLayout.tsx` 把 `useIpadSplitLayout`（仅 iPad identity）泛化为 `useTabletSplitLayout`（size class：iPad identity OR geometry），Android tablet/foldable 现在获得 persistent SessionSidebar split，fold 是 resize——sw600dp 以下自动回退 phone drawers。`index.css` 的 `changed-label` 24rem→30rem（`7c068159` #2590 fix），保留 fork 的 `active-todo` 30rem（比上游 38rem 更严格，已防 overlap）。**未移植**：`cc40ff9f` QR-without-Play-Services——fork 的 `mobileQrScan.ts` 已有 superior bundled CameraX scanner（`scanWithCameraPreview` + BarcodeDetector fallback），AndroidManifest 已声明 bundled `barcode` model，不回退上游较弱实现。`0b393e5b` Android edge swipe zones——fork 无 `useEdgeSwipe.ts`，drawers deliberately toggle-opened for perf（MainLayout 注释：「No drag="x": framer pan steals vertical scroll and pegs CPU」）。`hardwareKeyboard.ts` 跳过（iOS GCKeyboard native bridge，fork 无 native publishing）。`mobile.css` draft-starter gating 跳过（fork mobile.css 无对应 block）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。matching-surface QA 延后——tablet split 是 Capacitor shell feature（`isCapacitorApp()` gate），browser DevTools emulation 无法 exercise 该路径；size class geometry 由 5 条单元测试覆盖。

**第十批验证证据（2026-08-05）#115**：移植上游 `6eac705b` + `bbbb30b9` + `f2e6bc11` + `079ccb19`。Terminal early start：`TerminalViewport.tsx` 加 `getProvisionalTerminalSize` + `provisionalSizeRef` + `useLayoutEffect`（viewport mount 前用 DOM geometry 提供 provisional cols/rows）；`TerminalView.tsx` 加 `FALLBACK_TERMINAL_SIZE` + `pendingTerminalCreatesRef`，移除 size gate（不再等 viewport 测量），用 fallback size 立即 create，create 后 resize 到真实 size；`runtime.js` 的 `consumeTerminalThemeQueries` 加 `respondToPrimaryDeviceAttributes: true`；`theme-response.js` 加 DA1 query 识别 + response。AppImage ARGV0 strip：新增 `inherited-env.js`（`stripAppImageArgv0Leak` + `clearAppImageArgv0FromProcessEnv` + `resolveLinuxPtyLaunch`）；`runtime.js` 用 `stripAppImageArgv0Leak(env)` 清环境 + `resolveLinuxPtyLaunch` 在 Linux 用 `env -u ARGV0` 包裹 PTY shell 启动；`lifecycle.js` 在 managed OpenCode spawn env 上应用 `stripAppImageArgv0Leak`（**安全**：custom `-sscity` binary 路径来自 `OPENCODE_BINARY`/settings，不来自 `ARGV0`，strip 不影响 spawn 路径）；`env-runtime.js` 加 `clearAppImageArgv0FromProcessEnv` + `ARGV0` 到 skipKeys；`electron/main.mjs` 的 `inheritUserShellEnv` 在 loadShellEnv 前清 ARGV0。`bun-pty@0.4.8.patch` 新增（buffer output before data subscriber attaches——retain startup output 的关键）。`terminalApi.ts` 加 targeted race-safety fixes（`set.has(subscriber)` guard in catch、`this.opening = null` on generation bump、`this.failures = 0` on full detach、hidden 时固定 60s delay）。focused tests：`runtime.test.js` 27/27 ✅（含 ARGV0 strip + Linux env -u + DA1 response）、`theme-response.test.js` 全 ✅（含 DA1）、`inherited-env.test.js` 全 ✅、`env-runtime.test.js` ARGV0 测试 ✅（2 个 WSL 测试 pre-existing fail：machine 有 real `-sscity` binary，与 ARGV0 无关）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。**AppImage native QA 延后**——需 Linux Docker AppImage build 在真实 AppImage 验证 ARGV0 stripped。

**第十批验证证据（2026-08-05）#107**：移植上游 `2ea828b8` + `b92456fe` + `4e8fc1d2` + `0e778c24`。这是 v1.18.0 最大 feature（upstream ~8400 行）。Server walkthrough engine（`packages/web/server/lib/walkthrough/`）：digest.js（content-addressed hunk identity）、hunks.js（hunk grouping）、schema.js（structured output JSON schema）、store.js（content+language cache，jobs/cancel）、prompt.js、sources.js（Git diff source resolution）、model-settings.js（per-model token budget）、generated.js、pull-request.js（PR diff via GitHub）、index.js（orchestration: getWalkthrough / generateWalkthrough / getRepositoryRootFor / cancelWalkthroughGeneration）、routes.js（HTTP routes）、languages.js（**匹配 fork 9 locales，不含 de/fr**——#112 加 German 时同步加）。Dependency：`small-model/call.js` 加 `responseSchema`（structured output 跨 4 wire formats：OpenAI chat/responses、Anthropic messages、Google）、`signal`（abort）、`timeoutMs`、`onOverflow`（truncate | error）；`small-model/index.js` 加 `getModelInputCharBudget` / `resolveOutputTokens`，**保留 fork 的 `tryCandidates` fallback chain 架构**（不替换为上游 single-resolve）。`git/service.js` 加 `getRepositoryRoot` / `listUntrackedPaths` / `getUntrackedDiffs`；`git/routes.js` 加 `GET /api/git/range-diff`。`feature-routes-runtime.js` 接线 walkthrough routes + `getWalkthroughService`。UI：`packages/ui/src/components/views/walkthrough/` 新增 WalkthroughView + 6 supporting components（Blocker/HunkRun/Stages/Stream/Toc + useWalkthroughStageProgress + walkthroughAction + stopElementId）；`packages/ui/src/lib/walkthrough/` 新增 api.ts / model.ts / types.ts；`packages/ui/src/stores/useWalkthroughStore.ts` 新增。Integration：`DiffView.tsx` 加 walkthrough action button（explicit user start only）；`PullRequestSection.tsx` 加 walkthrough entry；`session-ui-store.ts` 注册 `/walkthrough` slash dispatch（fork routeMessage path）；`ContextPanel.tsx` / `ModelPickerList.tsx` / `ModelSelector.tsx` 加 model+language picker；`surfaces/registry.ts` + `types/index.ts` + `useUIStore.ts` + `sprite.ts` 注册 walkthrough surface/tab/icon。i18n：`en.ts` + 8 locale main files 加 walkthrough keys（`0e778c24` action label 简化）。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。matching-surface QA 延后到集成 QA 阶段。`languages.test.js` 验证 walkthrough languages 与 `runtime.ts` LOCALES 双向 parity（fork 9 locales，无 de/fr）。

**第十一批验证证据（2026-08-05）#112**：移植上游 `805d8737` + `d16ad0bf` + `10f4a7be` + `2a2edac8`。新增 `de.ts`（2899 行）+ `de.settings.ts`，使用 fork 的 strict `Record<I18nKey, string>` 类型——TypeScript 强制 key parity（de ≡ en，0 missing / 0 excess）。构建方式：从上游 `de.ts` 提取 ~2483 个真实 German 翻译，722 个 fork-only keys 用 English fallback（fork 独有功能：Chat/Queue/Multi-run/Goals/Visual/custom providers/walkthrough/skills 等）。修复上游 German 文件中的 raw newline 问题（上游 `de.ts` 的 multi-line single-quoted strings 是 JS 语法错误——用 character-level tokenizer 正确解析并 re-serialize 为 `\n` escape）。`runtime.ts` 加 `'de'` 到 `Locale` type / `LOCALES` array / `LOCALE_LABEL_KEYS` value union / `normalizeLocale()`（含 `de-*` fallback）。`store.ts` 加 `'de'` dynamic import case。`bootstrap.ts` 加 `DE_MESSAGES`（bootstrap 阶段 ~15 个 German 翻译）。`en.ts` + 8 个其他 locale main files 加 `common.language.german` key（各语言翻译：Alemán/ドイツ語/독일어/Niemiecki/Alemão/Німецька/德语/德語）。`walkthrough/languages.js` 加 `de: 'German'`——`languages.test.js` 4/4 ✅ 验证 walkthrough locales 与 `runtime.ts` LOCALES 双向 parity。**未移植 docs**——fork docs 极简（7 个 English MDX，无 locale 子目录），上游 30+ German docs 引用的页面在 fork 不存在。全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors。

## v1.18.0 合并收口（2026-08-05）

**合并范围**：上游 `v1.17.2..v1.18.0`（121 commits）。fork 从 `1.17.1-sscity`（commit `d13774f7f`）推进到 `ac8020a38`，10 个 commit 覆盖全部 14 个 v1.18.0 Work Item。

**最终集成验证（2026-08-05）**：
- 全 workspace `bun run type-check`：7 个 workspace 全 ✅ 0 errors。
- 全 workspace `bun run lint`：7 个 workspace 全 ✅ 0 errors。
- `bun run build`：✅ Done in 25.43s，产出正确，无 `vendor-.bun` 巨型 chunk（#110 修复验证），`vendor-vite-runtime` 1.8KB 隔离 `__vitePreload`，`de.js` German locale chunk 正确产出（#112 验证）。
- `git diff --check`：✅ 无 whitespace 问题。
- 独立实例 matching-surface QA：`OPENCODE_SKIP_START=true OPENCODE_PORT=9999 bun packages/web/bin/cli.js --port 3912 --ui-password test --foreground`。服务器成功绑定 `127.0.0.1:3912`；`/health` 返回 HTTP 200 完整 server status；`/api/walkthrough/languages`（#107）路由注册并正确报告 OpenCode 不可用；`/api/config/providers`（#109）返回 provider config；`/api/config/skills`（#117）从 `.agents/skills` 发现 skills；`/api/git/check`（#111）正确识别 git 仓库。Vite UI 在 `5196` 端口返回 HTTP 200 valid HTML。
- focused tests 总计 80+ 条全通过：providers 11/11、session-directory-resolution 9/9、control-commands 5/5、session-ui-store 15/15、diffScrollAnchor 3/3、toolDiffUtils 12/12、useGitStore 7/7、globalSessions 7/7、worktree partition 3/3、skills 12/12、walkthrough languages 4/4、tabletLayout 5/5、terminal runtime 27/27、terminal theme-response 全通过、inherited-env 全通过、env-runtime ARGV0 通过。
- GitLab Overview [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1)：全部 14 项 v1.18.0 checklist 勾选（#107–#120）。

**Native QA 延后交接**：
- **#108 Android QR scan without Play Services**：fork 已有 superior bundled CameraX scanner（`scanWithCameraPreview` + BarcodeDetector fallback），AndroidManifest 已声明 bundled `barcode` model。browser DevTools 无法 exercise Capacitor-gated 路径。**需用户在 Android emulator/device 验证**：build Android debug variant，打开 QR scanner，确认无 Play Services 时仍能扫描。
- **#115 Linux AppImage ARGV0 stripping**：`inherited-env.js` + `runtime.js`/`lifecycle.js`/`env-runtime.js`/`electron/main.mjs` 的 ARGV0 strip 已由 focused tests 覆盖。**需用户在 Linux Docker AppImage 验证**：`scripts/build-linux-appimage-docker.sh` 构建 AppImage，在 AppImage 内启动 terminal 和 OpenCode，确认 shell ARGV0 不含 AppImage 路径（`echo $0` / `ps` 检查）。

**fork 约束保持**：
- `serverId + directory` 是 session/file/permission/terminal/worktree 的权威键——全部 10 个 WI 保持。
- custom embedded OpenCode `-sscity` binary spawn 路径不受 ARGV0 strip 影响（binary 来自 `OPENCODE_BINARY`/settings，不来自 `ARGV0`）。
- `/Applications/OpenChamber.app` 未修改——全部改动在 `merge/upstream` 分支工作树。
- Markdown 渲染器保持 react-markdown（未迁 marked+shiki）；MessageList 虚拟化保持 `@tanstack/react-virtual`（未迁 virtua）。
- SessionSidebar 保持 authoritative（未引入上游 `MobileSessionsSheet`）；drawers 保持 toggle-opened（未引入 edge-swipe）。

## v1.18.1 差距审计与合并（2026-08-05）

**比较边界**：上游 `v1.18.0..v1.18.1`（`ce5192197`），24 commits，92 files，+4082/-619。fork 从 v1.18.0 合并收口（`631492caf`）推进到 v1.18.1 全部合并。

### 官方 v1.18.1 功能 → Fork 处理

| 功能 | 状态 | Fork 处理 |
|---|---|---|
| Providers: OAuth-only provider 登录完成 | ✅ 已合并 | 新增 `ProviderOAuthMethods.tsx` + `provider-oauth.ts`（OAuth 方式选择、device code copy、browser callback 完成）；`ProvidersPage.tsx` 用新组件替代内联 OAuth 逻辑；`proxy.js` 加 `INTERACTIVE_OAUTH_TIMEOUT_MS`（15min）+ OAuth callback 豁免 deadline |
| Providers: OAuth-only 隐藏 API key form | ✅ 已合并 | `shouldShowApiKeyAuth` 判断——OAuth-only provider 显示 Connect 流而非 API key form |
| Providers: 未认证时隐藏 models | ✅ 已合并 | Provider models 在 credentials 不存在时隐藏 |
| Sessions: archived sessions 可恢复 | ✅ 已合并 | `unarchiveSession` + `unarchiveSessions` 加 `expectedRuntimeKey` guard + fail-loudly check；`session-ui-store` 接线；`globalSessions.ts` 加 `splitGlobalSessionsByArchived` + `narrowToArchived`；`useGlobalSessionsStore` 改用 inclusive fetch + client-side split（restored sessions 在 reload 后存活）；ArchiveView / SessionNodeItem / BulkActionBar / useSessionActions 加 restore UI |
| Walkthrough: 未认证 models 不出现 | ✅ 已合并 | `small-model` 加 `resolveProviderLogin` + `hasLogin` + 结构化 401 error；walkthrough readiness `no-provider-login` 拒绝；`ModelPickerList` 视 `[]` 为 allow-none；WalkthroughView 隐藏未认证 models + 禁用 Generate |
| Walkthrough: "Critical" → "Key change" | ✅ 已合并 | `WalkthroughStream` importance tag 重命名 + tooltip；i18n key 改值 |
| Walkthrough: 旧服务器友好错误 | ✅ 已合并 | `api.ts` 加 `isJsonResponse` / `looksUnsupported` / `serverUnsupported` 检测——HTML 响应 → "server needs updating" |
| Walkthrough: disabled Generate 去掉 info tint | ✅ 已合并 | Generate button className 改为 `border-border text-muted-foreground` |
| Chat: Ctrl/Cmd+L 发送选中文本 | ✅ 已合并 | `addSelectionToChat` 逻辑；toggle-sidebar 移到 Ctrl/Cmd+Alt+L；ChatInput 集成 |
| Chat: 手动 model 选择在 subtask 后保持 | ✅ 已合并 | `userModelChoice` 持久化——delegated subtask 完成后不回退到 agent default |
| Agents/CLI: 未送达 prompt 报失败 | ✅ 已合并 | `openchamber-sessions/routes.js` — dispatched prompt 未到达 session 时报 failed |
| Desktop/Linux: Terminal launcher 不错误归属 | ✅ 已合并 | `linux-app-discovery.mjs` 加 `isTerminalEmulatorEntry`——`appId === 'terminal'` 要求 `Categories=TerminalEmulator`，不再 substring match 误匹配 |

**验证**：全 workspace `bun run type-check` 0 errors、`bun run lint` 0 errors、`bun run build` 通过。focused tests 覆盖 provider-oauth、session restore、walkthrough auth、Ctrl+L 各项。

---

## v1.18.2 差距审计（2026-08-11）

**比较边界**：上游 `v1.18.1..v1.18.2`（`da4a61ad8`），114 commits，316 files，+19366/-2655。
**Fork 起点**：`1.18.1-sscity`（commit `5f99f1b8d`，分支 `merge/upstream`）。
**当前状态**：仅完成 release-note feature inventory + 关键 fork-state recon（vite chunk、Apply & Restart 链、work-status panel 组件覆盖）；尚未逐 commit / file diff 落地。后续按 Tier 顺序逐批合并，**禁止整批套 patch**。

### 上游 Changelog → Fork 处理总表

按官方 changelog 出现顺序，对照 fork 当前实现给出初判。状态图例：✅ 已等价 / 🟡 部分或需逐文件合 / 🔴 缺失或高风险 / ⛔ 保留 fork 分歧。

| Changelog 项 | 对应关键 commit | 状态 | Fork 处理 / 备注 |
|---|---|---|---|
| Observability panel（active goal / tasks / subagents / pinned context / MCP / context usage 统一视图）；session list 显示 agent 工作时长 | `f2523d0cf` (#2776) | 🔴 高风险 | fork 各组件已分散存在（goal row、todo renderer、TaskSessionMaterializer、McpSidebar/Page、ContextSidebarTab/ContextUsageDisplay），但**统一面板、pinned-context、session work-duration 是 net-new**。详见 Tier 3 |
| Scheduled Tasks: `.agents/loops/*.md` 文件式循环任务，免重启发现文件变化；可编辑/启用/禁用/删除/运行 | `0ba330c77`、`bac56fc79`、`96c8d4775`、`d1bb9d3af`、`8a367382f`、`ffef080bc`、`3bbde9af4` | 🟡 中风险 | 新功能。需保护 `serverId + directory`、scheduled runtime 现有 permission auto-accept。详见 Tier 2 |
| Settings: Apply & Restart 累加 config 变更 | `6626d642c` + 12 commit 链 (#2585) | 🔴 高风险 | fork 当前每次 OpenCode config mutation（agent/MCP/command/skill/provider/plugin/permission/外部 watcher）**立即** restart managed OpenCode。改为 server-side pending 累加 + Settings footer 单一 Apply & Restart。详见 Tier 3 |
| Remote access: relay 设备无浏览器连接或 state 加载失败时不再失去 relay | `e04e34a2d` | 🟡 中风险 | fork 已实现 #16 relay/pairing v2，按多 transport + `expectedServerId` probe；需对照 fork `packages/web/server/lib/relay/*` 的 host-keepalive 路径 |
| Performance: 初始 web 下载 -58%，启动内存 -22%；heavy Settings 和 syntax-highlighting 延迟加载 | `fdcf5c272` (#2742) | 🔴 高风险 | fork v1.18.0 #110 已做基础：Bun chunk 解析 + Vite preload 隔离 + `html-to-image` lazy。**剩余缺口**：`CommandPalette` 静态 import `SettingsView` 把整组 settings 拉入主图；`PermissionCard`、`DiffPreview` 静态 import `react-syntax-highlighter`。详见 Tier 3 |
| Git/Worktrees: prompt 等待新 worktree checkout 完成；session 解析到所属 worktree | `7e8838486` (#2708) | ✅ 已等价 | fork v1.18.0 #111 已落地：`session-directory-resolution.ts` precedence 模块、`session-ui-store` record-first authoritative、worktree bootstrap gate |
| Git/Worktrees: worktree 创建后运行 repo 的 post-checkout hook；Windows 深嵌套 worktree "Filename too long" | `955e72312` (#2721)、`58e6e704b` (#2746) | 🟡 中风险 | post-checkout hook 需在 fork `git/service.js` worktree bootstrap 接入；`core.longpaths` Windows-only，平台分支 |
| Projects: 新项目目录可创建在当前 workspace 外；add/create/clone 打开 new-session draft | `4ef9ce1c5` | 🟡 中风险 | 需保护 fork 的多实例 `serverId + directory` 权威；新 draft 已用 frozen snapshot |
| Chat: 切换 session 前提交的消息留在原 session/workspace 并取消（不跨实例） | `1c9ca82b3` (#2424) | ✅ 已等价 | fork queue item 已冻结 `sendTarget`（directory + serverId）；切换 session 不改写已排队消息 |
| Chat: queue 不再 send 到仍在 streaming 的 turn；中断响应遗留 tool 卡片 settle | `fcf0622e1` (#2642)、`0f52a9be1` | ✅ 已等价 | fork v1.16 queue idle dispatch + 失败指数退避；materialization 无变化返回原 store state |
| Chat: shell 命令输出默认展开；add to context 后焦点回 composer | `294552b0e` (#2492)、`687cc17da` | 🟢 低风险 | 独立小修，Tier 1 |
| Chat: 已显示消息不再 replay 进入动画；iOS Shift+Enter 换行恢复 | `015741391` (#2124)、`287d6b878` | 🟢 低风险 | 独立 CSS/事件修复 |
| Chat: composer caret 更易见 | `721525e6f` | 🟢 低风险 | CSS 调整 |
| MCP: OAuth 浏览器 callback 更可靠；available/unavailable 区分；失败连接 retry action | `622b8bb66`、`f2523d0cf` 部分 | 🟡 中风险 | MCP OAuth 跨 runtime 重写（部分嵌在 #2776）；依赖 Tier-3 Apply & Restart 状态；fork McpPage 已有 status badges |
| Usage: xAI quota reporting | `b215036e1` (#2628)、`4df7439f6` | 🟡 中风险 | 新增 quota provider；按 fork 现有 provider 注册模式（multi-instance + `runtimeFetch`） |
| Terminal: 默认 tab 名在关闭后保持唯一；Escape 到达 terminal app 而非关闭 context panel；后台连接更少 keepalive | `10728dbf5` (#2718)、`a5c413b98`、`8702c6d5c` | 🟢 低风险 | 独立小修 |
| Desktop/macOS: 拒绝文件夹访问后选目录可恢复 | `dac56e31b`、`1a00c1fa8` (#2744) | 🟡 中风险 | Electron main.mjs 恢复逻辑；需保护 fork `OPENCHAMBER_OPENCODE_CWD` + managed OpenCode spawn path |
| Desktop/Windows: 任务栏最小化保持 native；app 自身最小化仍可到 tray | `f2b3c50af` (#2494) | 🟢 低风险 | Windows-only；fork #17 Windows tray 已落地，需复核 minimize 路由 |
| Desktop: overlay scrollbars 滚动后再次 auto-hide | `cc6c5db30`、`d3a90e408` (#2581) | 🟢 低风险 | 上游先加再 revert，最终态为 auto-hide。fork 需对齐最终态 |
| Mobile/Android: pairing QR 在错误读 `openchamber://` 的旧 WebView 中可用 | `24b44f71d` (#2611) | 🟡 中风险 | fork #16 pairing v2 已落地；需对照 fork `pairingLinkParse` 加 fallback |
| Mobile: 冷启动后 pending agent questions 重现 | `1198a11cf` | 🟡 中风险 | fork SessionNodeItem 已有 pending-question indicator；冷启动 hydration 路径需补 |
| Files: 移除 Office/OpenDocument 附件同时移除提取的图片；Linux reveal 失败 surface error | `2ffb9415c` (#2432)、`6599891d0` (#2490) | 🟡 中风险 | 与 v1.16.3 #25 tool/office 标准化相关；attachment cascade + Linux 错误提示 |
| VSCode: notebook 链接在已装兼容扩展时打开 notebook editor | `d1e9aa5ff` (#2373) | 🟢 低风险 | VS Code 单文件改动 |
| Settings: 通知模板快速编辑不再互相覆盖；collapsed-user-message 偏好持久化 | `f498fad34` (#2300)、`228e5c8b2` | 🟢 / ✅ | 通知模板 debounce 修复；collapsed-user-message fork 已有 `collapsibleUserMessages` |
| Walkthrough: 分支比较使用 repo 实际 remote default branch | `4ca0f6cdd`、`c9ab916cb` | 🟢 低风险 | fork #107 walkthrough 已落地 |
| Server: 用户 systemd service 启动的 foreground install 通过独立 transient service 更新 | `e0255cacf` (#2542) | 🟡 中风险 | server-side systemd 启动；fork 在 Linux Dev boxes 用 system unit（见 AGENTS.md），需对照路径 |
| Security: archive 解压更新（GHSA-xcpc-8h2w-3j85） | `ebb02b43e` (#2643) | 🟢 低风险 | `adm-zip` 0.5.16 → 0.6.0 依赖升级 |
| UI: dialog/dropdown/popover/tooltip 统一 glass 样式；移除 macOS vibrancy | `384810349`、`c67e846f1` | 🔴 高风险 | fork 已强制 `desktopVibrancy=false`（v1.12.4 Tier1），与上游方向一致；但 glass surface 统一会触及大量 popup 组件，需配合 fork theme token（见 `/theme-system` skill）。详见 Tier 3 |

### Tier 1 — 🟢 低风险 / 独立小修

每项 <1h，独立 commit，几乎无冲突。

| # | 功能 | 上游 commit | 关键文件 | 备注 |
|---|---|---|---|---|
| 1 | Model picker scroll shadows 调整 | `2d61984bd` | `ModelPickerList`/scroll-shadow primitive | 视觉微调 |
| 2 | Diff action container shadow 软化 | `bd52e3788` | CSS | 视觉微调 |
| 3 | Composer caret 更易见 | `721525e6f` | ChatInput CSS | 视觉 |
| 4 | Permission error color 可读 | `c1ae4e3e6` | `PermissionCard` | theme token |
| 5 | Overlay scrollbars 恢复 auto-hide（最终态） | `cc6c5db30`、`d3a90e408` | 全局 CSS | 上游 revert 后最终态；对齐即可 |
| 6 | Windows taskbar minimize native | `f2b3c50af` (#2494) | `electron/main.mjs` Windows | Windows-only；复核 #17 tray |
| 7 | Rail surface git activity dots 只在 git surface 显示 | `16e03d134` | sidebar rail | 视觉 |
| 8 | 已显示消息不再 replay 进入动画 | `015741391` (#2124) | `MessageBody`/FadeIn | latch |
| 9 | Shell 输出默认展开 | `294552b0e` (#2492) | `ToolPart` shell state | 默认值 |
| 10 | iOS Shift+Enter 换行恢复 | `287d6b878` | ChatInput key handler | iOS-only |
| 11 | Add-to-context 后焦点回 composer | `687cc17da` | ChatInput effect | 焦点 |
| 12 | Session activity spinner 改 dot + turn timer | `faa9c2433` | `SessionNodeItem` / status row | 视觉 + 信息 |
| 13 | Terminal default tab 名关闭后保持唯一 | `10728dbf5` (#2718) | terminal tab store | 命名 |
| 14 | Terminal keepalive 20s → 45s | `8702c6d5c` | terminal transport | perf |
| 15 | Escape 到达 terminal PTY 而非关闭 context panel | `a5c413b98` | `ContextPanel`/TerminalView 键路由 | 键盘 |
| 16 | Git worktree Windows longpaths | `58e6e704b` (#2746) | `git/service.js` Windows | `core.longpaths true` |
| 17 | fs list 路径通过 symlink 保持 requested space | `9f58b4c98` | `fs/routes.js` | 路径规范化 |
| 18 | Linux reveal launcher 失败 surface error | `6599891d0` (#2490) | FilesView / electron shell | Linux 错误提示 |
| 19 | Walkthrough base branch 从 repo 解析 | `c9ab916cb`、`4ca0f6cdd` | walkthrough git | #107 补丁 |
| 20 | VS Code notebook 链接打开 notebook editor | `d1e9aa5ff` (#2373) | VS Code link handler | VS Code |
| 21 | adm-zip 0.6.0 安全升级（GHSA-xcpc-8h2w-3j85） | `ebb02b43e` (#2643) | `packages/web/package.json` | 依赖升级 |
| 22 | Project add → open new-session draft | `4ef9ce1c5` | projects store | draft |
| 23 | pending-restart applying label i18n shorten | `1368a4a90` (#2791) | locale files | 依赖 Tier-3 Apply & Restart（最后合） |
| 24 | Rail badge background via surface theme tokens | `cd803dc83` (#2790) | theme token | 主题 |
| 25 | Test/CI/chore（无运行时影响） | `15fcfed3e`、`1fd80b91a`、`7e95dfab8`、`d34ee0642`、`a743739aa`、merge/release commits | — | 直接 adopt 或忽略 |

### Tier 2 — 🟡 中风险 / 需逐文件合并

每项 1–4h，单组件或单 store 改动，需保护 fork 多实例权威。

| # | 功能 | 上游 commit | 关键文件 | Fork 注意 |
|---|---|---|---|---|
| 26 | xAI quota provider | `b215036e1` (#2628)、`4df7439f6` | 新 `packages/web/server/lib/quota/providers/xai.js`、UI `quota.ts` types、registry、locale | 按 fork 现有 provider 模板（Crof/NeuralWatt #66）；active-instance base URL + VS Code parity |
| 27 | Markdown loops 调度任务 | `0ba330c77` + 6 commit | 新 `scheduled-tasks/loops.js`、`project-config.js`、UI dialog | fork scheduled runtime 已有 permission auto-accept + 时区；reconcileLoopTasks 必须按 `serverId + directory` 锁，不能写全局 |
| 28 | MCP OAuth 跨 runtime 可靠 + 可用/不可用区分 + retry | `622b8bb66` + #2776 部分 | `McpPage`、`startMcpAuthorization.ts`、`McpOAuthCallbackPage`、`useMcpStore` | 部分依赖 Tier-3 Apply & Restart；fork 已有 MCP status badges，需逐文件合 |
| 29 | Relay host 对实际使用设备保持 alive | `e04e34a2d` | `packages/web/server/lib/relay/*` | fork #16 已实现 multi-transport + `expectedServerId` probe；对照 keepalive 触发条件 |
| 30 | Mobile 冷启动后 pending question 重现 | `1198a11cf` | hydration / SessionNodeItem | fork SessionNodeItem 已有 pending-question indicator；hydration 路径需补 |
| 31 | macOS 文件夹访问拒绝后恢复 | `dac56e31b`、`1a00c1fa8` (#2744) | `electron/main.mjs` dialog flow | 保护 fork `OPENCHAMBER_OPENCODE_CWD` 与 managed OpenCode spawn path |
| 32 | Worktree 创建后运行 post-checkout hook | `955e72312` (#2721) | `git/service.js` worktree bootstrap | hook 必须在 fork worktree project ensure 之后运行 |
| 33 | Server: OPENCHAMBER_OPENCODE_HOSTNAME bind hostname 校验 | `94a165d31` | `env-runtime.js` / server bootstrap | fork 已有类似 env 处理 |
| 34 | CLI: bare `--ui-password` daemon/serve 自动生成密码 | `375363ff1` | `packages/web/bin/cli.js` | fork CLI 5452 行，按 helper port |
| 35 | managed OpenCode restart 后重绑 message-stream upstreams | `66f35bc26` | `server/index.js`、lifecycle | 依赖 Tier-3 Apply & Restart；fork 已有 in-process UI/proxy |
| 36 | 前台 systemd 服务安全更新（transient service） | `e0255cacf` (#2542) | server systemd 启动 | fork Linux Dev boxes 用 system unit（AGENTS.md），需对照路径 |
| 37 | Pairing QR 旧 Android WebView fallback parse | `24b44f71d` (#2611) | `pairingLinkParse` | fork #16 已有 mobile QR，加 fallback |
| 38 | Office/OpenDocument 附件级联删除提取图片 | `2ffb9415c` (#2432) | input-store、materializer | 与 v1.16.3 #25 tool/office 标准化相关 |
| 39 | 通知模板快速编辑互不覆盖 | `f498fad34` (#2300) | notification template store debounce | 设置层 |
| 40 | Active instance service URLs 在 About 显示 | `8303b3cb9` (#2669) | AboutSettings、server `/api/system/info` | fork 已有 About settings + `/api/system/info`；补 active instance URLs |
| 41 | Numbered context-panel surface switching | `8274dd82f` | surface registry、keyboard | fork #62 已有 surface rail；补编号 |
| 42 | Git rail surface changed-files count badge | `d7e82eead` | rail surface | 视觉 + 数据 |
| 43 | Chat work-status 从 git hints 刷新 | `630ac299c` | work-status / status row | 依赖 Tier-3 work-status panel；可先合 status row 部分 |
| 44 | Agent frontmatter lenient 解析（与 OpenCode 一致） | `dee6305b9` | server agent parser | fork 已有 agent YAML 保真（v1.16 小批次） |
| 45 | Provider OAuth methods 在 reconnect 时也加载 | `557e867fa` | provider OAuth flow | 补 v1.18.1 OAuth-only provider |
| 46 | Google API key env aliases 镜像到 managed OpenCode | `b18ec4422` | lifecycle env、provider-env-aliases | managed OpenCode spawn env |
| 47 | sync: 无 directory 的 todo 更新路由 | `1a58c2b13` | sync-context todo routing | fork 多实例路由权威保持 |
| 48 | sync: 中断 turn 后 settle 时 finalize 孤立 tool parts | `0f52a9be1` | event-pipeline / sync | fork 已有 queue/materialization guard；补 finalize |
| 49 | Stale running UI 修复 | `0dfde287b` (#2577) | sidebar / sync status | 视觉 + sync |
| 50 | Chat refresh work status from git hints | `630ac299c` | status row | 与 #43 相关 |

> 已等价项（不再开卡）：worktree bootstrap wait（#111）、session directory send/fork（#111）、queue 不 send 到 streaming turn（fork queue 退避）、collapsed-user-message persist（fork `collapsibleUserMessages`）、pending-question indicator（fork SessionNodeItem 已有）、SDK bump 1.18.15（fork lock 1.18.4）。

### Tier 3 — 🔴 高风险 / 大规模重写或深度架构改动

每个独立 milestone，禁止互相混批。

| # | 功能 | 上游 commit | 规模 | Fork 状态 + 风险点 |
|---|---|---|---|---|
| 51 | **Work-status panel**（统一 observability） | `f2523d0cf` (#2776) | 69 files, +5777/-894 | **Fork 组件分散已有**：goal row、todo renderer、TaskSessionMaterializer、McpSidebar/Page、ContextSidebarTab、ContextUsageDisplay。**Net-new**：统一面板组件（`packages/ui/src/components/chat/work-status/*` 10+ 文件）、pinned-context 数据契约、session work-duration 计时；同时改 Header（-514 行重构）、ChatContainer、ChatInput、MCP OAuth 重写。**风险**：fork 多实例 session sidebar、surface registry（#62）、context panel、Header 已有自定义结构，需选择"统一面板"还是"分散保留"。**建议先开 Work Item 设计 pinned-context 数据契约 + duration 计时（无 UI），再决定面板集成路径** |
| 52 | **Apply & Restart accumulator** | `6626d642c` + 12 commit 链 (#2585) | 55 files, +1525/-530 | **Fork 当前**：每次 OpenCode config mutation（agent/MCP/command/skill/provider/plugin/permission/外部 watcher）**立即** restart managed OpenCode（10+ 路由点：`config-entity-routes.js`、`config-routes.js`、`routes.js`、`plugin-routes.js`、`skill-routes.js`、`config-file-watcher.js`）。Settings footer 当前是手动 "Reload OpenCode"（`SettingsView.tsx:857-880`）。**改为**：server-side pending 累加 + Settings footer 单一 Apply & Restart + 确认对话框（警告 active chat 会停止）。**必须保护**：fork managed OpenCode detach/shared database 约束、`/api/config/settings` 普通设置不 restart 的现有契约、外部 config-file watcher 行为 |
| 53 | **Cold-start perf 58%/22%** | `fdcf5c272` (#2742) | 21 files, +585/-380 | **Fork v1.18.0 #110 已做基础**：Bun chunk 解析、Vite preload 隔离、`html-to-image` lazy。**剩余缺口**（recon 确认）：(a) `CommandPalette.tsx:35-36` 静态 import `getSettingsNavIcon` from `SettingsView`，把整组 Settings 拉入主图；(b) `PermissionCard.tsx:7`、`DiffPreview.tsx:2` 静态 import `react-syntax-highlighter`；(c) `VirtualizedCodeBlock.tsx:14-45` 静态 import Prism + 多 language grammars；(d) `SettingsView.tsx` 22-61 静态 import 各 section。**风险**：fork Markdown 渲染器仍用 react-markdown（未迁 Shiki），与上游 `markdownTheme.ts`/`markdownSyntaxVars.ts` 不通用，需 fork-specific lazy 边界 |
| 54 | **移除 macOS vibrancy + 统一 glass surfaces** | `384810349`、`c67e846f1` | refactor | Fork 已在 v1.12.4 Tier1 决定强制 `desktopVibrancy=false`，与上游方向一致；但 glass surface 统一触及大量 popup 组件（dialog/dropdown/popover/tooltip）。**必须按 fork theme token + `/theme-system` skill 处理**，不能直接套上游硬编码值；上游最终用 solid background 替换 glass 也需评估与 fork theme 一致性 |

### Fork 约束保持（合并时必须遵守）

- `serverId + directory` 是 session/file/permission/terminal/worktree/quota/loop 的权威键——全部新增 surface 保持。
- custom embedded OpenCode `-sscity` binary spawn 路径不受 Apply & Restart 累加影响（binary 来自 `OPENCODE_BINARY`/settings）。
- `/Applications/OpenChamber.app` 未修改——全部改动在 `merge/upstream` 分支工作树。
- Markdown 渲染器保持 react-markdown（未迁 marked+shiki）；MessageList 虚拟化保持 `@tanstack/react-virtual`（未迁 virtua）。
- SessionSidebar 保持 authoritative（未引入上游 `MobileSessionsSheet`）。
- managed OpenCode detach/shared database 约束——Apply & Restart 仍走现有 lifecycle restart，不改为退出即杀。
- 普通设置（`PUT /api/config/settings`）继续不 restart；只有 OpenCode config 文件变更才进 accumulator。
- 用户 PATH CLI 优先策略不采用（custom embedded binary 权威）。

### 合并顺序建议

```
Phase 1 — Tier 1（#1-25）：每项 <1h，可批量合；先合 #21 (adm-zip 安全)、#16 (longpaths)
Phase 2 — Tier 2 独立项（#26 xAI, #27 markdown loops, #33-#46 等独立小项）
Phase 3 — Tier 2 relay/MCP/worktree/mobile（#28-32, #37-39）逐文件合
Phase 4 — Tier 3 perf（#53）：先 lazy `SettingsView` 与 `react-syntax-highlighter` import，独立可验
Phase 5 — Tier 3 Apply & Restart（#52）：最大架构改动；先 server-side accumulator，再 UI footer
Phase 6 — Tier 3 work-status panel（#51）：最大 feature；先 pinned-context + duration 计时数据契约，再决定面板集成路径
Phase 7 — Tier 3 vibrancy/glass（#54）：theme 统一，配合 fork theme token skill
Phase 8 — 版本号 + CHANGELOG：发布收尾
```

**Work Item 已开**（GitLab 已建，2026-08-11）：

| Tier | WI | 标题 |
|---|---|---|
| 3 | [#122](https://coding.s-s.city/songsong/openchamber/-/issues/122) | [1.18.2][High risk] Unified work-status observability panel |
| 3 | [#123](https://coding.s-s.city/songsong/openchamber/-/issues/123) | [1.18.2][High risk] Apply & Restart accumulator for OpenCode config changes |
| 3 | [#124](https://coding.s-s.city/songsong/openchamber/-/issues/124) | [1.18.2][High risk] Cold-start perf 58%/22% — finish lazy-loading gaps |
| 3 | [#125](https://coding.s-s.city/songsong/openchamber/-/issues/125) | [1.18.2][High risk] Remove macOS vibrancy + unify glass surfaces via theme tokens |
| 2 | [#126](https://coding.s-s.city/songsong/openchamber/-/issues/126) | [1.18.2] xAI quota provider |
| 2 | [#127](https://coding.s-s.city/songsong/openchamber/-/issues/127) | [1.18.2] Scheduled tasks markdown loops (.agents/loops/*.md) |
| 2 | [#128](https://coding.s-s.city/songsong/openchamber/-/issues/128) | [1.18.2] MCP OAuth reliability (depends on #123) |
| 2 | [#129](https://coding.s-s.city/songsong/openchamber/-/issues/129) | [1.18.2] Relay host keepalive for actually-using devices |
| 2 | [#130](https://coding.s-s.city/songsong/openchamber/-/issues/130) | [1.18.2] Mobile cold-start pending question recovery |
| 2 | [#131](https://coding.s-s.city/songsong/openchamber/-/issues/131) | [1.18.2] macOS folder permission denial recovery |
| 2 | [#132](https://coding.s-s.city/songsong/openchamber/-/issues/132) | [1.18.2] Run repo post-checkout hook after worktree bootstrap |
| 1 | [#133](https://coding.s-s.city/songsong/openchamber/-/issues/133) | [1.18.2] Tier 1 batch — UI/CSS/test/chore independent fixes |

依赖关系：#128 → #123（Apply & Restart 先行）；#133 的 i18n shorten 项也 → #123。其余 WI 独立可并行。建议合并顺序：Phase 1 = #133；Phase 2 = #126/#127/#129/#130/#131/#132（独立）；Phase 3 = #128（依赖 #123）；Phase 4 = #124（perf）；Phase 5 = #123（Apply & Restart）；Phase 6 = #122（work-status panel）；Phase 7 = #125（vibrancy/glass）。

**双源规则**：每个延期或新发现的运行时能力先在 GitLab 建 WI（milestone `v1.18.2` + labels），挂到总览 [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1)；本文档同步加 ⏸️/🟡/🟠 状态并链到 WI。已完成项 ✅ 并链到 WI，再在 #1 checklist 勾选。

**已完成 recon 证据**：
- vite chunk 状态：`vite.config.ts:35-67`（Bun parsing + vendor chunks + Vite preload isolation）；`MainLayout.tsx:35-46`（SettingsView lazy）；`CommandPalette.tsx:35-36`（静态 import SettingsView 拉入主图——剩余缺口）；`PermissionCard.tsx:7` / `DiffPreview.tsx:2`（静态 Prism import——剩余缺口）；`MessageBody.tsx:1528-1531`（html-to-image lazy ✅）。
- Apply & Restart 现状：`lifecycle.js:948-986` `refreshOpenCodeAfterConfigChange` → `restartOpenCode('config_change')`；10+ 路由点立即调用（`config-entity-routes.js:47-68, 111-186, 309-390`、`config-routes.js:29-47, 90-143`、`routes.js:555-611, 619-686`、`plugin-routes.js:61`、`skill-routes.js:485, 536, 626, 654, 669, 761`、`config-file-watcher.js:94-143`）；`SettingsView.tsx:857-880` 当前是手动 Reload；`PUT /api/config/settings` 不 restart（`routes.js:431-442`）。
- Work-status 组件覆盖：goal（`SessionGoalRow.tsx:18-105`）、todo（`toolRenderers.tsx:371-504`、`ProgressiveGroup.tsx:145-213`）、subagent（`ToolPart.tsx:1768-1807, 2626-2700`）、MCP（`McpSidebar.tsx:32-59`、`McpPage.tsx:425-497`）、context usage（`ContextSidebarTab.tsx:426-516`、`ContextUsageDisplay.tsx:9-46`）；**缺失**：pinned-context 数据契约、session work-duration 计时（`SessionNodeItem.tsx:648-650` 只有 timestamp）。

**未启动项**：本审计仅完成 release-note feature inventory + 关键 recon；尚未逐 commit / file diff。后续每个 WI 关闭前必须完成实现、定向测试、全仓 type-check/lint/build、对应运行面 matching-surface QA，并把验证证据回写到本节。

---

## v1.18.2 合并收口（2026-08-11）

**合并范围**：上游 `v1.18.1..v1.18.2`（114 commits）。fork 从 `1.18.1-sscity`（commit `5f99f1b8d`）推进到 `1.18.2-sscity`（commit `7d74e8c25`），共 40+ 个 fork commit 覆盖全部 12 个 v1.18.2 Work Item。

### Work Item 完成状态

| Tier | WI | 标题 | Fork commit | 状态 |
|---|---|---|---|---|
| 3 | [#122](https://coding.s-s.city/songsong/openchamber/-/issues/122) | Unified work-status observability panel | `bd244bf13` `1b66f06df` `b2520325f` `38354c53a` | ✅ 部分（数据基础设施完成；统一面板 UI 作为 fork 设计决策延后） |
| 3 | [#123](https://coding.s-s.city/songsong/openchamber/-/issues/123) | Apply & Restart accumulator | `6776624db`..`8d3aa83f6` (19 commits) | ✅ |
| 3 | [#124](https://coding.s-s.city/songsong/openchamber/-/issues/124) | Cold-start perf 58%/22% | `bebe20e69` | ✅ |
| 3 | [#125](https://coding.s-s.city/songsong/openchamber/-/issues/125) | Remove macOS vibrancy + unify glass surfaces | `aea0145dc` `1556d5f2f` | ✅ |
| 2 | [#126](https://coding.s-s.city/songsong/openchamber/-/issues/126) | xAI quota provider | `eef8758a1` | ✅ |
| 2 | [#127](https://coding.s-s.city/songsong/openchamber/-/issues/127) | Scheduled tasks markdown loops | `59ff4f5ae` | ✅ |
| 2 | [#128](https://coding.s-s.city/songsong/openchamber/-/issues/128) | MCP OAuth reliability | `bdf8ce6c1` `4758457c2` `8a49d10ad` `58f12509e` | ✅ |
| 2 | [#129](https://coding.s-s.city/songsong/openchamber/-/issues/129) | Relay host keepalive | `54b0dfe09` | ✅ |
| 2 | [#130](https://coding.s-s.city/songsong/openchamber/-/issues/130) | Mobile cold-start pending question | `2d4fd206c` | ✅ |
| 2 | [#131](https://coding.s-s.city/songsong/openchamber/-/issues/131) | macOS folder permission recovery | `bf335295f` | ✅ |
| 2 | [#132](https://coding.s-s.city/songsong/openchamber/-/issues/132) | Worktree post-checkout hook | `465f7faca` | ✅ |
| 1 | [#133](https://coding.s-s.city/songsong/openchamber/-/issues/133) | Tier 1 batch — UI/CSS/test/chore | `637f31ef6`..`c976e806f` (13 commits) | ✅ |

### 最终验证（2026-08-11）

- 全 workspace `bun run type-check`：✅ 0 errors
- 全 workspace `bun run lint`：✅ 0 errors
- `bun run build`：✅ Done in 28s
- `git diff --check`：✅ 无 whitespace 问题

### Fork 约束保持

- `serverId + directory` 是 session/file/permission/terminal/worktree/quota/loop/restart 的权威键——全部新增 surface 保持。
- custom embedded OpenCode `-sscity` binary spawn 路径不受 Apply & Restart 累加影响。
- `/Applications/OpenChamber.app` 未修改——全部改动在 `merge/upstream` 分支工作树。
- Markdown 渲染器保持 react-markdown（未迁 marked+shiki）；MessageList 虚拟化保持 `@tanstack/react-virtual`（未迁 virtua）。
- SessionSidebar 保持 authoritative（未引入上游 `MobileSessionsSheet`）。
- managed OpenCode detach/shared database 约束——Apply & Restart 仍走现有 lifecycle restart，不改为退出即杀。
- 普通设置（`PUT /api/config/settings`）继续不 restart；只有 OpenCode config 文件变更才进 accumulator。
- 用户 PATH CLI 优先策略不采用（custom embedded binary 权威）。

### 已等价覆盖（不重复建卡）

- worktree bootstrap wait (#111 已覆盖)
- session directory send/fork routing (#111 已覆盖)
- queue-no-send-into-streaming-turn (fork queue 退避已覆盖)
- `collapsibleUserMessages` persistence (fork v1.12.4 Tier 1 已覆盖)
- pending-question indicator (fork SessionNodeItem 已覆盖)
- SDK bump 1.18.15 (fork lock 1.18.4 已覆盖)
- overlay scrollbar revert (fork 已在 post-revert 状态)
- permission error color (fork 已用 `text-status-error`)
- diff action shadow (fork DiffView 结构不同，不适用)
- model picker scroll shadows (fork ModelPickerList 不用 useScrollShadow)

### #122 Work-status panel 延后说明

fork 已有丰富的 surface 组织（#62 surface rail + ContextSidebarTab + ContextUsageDisplay + SessionGoalRow + McpSidebar + TaskSessionMaterializer）。上游的统一 work-status 面板会替换这些既有 surface，属于 fork 设计决策。

本批次落地了 **数据基础设施**（未来面板可复用）：
- `contextUsage.ts` pure helper（session-aware token 计算）
- `session-activity-timing.ts`（session work-duration 计时基础设施，支持多实例 `serverId + directory` composite key）
- `SessionActivityDuration` component + locale keys
- `SessionNodeItem` 用 static dot + duration counter 替换 CSS spinner 动画（perf 优化）

**统一面板 UI 集成**（替换现有 surface vs 叠加为可选 surface）留作独立设计 milestone。

### Matching-surface QA 状态

本批次自动化验证全部通过（type-check、lint、build、focused tests）。Matching-surface QA（隔离 dev 实例、Playwright 交互）在 subagent 内由部分批次执行，但完整端到端 QA 随下次 local app-only 包补测：
- Apply & Restart footer 确认对话框
- MCP OAuth callback 跨 web/relay 完成
- xAI quota 报告
- markdown loops 发现/编辑/删除
- relay host keepalive（配对设备 → 关闭浏览器 → 验证移动端仍可用）
- macOS 文件夹权限拒绝 → 恢复
- worktree post-checkout hook 执行
- session work-duration 显示

---

## v1.18.3 → v1.20.0 差距审计与迁移启动（2026-08-27）

### 上游边界

| 版本 | tag / release commit | 非 merge commits | diff 规模 |
|---|---|---:|---:|
| `v1.18.3` | `249d5deca` | 43 | 321 files, +15557/-9806 |
| `v1.18.4` | `f0c23d3da` | 6 | 50 files, +1846/-382 |
| `v1.19.0` | `4c8acf3c7` | 85 | 344 files, +24486/-2703 |
| `v1.20.0` | `52ee87866` | 68 | 334 files, +13228/-3591 |

审计方法继续遵守本文件顶部规则：只逐功能手工移植，不执行上游 merge，不覆盖 fork 未提交代码；`serverId + directory`、自研 sidebar、多实例 Electron host 聚合、稳定壳 / runtime 分离均为硬边界。

### 现有 fork 等价 / 部分等价

- **Browser**：fork 自 2026-05 已有 ContextPanel webview、元素/区域标注、截图与本地 dev server surface；上游 v1.18.3 的多页 Browser workspace、持久 history/device controls、remote dev tunnel 和 agent Web tool 尚未完整等价，统一由 [#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) 收口。
- **Markdown images**：fork 已有 session-directory-aware 本地图片解析、全屏预览和 gallery 导航；上游 completed-reply compact thumbnail/mobile layout 尚未对齐，见 [#136](https://coding.s-s.city/songsong/openchamber/-/issues/136)。
- **Electron 43**：fork commit `831801e44` 已升级 Electron 43.3.0，Linux rounded-corner 前置已覆盖；其他 shell parity 集中 [#159](https://coding.s-s.city/songsong/openchamber/-/issues/159)。
- **SSH config import**：当前工作区已有 `ImportCard` / SSH config 解析及未提交的 ssh-manager/settings WIP，但未完成 v1.20.0 生命周期验收，不计为 done，见 [#151](https://coding.s-s.city/songsong/openchamber/-/issues/151)。
- **Settings lock / atomic persistence**：当前未提交 WIP 与 v1.19/v1.20 config safety 有重叠；迁移不得覆盖，完成后按 [#144](https://coding.s-s.city/songsong/openchamber/-/issues/144) 独立审计。

### 第一批：Tier 1 independent fixes（Work Item [#134](https://coding.s-s.city/songsong/openchamber/-/issues/134)）

| 上游能力 | commit | Fork 处理 | 状态 |
|---|---|---|---|
| Shell `!` 在 CodeMirror 插入前切换模式，paste/mobile transaction 同步移除触发符；重复 `!` 保留 | `70a3b33c6`, `8202292dd` | 手工适配当前 `ChatInput` autocomplete state；不复制上游已变化的 helper | ✅ |
| 三位数以上代码行号不换行 | `a7db40153` | `data-md-code-line-number` 增加 `white-space: nowrap` | ✅ |
| CJK IME composition 期间禁止 controlled value 全量 writeback | `1a48de769` | `ComposerEditor` 使用 CodeMirror `compositionStarted`；附回归测试 | ✅ |
| Dialog 默认关闭按钮扩大为稳定 `28×28` 热区 | `527c9aafb` | 沿用 theme tokens，仅补尺寸/居中/z-index | ✅ |
| 流式 Bash 输出随内容增长至 `46vh`，再进入滚动 | `3e7fe4ff9` | 去除 streaming-only 固定 `h-[46vh]`，保留 follow-at-bottom | ✅ |
| 长用户消息晚布局后仍可检测截断并展开 | `e937b1757` | 观察自然高度 children + subtree，点击时重新测量 | ✅ |
| Skills Catalog 展示名 `ClawdHub` → `ClawHub` | `1d0723b97` | 保留协议/内部 ID `clawdhub`，修 UI/Web/VS Code label 与文档 | ✅ |

验证（2026-08-27）：

- focused tests：IME writeback、UserText content、Bash output helpers、UI/Web ClawHub labels ✅
- isolated production web build：`bun run build:web` ✅
- isolated browser QA（临时 data dir + ports 3902/5190；未启动/终止 managed OpenCode）：Shell trigger/repeated prefix ✅；Dialog close hit area `28×28` 且可关闭 ✅；Skills Catalog 仅显示 `ClawHub` ✅
- 隔离 backend 指向受 Basic auth 保护的 external OpenCode，因此 console 中存在预期 401 bootstrap/SSE 错误；页面、composer、settings 和被测交互仍正常挂载。该 401 不是本批回归。
- full workspace lint ✅；docs validation ✅；`git diff --check` ✅。
- 2026-08-30 补齐现有 interrupted-continue WIP 的 locale key 后，full workspace type-check ✅；[#134](https://coding.s-s.city/songsong/openchamber/-/issues/134) 验证闭环，可关闭。

### GitLab executable backlog（#135–#159）

| WI | 范围 | 风险 / 当前判断 |
|---|---|---|
| [#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) | Browser workspace + agent Web tool | 🔴 与 fork Browser/Electron/remote tunnel 深度重叠 |
| [#136](https://coding.s-s.city/songsong/openchamber/-/issues/136) | compact Markdown image galleries | 🟡 fork 已有 preview/gallery 基础 |
| [#137](https://coding.s-s.city/songsong/openchamber/-/issues/137) | pairing / relay / mobile reconnect / browser tunnel | 🔴 多 transport 生命周期 |
| [#138](https://coding.s-s.city/songsong/openchamber/-/issues/138) | Usage refresh + OpenCode Go/Claude/Command/Z.ai | 🟡 instance-scoped quota parity |
| [#139](https://coding.s-s.city/songsong/openchamber/-/issues/139) | scheduled occurrence single-dispatch | 🟡 多 server claim authority |
| [#140](https://coding.s-s.city/songsong/openchamber/-/issues/140) | draft work status + active-only context chats | 🟡 与 fork work-status/surfaces 对齐 |
| [#141](https://coding.s-s.city/songsong/openchamber/-/issues/141) | ID rollover chronology + isolated server exception survival | 🔴 event ordering / process lifecycle |
| [#142](https://coding.s-s.city/songsong/openchamber/-/issues/142) | installable Integrations settings | 🟡 需接 Apply & Restart + instance scope |
| [#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) | Project knowledge | 🔴 surface / persistence / context pins |
| [#144](https://coding.s-s.city/songsong/openchamber/-/issues/144) | config parse + atomic write safety | 🔴 当前 settings WIP 重叠，禁止覆盖 |
| [#145](https://coding.s-s.city/songsong/openchamber/-/issues/145) | Shiki churn + proxy connection reuse | 🔴 renderer hot path + proxy lifecycle |
| [#146](https://coding.s-s.city/songsong/openchamber/-/issues/146) | Git PR/worktree/branch diff/generated text | 🟡 逐子能力移植 |
| [#147](https://coding.s-s.city/songsong/openchamber/-/issues/147) | file upload + path authority | 🔴 session `serverId + directory` 必须贯穿 |
| [#148](https://coding.s-s.city/songsong/openchamber/-/issues/148) | drafts / embedded chats / context usage / attachment bounds | 🔴 sync 与历史恢复 |
| [#149](https://coding.s-s.city/songsong/openchamber/-/issues/149) | `/btw` side-question sessions | 🔴 temporary fork lifecycle |
| [#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) | projectless Chats | 🔴 新 session ownership 模型 |
| [#151](https://coding.s-s.city/songsong/openchamber/-/issues/151) | SSH remote setup/lifecycle | 🔴 当前 WIP 重叠 + multi-instance host authority |
| [#152](https://coding.s-s.city/songsong/openchamber/-/issues/152) | curated GitHub Skills catalog | 🟡 catalog/source scope |
| [#153](https://coding.s-s.city/songsong/openchamber/-/issues/153) | post-recording dictation | 🟡 web/Capacitor/desktop voice parity |
| [#154](https://coding.s-s.city/songsong/openchamber/-/issues/154) | Settings selector/default ownership | 🔴 不能切换整个 app context |
| [#155](https://coding.s-s.city/songsong/openchamber/-/issues/155) | custom providers + Small Model resolution | 🟡 running-OpenCode provider authority |
| [#156](https://coding.s-s.city/songsong/openchamber/-/issues/156) | focused-project sidebar + external sessions | 🔴 fork sidebar authoritative |
| [#157](https://coding.s-s.city/songsong/openchamber/-/issues/157) | restart/reconnect/queue reconciliation | 🔴 live state 与 remote identity |
| [#158](https://coding.s-s.city/songsong/openchamber/-/issues/158) | external app deep-link confirmation | 🟡 security + per-device trust |
| [#159](https://coding.s-s.city/songsong/openchamber/-/issues/159) | desktop/mobile shell parity | 🟢/🟡 先核验已有等价实现 |

建议顺序：`#134` 收口 → `#136/#138/#139/#140/#152/#155/#158/#159` 独立中低风险 → `#141/#144/#145/#147/#148/#157` correctness/perf → `#135/#143/#149/#150/#151/#154/#156` 大功能与架构适配。

### #139：Scheduled occurrence cross-instance claim（2026-08-30）

上游来源：`807a42662`。fork 手工移植完整 correctness 语义，不引入全局 active-directory fallback：

- project config state 新增 `lastScheduledFor`；scheduled timer 把其权威 `nextRunAt` 作为 occurrence identity 传入 queue。
- 每个 project config 写入先经过进程内 promise chain，再获取跨进程 `<project>.json.lock`；stale PID、stale age、partial lock 均可恢复，release 前验证 ownership。
- `updateScheduledTaskStateIf` 在锁内重新读取磁盘并条件 patch；两个 OpenChamber 进程同时触发同一 occurrence 时只有一个能创建 Session。
- claim/start/completion 写入失败都通过 `finally` 释放 running slot；只 re-arm future timestamp，避免 once task delay-zero 自旋。
- Session 已执行但 completion state 保存失败时，runtime 保持终态并返回 `persistError`；service/API/UI surface warning，而不是错误地宣称整次 dispatch 失败。
- fork 原有 loops discovery、worktree bootstrap、goal metadata/objective、permission auto-accept、explicit project path 均保留。

验证：

- scheduled/project-config Vitest：5 files / 53 tests ✅，含两个 runtime 共用真实 on-disk config 的 daily/weekly/cron/once claim、锁 timeout/recovery/ownership、queue rejection、completion retry。
- full workspace type-check ✅；full workspace lint ✅；`bun run build:web` ✅；`git diff --check` ✅。
- authority audit：新增 persistence/dispatch 均以显式 `projectID` 和该 project 的 path 为键；未使用 `activeProjectId`、`currentDirectory`、`lastDirectory` 或 `opencodeClient.getDirectory()` 作为既有任务 fallback。

### #157：Managed restart / reconnect / queue reconciliation（2026-08-30）

上游来源：`2db90f74d`、`ea248f08e`、`20f3c5945`。按 fork event reducer、多实例 registry 和 runtime transport 适配：

- successful managed restart 会从 server-side live state 找出 busy/retry Sessions，逐个广播 authoritative idle + `MessageAbortedError`，并发送一次可定位 Session 的 interruption notification。
- `settleInterruptedTurn` 只在权威 idle、无 pending question/permission、尾部 assistant 未完成时执行；同时终止 pending/running tool parts，不修改已完成 parts。
- reconnect materialization 若收到同 message ID 的权威 completed assistant，会替换本地 aborted copy，避免 OpenCode 实际完成但 UI 永久显示中断。
- web runtime 的 queue identity 使用 Electron boot outcome 中稳定的 `hostId`，不再以每次 SSH reconnect 都会变化的 local-forward URL 为键。
- 现有 Continue 操作按 owning Session 的 directory/server route，并通过 `runtimeFetch` 保持 direct/remote/relay transport 一致；原始 HTTP 失败内容可见。
- lifecycle 保留 32 KiB credential-redacted stderr tail，分类 health failure，并在 `/health` 暴露 last health/process/restart snapshots；实时 child stderr 也先清洗再写日志。

验证：

- UI sync/session-actions：58 tests ✅（interrupted settle、completed reconciliation、directory routing、raw failure）。
- web lifecycle/runtime identity：4 files / 34 tests ✅（restart settle、single notification、stable host identity、diagnostic redaction/tail）。
- full workspace type-check ✅；full workspace lint ✅；build/web 与 diff check 在本批最终提交前复跑。

### #138 Phase 1：Command Code + Z.ai credits（2026-08-30）

- 新增 Command Code Web/VS Code provider：标准 `command-code` auth entry 或 `COMMAND_CODE_API_KEY`；先以 `/alpha/whoami` 解析个人/组织 scope，再读取 credits 与 5h/weekly limits。
- UI quota registry/type/logo 同步加入 `command-code`；monthly/purchased/free credit labels 补齐全 locale。
- Z.ai 同时接受 `TOKENS_LIMIT` 与新 `CREDIT_LIMIT`，显示 `used / total credits`，并保留 API `level` 为 plan label；Web/VS Code parity。
- fork 原有 60s 可配置 auto-refresh、Header/VS Code/Usage 三 surface 挂载和 UI request single-flight 已覆盖上游 3 分钟刷新目标，不降级为上游固定实现。

验证：Web provider/registry/formatter 4 files / 19 tests ✅；VS Code quota parity 9 tests ✅；full type-check ✅。[#138](https://coding.s-s.city/songsong/openchamber/-/issues/138) 保持 open，下一 phase 处理 Claude Code credential/quota 与 OpenCode Go API-key migration。

### #138 Phase 2：Claude Code + OpenCode Go API-key migration（2026-08-30）

- Claude Web/desktop/mobile 从 Claude Code macOS Keychain、`~/.claude/.credentials.json`、OpenCode auth、`CLAUDE_CODE_OAUTH_TOKEN` 依次只读发现 OAuth；VS Code extension host 使用同一优先级。
- Claude quota 解析新 `limits` 数组与 legacy fallback，保留 5h/7d duration、model-scoped weekly limits、enabled extra-usage spend label 和 Claude Code subscription plan；429 期间只回放同 credential fingerprint 的 last-good 数据。
- Web registry、Claude provider 和 VS Code dispatcher 都合并同一 provider 的并发刷新；不同 provider / active runtime 仍使用各自 key，不引入全局实例状态。
- OpenCode Go 停用 workspace dashboard cookie scraping，改读 owning OpenCode `auth.json` 的标准 `opencode-go` API key，并调用 `/zen/go/v1/usage` JSON API；旧 cookie file 仅删除，旧写入 route 明确返回 HTTP 410，不静默接受失效凭据。
- Usage 页面显示 Claude plan，model-scoped Claude limits 默认全部选中；旧 OpenCode Go credential form 从 Providers 页面移除。Command Code、Z.ai credits 和 fork 既有 60s configurable auto-refresh 保持 Phase 1 语义。

验证：Claude Web Vitest 4 files / 15 tests ✅；OpenCode Go Web 2 files / 5 Bun tests ✅；VS Code quota parity 12 Bun tests ✅；UI quota focused tests 10 条 ✅；full workspace type-check/lint ✅；Web production build 与 VS Code production build ✅；`git diff --check` ✅。

### #152：Curated GitHub Skills Catalog（2026-08-30）

上游来源：`1c205c879`、`6a46649b4`。按 fork 能力做加法移植，没有照搬上游删除 ClawHub：

- curated source 扩展为 Anthropic、OpenAI、Cursor `pstack/skills`、Matt Pocock；Web 与 VS Code fallback 清单一致，ClawHub 继续作为第五个分页 registry source。
- catalog source 卡片显示已加载 skill 数、GitHub stars 和最近 push 日期；搜索在所有已加载 GitHub/custom source 中聚合，ClawHub 仍只按用户选中后的分页数据参与，不做无界全量抓取。
- GitHub skill 行提供仓库路径链接；自定义 source 的删除、refresh、install/conflict flow 和 ClawHub metadata/install selection 均保留。
- GitHub metadata 使用 1.5s best-effort fetch、3h 成功缓存、5min 失败缓存；scan 以 `repo + subpath + gitIdentity` 为 key 去重，最多两个并发，并用 owner-only atomic disk cache 跨重启保留。
- UI 所有 catalog 请求改经 `runtimeFetch`，source-load single-flight key 包含 resolved runtime identity 与当前 project directory；同路径的两个 remote instance 不会共享请求，且未回退到全局 active server/directory。

验证：skills catalog Web modules 3 files / 7 Vitest tests ✅；真实 Express catalog route 1 test ✅（metadata + ClawHub coexistence）；UI store 4 Bun tests ✅（curated+ClawHub coexistence、active-runtime transport、同 source 去重、跨 runtime 隔离）；full type-check/lint 与 Web/VS Code production build ✅。隔离 server 在现有 managed OpenCode/SQLite startup scan 中阻塞，连 `/health` 都未就绪，因此没有虚报浏览器 QA；该隔离 PID 已单独终止，未触碰用户运行中的 OpenChamber。

### #158：External app deep-link confirmation（2026-08-30）

上游来源：`486c66b0c`。适配 fork 的 ReactMarkdown renderer 和多 runtime shell：

- chat Markdown 允许 `spotify://`、`obsidian://`、`linear://` 等受分类的 app scheme 保留 href；primary/modifier/middle click 与 drag 都先被统一 interaction layer 截获，不能绕过确认。
- `javascript/data/vbscript/blob/file/intent/ms-msdt/search-ms/shell`、WebView/internal protocols、network protocols 与 `openchamber/openchamber-ui/capacitor` 自 deep-link 永久拒绝，不进入 trust store。
- 首次打开提供取消、打开一次、信任并打开；取消默认聚焦。信任按 normalized scheme 存入 deferred per-device safe storage，最多 64 项，不写 server settings，也不跨设备同步。
- trusted scheme 可在 Settings → Chat 中逐项移除；MainLayout、VS Code layout、Mini Chat 各只挂载一个 dialog，避免 nested runtime provider 产生重复确认框。
- HTTP(S) 继续走原有 `openExternalUrl`；custom scheme 只有在 classifier + confirmation 后才进入 `openConfirmedAppLinkUrl`，不会放宽普通 URL opener。

验证：URL classifier、trust store、confirmation queue、click/auxclick/drag interaction 共 4 files / 13 Bun tests ✅；full workspace type-check/lint ✅；Web/VS Code production build ✅；`git diff --check` ✅。

### #159 Phase 1：Desktop/mobile shell parity audit（2026-08-30）

- Electron 已为 43.3.0（fork `831801e44`），Linux frameless rounded-corner 前置等价，无重复升级。
- iOS CodeMirror 已有 native selection + visible handles 的 fork 实现与 focused tests，等价覆盖上游 `26b0ad5bd`，不替换现有低延迟 composer theme。
- `desktop_minimize_current_window` 当前始终调用 `browserWindow.minimize()`，close path 才走 tray；补齐 10 locale 文案为“关闭到托盘，最小化保留任务栏”，对齐 `c020e1554`，保留 persisted key `desktopMinimizeToTrayEnabled`。
- Windows 右侧 controls 去除多余 header padding，close hover 改用 status error theme tokens，对齐 `57c9ec2fd`；fork Mini Chat 当前没有该上游 frameless-controls 结构，因此不造无调用方样式。
- `bcab6d68a` self-signed loopback Browser panel certificate exception 尚未落地：需要接入当前由其他 agent 修改中的 `packages/electron/main.mjs`。为避免把 settings-lock/SSH WIP 一并提交，本项保持 open，待 main WIP 收口后补 helper + hook + shell test。

### #159 Phase 2：Loopback certificate policy boundary（2026-08-30）

- 新增独立 `browser-panel-security.mjs`，只允许 `https:` 的 `localhost`、`127.0.0.1`、`[::1]`，且 Electron 错误必须精确为 `net::ERR_CERT_AUTHORITY_INVALID`。
- 公网域名、localhost suffix 欺骗、`0.0.0.0`、畸形 URL、过期证书等其他错误继续 fail closed；没有使用通配 host、私网网段或全局 `ignore-certificate-errors`。
- 对应提交：`8db21bd59 fix(browser): constrain loopback certificate bypass`。
- 当前 fork 的 Electron main 尚无上游 `BROWSER_PANEL_PARTITION / hardenBrowserPanelSession`；这是 [#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) Browser workspace 的前置，不只是 main 文件脏。现在把 handler 挂到全局 session 会扩大证书绕过范围，因此有意不接无 owner hook。`#135` 建立专用 partition 后再绑定 `contents.session === panelSession`。

验证：Node test 3/3 ✅（loopback allow、non-loopback deny、other-error/malformed deny）；全 workspace type-check/lint/build ✅，build 仅有既有 chunk/import warnings。[#159](https://coding.s-s.city/songsong/openchamber/-/issues/159) 保持 open：等待 `#135` 专用 Browser partition 后接 handler，并完成 installed shell + iOS 真机 QA。

### #159 Phase 3：Browser partition certificate hook（2026-08-30）

- 复核发现 fork Browser `<webview>` 已使用 `partition="persist:openchamber-browser"`；无需等待新的 Browser 架构。Electron ready 时只对该 partition 注册一次 `certificate-error` handler。
- handler 同时要求 `contents.session === panelSession` 与 Phase 2 policy allow；其他 Electron window/session 即使访问 loopback self-signed HTTPS 也不会获得 bypass。
- 对应提交：`2bb0a05f4 fix(browser): scope loopback certificate errors`。使用 temporary index 从 dirty `main.mjs` 精确提交；提交后其他 agent 的 main WIP 仍保持 `23 insertions / 5 deletions` 未提交。

验证：Node syntax ✅、Electron type-check/lint ✅、certificate policy 3/3 ✅；full workspace type-check/lint/build 已在同轮通过。此变更属于 immutable shell，不通过 runtime install 发布。[#159](https://coding.s-s.city/songsong/openchamber/-/issues/159) 保持 open：需要下次显式 shell refresh 后用真实 self-signed loopback page 做 installed QA，并保留 iOS 真机 selection QA。

### #155 Phase 1：Config-defined custom provider auth gate（2026-08-30）

上游来源：`ddd4b5ed8`。fork 已有 config-defined custom provider CRUD、scope/source 识别和 models/baseURL，因此只修真实缺口：

- provider 存在于 user/project/custom config layer 且符合 custom OpenAI-compatible contract 时，不再因 auth.json/env 为空自动展开未认证 panel，也不再隐藏其 models。
- 普通内置 provider 仍必须有 auth/env credential；source 尚未加载时不提前判失败。
- pure gate 1 Bun test / 4 assertions ✅；full workspace type-check/lint 与 diff check ✅。

[#155](https://coding.s-s.city/songsong/openchamber/-/issues/155) 保持 open：下一 phase 仍需移植 `f1b602019` running OpenCode `/provider` snapshot，使 plugin-registered endpoint/key 参与 Small Model resolution，并独立审计 `109e957fe` Claude CLI provider state。

### #155 Phase 2：Running OpenCode provider authority + Claude CLI state（2026-08-30）

- 新增 `runtime-providers.js`：从 owning managed OpenCode 的 `/provider` 读取 plugin-registered provider key/baseURL，30s TTL、同请求 single-flight；OpenCode 短暂不可达时返回 last-known-good，未配置时返回 unknown 而非 empty。
- credential precedence 为 config options → runtime plugin credential → auth.json；endpoint precedence 为 config baseURL → OpenAI default → runtime baseURL → models.dev。Copilot/OpenAI OAuth/Anthropic/Google dedicated wire format 不误用 runtime OAuth token。
- Zen 匿名 `apiKey: public` 永不视作可调用 credential；`claude-code` 即使 plugin 暴露 OpenAI-compatible facade 也不进入后台 Small Model，避免标题/摘要启动 Claude CLI 并消耗订阅。
- managed OpenCode restart 清空 runtime provider snapshot；Small Model/Walkthrough authenticated provider list 改为 async runtime-aware，Defaults picker 从 active runtime 获取并 fail closed。
- Claude Code provider source 通过 `claude auth status --json` 识别 CLI login，调用时移除环境 credential override；CLI 已自行发起授权 URL，不重复打开，也不为成功登录强制 reload OpenCode。

验证：Small Model runtime/call/index + Claude CLI 4 Vitest files / 33 tests ✅；provider OAuth/auth/custom gate 3 Bun files / 25 tests ✅；full workspace type-check/lint ✅；Web production build ✅；`git diff --check` ✅。

### #140 Phase 1：Active-only embedded context chats（2026-08-30）

上游来源：`7a04dd5c4`，适配 fork 支持 split pane 的 ContextPanel：

- persisted chat tabs 不再全部映射成隐藏的全应用 iframe；非 split 只挂 active chat，关闭 panel 时所有 chat iframe 卸载。
- split pane 打开时只允许 active + split 两个可见 chat，各自仍保留 read-only、directory、runtime bootstrap 与 viewed-state 语义；panel 关闭时 `active=false` guard 同样卸载。
- `getActiveEmbeddedSessionChatTab` pure helper 覆盖 active/null/missing；ContextPanel focused test 5 条 ✅；full workspace type-check/lint 与 diff check ✅。

### #140 Phase 2：Draft status in the fork Context surface（2026-08-30）

上游来源：`222057abc`、`83c4c75ff`、`5ef828f38`。不恢复 #122 已明确延期的独立 WorkStatusPanel，而把草稿状态接入 fork 已有的 Context surface：

- Context tab 在 Session 尚未 materialize、但草稿已打开时，不再只显示“打开一个会话”；改为显示草稿实际目标的项目、目录、实例、MCP health 与所选用量提供商摘要，pending worktree 有明确状态。
- 权威解析优先草稿显式 `selectedProjectId`，再按目录/已发现 worktree 解析 owning project；同路径 local/remote 项目不会串实例，兄弟 worktree 仍归属原项目。显式项目已删除时保留目标目录但 `serverId=null` fail closed，不静默请求本地实例。
- MCP status 请求把 draft directory 与 resolved serverId 一起传给 SDK。用量数据按 resolved server base URL 独立读取并在组件内汇总，没有复用全局 quota results，因此打开 Dev3 草稿不会把本地/Header 的用量快照误当成 Dev3 数据。
- active/split embedded chat 已在 Phase 1 保证只挂可见 iframe；现有 `tab.readOnly`、`allowPromptingSubagentSessions` settings sync、directory/runtime bootstrap 和 viewed-state bridge 经复核保留，不需要复制上游面板内的另一套子智能体导航。
- 上游“所有 WorkStatus sections 被隐藏后恢复入口”只修复其独立 panel 的持久化 sections dialog；fork 没有该 panel/setting，Context rail/tab 始终可达，因此按架构不适用，而非遗漏。

验证：draft authority/quota + Context wiring + context usage Bun 3 files / 16 tests ✅；i18n runtime 4 files / 8 tests ✅；full workspace type-check/lint/build ✅；`git diff --check` ✅。隔离 `OPENCHAMBER_DATA_DIR` Web QA（未启动/终止 installed OpenCode）确认 Context rail 在 draft 上显示 `OpenChamber QA / Local / owning directory`，quota 从 Loading 收敛为 `63% remaining · 4 providers`，无布局溢出；MCP 因隔离 external OpenCode 故意不可达而显示 `Unavailable`。控制台仅有预期的 external OpenCode 400 bootstrap/SSE 错误。

至此 [#140](https://coding.s-s.city/songsong/openchamber/-/issues/140) 的 active-only embedded chat、draft target project/MCP/usage 与 subagent read-only/prompt sync 均已覆盖，可在 matching-surface 通过后关闭。

### #142 Phase 1：Instance-scoped Integrations catalog contract（2026-08-30）

上游最终范围：`f5823ccad` 到 `5486d472e`。v1.19 初版曾列 Claude Code、Command Code、Cursor，v1.20 发布前已撤下不可安装的 Command Code；最终 installable catalog 只有 `@openchamber/opencode-claude` 与 `@openchamber/opencode-cursor`，Command Code 只保留 quota provider。本 fork 不恢复被上游主动删除的入口。

- 新增纯 catalog state machine：精确匹配 package/version spec，区分 user/project entries、重复 user entry、install/update/setup/manage 与 restart/registry/provider unavailable 展示状态。
- 新增 `integrationCatalogApi`，所有 list/registry/install/update/remove 都要求 Settings-selected instance 的显式 `baseUrl`；direct local、aggregated remote 与 relay 继续走 `runtimeFetch + resolveApiUrl`，不读取 active Session、active project 或 `opencodeClient.getDirectory()`。
- registry lookup 失败与 plugin list 成功明确区分：保留已安装状态并标记 npm unavailable，不把暂时网络失败伪装成空 catalog。
- mutation 保留后端 `restartDeferred / requiresManualRestart / reloadFailed` contract，后续 UI 直接接现有 server-side Apply & Restart accumulator，不复制上游已删除的 client-only pending store。

验证：catalog/API Bun 2 files / 10 tests ✅；UI type-check/lint ✅；`git diff --check` ✅。[#142](https://coding.s-s.city/songsong/openchamber/-/issues/142) 保持 open，下一 phase 接 Settings 页面、Provider setup、remove confirmation、11 locale 和 matching-surface QA。

### #142 Phase 2：Installable Integrations Settings surface（2026-08-30）

- 新增 local/remote 都可见的 Settings → Integrations 单页，并标为 experimental；Claude Code / Cursor 使用原生 Collapsible、Provider logo、状态 badge 与 install/update/setup/docs/remove actions。
- 页面 catalog state 只属于当前 Settings instance；切换实例会 abort 旧请求并清空 entries、registry、pending action、展开状态与 remove target，迟到响应不能覆盖新实例。
- install/update/remove 固定写 user scope，保留原始后端错误到 toast；remove 必须经过确认。重复 user entries 转到完整 Plugins 管理页，不猜测应该删除哪一个。
- setup 在 provider 真正出现在所选实例的 `/api/config/providers` 后才跳到 Providers；remote 同样检查 remote provider list，不用 local configStore 冒充。
- 服务端 pending restart snapshot 与 `openchamber:pending-config-restart` 实时事件接入页面；切页/重开仍显示 Apply & Restart 提示，pending 时禁止过早进入 provider setup，Apply 完成后清除本地 restart flag。
- Integrations metadata、导航 icon、beta badge 与 11 runtime locale 全部接入；翻译 fragment 以 English key contract 做 parity test，且明确没有已被上游撤下的 Command Code 安装文案。

验证：catalog/API/metadata/i18n Bun 4 files / 13 tests ✅；full workspace type-check/lint/build ✅；`git diff --check` ✅。隔离 `OPENCHAMBER_DATA_DIR` local Web QA（不启动/终止 installed OpenCode）确认 Settings nav 出现 `Integrations beta`，页面只显示 Claude Code/Cursor、没有 Command Code；展开 Claude 显示 Install + Docs 且未安装时不显示 Remove，布局无溢出。aggregated remote URL contract 由 API test 固定为 `/api/remote/:id/config/plugins[/registry|/entry]`；本轮未对真实 Dev 实例执行安装 mutation。

至此 [#142](https://coding.s-s.city/songsong/openchamber/-/issues/142) 的最终 v1.20 catalog、local/remote instance routing、install/update/setup/remove、Apply & Restart 恢复、11 locale 与 matching-surface 均已覆盖，可关闭。

### #143 Phase 1：Server-owned Project context storage（2026-08-30）

上游来源：`889456d5b` 的 `project-context` 子域。先迁数据唯一写者与 routes，不提前覆盖 fork 现有 Notes surface：

- 新增 `<projectsDir>/<projectId>/context.json`（version 2）与 `plans/*.md`；notes/todos/plan manifest 不再与 scheduled tasks、project actions、draft starters 等六类数据共写 `<projectId>.json`。
- 所有写入采用同目录临时文件 + rename，projectId 级 promise lock 串行化 read-modify-write；note patch、todo replace、plan edit/pin/delete 只修改各自字段，不能互相回滚。
- 区分 missing / malformed / I/O failure：missing 是 authoritative empty，malformed 显式 500，不把损坏文件伪装为空数据并覆盖。
- legacy `projectNotes/projectTodos/projectPlanFiles` 首次读取时幂等迁移；先持久化新 context，再删除旧 key。绝对 plan path 会恢复到新 plans 目录；丢失 markdown 的死链接不写入 manifest。
- HTTP routes 覆盖 note/todo/plan CRUD、pin、inline raw plan save；body shape、project traversal、unknown item 与 malformed storage 有明确 400/404/500。
- runtime 通过 `feature-routes-runtime` 注册并由默认/remote OpenChamber server 自身承载；客户端后续只需针对所选实例使用 `/api/project-context/:projectId`，不再读取本机 home path。

验证：project-context runtime + HTTP Bun 2 files / 75 tests ✅；Web type-check/lint ✅；`git diff --check` ✅。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open：下一 phase 接 fork Notes UI store/API 与旧 panel 迁移，随后是 session knowledge pins 和 feature-gated Agent memory。

### #143 Phase 2：Project context client cache + remote authority（2026-08-30）

- 新增 `projectContextApi`，UI 只使用 note/todo/plan id 与 HTTP contract，不拼接 `~/.config/openchamber` 或绝对 plan storage path；所有失败抛出，authoritative load 不返回伪 empty。
- `ProjectRef` 扩展 `serverId`；request base 由显式 project server 解析为 local 或 `/api/remote/:serverId/project-context/:pathDerivedId`。同一路径 local/Dev3 得到不同 transport，且 storage id 仍只由路径派生，避免 settings project id 版本变更造成“数据消失”。
- 新增 `useProjectContextStore`：按 path-derived project id 缓存；load failure 保留 last-known-good，note/todo/plan 分组 mutation flags 防止慢 load 覆盖新写入。
- 每项目 write chain 串行化 optimistic mutations；失败回滚并保留 error，server 404 会删除已不存在的 note/plan，不复活 phantom row。create 等待 server id/timestamp，不插入打不开的假 row。

验证：project-context store + authority Bun 2 files / 35 tests ✅（另有 Phase 1 server 75 tests）；UI type-check ✅；lint/diff check 在本 phase 提交前复跑。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open，下一 phase 切换 Project Notes surface。

### #143 Phase 3：Fork Project Notes surface → Project knowledge（2026-08-30）

- 右侧 Notes/Context surface 从旧单列 `ProjectNotesTodoPanel` 切到 server-backed Project knowledge：Notes / Todo / Plans 三段右侧导航、统一搜索和计数、可拖动 section 宽度。
- Project owner 不再取全局 `activeProjectId/projects[0]`：以 `useEffectiveDirectory` 的当前 Session/draft/worktree 目录，通过 `resolveProjectForSessionDirectory`（含 sibling worktree map）解析 owning project，并把 `serverId` 写入 `ProjectRef`。找不到 owner 时显示 missing-project，不偷用本地项目。
- Notes 变为独立卡片：新增、三行折叠、单项展开编辑、400ms debounce、空正文不保存、外部更新只在本地 draft 未改时采纳；失败显示 store raw error。
- Todos 保留 add/toggle/delete/clear/reorder 与发送到 current/new/worktree Session，但 storage 改为独立 todos route；optimistic failure 回滚，筛选时仍对完整 list 写入。
- Plans 通过 id 导入/删除并在原 panel 内懒加载 `PlanView`；PlanView 增加 `projectPlanId`，从 project-context route 读取/350ms 保存 raw markdown，不暴露/重建 storage path，标题由保存后的 markdown 重新派生。
- 本 phase 暂不显示 pin 控件：上游最终语义是 **session/draft scoped pin**，不是 project-level `pinned`。在 session-knowledge runtime 到位前隐藏，比先写成错误的全项目 pin 再迁移更安全。
- 新增 Project knowledge locale fragment（11 runtime locales）和 Plan load failure 文案；UI 仅使用现有 theme tokens。

验证：Project context store/authority/i18n Bun 3 files / 36 tests ✅；Phase 1 server 75 tests ✅；full workspace type-check/lint/build ✅；`git diff --check` ✅。隔离 `HOME + OPENCHAMBER_DATA_DIR` Web QA（不接 installed OpenCode）确认 Project notes surface 显示 Notes/Todo/Plans、没有提前出现 Memory/Pin；UI 新建 note 后生成独立 `.../projects/<path-id>/context.json` version 2，刷新页面后 note 与 `Notes 1` 仍在，且真实 `$HOME` 项目数据未读写。

[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open：session knowledge pins + compaction/scheduled/agent-dispatched delivery、Agent memory 尚未移植。

### #143 Phase 4：Session-scoped pins + uniform knowledge delivery（2026-08-30）

- 新增 server-owned `session-knowledge`：pins 存在 `session.metadata.openchamber.project_context_pins`，delivery signature 存在同一 Session metadata；note edit/plan title change 会改变 signature 并触发下次重发。
- assembled block 只含当前 Session/draft pinned note 与 plan body；总预算 8,000 chars 且截断显式标记。单个 plan 读失败显示 `(plan content unavailable)`，不会静默把 attachment 丢掉。
- regular UI send、draft first send、scheduled task、OpenChamber Agent-dispatched Session 均在 prompt 前从同一 runtime 获取知识，在 prompt 被接受后才记录 delivered；失败 send 下次仍携带。
- compaction 与 context-obligatory 合并成同一个 synthetic turn，避免连续两条系统恢复消息；cursor 与 knowledge signature 同一次 metadata patch。aggregated remote compaction 不读本机知识：由 remote OpenChamber 自身 runtime 处理，防止 Dev3 目录落进 local storage。
- server owner 以最长 registered project path 解析，linked sibling worktree 通过 `git rev-parse --absolute-git-dir/--git-common-dir` 回到 primary checkout；无法解析时返回 empty，不取 projects[0]。
- UI `sessionKnowledgeApi` 显式接受 serverId；local 与 `/api/remote/:id/session-knowledge` 分流。draft pins 随 create metadata 一起 materialize；现有 Session pin mutation 清空 delivered signature。
- Project Knowledge Note/Plan pin controls现已启用；draft 使用 draft-local pins，Session 使用 server summary/pin routes。Agent Memory 仍显式 disabled，不混入 knowledge block。
- 修复 `openchamber-sessions/service.test.js` 的旧 mock：prompt accepted 后返回新增 user message，使测试覆盖真正的 landed contract，而不是固定历史导致 5s timeout。

验证：session runtime/project owner/service 3 Bun files / 24 tests ✅；scheduled runtime 11 tests ✅；UI pin authority/store 2 files / 35 tests ✅；context-obligatory Vitest 7 tests ✅；full workspace type-check/lint/build ✅；`git diff --check` ✅。隔离 `HOME + OPENCHAMBER_DATA_DIR` Web QA 新建 note 后确认 draft 显示 `Pin to agent context`，点击切换为 pressed 的 `Unpin from agent context`；未 materialize Session（external OpenCode 故意不可达），metadata/delivery 由 runtime/service tests 覆盖。

[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open，仅余 feature-gated Agent Memory 与 v1.21 owning-project follow-ups。

### #143 Phase 5：Feature-gated Agent Memory storage/routes（2026-08-30）

- 新增 global (`<userConfigRoot>/memory.json`) 与 project (`<projectsDir>/<projectId>/memory.json`) 两个独立 store；global 上限 60、project 上限 200，title/body/type/provenance 有长度与 shape 约束。
- create 对 exact title 与 >=75% meaningful-token overlap 做 restatement replacement，避免同一事实换句话后无限堆积；concurrent writes 有 scope-level lock，满 store 仍允许更正已有 entry。
- read 每次重跑 prompt-injection threat patterns；命中项保留并 `flagged`，但 session knowledge index 排除。既不静默删除证据，也不把可疑指令带给 Agent。
- routes 只提供 panel read/update/delete；Agent create 仍留给下一 phase 的 managed tool。scope 缺失、project scope 无 projectId 必须 400，绝不回退 global。
- 双门控：build-level `OPENCHAMBER_MEMORY_ENABLE` + settings `agentMemoryToolEnabled`。任一关闭时 routes 返回 `{disabled:true}` 404，未知 setting 503；session knowledge 也不读取 memory。
- memory project resolver 已覆盖 configured worktree、linked sibling worktree、managed Chats root、非 git fallback 与无目录 fail closed。当前 routes/runtime 已注册，但默认 feature flag unset，运行面完全不可见。

验证：Agent Memory runtime/feature/resolver/threat Bun 4 files / 59 tests ✅；HTTP routes Vitest 20 tests ✅；session knowledge memory filtering 20 tests ✅；Web type-check/lint ✅；`git diff --check` ✅。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open：managed Agent tool/actions、UI Memory tab/settings 与 v1.21 follow-ups 尚未完成。

### #143 Phase 6：Scoped managed Agent Memory tool（2026-08-30）

- 新增 `memory.list/read/save/delete` core actions；project scope 只从当前 Session directory 经 memory project resolver 解析，模型提供的 projectId 不取得写入权威。global/project 不明、setting 关闭、store 读取失败均显式报错。
- managed plugin 将 `openchamber`、`openchamber_web`、`openchamber_memory` 分开生成。Memory 默认不存在；只有 build-level feature gate 与 persisted setting 同时开启时注入。仅开 Memory 不会把控制/浏览器工具一并带回。
- Memory tool 只接受 `title/body/scope/memoryId/type`，不能调用 browser/session action。工具内可使用简写 `read/list/save/delete`，loopback bridge 在进入 core service 前归一为 canonical `memory.*`，payload 也同步 canonicalize。
- 写入成功广播 `openchamber:agent-memory-changed`；UI 后续可据此刷新，不需要轮询。managed local authority、loopback bearer 与 external OpenCode no-injection 约束保持不变。

验证：Agent tool + HTTP routes Vitest 2 files / 25 tests ✅；Agent Memory actions/runtime/flag/resolver/threat Bun 5 files / 88 tests ✅。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open：UI Memory tab/settings 与 matching-surface QA 尚未完成。

### #143 Phase 7：Project Knowledge Memory review surface（2026-08-30）

- 新增显式 `ProjectRef(serverId + path)` Agent Memory client。local、aggregated/direct remote 通过 project owning server 路由；projectId 始终从 path 派生，不信任 mutable project id。
- 窄 Zustand store 区分 disabled、enabled-empty、fetch failure；失败刷新保留 last-known-good global/project lists，不把断线解释成记忆被清空。update/delete 只替换目标 scope。
- Project Knowledge 只在 server 明确 enabled 后显示第四个 Memory 页签；默认 feature flag 关闭时完全不可见。项目/全局分区同时展示，可搜索、刷新、编辑 title/body/type；flagged 内容明确说明已从 agent context 排除。
- 删除采用两步确认，不会首次点击即丢数据。UI 不提供 create：记忆创建仍只属于受约束的 managed Agent tool，用户界面用于 review/correct/delete。
- Memory 文案进入 11-locale key contract；中文简繁有本地化，其余 locale 先使用 English fallback，保证无裸 key 并等待后续翻译贡献。

验证：Agent Memory API/store/i18n Bun 3 files / 7 tests ✅；full workspace type-check/lint/build ✅；隔离 `HOME + OPENCHAMBER_DATA_DIR + OPENCHAMBER_MEMORY_ENABLE=1` matching-surface QA 验证 `Memory 2`、global/project read、project edit persisted、global unchanged、delete first click only enters confirm。正式 runtime 未替换。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) 保持 open：`agentMemoryToolEnabled` Settings/persistence wiring 与 managed OpenCode reload QA 尚未完成。

### #143 Phase 8：Agent Memory Settings + managed restart（2026-08-31）

- `/api/config/settings` 增加只读 `agentMemoryAvailable`，来自 server env feature gate；stored `agentMemoryToolEnabled` 独立返回。feature unavailable 时 Settings 不显示开关，不让用户启用无调用方功能。
- `agentMemoryToolEnabled` 加入 UI store、Desktop/Web settings contract、host sync/sanitize 与 11-locale Settings 文案；默认 false。toggle PUT 失败时回滚，PUT 成功但 restart 失败时保留已持久化意图并显示原始错误，Footer 可继续 Apply & Restart。
- toggle 显式 flush debounced settings PUT 后才 apply pending restart，避免 accumulator 仍为 0 的 race。server 只在布尔值真实变化时登记 `scope=agent-memory`，普通 settings PUT 不触发 restart。
- Agent Memory scope 强制 process restart，不走默认 config hot reload：managed plugin 工具集合只在 process start 的 `prepareManagedOpenCodeEnv` 生成，hot reload 无法可靠增加/移除 `openchamber_memory`。
- 对应提交：`b3bcab886 feat(memory): expose feature availability`、`b057f0758 feat(memory): persist tool preference`、`356838997 feat(memory): add managed tool setting`、`776b199be fix(memory): force managed plugin restart`。

验证：Settings/persistence/routes/restart/i18n focused 4 files / 62 tests + restart focused 2 files / 24 tests ✅；full workspace type-check/lint/build ✅。隔离 `OPENCHAMBER_DATA_DIR + OPENCHAMBER_MEMORY_ENABLE=1` matching-surface QA：开关只在 available 时出现；首次测试复现并修复 debounce/apply race 与 hot-reload 假重启；最终 enable 从 port `63110` 强制重启到 `65221`，lifecycle 有完整 stop/spawn/ready/restart_completed，pending=0，settings=true，generated plugin 含 `openchamber_memory`，页面 reload 后 checkbox 仍 checked/enabled。隔离 UI/server/OpenCode 已停止，正式 runtime 未替换。[#143](https://coding.s-s.city/songsong/openchamber/-/issues/143) v1.20 scope 完成；跨实例 Settings mutation 归 [#154](https://coding.s-s.city/songsong/openchamber/-/issues/154)。

### #149 Phase 1：`/btw` metadata authority + transient panel state（2026-08-30）

上游来源：`0d51d52c0`、`c5877c28a`，先落不触碰 dirty ChatInput/Sidebar 的基础合同：

- parent metadata 的 `btwSessionID` 是 panel identity；fork metadata 的 `kind=btw + originalSessionID + btwBoundaryMessageID` 是隐藏/ownership/boundary authority。UI store 只保存 collapsed/creating/destroying，不保存 fork identity。
- fork marker 替换继承来的整个 `openchamber` namespace，防止 review/btw link 从 parent 泄漏；unlink 仅删除仍指向 expected fork 的 link，迟到 cleanup 不会清掉后来创建的新 fork。
- promote 删除 live marker 并保留 `btwPromoted=true`。旧 side-session boundary parts 已进入 transcript，后续正式 Session 必须据此持续发送 revocation notice，不能假设 metadata 清除会删除历史 instruction。
- `btwBoundaryMessageID` 只作为 identity marker。当前 fork 的 message chronology 已支持 ID rollover，后续 tail filter 必须在 authoritative chronological array 中定位 marker 后 slice；明确拒绝上游原始 `message.id > boundaryId` 字典序比较。

验证：Session btw metadata + UI store Bun 2 files / 7 tests ✅；UI type-check/lint ✅。[#149](https://coding.s-s.city/songsong/openchamber/-/issues/149) 保持 open：下一 phase 接 completed-turn fork/send lifecycle、tail filter、panel/command/sidebar hiding 与 matching-surface QA。

### #149 Phase 2：Completed-turn fork + isolated send lifecycle（2026-08-30）

- `/btw` 从 parent Session 的 authoritative `serverId + directory` 解析 SDK；fork 注册同一 server、使用 server canonicalized directory，并在进入 child/global store 前完成 marker mutation，避免 sidebar 短暂闪现未标记 fork。
- parent messages 先走 shared chronology contract，定位最后一个 `time.completed` assistant；mid-turn `/btw` 不继承正在 streaming 的半截 turn。无 completed assistant 时保留 upstream fork-at-HEAD fallback，但首条消息仍立即携带 boundary instruction。
- boundary instruction 将继承历史降为 reference，禁止继续 parent plan/approval/tool、禁止 subagent，并默认禁止 workspace mutation；每次 btw send 都必须携带。promoted Session 每次 send 改携带 revocation notice，因为已落 transcript 的 boundary parts 无法删除。
- 首次 send 失败：compare-and-unlink parent 后删除 fork；marker/link/insert 任一步失败也清理 fork。destroy 先 unlink 再 delete，promote unlink parent + `btwPromoted` marker + 按 fork directory/server 导航。
- tail records 用 `time.created` + shared tie-break 排序，按 boundary identity 的实际 index 后 slice。marker 缺失时 fail closed 返回空；ID rollover 后的 lexical-small later message 仍正常显示。

验证：btw chronology/instructions/lifecycle + metadata/store Bun 3 files / 12 tests ✅；UI type-check/lint ✅。[#149](https://coding.s-s.city/songsong/openchamber/-/issues/149) 保持 open：ChatInput `/btw` dispatch、panel、session-list hiding、delete/archive cleanup 与 matching-surface QA 待续。

### #149 Phase 3：Side-conversation panel + lifecycle completion（2026-08-30）

- ChatInput 注册 `/btw` built-in command；expanded panel 时普通 send/stop 路由到 fork，collapsed 时 composer 回 parent。Queue/steer 和 parent blocking-request dismissal 不会误作用到 fork；response-style first-message instruction 不进入 btw。
- panel identity 只来自 parent metadata link + fork live record；支持 streaming tail、Question/Permission、Working row、ResizeObserver stick-to-bottom、Esc collapse、移动端 visualViewport 高度钳制、Destroy 和 Promote。
- `peek` chat surface 隐藏 user copy/fork/pin actions、assistant actions 与 turn footer，保留消息本体；panel 不是第二个完整 chat 页面。
- temporary fork 在 Sidebar、desktop/mobile switcher 和 Command Palette 中隐藏；Promote 去 marker 后恢复正常可见。Sidebar 文件已有并发 WIP，本轮用独立 temporary Git index 只提交 2 行过滤，未纳入其余 58 行工作树改动。
- delete/archive 统一执行 linked-session cleanup：移除 fork compare-and-unlink parent；移除 parent 先 unlink 再删除 temporary fork；迟到 cleanup 不能清除 newer link。单删、指定目录删除、批量归档（经单项 archive）均覆盖。
- `/btw` i18n key contract 覆盖 11 locales；简繁中文本地化，其余暂用 English fallback。
- 现场修复 fork boundary：OpenCode 会为 cloned messages 生成新 ID，因此 fork 后、首发前从 fork 自己的 `session.messages(limit=1)` 读取最后继承消息 ID。继续使用 parent fork-point ID 会导致 marker 在 fork transcript 中不存在，panel 正确 fail closed 但永久 Loading。

验证：btw metadata/core/policy/command/i18n 6 files / 19 tests ✅；full workspace type-check/lint/build ✅。隔离 `HOME + OPENCHAMBER_DATA_DIR + OpenCode 1.18.23-sscity` QA：创建 completed parent → `/btw` → side answer → sidebar hidden → collapse 恢复 parent composer → expand 恢复 fork → Promote 显示正式 Session → 后续 user message 含 `BTW_PROMOTION_NOTICE` synthetic part；测试 Sessions 全部删除，正式数据/runtime 未触碰。[#149](https://coding.s-s.city/songsong/openchamber/-/issues/149) v1.20 scope 完成。v1.21 completed-turn/reference/boundary/panel-authority follow-ups与真实 Capacitor narrow-screen QA 已拆至 [#173](https://coding.s-s.city/songsong/openchamber/-/issues/173)，不再阻塞 v1.20 closeout。

### #150 Phase 1：Multi-instance managed Chats directory authority（2026-08-30）

上游来源：`26ee335ff`。不移植其 process-global `opencodeClient` 目录解析：

- managed projectless Chat 存放在 owning instance home 下的 `.config/openchamber/chats/YYYY-MM-DD/session-<uuid>`；`CHAT_DRAFT_PROJECT_ID=openchamber:chats` 仅是 UI identity，不伪造项目。
- `createChatDirectory({serverId})` 先通过该实例 `/api/fs/home` 获取 authoritative home，再用同一 base URL `/api/fs/mkdir`；remote aggregated/direct/relay 均由 `runtimeFetch + resolveApiUrl` 路由。cache key 为 `runtimeKey + serverId`，不同实例不会共用 home。
- delete 重新解析同一 server root，只允许 root descendant；项目路径和其他实例 path 不执行删除。mkdir/delete 显式标注 outside-workspace，但 target 必须先由 server home 派生或通过 root boundary。
- helper 可识别 POSIX/Windows home、从 session directory 回推出 Chats root，并按 runtime authority 预热。

验证：chatDirectories Bun 3/3 ✅（local date scope、remote home/mkdir/delete same-instance、project path refusal）；UI type-check/lint ✅。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：draft materialization、server/session ownership、Chats sidebar/mobile/search、folder/action cleanup 与 matching-surface QA 待续。

### #150 Phase 2：Projectless Chat draft materialization + cleanup（2026-08-30）

- `NewSessionDraftState` 增加 `target=project|chat`、monotonic `draftId`、`chatServerId` 与 `preparedChatDirectory`。现有入口默认仍为 project，显式 `target:'chat'` / `CHAT_DRAFT_PROJECT_ID` 才启用，等待 Sidebar/App 入口完成后再切 upstream 默认。
- prepare 以 `runtimeKey + serverId + draftId` single-flight；late completion 会核对 runtime、draft identity、target、server，任一变化即删除刚创建目录。重复 materialize 复用 prepared directory。
- close、Chat→project target switch、create 失败清理 prepared directory；successful create 在 close 前解除 prepared ownership，避免把已归 Session 所有的目录误删。
- `materializeOpenDraftSession` 与 ChatInput first-send 两条路径都跳过 project/worktree fallback，使用 Chat 显式 serverId 和 managed directory；projectId 保持 null，不持久化成 last project target。
- Session 创建后仍继承 permission intent、model/agent selection、pending-message recovery、knowledge delivery 与 normal routeMessage；不继承 project/worktree identity。
- server-confirmed delete 识别 managed Chat directory 并在 session state 清理后异步删除同实例目录；archive 保留目录，因为 Session 仍可恢复。

验证：session UI store 21/21（含 remote prepare/cancel/materialize/no-success-delete）+ chatDirectories 3/3，需分文件运行以避免 Bun module mock 污染；full workspace type-check/lint ✅。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：Chats source/cache/folder ownership、Sidebar/Mobile/Search 入口、default target 切换与 matching-surface QA 待续。

### #150 Phase 3：Managed Chats cold-start catalog（2026-08-30）

- 当前 fork 已移除通用 Session localStorage cache，故不恢复 upstream `persist-cache` 方案；新增独立 `managed-chats-cache`，最多 50 条，只保存 `.config/openchamber/chats/` Session。
- cache key 按 runtime endpoint hash 隔离；remote Chat 副本携带 `openchamberServerId`，读取时重建 `sessionId → serverId` registry，避免 Dev3 Chat 被当成本地同路径 Session。
- global Sessions store 首屏从 cache 恢复 Chats；随后 root/session snapshots 仍是 authoritative source。active list 变化时只重写 managed subset，项目 Sessions 永不进入该 cache。
- VS Code runtime 的 snapshot apply 与 live upsert 都过滤 managed Chats，保持上游 project-only 合同；Desktop/Web/Mobile 保留。
- malformed/cross-runtime cache fail closed，不清理或替换 server state。

验证：managed Chats cache 2/2 + global session paging 7/7（分文件），UI type-check/lint ✅。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：folder root ownership、Sidebar/Mobile/Search 入口、default target 与 matching-surface QA 待续。

### #150 Phase 4：Composer Chats target + folder root ownership（2026-08-30）

- Desktop/Web composer 的 draft project selector 增加 Chats；选择后 `target=chat`、project sentinel 仅用于 UI，branch/worktree selector 隐藏。serverId 继承当前实例，切回项目触发 prepared directory cleanup。
- 仍保留现有“新会话”默认 project，防止 Sidebar/App 入口尚未接完时半切默认；最终入口收口后再按 upstream 改为 Chats default。VS Code 不显示该 selector，继续 project-only。
- Chat Session 加入 folder 时 scope 从 daily/session directory 归一到 Chats root；不同日期的 Chats 共用一套 folder tree，不产生每 Session 一个 folder scope。
- mobile/desktop switcher 使用 global catalog；projectless Chat 的 projectId 为 null，在 unscoped mobile sheet 可见，在 project-scoped dropdown 不泄漏。
- Chats label 进入 11-locale contract；简繁中文本地化，其余 English fallback。

验证：Chats i18n 1/1、session UI store 21/21、cache 2/2；UI type-check/lint ✅。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：Sidebar dedicated Chats section/default new-chat entry、search、App/Mini Chat parity 与 matching-surface QA 待续。

### #150 Phase 5：Sidebar managed Chats source（2026-08-30）

- 新增纯数据源 helper，从 Session 自身的 authoritative directory 识别 active managed Chats；归档 Chat 与普通 project Session 不进入 Chats section。
- Chats root 优先由当前实例的 Session 路径反推；本机 home 仅在与该实例推导根一致时采用，避免远程 Session 被本地 `.config/openchamber/chats` 覆盖。
- source 同时提供统一 Chats root 与各 daily/session directory scope，供后续 dedicated Sidebar section、folder lookup 与 search 共用；不同日期仍归入同一 Chats 根。
- 对应提交：`cc4b0b9ae feat(chats): derive sidebar source`。

验证：managed Chats sidebar source 2/2 ✅（project/archived exclusion、remote root authority、multi-date folder scopes）；UI type-check/lint ✅。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：把 source 接入 dedicated Sidebar section/default new-chat entry、search、App/Mini Chat parity，并完成 matching-surface QA。

### #150 Phase 6：Dedicated Chats sidebar + search（2026-08-30）

- Sidebar catalog 允许 managed Chats 进入非 VS Code runtime，但 project/worktree ownership 仍由原有路径规则决定；Chats 不伪装成项目，也从 Recent activity 中排除，避免重复行。
- Chats 按 `serverRegistry` 的 Session ownership 分实例；每个实例使用独立 root、folder scopes 与 `serverId`，远程 Chats 不会借用本机 home。父子 Session 由纯 helper 构建，BTW 临时 fork 继续隐藏。
- dedicated Chats section 使用共享 `SessionGroupSection`，因此 folder drag/drop、folder 内新建、Session actions、父子展开与 pinned 行保持一致；folder/group 新建会显式传递 `target=chat + chatServerId`。
- Chats section 空时仍保留创建入口；点击后 composer target 为 `Chats / openchamber:chats`。Sidebar 搜索同时覆盖 Chat title、子 Session、instance label、Chats root 和 folder name，并将命中数合入统一计数。
- 没有 project 或 project 搜索无结果时，独立 Chats 内容仍能渲染；VS Code 保持 project-only。
- 对应提交：`9866e6961 feat(chats): partition sidebar sources by instance`、`625635b6e feat(chats): add sidebar activity surface`、`6029c8bea feat(chats): preserve folder draft target`、`e4a3a02e1 feat(chats): wire managed sidebar sessions`。

验证：managed Chats source 3/3 + Chats i18n 1/1、UI type-check/lint ✅。隔离 Electron dev matching-surface QA：空 Chats section + create action ✅；专用 Chats composer target ✅；临时 managed Chat live insert ✅；搜索 `Chats` 命中并显示该 Session ✅；清空搜索后只出现一次、未重复进入 Recent ✅；测试 Session 已删除，隔离 dev/OpenCode 已停止。控制台仅见启动 503 fallback、测试 Session 删除后的预取 404，以及既有 TempSessions/ModelControls Base UI button 语义警告，均非 Chats 代码路径回归。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) 保持 open：App/Mini Chat parity、真实 remote multi-instance 与 Capacitor mobile matching-surface QA 待续。

### #150 Phase 7：Main/Mini Chat + Context parity（2026-08-30）

- 空配置 Electron Mini Chat 与其快捷键现在显式创建 `target=chat`；有 directory/project 参数时才创建 project draft。Mini Chat 返回主窗口时沿用同一判定，不再把空参数恢复成活动项目草稿。
- 修复 Mini Chat 双自动建草稿竞态：`MiniChatBootstrap` 是唯一 draft bootstrap；`ChatContainer autoOpenDraft` 不再抢先按旧默认创建 project draft。
- Mini Chat/Header 在 Chat context 隐藏 project、branch 与 git status；打开/返回 Mini Chat 时，既有 Session 使用 Session 自身 directory，Chat draft 不再回退到活动项目路径。
- Right Context panel 在已知 Chats root 时使用 `CHAT_DRAFT_PROJECT_ID + root + serverId`，保持 Memory/Notes owner 与实例一致；远程空白 draft 在远端 home 尚未知时 fail closed，不用本机 Chats root 代替。
- 对应提交：`ef9b0d64a feat(chats): align mini chat surfaces`、`0b773e67b fix(chats): restore draft target from mini chat`、`4490a72dd fix(chats): serialize mini chat draft bootstrap`。

验证：UI type-check/lint ✅。隔离 HMR `/mini-chat.html?mode=draft` 首轮复现 project draft 竞态（Header/composer 显示 `song`），修复后重载只显示 New session、无 project/branch/target path ✅；无新增控制台错误，既有 ModelControls Base UI warning 单独保留；QA backend/OpenCode 已停止。[#150](https://coding.s-s.city/songsong/openchamber/-/issues/150) v1.20 scope 完成。v1.21 Chat-own-directory autocomplete、真实 remote multi-instance 与 Capacitor sessions surface QA 已拆至 [#174](https://coding.s-s.city/songsong/openchamber/-/issues/174)，不再阻塞 v1.20 closeout。

### #141 Phase 1：Isolated server exception survival（2026-08-30）

上游来源：`71a538b77`。fork 的 embedded server 没有外部 supervisor，单个 Node/socket stray exception 不应让整个 OpenChamber instance 离线：

- `uncaughtException` 现在记录并继续服务；滚动 60 秒窗口内超过 10 次才执行既有 graceful shutdown，避免真正异常风暴下半失效运行。
- `unhandledRejection` 保持既有非致命日志策略；SIGTERM/SIGINT/SIGQUIT graceful path 不变。
- 3 Vitest tests 覆盖单次异常、11 次风暴和 rejection，full type-check/lint/diff check ✅。
- 上游 dev-tunnel invalid base URL 子修复当前无对应模块：fork 尚未合并 Browser workspace/dev-tunnel（[#135](https://coding.s-s.city/songsong/openchamber/-/issues/135)），不创建无调用方 client。

[#141](https://coding.s-s.city/songsong/openchamber/-/issues/141) 保持 open：Phase 2 需要将 `538309528` 的 message chronology contract 贯穿 event reducer、history/page loader、materialization、optimistic、revert/redo 和 side-channel merge；当前仍存在多处 message/part ID 排序，不能只加 comparator 就宣称完成。

### #141 Phase 2：Message chronology across ID rollover（2026-08-30）

上游来源：`538309528`，适配 fork 的 cursor pagination、side-channel、optimistic shadow 和 inline reverted dock：

- 新增单一 `message-ordering.ts`：`time.created` 为 chronology，ID 只作 equal-time tie-break；marker slice 按当前数组位置，不做 lexical 大小比较。
- event reducer 的 message update/insert/remove 改为 identity lookup + chronological insertion；part update/remove/delta 改为 identity lookup并保留 authoritative arrival order。
- raw history loader、page boundary merge、prompt history、materialization、optimistic page/store、useSync optimistic bridge、side-channel records、Prompt Navigator source 和 latest assistant completion 统一使用 chronology contract。
- revert/new-branch/rollback 与 ChatInput reverted dock 使用 marker position；post-rollover `msg_000...` 不会被误当成旧消息，失败 rollback 仍恢复正确顺序与 parts。
- 集中 rollover integration 覆盖 reducer、part arrival、page merge、materialization 和 optimistic merge；focused suite 8 files / 108 tests ✅，full workspace type-check/lint/diff check ✅。
- 剩余 ID 排序点逐项确认属于 Session、Question、Permission，或 assistant status 已先比较 `time.created` 再以 ID tie-break；未将 message chronology 修复扩散到不同实体契约。

### #153：Post-recording dictation + waveform + pause segmentation（2026-08-30）

上游来源：`4c9e6fceb`。fork 保留现有 `/api/stt/transcribe` 和 local WASM Whisper，不引入第二套 dictation WebSocket server：

- Server/OpenAI-compatible STT 与 WASM STT 录音期间只本地排队，不再在每次短静音时转写；用户点击完成后才顺序处理所有 segments，并合并成一个 final transcript callback，避免 1.2s final settle 覆盖前段文本。
- 长录音在 60 秒后优先于自然停顿切段，连续讲话 90 秒硬切；短停顿和短录音不切。Cancel 丢弃本地队列，不上传、不推断。
- `AudioStreamService` 与 `WasmSttService` 共用 segmentation contract；stop/restart promise 避免用户恰好在自动切段时点击完成而丢尾段。
- Composer dictation 在 Web、Capacitor、desktop 共用 live waveform 与秒级计时；音量 listener 直接更新 28 个 bar DOM，不把约 12Hz 音频 level 放入 React state，processing 状态显示统一文案。
- 浏览器原生 WebSpeech 不提供受控音频帧/MediaRecorder，继续作为实时 fallback；选择 Server 或 WASM provider 时获得完整 post-recording 语义。

验证：segmentation/join + fake MediaRecorder 4 Bun tests ✅（录音中 0 次 fetch、finish 后 1 次、单 final callback）；full workspace type-check/lint ✅；Web production build ✅；`git diff --check` ✅。

### #145：OpenCode proxy connection reuse；Shiki architecture N/A（2026-08-30）

上游来源：`3c93190c9`、`a5492d5dc`、`79cbc1e9f`、`7657c5455`：

- API proxy 与 interactive OAuth proxy 共享 per-scheme keep-alive pool：30s TCP keepalive、60s idle retirement、256 free sockets、unbounded active sockets；避免每请求 `Connection: close` 导致 TIME_WAIT/ephemeral-port 耗尽。
- agent 通过 getter 在 request time 懒解析；proxy 在 managed OpenCode 启动前注册时可先得到 HTTP fallback，后续 external HTTPS runtime 会使用独立 `https.Agent`，不会错误复用 plaintext pool。
- factory/resolver 2 tests + middleware wiring 2 tests 覆盖 keepalive options、per-scheme memo、API/OAuth share 和 cold→HTTPS；full type-check/lint/diff check ✅。
- Shiki churn 子项对本 fork 明确 N/A：当前 Markdown 主 renderer 是 ReactMarkdown + `react-syntax-highlighter` Prism，不存在上游 `markdownCore.ts`、`markdown-shiki.worker.ts`、`HighlightResultCache` 三层。迁入上游 cache/worker 会引入第二套 renderer；保留此前 MERGE 决策“不迁 marked+shiki”，不创建无调用方性能代码。

### #146 Phase 1：Repository-aware generated commit / PR text（2026-08-30）

上游来源：`f70834598`、`e920e52e4`：

- commit generation 读取当前 branch 最近 10 条 subject（每条最多 200 chars），要求 Small Model 匹配仓库现有语言、prefix/scope、capitalization 与长度；无 history/读取失败时给显式 fallback，不伪造样本。
- PR generation 依 GitHub 优先级与 GitLab `Default.md` 路径探测首个 template；本地/remote/VS Code 均先走 active runtime Files API，再走 `runtimeFetch`，带 owning directory 且 optional read。
- template 截断至 8,000 chars，并用 BEGIN/END marker 声明“复用结构而非执行指令”；additional context 和 template 前各有两个换行，不再与 changed-file list/Markdown heading 粘连。
- pure formatting + real magic-prompt render 4 Bun tests / 9 assertions ✅；full workspace type-check/lint/diff check ✅。

[#146](https://coding.s-s.city/songsong/openchamber/-/issues/146) 保持 open：后续仍需 branch-vs-base Context Diff、fork PR worktree fallback 和 merged/open PR history correctness。

### #146 Phase 2：Fork PR worktree authoritative source（2026-08-30）

上游来源：`83eb0802a`，按 fork 当前异步 worktree bootstrap 结构手工移植：

- GitHub PR head 同时提供 HTTPS/SSH URL 时优先 HTTPS，公开 fork 不再无谓依赖本机 SSH agent；head repository 已删除或不可用时显示可操作错误。
- 新增 `resolveExistingWorktreeSource(primaryWorktree, input, intent)`，validate/create 以相同的显式 project primary worktree、fork remote name/URL 和 branch 解析 source；不读取 active project/current directory。
- validate 对 provisioned fork URL 执行 `ls-remote --heads`；create 先确保 remote URL，再抓取该 fork 的权威 branch。网络、凭据或 branch 缺失会在创建 worktree 前明确失败，不留下半创建目录。
- upstream remote/branch 优先采用共享 resolver 的推导结果；若目标 ref 抓取失败，bootstrap 保持 tracking unset，不再手写指向不存在 ref 的 `branch.*.remote/merge`。branch rename 的同类 fallback 也移除。
- 普通本地 branch、已配置 remote branch、异步 population/post-checkout/start-command 与 OpenCode sandbox metadata 流程保持原样。

验证：真实临时 Git repository/bare fork 测试 `service.test.js` 48/48 ✅，新增覆盖 validate/create 同源、不可达 fork 无 worktree 残留、upstream fetch 失败无伪 tracking；full workspace type-check/lint ✅；完整 Web + VS Code + mobile assets production build ✅；`git diff --check` ✅。

[#146](https://coding.s-s.city/songsong/openchamber/-/issues/146) 保持 open：仍需 branch-vs-base Context Diff 与 merged/open PR history correctness。

### #146 Phase 3：Open PR authority + merged/closed branch history（2026-08-30）

上游来源：`773691141`、`dd4a2015e`，适配 fork 当前 `directory::branch` shared PR store 与现有 Git panel：

- server 对 fork network 的每个 target 先完整寻找 open PR；只有全部 target 都无 open PR 时，才返回主 remote + 原始 branch 的最新 closed/merged PR。已合并 fork PR 不再遮住仍 open 的 upstream PR。
- repo-level open list 45s 缓存并 coalesce in-flight；complete first page 的 miss 作为权威结果。只有不完整覆盖才使用 Search API，且 Search 只查 open、miss 按 repo+branch 退避，避免耗尽低配额。
- history 只查主关联，found 缓存 6h、absent 缓存 10m、最多 500 项；OpenChamber 内 create/merge 会失效 repo open/history/search cache。
- closed/merged route 不再请求 checks 和 collaborator merge permission；这些结果不可操作。
- UI 将 terminal PR 作为 branch history：显示紧凑历史提示和 GitHub 链接，同时保留下一个 PR 的创建表单；不再加载历史 PR 的 body/context/checks/comments。
- watcher 对 terminal history 使用 5m discovery cadence；focus/visibility 从 store 读取事件发生时的 freshness。持久化 history 在 hydrate 时把 discovery timestamp 归零，立即核验新 open PR 或权威 empty。
- 10 个现有 locale 均补齐 merged/closed history 文案；样式只使用现有 border/surface/PR status theme tokens。

验证：server candidate/cache + UI watcher/hydration 共 2 files / 8 tests ✅；full workspace type-check/lint ✅；完整 Web + VS Code + mobile assets production build ✅；`git diff --check` ✅。

[#146](https://coding.s-s.city/songsong/openchamber/-/issues/146) 保持 open：仅剩 `dd4013927` branch-vs-base Context Diff。共享 `packages/ui/src/lib/api/types.ts` 当前有另一 agent WIP，下一 phase 必须在不覆盖该内容的前提下适配。

### #146 Phase 4：Branch-vs-base Context Diff（2026-08-30）

上游来源：`dd4013927`，按 fork 只有 Working/Last turn 的 DiffView、现有 runtime routing 和 dirty shared types 做兼容移植：

- Diff scope 新增 Branch，仅在已知 repository default branch 且当前 branch 不同于 default 时提供；VS Code 隐藏。metadata 未决时不错误改写 scope，detached/default/重试耗尽时才回退 Working。
- server 新增 `/api/git/branch-base`：只接受 reflog `branch: Created from <named ref>`，`HEAD@{}`、raw SHA、过期/缺失 reflog 返回 unknown，绝不猜 `main/master`。
- `/api/git/range-files` 使用 `git diff --name-status -z -C base...head`，返回 status + rename/copy destination path；per-file `/range-diff` 复用已有 endpoint。
- Web/remote runtime API 增加 branch-base/range-files/range-diff。为避免提交另一 agent 正在修改的 `api/types.ts`，契约通过独立 `gitBranchScopeApi.ts` module augmentation 注入；该 WIP 文件保持原样且不进入本批提交。
- 自动 base 不存在时显示可搜索 branch picker；显式选择按 runtime + directory + current branch 持久化，最多 100 项，不跨 instance/path 复用。
- 单文件与 stacked 模式都使用 range-key local cache；只加载 selected/expanded files，range 变化清空，旧 promise completion 不能污染新 range。Branch 内容只读，不显示工作区 editor/mutation action；Walkthrough 使用 `{ kind: branch, baseRef, headRef }`。
- QA 发现上游 picker 一旦选到无 merge-base 的 ref 只能 Retry；fork 额外增加“选择其他基础分支”，清除显式 override 后返回 picker。
- 10 个 locale 补齐 Branch/base/loading/empty/error/change-base 文案，UI 只使用现有 theme tokens。

验证：Git service 51/51 ✅（含真实 reflog 与含空格 rename destination）；branch scope pure helpers 4/4 ✅；full workspace type-check/lint ✅；完整 Web + VS Code + mobile assets build ✅；`git diff --check` ✅。独立 HMR 匹配界面 QA：Openchamber `merge/upstream` 显示 Branch 菜单和 unknown-base picker；`feature/chat-density-tweaks` 自动检测 `merge/upstream` 并显示“无相对更改”终态；API 对有共同祖先的 range 返回结构化文件列表。测试实例曾因只设 `XDG_DATA_HOME` 写到真实 settings，停止实例后已通过运行中 OpenChamber 配置 API 精确恢复 `activeProjectId`、root/local `lastDirectory`、draft target、测试 context panels 和测试 base override，并逐项 GET 验证。

[#146](https://coding.s-s.city/songsong/openchamber/-/issues/146) 的 generated text、fork PR worktree、open/history PR status 与 branch Context Diff 已全部完成，可关闭。

### #136 Phase 1：Completed-assistant compact Markdown image gallery（2026-08-30）

上游来源：`10d0ee973`、`7b8e3a561`、`e37fd63be`、`d0712d45d`、`8ac5e553a`、`763a0f474`、`56077a25e`。fork 不引入上游 marked worker renderer，直接适配现有 ReactMarkdown + ToolOutputDialog gallery：

- completed assistant 的 Markdown image syntax 在正文显示小型 image+filename label，不再插入大图；消息尾部汇总最多 12 个 unique candidates 为稳定 `100×100`（窄屏 `88×88`）缩略图，复用 fork 现有全屏预览、键盘/前后导航和 mobile overlay。
- candidate extraction 使用 fork 已依赖的 `marked.lexer` token tree，支持 inline/reference images，跳过 fenced/inline code；persisted text part 缺 `time.end` 时以 message completed authority 决定 compact，不回退大图。
- gallery 接近 viewport 才发一次 message-level local prepare；每个 thumbnail 自身接近 viewport 才设置 `<img src>`。prepare cache 按 resolver + session + message + directory + sources 隔离，最多 1024 项，non-ready 30s，grant 过期前 5s 刷新。
- 新增 message-bound grant route：server 从 owning directory 的 OpenCode message API 反查 assistant message，只批准实际 image syntax 中出现的 source。workspace image 必须 canonical path 在 directory 内；外部 image 仅允许 OpenCode 专用 temp root，拒绝 symlink escape、非普通文件、>10 MiB 和签名不匹配。
- FS 新增 path-bound `outsideFileGrant`：gallery 外部图只获 `raw` scope、10 分钟、canonical exact-path；现有 fork `allowOutsideWorkspace` 调用不带 token 时维持兼容，不在本批破坏普通文件链接。
- VS Code 暂保留既有 inline image path，不启用 gallery/compact label；上游最终通过 workspace FS bridge 支持 VS Code，fork 对应 parity 仍需 matching-surface 独立移植。

验证：client extraction/prepare/SSR compact slots 2 files / 4 tests ✅；server message-source/grant + FS path binding 2 files / 14 tests ✅；UI/Web focused type-check ✅；`git diff --check` ✅。HMR 实界面 QA 被当前另一 agent 的 sidebar/bootstrap WIP 阻断（direct `?session=` 未恢复目标 Session，页面停在空 draft），因此 [#136](https://coding.s-s.city/songsong/openchamber/-/issues/136) 保持 open，待本批完整 build 后在不共享 managed OpenCode 生命周期的隔离方式或下一次 runtime QA 中确认 thumbnail/preview 交互。

QA 事故记录：HMR server 复用了安装版 managed OpenCode `54185`，退出时向共享 PID `47219` 发出 `SIGKILL`；安装版随后卡在 restart path。已按 incident runbook 保存 lifecycle/listener/OpenChamber sample 到 `~/Desktop/openchamber-opencode-incident-20260830T074340Z`，随后只重启 OpenChamber app（未替换 shell/runtime），恢复为 healthy OpenCode `65246`；配置 API 再次确认 active project、root/local lastDirectory、draft target 均为原值且测试 base override 不存在。后续 HMR QA 禁止复用安装版 managed OpenCode。

### #136 Phase 2：VS Code compact gallery parity（2026-08-30）

- VS Code `FilesAPI.readFileBinary` 接通 extension bridge `api:fs:read-binary`，复用现有 `resolveFileReadPath(realpath)` 与 workspace canonical containment；symlink 指向 workspace 外会拒绝。
- completed assistant 在 VS Code 同样启用 compact inline image label + message-tail gallery，不再保留大图 inline 特例。
- VS Code local image prepare 只解析 session directory 内 image reference；stat 必须是 regular file 且 ≤10MiB，再通过 binary bridge 读取 data URL。absolute outside path 不发 bridge request。
- remote/data images 沿用现有 lazy thumbnail；local data URL 仍经 MIME/size validator。Web/Desktop 的 message-bound grant、temp-root 和 path-bound outsideFileGrant 不变。
- bridge failure、unsupported MIME、oversize、outside path 都留下稳定 disabled thumbnail slot，不静默改走无授权 `/api/fs/raw`。

验证：gallery assets + SSR slots + VS Code binary bridge 3 files / 9 tests ✅；UI/VS Code type-check/lint ✅；`git diff --check` ✅。结合 Phase 1 的 18 条 client/server safety tests 与完整 builds，[#136](https://coding.s-s.city/songsong/openchamber/-/issues/136) 已实现 Desktop/Web/VS Code parity，可关闭；未再启动共享 HMR，避免重复 managed OpenCode 生命周期事故。

---

## v1.21.0 → v1.21.1 差距审计启动（2026-08-30）

### 上游边界

| 版本 | tag / release commit | diff 规模 |
|---|---|---:|
| `v1.21.0` | `ad7fd3563` | 相对 v1.20.0：376 files, +23650/-12014 |
| `v1.21.1` | `6801186bb` | 相对 v1.21.0：457 files, +26427/-2354 |

本轮继续只做 capability-level 手工移植，不 merge/cherry-pick release。纯 docs、CI、maintainer triage/reviewer agent 指令和上游内部 cleanup 不建 runtime backlog。

### 新建 GitLab executable backlog

| WI | Runtime scope | 风险 |
|---|---|---|
| [#160](https://coding.s-s.city/songsong/openchamber/-/issues/160) | Session tabs + centralized shortcut registry | 🔴 多窗口/Session ownership |
| [#161](https://coding.s-s.city/songsong/openchamber/-/issues/161) | Anchored chat scrolling + streaming follow performance | 🔴 fork scroll/fold/prompt navigator |
| [#162](https://coding.s-s.city/songsong/openchamber/-/issues/162) | Bounded settings mutation + auto-follow preference | 🟡 当前 settings WIP 需先收口 |
| [#163](https://coding.s-s.city/songsong/openchamber/-/issues/163) | Move Session tree to existing worktree + dirty safety | 🔴 rollback/partial failure |
| [#164](https://coding.s-s.city/songsong/openchamber/-/issues/164) | Live auth expiry recovery + relay-default boot | 🔴 auth/transport lifecycle |
| [#166](https://coding.s-s.city/songsong/openchamber/-/issues/166) | Multi-project directory selection + remote tracking branch checkout | 🟡 Desktop/VS Code/Git parity |
| [#168](https://coding.s-s.city/songsong/openchamber/-/issues/168) | Provider headers/credential signals + OpenCode upgrade UX | 🟡 provider/runtime authority |
| [#171](https://coding.s-s.city/songsong/openchamber/-/issues/171) | Turkish runtime localization | 🟢 locale completeness |
| [#172](https://coding.s-s.city/songsong/openchamber/-/issues/172) | Large-text paste attachments + virtual large-file previews | 🔴 attachment/memory bounds |

### 追加到既有 work items（不重复建卡）

- `#135`：Browser capture reveal/wait (`7ffb7d6f5`, `e2dab1417`)；`browser.open` background-only (`4bed3589d`)。
- `#143`：saved plan owning-project route (`fa5446593`)；agent memory project-context owner (`1309403af`)。
- `#172`：从已完成的 `#148` 拆出 large-text paste attachment 与 virtualized large-file previews，归属 v1.21 milestone。
- `#149`：`/btw` completed-turn boundary、inherited reference、boundary cleanup、promoted authority。
- `#150`：managed Chats mobile sessions sheet + sidebar search。
- `#159`：renderer-window recovery、update-install error visibility、stale shell UI prevention。

### 已审计为现有 fork 等价 / 不重复

- Prompt Navigator quote-only user messages：fork navigator source 已从 chronology-normalized user records生成；实现时随 #161 focused regression 复核。
- Context tab close menu和 rail visibility属于现有 #62 surface rail后续，不单独建新架构卡；分别归 #161/#160 的 navigation QA。
- v1.21 内 `/btw`、Project knowledge、projectless Chats 的修复必须等待对应 v1.20 parent feature，不能先移植无调用方 patch。

v1.20.0-sscity 尚未宣布完成：当前未关闭 `#135/#140/#142-#151/#154/#156/#159`，其中多项与并行 settings/sidebar/SSH/input WIP 重叠。版本号保持 `1.18.2-sscity`，直到 v1.20 closeout gate 真正满足。

### #135 Phase 1：Browser agent control plane（2026-08-30）

上游来源：`cc9249d93`。先移植不依赖 dirty Electron main 的 server/control/tool 边界：

- first-claim broker 将 request 广播到 live SSE client；`browser.open` 可由任一 client 创建 view，其余 action 只投递给声明 `browser=1` 的 connection。第一个 claim 获准，其他 client 必须不执行。
- 无 capable client 立即 503；claim 后无结果为 20s（open 45s）明确 timeout；abort、late result 和 reject-all 均有确定语义。
- control service 增加 open/snapshot/click/type/scroll/back/forward/inspect/capture/resize 参数校验，仍要求 managed-local `serverId`；只允许 absolute HTTP(S)。
- capture base64 不回传模型，由 server 写入 authoritative context/explicit directory 的 `.openchamber/screenshots/`，返回相对路径和 Markdown hint；label 不能形成 traversal。
- managed plugin 增加独立 `openchamber_web` tool，与 `openchamber` 分离 action enum、参数和 metadata；callback transport 与 ephemeral loopback token 共用。当前 control 开启时两者一起注入，独立 toggle 留到 settings phase。
- renderer control client、real Chromium BrowserPane、dev-server tunnel 和 Electron webview lifecycle 未移植，所以当前没有 client 宣告 `browser=1`，动作诚实 fail fast。

验证：broker + generated plugin Vitest 2 files / 6 tests ✅；control authority + SSE capability Bun 2 files / 6 tests ✅；Web type-check ✅；`git diff --check` ✅。[#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) 保持 open。

### #135 Phase 2：Authoritative dev-server discovery（2026-08-30）

- 新增 cross-platform listener scanner：macOS/Linux `lsof -F pcn`、Windows netstat、无 lsof 的 Linux/container 使用 `/proc/net/tcp{,6}` fallback。
- 只保留 loopback/wildcard bind；排除 LAN-only（localhost 无法访问）、OpenChamber/OpenCode own ports、当前 scanner PID 和短 infrastructure denylist。
- 成功扫描 3s cache；失败不 cache，并由 `/api/dev-servers` 返回 503，明确区分“没有 server”和“扫描失败”。
- scanner 在 feature route composition 中单实例复用，为后续 Browser address suggestions 与 remote tunnel allowlist 提供同一权威集合。

验证：parser Bun 1 file / 4 tests ✅；Web type/lint ✅；真实 macOS lsof 只读扫描发现 254 个候选并确认排除安装版 `57123` 与 OpenCode `65246`。下一 phase 接 UI BrowserPane/address suggestions，再将同一 scanner 接 dev tunnel。

### #135 Phase 3：Remote dev-server raw tunnel（2026-08-30）

- host 新增 `/api/dev-tunnel?port=` WebSocket raw-byte bridge，只能连接同一 authoritative scanner 当前报告的 loopback/wildcard listener；不是任意 loopback proxy。
- OpenChamber own-port 集合改为 request-time 读取 `tunnelRuntimeContext.getActivePort()`，随机端口启动时也不会把自身错误列入 discovery/tunnel allowlist。
- 有 Origin 的 browser caller 保留正常 Origin gate；无 Origin 的 desktop caller 必须是 paired-client bearer auth，普通 UI session 无权绕过 CSRF 边界。URL token 不允许替代 desktop client auth。
- desktop-side client 为每个 `baseUrl + remotePort` 复用一个随机本地 loopback listener；每条 TCP connection 使用独立 WebSocket，首包 buffer 256 KiB、handshake 15s、host connect 5s、host sockets 64 条上限。
- close/error/shutdown 使用强制对称 teardown；graceful shutdown 在关闭 HTTP server 前 dispose dev tunnel，避免半开 socket 阻塞 runtime 切换或退出。
- non-http(s) base URL 在暴露 listener 前失败，并捕获 WebSocket constructor synchronous throw，覆盖上游 v1.18.4 invalid-base crash fix。
- 当前未接 dirty Electron main / Browser renderer，因此还没有 `desktop_dev_tunnel_open` 调用方。private relay virtual endpoint 也不能直接给 Node `ws` client 使用，归 [#137](https://coding.s-s.city/songsong/openchamber/-/issues/137) 的 relay/browser-tunnel parity，不虚报支持。

验证：dev tunnel + discovery + shutdown 3 files / 17 tests ✅，含真实 HTTP host→WebSocket→local TCP 透传、allowlist/auth/origin 拒绝、stalled handshake bound 与 shutdown ordering。下一 phase 接 clean UI browser contract/control client；Electron main 需等待另一 agent WIP 收口。

### #135 Phase 4：Agent control connected to the fork Browser pane（2026-08-30）

- 修复 Phase 1 transport 断链：fork 已移除常驻 OpenChamber EventSource 并把 synthetic events 合入 global message WS，但 broker 仍只写旧 SSE。Electron global WS 现在以 query `browser=1` 声明 ephemeral capability，server 只向 capable global socket 投递 control request。
- capability 只记在 global socket；directory stream、普通 browser、notification client 不会收到 action。旧 `/api/openchamber/events` capable SSE 保持兼容，但不是 fork 主路径。
- renderer control client 解析 envelope 后按 `serverId` 匹配 active controller/opener，匹配前不 claim；claim 成功后才触碰页面，成功/原始失败都回传 `/result`。聚合 remote event 不会误发给 default page。
- ContextPanel 在当前 authoritative active server 注册 opener；无 Browser tab 的 `browser.open` 先创建现有 fork Browser tab，再等待 controller attach。split 时 primary active Browser 拥有 controller，第二个可见 pane 不抢占。
- 复用 fork 已有 Electron `<webview>`，实现 `open/snapshot/click/type/scroll/back/forward/inspect/capture`。snapshot 最多 6,000 text chars / 120 interactive elements并报告 truncation；selector/text/value 全部作为 JSON data 嵌入，不能形成脚本注入。
- back/forward 无历史时明确失败；click/submit 等待 navigation settle；capture 复用现有 shell screenshot command，再由 Phase 1 server 写入 authoritative directory。
- `browser.resize` 尚无 fork viewport/device bar，当前明确返回 unsupported，不假称已应用。aggregated remote 的 `/api/openchamber/events` fan-in 和 private relay parity 仍归 [#137](https://coding.s-s.city/songsong/openchamber/-/issues/137)。

验证：page actions + control client Bun 2 files / 8 tests ✅；Electron capability focused Bun 1/1 ✅；event-stream + broker Vitest 2 files / 17 tests ✅；UI/Web type-check 与 lint ✅。未启动共享 HMR，避免再次复用并终止安装版 managed OpenCode。

### #135 Phase 5：Real viewport presets for agent Browser actions（2026-08-30）

- `browser.open` 与 `browser.resize` 接受 upstream vocabulary `mobile/tablet/desktop/fill`；分别映射 390x844、768x1024、1440x900 与 panel fill。
- fixed viewport 以选定 CSS width/height 真实参与页面 layout，只通过 transform 向下缩放适配 panel，绝不放大；因此 media query、element bounds、capture 与 snapshot 都描述 agent 指定的布局。
- snapshot/open/capture/resize result 回传同一 `{ mode, width, height }`，避免模型误把 mobile snapshot 当 desktop。当前尺寸和视觉 scale 在页面角落以紧凑状态显示。
- viewport state 使用 ref + narrow React state；agent resize 不会重建 controller 或中断已 claim request。ContextPanel ResizeObserver 只在 panel 尺寸真正变化时更新。

验证：viewport + page actions + control client Bun 3 files / 13 tests ✅；UI type-check/lint ✅；`git diff --check` ✅。`#135` 仍保持 open：dev-server suggestions/history/crash recovery、Electron dev-tunnel IPC 与 aggregated remote event bridge 未完成。

### #135 Phase 6：Authoritative dev-server suggestions in Browser empty state（2026-08-30）

- Browser 未打开页面时每 2 秒读取 `/api/dev-servers`，显示真实正在监听的候选 URL、port 与 process command；打开页面后立即停止 poll/abort request，不在后台持续扫描。
- payload validator 拒绝非法 port/URL，按 port 去重并稳定排序。成功空列表显示正常空状态；HTTP/shape/network failure 显示独立 unavailable 文案，避免把扫描失败谎报成“没有 server”。
- client route 显式接收 Browser 所属 `serverId`：default 使用 `runtimeFetch`（保留 direct/relay transport），aggregated remote 使用该 registry connection 的 base URL 与 auth token；不读取全局 active directory 推断 ownership。
- 空状态 server 列表保持 panel 本身不滚动，仅候选列表滚动；按钮使用现有 theme tokens。新增标题/失败文案已补齐 de/en/es/ja/ko/pl/pt-BR/uk/zh-CN/zh-TW 全量 locale contract。

验证：dev-server client 3/3 ✅（validation、empty-vs-failure、default transport）；UI type-check/lint ✅。`#135` 仍 open：history/crash recovery、Electron dev-tunnel IPC、aggregated remote synthetic-event bridge 未完成。

### #135 Phase 7：Scoped Browser address history + URL normalization（2026-08-30）

- 浏览完成后记录 normalized URL、page title 与 visit time；相同 URL revisit 只移动到顶部，不复制，最多 50 entries / project、20 project scopes。
- scope key 为 `runtimeKey + serverId + normalized directory`，同一路径位于 local/Dev1/Dev3 不会串历史；direct remote top-level runtime 也由 runtimeKey 隔离。
- address bar 使用原生 datalist 提示最近/匹配 URL；typing 只过滤当前 scope 的 leaf array，不向 shared store 写高频输入状态。历史写入使用 deferred safe storage。
- URL normalizer 补齐 upstream loopback 语义：`localhost:5173`、`127.0.0.1:3000` 默认 HTTP；公网 schemeless host 默认 HTTPS；file/javascript/data 与非法 URL 统一拒绝为 blank。

验证：URL/history/dev-server 3 files / 9 tests ✅；UI type-check/lint ✅；Web production build ✅；`git diff --check` ✅。`#135` 仍 open：crash recovery、Electron dev-tunnel IPC、aggregated remote synthetic-event bridge 未完成。

### #135 Phase 8：Bounded Browser guest renderer crash recovery（2026-08-30）

- 监听 Electron `render-process-gone` 与 legacy `crashed`；30 秒窗口最多自动 reload 三次，按 250ms → 500ms → 1000ms 退避，避免 crash-on-load 无限循环拖垮整个 OpenChamber。
- recovery budget 保存在 Browser pane ref，重新 render 不会重置。窗口过期后新的首次崩溃获得新 budget。
- budget 耗尽后停止自动动作，显示明确错误和手动 Reload；手动操作重置 budget。该流程只重载 guest page，不重启 Electron shell、OpenChamber server 或 managed OpenCode。
- crash/error/reload 文案使用现有 theme tokens，新增错误文案补齐全部 10 个 locale。

验证：crash recovery + history 2 files / 5 tests ✅；UI type-check/lint ✅；`git diff --check` ✅。`#135` 仍 open：Electron dev-tunnel IPC 与 aggregated remote synthetic-event bridge 未完成。

### #135/#137 Phase 9：Capability-gated aggregated remote synthetic-event bridge（2026-08-30）

- local global WS 只有 Electron client 以 `browser=1` 声明 capability；global bridge 仅在至少一个 capable socket 存活时，为每个 healthy aggregated remote 启动 `/api/openchamber/events?browser=1` fan-in。
- synthetic stream 使用独立 remote `stream` lane，停止/失联/最后 capable client 退出时立即 abort、stop、release；普通 Web client 不启动额外连接，也不会让远端 broker 误以为能控制页面。
- remote event 转发只投递给 capable global sockets，并保留 envelope `serverId`。renderer 仅由相同 serverId 的 active Browser controller claim；claim/result 经该 registry base URL + auth token 返回事件来源实例。
- 旧 remote 对可选 endpoint 返回 404/405/410 时视为 capability unsupported：立即释放 lane，不 fast retry、不把 remote 标 unhealthy。真实 network/auth/5xx 才记录 request failure。
- OpenCode global events 与 OpenChamber synthetic events 保持两条明确 ownership channel，未把 synthetic event 注入 OpenCode history/replay buffer。

验证：remote synthetic fanout + global capability bridge + event runtime Vitest 3 files / 17 tests ✅；control client Bun 1 file / 5 tests ✅；UI/Web type-check/lint ✅；`git diff --check` ✅。`#135` 仅剩 dirty Electron main 中的 dev-tunnel IPC/shell lifecycle；private relay 下的 tunnel-virtual endpoint 仍由 [#137](https://coding.s-s.city/songsong/openchamber/-/issues/137) 后续处理。

### #135 Phase 10：Instance-authoritative Electron dev tunnel（2026-08-30）

上游来源：`dd642b1d8`，按 fork aggregated multi-instance 改写：

- Browser loopback URL resolution 显式接收 owning `serverId`；只有 Electron + non-default instance + parsed loopback HTTP(S) 才 tunnel。local/default、public URL 与 Web/Mobile 保持原 URL。
- renderer 只向 IPC 发送 `serverId + port`，不能提交 base URL、token 或任意 headers。Electron main 从 SSH ready status + persisted host registry 解析 forward base URL，要求两者同源且 paired client token 存在，再发送 bearer 打开 tunnel。
- tunnel 按 `serverId + remotePort` 缓存；SSH forward URL 改变时关闭旧 listener。显式 close、SSH disconnect 与 app window shutdown 都释放 listener/socket。
- webview 实际加载 `127.0.0.1:<random>`，address/history/tab target 与 agent result 通过 reverse map 保留原远端 `localhost:<port>`；随机 tunnel port 不持久化。
- link/script 跨到另一 loopback port 在 `will-navigate` 前 retunnel；server redirect 的 failed load 最多按 URL 恢复一次。失败显示 unavailable 并抛原始 tool failure，绝不回退本机同端口。
- 对应提交：`6cad928cb feat(browser): resolve remote loopback tunnels`、`a0522c6a6 feat(browser): validate tunnel instance authority`、`0cd6d1b81 feat(browser): bridge SSH dev tunnels`、`515896256 feat(browser): load remote dev tunnels`。

验证：Browser URL/tunnel/dev-server/history/crash focused 5 files / 18 tests ✅；Electron tunnel/certificate authority Node 2 files / 6 tests ✅；main syntax、全 workspace type-check/lint/build ✅，build 仅有既有 chunk/import warnings。`main.mjs` 使用 temporary index 精确提交，其他 agent WIP 仍为 23/5。[#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) 保持 open：需要真实 SSH instance + remote dev server + Electron webview/HMR/cross-port matching-surface QA；private relay dev tunnel 仍归 #137。

### #135 Phase 11：Real Dev3 HTTP/WebSocket tunnel QA（2026-08-31）

- 从 current HEAD 建 detached clean worktree，安装 frozen dependencies并运行 Docker linux/amd64 build；产物为 139 MiB glibc x86_64 binary，SHA-256 `b1cb4e31441db22b0b23dd89d903a51c5c2bd8a9e11223bada91d828b899ab47`。
- binary 仅上传 Dev3 `/tmp`，使用独立 data dir 与 loopback port 3099；system `/opt/openchamber`、systemd 与 2999 未修改。QA host 正确发现临时 HTTP 18765 与 WebSocket 18766。
- 独立 `ElectronSshManager` 通过 `ssh Dev3` 建立 3099→local 60244 forward，并在 remote UI password disabled 情况下获得 paired client token。真实 dev-tunnel 分别绑定 local 51891/54151。
- HTTP `/tmp` directory response local/remote SHA-256 均为 `89e2de329637455b3c2d12541e438d536e3e793ac5922da964c87f96a4f4a652`；WebSocket 完成 upgrade，发送 `hmr` 得到 `echo:hmr`，证明 HMR 所需 raw bidirectional transport。
- cleanup 后 local listeners与 remote 18765/18766/3099/44243 全部关闭；Dev3 system 2999 保持 healthy、managed OpenCode port 38247 未变化。临时 QA OpenCode 426780 曾短暂 D-state，按 incident runbook采集 lifecycle/process/kernel evidence到本机 `/tmp/openchamber-dev3-qa-opencode-426780`；TERM 最终生效，无 orphan listener。
- v1.21 capture wait/reveal/background-open 与下一次 shell refresh 后的 installed webview QA 拆至 [#175](https://coding.s-s.city/songsong/openchamber/-/issues/175)。

验证：真实 Dev3 discovery + paired auth + HTTP + WebSocket/HMR + cleanup ✅；clean HEAD Linux build ✅。[#135](https://coding.s-s.city/songsong/openchamber/-/issues/135) v1.20 scope 完成。

### #151 Phase 1：No-password SSH paired-client authority（2026-08-31）

- `ElectronSshManager.issueClientToken` 不再在 remote UI password为空时直接返回空 token；改为调用受 remote server auth policy保护的 client-create endpoint。
- client 使用 `clientKind=desktop-ssh` 与 instance-scoped `dedupeKey=desktop-ssh:<instanceId>`，reconnect 不会无限累积 token record。有 password 时保留 login-return token优先与 cookie fallback。
- 对应提交：`7f78ccad9 fix(ssh): pair no-password remote instances`，通过 temporary index提交，原 ssh-manager WIP恢复 61/52。

验证：SSH manager + dev-tunnel authority 11/11 ✅；真实 Dev3 password-disabled instance生成 token并完成 Phase 11 transport QA。[#151](https://coding.s-s.city/songsong/openchamber/-/issues/151) 保持 open：继续完整 SSH setup/lifecycle redesign 与对应 UI/settings migration。

### #137 Phase 10：Loss-safe relay request-body delivery（2026-08-30）

上游来源：`d634cd232`、`aaf397e68`、`854a0db92`，保持 TS client / JS host wire backward compatibility：

- `TunnelHttpRequestPayload` 新增 optional `hasBody`。client 有 body source 时声明 true；source 即使 0 chunks 也发送一个 explicit empty `HttpBody` frame，再发送 `StreamEnd`。
- host 对 ≤512 KiB body 先完整 buffer，只在收到 `StreamEnd` 后一次性 forward loopback；relay reconnect/丢 frame 时不会把 empty/truncated chunked body 发给 OpenCode 后得到裸 400。
- `hasBody=true` 但 0 body frames 属于 ambiguous transport failure，发送 `StreamAbort` 让 client 既有 retry/unknown-outcome 语义处理。旧 client 未带 hasBody 的 bodyless POST 与显式 empty frame 都保持可用。
- buffered delivery 15 秒 deadline；超时只 abort 一次、释放 buffer/call frame，late `StreamEnd` 不会复活请求。>512 KiB 切换 live stream，避免大上传全量占内存。
- response path、E2EE framing、batch negotiation、frame counters 与 WebSocket path 均未变化。

验证：tunnel client + host body + JS/TS cross-compat 3 files / 24 tests ✅；UI/Web type-check/lint ✅；Node syntax ✅。`#137` 保持 open，继续审计 pairing origin、mobile reconnect/tokenless resume、ngrok 与 private-relay dev tunnel。

### #137 Phase 11：Ngrok interstitial bypass across direct transports（2026-08-30）

- `runtimeFetch`、installed window fetch bridge 与 Capacitor `nativeHttpRequest` 对官方 ngrok runtime host 添加 `ngrok-skip-browser-warning: openchamber`，防止 `/health`/`auth/session` 被浏览器提示 HTML 替代后误判连接失败。
- host matcher 仅允许 `ngrok.app`、`ngrok-free.app`、`ngrok.dev`、`ngrok.io` 及其 subdomain；`ngrok-free.app.evil.example` 等 lookalike 不获得 header。
- 已存在用户 header 不覆盖。relay transport 使用 tunnel path，不添加无意义 proxy header。
- fork CORS 已动态回显 `Access-Control-Request-Headers`，等价覆盖上游静态 allowlist 增项，无需降级现有行为。
- pairing public request-origin candidate 已在 fork `client-auth/pairing-routes.js` 等价且更严格：preferred/LAN/request-origin 全部去重，过滤 localhost、完整 127/8、0.0.0.0/::，故不重复移植 `9aa98df24`。

验证：runtime fetch 1 file / 26 tests ✅（含 official/lookalike/direct fetch）；UI type-check/lint ✅；`git diff --check` ✅。`#137` 保持 open，下一 phase 处理 tokenless cold launch/resume 与 transient reconnect ladder。

### #137 Phase 12：Tokenless persistence + transient cold-launch/resume retries（2026-08-30）

- 保存记录 `hasToken=false/undefined` 表示上次成功连接的 server auth disabled，cold launch/resume 允许 tokenless probe 与 runtime switch；只有 `hasToken=true` 但 secure storage/inline token 缺失才判 credential unavailable。
- cold launch 先 fast probe 并立即释放 splash/显示 connect UI；fast false-negative 后后台执行一次 full-budget retry。`skipIfConnected` 在 probe 前后双重检查，不能覆盖用户期间手动建立的新连接；unused relay tunnel 会关闭。
- Resume 初次 fast probe 为 unreachable 时等待 4s 再 fast probe，仍失败后等待 10s 做最后一次 full-budget probe。`needs-login` 与 `no-connection` 立即终止，不浪费 ladder；auth rejection 显示 `auth-required` 而非 unreachable。
- full relay probe 显式限制为共享 8s connect budget，不继承 15s relay session default；direct 同样使用完整 connect budget。
- 当前 fork 将 resume orchestration 保持在独立 `useMobileConnectionResume` hook，没有复制上游旧 MobileApp 大块生命周期代码。

验证：mobile storage/probe + resume ladder 2 files / 18 tests ✅；UI type-check/lint ✅；`git diff --check` ✅。`#137` 保持 open：connection diagnostics panel、mobile export parity 与 private-relay dev tunnel 仍需收口。

### #137 Phase 13：Native mobile sharing for exported message images（2026-08-30）

- VS Code 继续走 extension `saveImage`；Web/Desktop 继续走 download anchor；仅 Capacitor runtime 将生成的 PNG data URL 转为具名 `File` 并调用系统 `navigator.share`。
- 调用前用 `navigator.canShare({ files })` 明确验证 file-share capability；不支持或 share 失败进入现有可见 error toast，不静默创建移动端无法访问的 download link。
- 转换/分享逻辑抽为独立 `mobileShare.ts`，MessageBody 不持有 platform-specific blob 细节。

验证：mobile share 2/2 ✅；UI type-check/lint ✅；`git diff --check` ✅。`#137` 保持 open：connection diagnostics 与 private-relay dev tunnel；FilesView mobile preview/download 已由 fork 的 runtime Files API / binary reader 等价覆盖，且当前该文件无本批改动。

### #137 Phase 14：On-device mobile connection diagnostics（2026-08-30）

- 现有 `logConnect/logStorage` 的已序列化、无 token detail 同步写入 current-launch-only in-memory ring，最多 300 entries；启动时删除上游早期遗留持久化 key，不跨启动积累敏感/陈旧信息。
- connect 页 OpenChamber 标题 700ms 长按打开诊断，移动超过 10px 取消，触发后吞掉 synthetic click；已连接的 Instances sheet 同时提供 familiar information icon。
- panel open 时 snapshot 当前日志，避免复制过程中 live update 抖动；显示毫秒时间、step/detail，并使用 shared clipboard helper 一键复制。
- title/copy/copied/close/empty 文案补齐全部 10 个 locale；只使用现有 theme/status tokens。
- 上游 v1.18.4 `dev-tunnel/client.js` 明确拒绝 relay/custom-scheme base URL，因此 private-relay dev tunnel 并非 v1.20 capability；本轮不创建超出上游的 transport。direct HTTP(S) remote dev tunnel 已由 #135 Phase 3 完成。

验证：mobile diagnostics + connection storage 2 files / 17 tests ✅；UI type-check/lint ✅；`git diff --check` ✅。至此 [#137](https://coding.s-s.city/songsong/openchamber/-/issues/137) 的 pairing origin、relay body、transient reconnect、tokenless resume、ngrok、mobile share/download 与 diagnostics 均已等价，可关闭。

### #171：Turkish runtime localization（2026-08-30）

上游来源：`fa981251a`。以 fork 当前 `en.ts` / `en.settings.ts` 为 authoritative key contract，而不是直接覆盖上游词典：

- 新增 `tr` locale、语言选择标签、`tr-*` 归一化、异步 dictionary chunk、bootstrap 文案和 Walkthrough prompt language；UI 与 server 语言表继续由双向 parity test 约束。
- `tr.ts` / `tr.settings.ts` 机械对齐 fork 当前 5,079 个 key。复用上游 4,251 个真实 Turkish 翻译；828 个上游尚不存在的 fork-only key 明确回退当前 English 文案，因此不会出现缺键、空白或裸 i18n key。
- 其余 10 个现有 locale 均增加各自语言的 Turkish 标签。土耳其语文档站不属于 runtime migration scope，按 work item 约定不移植。
- Web 与 VS Code 构建均产生独立 lazy `tr` chunk（374,615 bytes），未并入初始 English bundle。

验证：Bun i18n 3 files / 6 tests ✅；Walkthrough language Vitest 4/4 ✅；全 workspace `bun run type-check` ✅、`bun run lint` ✅、`bun run build` ✅；`git diff --check` ✅。[#171](https://coding.s-s.city/songsong/openchamber/-/issues/171) 可关闭。

### #166 Phase 1：Remote-tracking branch checkout（2026-08-30）

上游来源：`599f5dc5d`，同时保持 fork Web / VS Code Git contract 一致：

- branch picker 选择 `origin/feature` 或 `remotes/origin/feature` 时，不再直接 checkout remote ref 进入 detached HEAD；若本地 `feature` 不存在，创建并 tracking `origin/feature`，若已存在则直接切换本地分支。
- 本地同名分支优先。例如真实存在 `refs/heads/origin/feature` 时，不会误判为 remote ref。未知 ref 与 `origin/HEAD` 继续交由 Git 自身处理并保留原始错误语义。
- Web service 与 VS Code extension 返回 repository 实际落到的本地 branch；Git UI toast 使用该返回值，避免仍显示 remote ref。
- remote 名按长度降序匹配，避免 prefix remote name 错认 ownership。

验证：真实临时 bare remote 的 Git service Vitest 57/57 ✅（新增 6 条 checkout 分支场景）；全 workspace `bun run type-check` ✅、`bun run lint` ✅、`bun run build` ✅；`git diff --check` ✅。[#166](https://coding.s-s.city/songsong/openchamber/-/issues/166) 保持 open，下一 phase 仍需 multi-project directory selection 与对应 Desktop/VS Code add-project parity。

### #166 Phase 2：Desktop/Web multi-project directory selection（2026-08-30）

上游来源：`33caa4925`、`a2f7954ed`，按 fork multi-instance project registry 改写：

- local directory picker 的目录行增加 checkbox；Space 仅在 browse 状态切换高亮目录选择，路径输入状态仍可输入空格。切换目录或 clone mode 会清空 batch，避免隐藏选择跨目录提交。
- 有 batch 时主按钮明确变为“Add selected”；一次加入所有有效目录、跳过 batch 内重复项与已存在 local 项目、激活第一项并显示实际成功数量。
- remote project 不能压制同路径 local 项目：去重只比较 default/local connection，保留 fork 的 `serverId + directory` ownership。
- Finder 选择显式使用 `ignoreBatch` 提交；不依赖 `setState` 同 tick 生效，修掉上游“旧 selection 闭包覆盖 Finder target”的 race。
- 三个新增 UI key 已补齐 en/de/es/ja/ko/pl/pt-BR/tr/uk/zh-CN/zh-TW。

验证：Projects store Bun 4/4 ✅（批量、normalize、duplicate、remote/local 同路径、invalid）；i18n focused 4/4 ✅；UI type-check/lint ✅。完整 workspace build/检查见本 phase 提交验证。[#166](https://coding.s-s.city/songsong/openchamber/-/issues/166) 保持 open：fork VS Code 当前是 single-workspace bootstrap，且其 runtime API 类型正被并行 remote-namespace WIP 修改；不能把 upstream multi-folder bridge 静默套入或假称 parity。

### #159 Phase 1：iOS CodeMirror selection handles（2026-08-30）

上游来源：`26b0ad5bd`（官方 dependency set，不是自行追 npm latest）：

- CodeMirror 兼容组升级到 `view 6.43.9`、`state 6.7.1`、`language 6.12.4` 及上游配套 autocomplete/commands/lang/lint/search/vim versions；root overrides 固定同一实例，避免私有 Facet/Language 类型跨版本。
- 所有平台继续安装 `drawSelection()`，保留 wrapped input / IME 的低延迟路径。非 iOS 继续使用 native-selection fallback；只有与 CodeMirror 6.43.9 完全相同的 iOS predicate 命中时，才切换到 CodeMirror 自带 handles。
- iOS 只抬高既有 selection layer、为 8px handles 扩展 clip area、保持 pointer-events none，并隐藏与系统 selection overlay 重叠的 synthetic fill；不再恢复会让 WebKit 每次 decoration redraw 重排的 native caret/selection。
- composer 模块文档同步记录平台分流与真机 QA 边界。

验证：composer Bun 13 files / 232 tests ✅（selection/theme 25 条）；CodeMirror forced reinstall 后确认 `language-data` 依赖统一解析到 6.12.4/6.7.1；UI type-check ✅。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。WKWebView selection drag/IME 必须留作真机 matching-surface QA，不能用单测冒充。[#159](https://coding.s-s.city/songsong/openchamber/-/issues/159) 保持 open：self-signed loopback Browser 仍需接 dirty Electron main，其他 shell parity 也需最终 installed-runtime QA。

### #147 Phase 1：Bounded atomic file-upload route（2026-08-30）

上游来源：`7b92bf347`、`853e0d43b`，先落不依赖 dirty shared `FilesAPI` type 的 server authority：

- 新增 `POST /api/fs/upload?path&directory&overwrite`，只接受 raw `application/octet-stream`；必须携带 explicit owning directory，不读取 persisted active/last directory。
- 默认 100 MiB 上限，可由正数 `OPENCHAMBER_FS_UPLOAD_MAX_BYTES` 覆盖；Content-Length 预检和实际 streaming byte counter 双重限制。
- 数据先写同目录随机临时文件。非 overwrite 用 hard-link commit，目标在检查后并发出现时仍返回 `409 already-exists`；overwrite 使用 rename。任何失败都清理 temp，reader 不会看到半文件。
- target、parent、existing symlink 均经过 canonical workspace boundary；workspace 内 symlink 指向外部文件不能借 overwrite 修改外部内容，worktree fallback 与现有 FS contract 不变。
- 400/403/404/409/413/415 与 `reason` 语义明确，OS permission 继续走既有 `os-permission` contract。

验证：FS route Vitest 20/20 ✅，其中新增 8 条覆盖 explicit authority、binary fidelity、conflict preservation、overwrite、MIME、size、missing parent/temp cleanup、outside symlink denial。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。[#147](https://coding.s-s.city/songsong/openchamber/-/issues/147) 保持 open：下一 phase 接 Web client、Sidebar drop UI、conflict confirmation、cache invalidation 与 remote runtime parity；当前 dirty `api/types.ts` 不被本 phase 覆盖。

### #147 Phase 2：Scoped Sidebar drop upload + conflict recovery（2026-08-30）

- 新增不依赖 shared dirty `FilesAPI` type 的 `uploadWorkspaceFile`：每次调用显式捕获 `serverBaseUrl + owningDirectory + targetPath`，通过 `runtimeFetch` 支持 local、direct remote、aggregated `/api/remote/:id` 与 relay transport；缺 owning directory 在 fetch 前 fail closed。
- Sidebar root、folder 和 file row（file 使用 parent）接收外部文件 drop；目录 item 被过滤，文件名拒绝空值、`.`/`..`、slash/backslash。每批最多并行 3 个上传，避免大量文件制造请求风暴。
- 默认不覆盖；409 conflict 收集到确认 dialog，用户显式 Replace 后只重传冲突文件。切 Session/server/runtime 后旧 dialog fail closed，不会把确认操作路由到新实例。
- upload operation 捕获 `runtimeKey + serverBaseUrl + root`。完成后仅在仍处于同一 authority 时刷新树；缓存 invalidation 使用 `runtimeKey + serverBaseUrl` scope，比上游仅 runtimeKey 更严格，不会让 Dev1/Dev3 同路径互相刷新。
- FilesView 对同 scope、同 selected path 且无 dirty draft 的 invalidation 立即重载 text/image/HTML；有未保存编辑时不覆盖用户内容。
- upload/error/drop/conflict 文案补齐全部 11 个 runtime locales。

验证：upload client + invalidation + filesystem reason Bun 3 files / 7 tests ✅；UI type-check/lint ✅。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。[#147](https://coding.s-s.city/songsong/openchamber/-/issues/147) 保持 open：VS Code extension 没有 `/api/fs/upload` server surface，需在其 bridge/type WIP 收口后补二进制 upload parity；installed runtime drag/drop matching-surface QA 也尚未执行。

### #147 Phase 3：VS Code atomic binary upload parity（2026-08-31）

- VS Code webview fetch shim 拦截共享 `POST /api/fs/upload`，复用现有 binary body encoder，向 extension bridge 发送 explicit `directory + path + overwrite + bodyBase64`；backend 的 200/403/409/413 status/body 原样恢复为 Response，共享 Sidebar conflict/Replace UX 不分叉。
- extension host 只接受 current VS Code workspace root 内的 owning directory；atomic runtime 再以 realpath 校验 parent boundary，拒绝 outside/symlink target，保持 100 MiB 上限、same-directory temp、no-overwrite hard-link commit 与 explicit overwrite rename。
- bridge payload error 与 HTTP conflict 分离：缺字段是 bridge contract failure；workspace/outside/conflict/size 是成功 transport 上的结构化 HTTP result，避免 `sendBridgeMessage` 丢失 `reason`。
- 对应提交：`f729cf51a feat(vscode): add atomic file upload bridge`、`841ea4307 feat(vscode): proxy binary file uploads`。`webview/main.tsx` 用 temporary index 精确提交，原 selection-attachment staged diff 恢复为 58/22。

验证：VS Code atomic runtime 4/4 + bridge FS 6/6 ✅；VS Code type-check/lint/build ✅，build 仅有既有 chunk/import warnings。[#147](https://coding.s-s.city/songsong/openchamber/-/issues/147) 保持 open：仍需真实 VS Code Extension Host 与 Desktop/Web installed runtime drag/drop + 409 Replace matching-surface QA。

### #148 Phase 1：Deleted-worktree draft recovery（2026-08-30）

上游来源：`3d15b09d0`、`f26ad5d35`、`5693e5ff9`，按 fork multi-instance authority 重写，不修改 dirty `opencode/client.ts`：

- 新增 `probeWorkspaceDirectoryAvailability` 三态探测，经 draft selected project 的 `serverId` 解析 local/direct/aggregated remote base URL。只有 404、`not-found/not-directory` 或明确 ENOENT/ENOTDIR 属于 missing；offline、403、invalid response 都是 unknown。
- 仅普通 implicit draft 可恢复；explicit preserve target、temp Session、pending/bootstrap worktree 均跳过。runtime key 或 draft project/directory 在 probe 中途变化时 abort，不把迟到结果覆盖用户选择。
- missing 时 visible draft、selected project、persisted target 与 active config 一起改到 selected/active project root；open 时 proactive recovery，materialize 与真正 send 前再次验证，覆盖“立即发送”race。
- create/session-folder/pending-message/routeMessage 使用恢复后的 directory 和 serverId；同一 in-flight proactive rewrite 到相同 fallback 被接受，不误判为用户改目标；失败恢复 snapshot 也保持已恢复目录。

验证：directory availability + session UI Bun 2 files / 22 tests ✅，覆盖 missing/unknown/explicit target/materialize remote authority。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。[#148](https://coding.s-s.city/songsong/openchamber/-/issues/148) 保持 open：context-meter server totals、Office extraction bounds、embedded restoration与 v1.21 large-text/virtual preview follow-up 仍需逐项收口。

### #148 Phase 2：Server-total context-window accounting（2026-08-30）

上游来源：`438360868`。OpenCode 多工具 turn 的 `input/cache.read` 是每次内部 API round-trip 的累计量，直接求和会把真实 232,872 / 1M 显示成 3,306,479 / 1M（330.6%）：

- `contextTokensFromBreakdown` 成为唯一窗口 token 规则：有限正数 `tokens.total` 优先；旧服务器没有 total、total=0/NaN 时才回退 breakdown sum。plain numeric token payload 保持兼容。
- `contextStore.extractTokensFromMessage`、session UI getter、work-status helper、Context Sidebar、VS Code Header、Mini Chat 全部改用同一 helper；不再保留各 surface 的 inline sum。
- Context Sidebar 仍分别展示 input/output/reasoning/cache buckets，但总数使用 server final-round total，细项与总数不强行相加，因为细项表达累计成本、total 表达当前窗口。

验证：token/session/context surfaces Bun 4 files / 32 tests ✅，含真实 multi-step payload regression（23.2872% 而非 330.6%）、older-server fallback、part-level tokens。UI type-check/lint ✅；全 workspace build 与 diff check 见本 phase 最终验证。[#148](https://coding.s-s.city/songsong/openchamber/-/issues/148) 保持 open：Office extraction bounds、embedded restoration审计与 large-text/virtual preview follow-up 尚未完成。

### #148 Phase 3：Exact folder-derived project labels（2026-08-30）

上游来源：`75bd5ac6a`：

- 自动 label 直接使用目录 basename，`.ssh`、`opencode-claude`、`custom_name` 不再被改写成 `.Ssh`、`Opencode Claude`、`Custom Name`。
- persisted label 仅在它精确等于旧版本自动 title-case 结果时迁回真实 folder name；用户手动 rename 的 label 保留。
- Sidebar、Settings project selector、window title 和 notification `project_name` 使用同一“trim only”显示规则，避免一个项目在不同 surface 有多个名字。
- local/remote project ID、serverId/path ownership 与用户自定义 label 不变。

验证：Project/sidebar Bun 15/15 ✅；notification template Vitest 6/6 ✅；覆盖 dot folder、dash/underscore 和 manual label。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。[#148](https://coding.s-s.city/songsong/openchamber/-/issues/148) 保持 open：Office extraction bounds、embedded restoration审计与 large-text/virtual preview follow-up 尚未完成。

### #148 Phase 4：Compact bounded Office extraction + embedded-chat equivalence audit（2026-08-30）

上游来源：`e84653383`，保留 fork stronger bounds：

- fork 已有 20 MiB archive、100 MiB expanded、25 MiB entry、8 MiB XML、5,000 entries、50 images/20 MiB single/40 MiB aggregate、safe archive path、image signature、ODF expanded-space 与 2M extracted-text limits；不回退上游 500k text cap。
- XLSX 稠密连续 rows 输出一次 `Range: A1:B2` + quoted TSV，省去每格重复坐标；含 tab/newline/quote 的值按 TSV escaping。跨度异常大的 sparse row 输出 `Cells: A2\tvalue | XFD2\tvalue`，不分配 16,384 个空 column。
- `isDocumentAttachmentFilename` 成为 Office/OpenDocument filename 判定入口，大小写路径一致。
- embedded chat 恢复审计为 fork 等价且更适合现有 split panel：仅 active/split chat iframe 挂载；iframe `onLoad` 同步 theme/settings/visibility，App 初始 visible 并启动 history/bootstrap；关闭 panel 时卸载。现有 #140 active-only focused tests 覆盖 tab/null/missing，故不复制上游早期“全部隐藏 iframe 挂载”方案。

验证：attachment/document Bun 2 files / 20 tests ✅，覆盖 DOCX/PPTX/XLSX/ODF、dense/sparse/TSV、zip bounds、unsafe paths、image bounds/signatures、text citation truncation。全 workspace type/lint/build 与 diff check 见本 phase 最终验证。[#148](https://coding.s-s.city/songsong/openchamber/-/issues/148) 的 v1.20 runtime 范围已完成并关闭；原先追加的 v1.21 large-text paste / virtual preview 已迁到 [#172](https://coding.s-s.city/songsong/openchamber/-/issues/172)，避免跨 milestone 阻塞 v1.20 closeout。

### v1.20 regression：Directory activation agent-catalog revalidation（2026-08-30）

- 现场证据：当前 managed OpenCode `1.18.16-sscity` 对 `/Users/song/dev_entertainment` 的 `/api/agent` 响应包含 `Sisyphus - ultraworker`，但 OpenChamber 可继续显示持久化的原生 `Build / Plan`；因此不是 OMO 未加载，而是 UI 把旧 agent snapshot 当成永久 authoritative state。
- `activateDirectory(serverId + directory)` 继续先同步恢复 persisted providers/agents，避免切目录时闪空；随后无条件向 owning server 重新加载 agent catalog。缓存只负责 first paint，不能跳过 plugin/project config/OpenCode restart 后的 authoritative reconciliation。
- 不扩大 provider 请求：已有 provider snapshot 仍可跳过；本次只修复会受 plugin/config 热变化影响的 agents。
- 独立 Electron dev 验证切换到 `/Users/song/dev_entertainment` 后 composer 显示 `Sisyphus - ultraworker`；测试产生的 `activeProjectId` 已恢复，正式 OpenChamber 未终止、runtime 未替换。

验证：`useConfigStore.nonblocking.test.ts` 12/12 ✅（新增 stale `Build / Plan` → live OMO catalog、directory authority 回归）；全 workspace `bun run type-check` ✅、`bun run lint` ✅。
