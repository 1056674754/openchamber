# v1.22.0..v1.23.0 逐 commit 移植分类（101 个）

分析基线：fork 分支 merge/upstream（89b311a42 checkpoint）。fork 侧已逐项核实的关键结论见文末"fork 侧现状核实记录"。

## 特殊拓扑警示

`5012de6b8 release v1.22.2` 是**无父 orphan 提交**（上游在 v1.22.2 重导入了历史）。它不是普通 release bump：v1.22.0→v1.22.2 的真实内容差为 **630 文件 / +42,546 / -6,024**（含 composer draft-target 基建、LiveTurnActivity 时间线、timelineScrollAnchoring 扩展、markdown decorate 管线、上游 WorkStatusPanel、上游 Mobile surfaces 等），**全部未分解为可审 commit**。本段后续多个 commit 依赖这些基建。段内其余 100 个 commit 的 numstat 均相对 v1.22.2 树。

## 分类表

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
|---|------|------|------|------|------|------------|
| 1 | d073858dc | release | other | 低 | 跳过 | 版本号+CHANGELOG |
| 2 | 2d043939f | fix | ui | 低 | 手工合 | 修复 #3 的 useFilePreviewScrollPosition；与 b65bed1f0 同批移植 |
| 3 | 72582013f | test | web-server | 低 | 手工合 | relay 测试，随 1f5060c8f 批次 |
| 4 | b65bed1f0 | feat | ui | 中 | 手工合 | FilesView + 新 hook useFilePreviewScrollPosition（fork FilesView 存在） |
| 5 | 5fcae5446 | test | web-server | 低 | 手工合 | relay flow-control 测试，随 relay 批次 |
| 6 | ee48a469f | style | ui | 低 | 手工合 | MessageBody fork 大幅分叉，样式小改需手对 |
| 7 | 7bee945e7 | fix | web-server | 低 | 已等价 | 已核实：fork opencode-go.js 已做 `resetAt: new Date(resetAt).getTime()` 归一且有 isFinite 守卫；可选补回归测试 |
| 8 | 2716e757a | fix | ui-i18n | 低 | 手工合(待查) | 上游删冗余 committed scope 标题；fork walkthrough 自研（有 `walkthrough.scope.group.committed` key），需确认是否同样冗余 |
| 9 | b5d6b8490 | fix | ui | 低 | 不适用 | 隐藏 dirty-branch warning：该 warning 依赖 orphan 引入的 DraftTargetSelectors 基建，fork 无此功能 |
| 10 | 6b5094c22 | fix | ui | 中 | 手工合 | prefetch 并发槽修复；fork useGitStore 自研改 1277 行、有自己的 inFlight 管理表，需按 fork 实现重写修复语义 |
| 11 | a1d4eda4c | feat | ui | 高 | 手工合 | hunk 浮动按钮（DiffView/PierreDiffViewer/patchFileDiff）；fork DiffView/PierreDiffViewer 分叉 |
| 12 | a3a8137ed | fix | ui | 中 | 手工合 | fork useUIStore 有同款预修复 bug（hasManuallyResizedLeftSidebar + 重开重置宽度），移植=移除该机制、默认 280px |
| 13 | 60ecaf5c6 | fix | ui | 高 | 手工合 | 新增 sync/session-message-loader 模块；fork session-ui-store/sync 自研（多服务器），加载路径需映射 |
| 14 | 221b7cc6e | merge | ui | - | 跳过 | PR #3443 merge 载体，内容= #43/#44/#16 净和 |
| 15 | f80ef6d87 | test | web-server | 低 | 手工合 | event-stream runtime 测试；fork event-stream 目录结构自研（global-hub/ws-bridge），测试需适配 |
| 16 | 138f9ba02 | feat | web-server | 高 | 手工合 | git service.js applyHunk 端点（净内容在 PR #3443 树差里）；fork service.js 自研分叉 2120 行 |
| 17 | f8b929edf | fix | electron | 低 | 手工合 | Mini Chat HMR 路径；fork 有自研 mini-chat，main.mjs 小改 |
| 18 | c01ff0338 | fix | ui | 中 | 手工合 | composer zoom 随界面缩放；缩放基建由 #20 引入，fork ThemeProvider 无 zoom |
| 19 | e058f112f | merge | ui | - | 跳过 | PR #3440 merge 载体，内容= #45/#46 |
| 20 | 34c248b20 | merge | ui | - | 跳过 | PR #3423 merge 载体，内容= #48 |
| 21 | d716d7861 | merge | web-server | - | 跳过 | PR #3431 merge 载体，内容= #53 |
| 22 | a4b65a44f | fix | electron | 中 | 手工合(决策) | 新增 electron-host-probe 子系统；fork electron 自研（ssh-manager 等）且无 probe 基建 → 是否引入需决策 |
| 23 | 7d1625d39 | fix | web-server | 中 | 手工合 | git diff warnings exit code；service.js 分叉但修复点独立 |
| 24 | 8fb2b7ca1 | test | ui | 低 | 手工合 | question bootstrap 测试；fork bootstrap.ts 有 question.list，可合入 __tests__ |
| 25 | d55144ca7 | feat | ui | 高 | 手工合(决策) | 折叠 Markdown disclosures 建立在上游 markdown/markdownCore 新管线；fork 渲染器自研、无 markdown/ 子目录 → 需重实现或决策引入管线 |
| 26 | 096f67b62 | fix | vscode | 中 | 手工合 | 已核实：fork chunkLoadRecovery.ts 缺 `isVSCodeRuntime()` 守卫（会整个 reload），补丁直接对应 |
| 27 | d7edf67fc | fix | ui | 中 | 手工合 | useFactsFit fork 不存在（orphan 基建）；MessageBody 分叉 → 先查 fork 是否有等价 footer facts 逻辑 |
| 28 | 99b9c23c9 | feat | mobile-shared | 高 | 拆分 | 分支/commit 对比视图：共享部分（DiffView、Branch/CommitComparisonSelector、useGitComparison、patchFileDiff）手工合；MobileChangesSurface/MobileOverlayPanel 等面板不做 |
| 29 | 26b54dbe3 | feat | ui | 高 | 手工合 | 44 文件统一对比+紧凑消息操作；fork 有自研 baseBranch/walkthrough（分叉 86 行）→ 逐块合；i18n 13 locale 保留 fork 本地 key |
| 30 | 16cbb92c5 | fix | vscode | 中 | 手工合 | 跳过不支持的事件流；fork openchamberEvents.ts 自研分叉 362 行，需评估是否已有等价过滤 |
| 31 | 7ceb073c5 | refactor | mobile-shared | 低 | 不做 | MobileSessionsSheet 整包内改动（政策：不做） |
| 32 | f4df0b6e9 | fix | mobile-shared | 低 | 不做 | 上游 Mobile 面板/样式（fork 自研 Capacitor 壳，无这些 surface） |
| 33 | 47bc2f604 | feat | mobile-shared | 低 | 拆分 | SettingsView 手机电钻入部分评估是否取用；MobileApp 部分 + i18n settings 随共享部分 |
| 34 | 6004691f1 | fix | ui | 低 | 不适用 | LiveTurnActivity fork 无（orphan 基建）→ 随 live-activity 决策；MessageBody divider 微调可随手 |
| 35 | 7194d5d41 | feat | mobile-shared | 中 | 拆分 | projectSort.ts + SessionSidebar 共享排序手工合；MobileSessionsSheet 部分不做 |
| 36 | baba83c4d | feat | mobile-shared | 低 | 不做 | MobileSessionsSheet 整包 + i18n key |
| 37 | 4e795894c | fix | ui | 低 | 手工合 | InlineCommentInput Enter 提交；fork 有该文件（分叉 217 行） |
| 38 | 10c51f678 | chore | other | 低 | 手工合(决策) | SDK 升 1.18.30；fork 钉 ^1.18.4（root ^1.17.9），多服务器对 SDK 行为敏感 → 升级需决策+回归 |
| 39 | 9ca1caf0a | fix | ui | 高 | 手工合 | relay 死连接+usage 刷新；fork 有 ui tunnel-client/useQuotaStore 可对位，但 23 文件需逐个 |
| 40 | ff8edd6d4 | feat | mobile-shared | 低 | 不做 | useEdgeSwipe/Mobile 抽屉（fork 自研壳） |
| 41 | 1f5060c8f | fix | web-server | 高 | 手工合 | 新增 downstream-scheduler/flow-control 基建（fork web relay 无此文件，且 fork 自研 host-lock/identity/signing-key）；protocol/handshake 需双端同步改 |
| 42 | 8c25bf0c9 | fix | ui-i18n | 低 | 手工合 | tr 词汇表对齐 |
| 43 | db684f119 | fix | ui | 中 | 手工合 | hunk 原生菜单项（hunk 块） |
| 44 | ebe5f93fb | feat | ui | 高 | 手工合 | HunkActions 新组件（hunk 块）；fork 无对应物 |
| 45 | e874c7178 | refactor | ui | 高 | 手工合 | queue 重连对账；fork messageQueueStore 自研改 495 行（follow-up mode） |
| 46 | 3da20ab48 | fix | ui | 高 | 手工合 | 流中断后重读服务端队列；同上 |
| 47 | c498beaa6 | fix | web-server | 中 | 手工合 | small-model 用选中 runtime 模型端点；fork 有 small-model 目录，需比对 |
| 48 | 1c1221a0a | fix | ui | 中 | 手工合(决策) | 界面缩放基建（ThemeProvider zoom 等）+19 文件布局适配；fork 无缩放功能 → 是否引入整组（含 #18）决策 |
| 49 | 2471b296f | fix | ui | 低 | 不适用 | LiveTurnActivity fork 无 → 随 live-activity 决策 |
| 50 | 1c544b132 | fix | ui | 中 | 不适用 | LiveActivityCollapse + legend-list bun-patch；fork 无 live-activity 基建 → 随该决策 |
| 51 | 9bab7764c | fix | ui | 中 | 手工合(重写) | 40px end-follow 阈值；timelineScrollAnchoring fork 无（fork 自研 scroll 系统）→ 映射到 fork 实现 |
| 52 | b2058db3d | feat | ui | 高 | 手工合(决策) | 完成态活动折叠（依赖 orphan 引入的 LiveTurnActivity 时间线，fork 无）→ 是否引入整块需决策 |
| 53 | f70f18150 | feat | web-server | 中 | 手工合 | ClinePass provider 三端（web providers/ui index/vscode quotaProviders）；fork provider 注册表自研扩充，注册点不同 |
| 54 | 3903bfad8 | feat | ui | 中 | 手工合(重写) | 精确 ID 搜索（#3428）；fork 侧栏结构自研（无 useSessionSidebarSections/projects 子目录），需在 fork 的 session/sidebar + ArchiveView 上等价实现 |
| 55 | a7c2cf7cf | fix | ui | 低 | 手工合 | ToolPart 间距 |
| 56 | 8dce7ae6b | feat | ui | 中 | 手工合 | turn stats 默认开；依赖 #98 的遥测基建 + settings registry（fork 无）→ 接入 fork 设置体系 |
| 57 | 0e250053a | fix | ui | 中 | 手工合 | 最终回答 divider；fork 有自研 renderCompare（分叉 149 行）与自研 lib/turns |
| 58 | 5aef08707 | fix | ui | 低 | 手工合(评估) | ScrollableOverlay fork 有自研版（分叉 96 行），先查是否已有等价 |
| 59 | 9711f8cf6 | docs | ui-i18n | 低 | 手工合 | 12 locale settings 提示文案；若滚动条偏好不移植则跳过 |
| 60 | 20ad784c8 | fix | ui | 中 | 手工合(待查) | 上游 bindScrollbar 架构上的 hover 显示；fork 自研 OverlayScrollbar+overlayScrollbarVisibility 已有 intent/hover 逻辑 → 可能已等价，待比对行为 |
| 61 | b8e25f46a | fix | ui | 低 | 手工合(评估) | index.css 允许 settings 覆盖滚动条；随滚动条簇 |
| 62 | 558ed3213 | merge | ui | - | 跳过 | 分支合流载体，无独立内容 |
| 63 | beb8e79ea | feat | ui | 中 | 手工合(待查) | always-show scrollbars 偏好；fork OverlayScrollbar 已有 alwaysVisible prop + d6b642eac 保竖向可见 → 行为层可能已等价，缺设置项接入（fork 无 settings registry） |
| 64 | bce838ca7 | feat | ui | 高 | 手工合(决策) | /btw isolated composer；fork 有自研 btw 面板（53dd45412/5f072088d，与上游实现差异 800+ 行）→ 取哪家需决策 |
| 65 | 1090d8470 | fix | ui | 中 | 手工合(重写) | ReasoningPart follow 释放；fork ReasoningPart 分叉 552 行 + 自研 scroll |
| 66 | b2a4cd055 | fix | ui | 中 | 手工合(评估) | native host 版本校验；fork 无 web-update.ts、openchamber-routes 分叉 430 行、electron updater 自研 → 评估适用性 |
| 67 | 23c6b4833 | fix | web-server | 中 | 手工合 | 独立 credential-helper 权限；service.js 小改 |
| 68 | ba74cf729 | fix | ui | 中 | 手工合 | 过期 interrupted-turn 恢复拒绝；fork 有自己的 interrupted-turn 体系，需比对 |
| 69 | 5a4f9d4e5 | fix | vscode | 中 | 手工合(决策) | 连接超时；fork 无 network-defaults.js，vscode extension.ts 自研 → 映射方式需定 |
| 70 | 43bc4fca0 | fix | ui | 高 | 手工合(重写) | composer 焦点/键盘导航；ChatInput fork 分叉 6221 行、上游 DraftTargetSelectors 基建 fork 无（fork 自研 draft context） |
| 71 | f25c5660b | fix | electron | 中 | 手工合(评估) | 桌面 host updater；fork updater 自研（updater-capability.mjs） |
| 72 | 6371f72a8 | fix | ui | 低 | 手工合(评估) | markdown 表格收缩；目标 decorate.ts 属上游管线 fork 无 → 在 fork 渲染器等价实现或随 #25 决策 |
| 73 | c33bbe02c | fix | web-server | 中 | 手工合 | allowUnsafeCredentialHelper 传参；service.js |
| 74 | df551637a | fix | web-server | 低 | 手工合 | NeuralWatt valueLabel；fork 有 neuralwatt.js（分叉） |
| 75 | 008ea3b65 | fix | ui | 高 | 手工合(评估) | session fork 提示恢复到目标 composer（"fork"=OpenCode session fork，非本仓库）；上游 useComposerDraft 基建 fork 无，fork 自研 draft context 是否已有等价待查 |
| 76 | f4d883e66 | fix | ui | 中 | 手工合 | 重载后 stale active tools；materialization.ts fork 分叉 318 行 |
| 77 | ce16dc3c2 | fix | electron | 低 | 手工合 | 非 ASCII desktop 条目过滤；fork 有 linux-app-discovery.mjs |
| 78 | aa0a93527 | fix | web-server | 中 | 手工合 | Node 250ms 连接上限；network-defaults.js fork 无 → 修复语义映射到 fork 的 web/bin/cli.js + electron main.mjs |
| 79 | 73040d71e | feat | ui | 中 | 手工合(决策) | 新会话项目选择器搜索；目标 DraftTargetSelectors fork 无（fork 自研项目选择）→ 是否需要该 UX 决策 |
| 80 | cd5393e78 | fix | web-server | 中 | 手工合 | OpenRouter /api/v1/key；fork openrouter.js 分叉 |
| 81 | 02b12df54 | fix | vscode | 中 | 手工合 | Ollama 配额校验；fork vscode quotaProviders.ts 自研（bridge/participant 并存），逐文件合 |
| 82 | 4c42f82d0 | style | ui | 低 | 手工合 | 聊天文字对比度 |
| 83 | 728e0f1d8 | fix | web-server | 中 | 手工合 | ollama-cloud 成本窗口；fork 有 ollama-cloud.js |
| 84 | 64f526451 | chore | other | 低 | 跳过 | 上游仓库自身的 .openchamber/project.json 配置，非产品代码 |
| 85 | 09d959982 | fix | ui | 中 | 手工合 | thinking 滚动盒；ReasoningPart 分叉 552 行 |
| 86 | dbf69e9ab | fix | ui | 低 | 手工合 | Activity 行节奏；ProgressiveGroup fork 分叉 733 行，按 fork 版本评估是否适用 |
| 87 | d56564eea | fix | ui | 低 | 不适用 | dirty-branch tooltip；依赖上游 draft-target 基建 fork 无 |
| 88 | 7f089b08a | fix | ui | 中 | 手工合 | 已核实：fork event-reducer 为预修复版本（首 optimistic gate），上游补丁语义可直接移植 |
| 89 | 0ed82a269 | refactor | ui | 中 | 手工合(评估) | 去掉发送后锚定尾空；上游 timelineScrollAnchoring 体系 fork 无 → 评估 fork 自研 scroll 是否有同问题 |
| 90 | e246ad5ab | feat | ui | 中 | 手工合 | 40 个 theme json 增 selection 色（机械）+ css/MessageBody 排版（fork 分叉）；fork 66 个主题文件需同批补 |
| 91 | c5559499c | fix | ui | 中 | 手工合(重写) | 面板/窗口 resize 保持贴底；同 #51/#89 scroll 簇 |
| 92 | 82a0ee757 | feat | ui | 高 | 手工合(决策) | **本段最大结构变更**（163 文件 +11k）：settings registry/scope 存储基建 + 项目级 .openchamber 配置；fork 完全没有该基建且设置体系自研 → 大决策项，影响 #56/#63 等 |
| 93 | cab078054 | fix | web-server | 中 | 手工合 | PTY 清 NODE_CHANNEL_FD；fork terminal/runtime.js 仅分叉 112 行，修复点独立 |
| 94 | e5c2c81bf | feat | ui | 高 | 手工合 | libghostty-vt 适配器整包替换 ghostty-web（59 文件 +6.7k，含 vendored wasm/字体 + i18n 全量）；fork 仍 ghostty-web 0.3/0.4 → 建议按终态整批移植 |
| 95 | fbf704e45 | fix | ui | 中 | 手工合 | missing-worktree 手动迁移；fork 有自研 worktreeManager/sessionWorktreeMove 体系，逻辑映射 |
| 96 | 8e95281fe | fix | other | 低 | 手工合(被取代) | ghostty-web 版本+patch；若直接移植 #94 终态则被吸收 |
| 97 | e7d8bb7e5 | fix | ui | 中 | 手工合 | 快照按绘制尺寸重放；服务端 runtime 部分仍需移植，ui 部分视 #94 终态重评估 |
| 98 | 2dfd1190e | feat | ui | 高 | 手工合(决策) | opt-in turn statistics（#3177）；上游 WorkStatusPanel fork 从未有，fork 把 work-status 目录用作自研 DraftContextOverview → 是否引入上游面板+遥测需决策 |
| 99 | 6e585898c | fix | web-server | 中 | 手工合 | Hyper 凭据校验；随 #100 同批 |
| 100 | fbdd80fa2 | feat | web-server | 中 | 手工合 | Charm Hyper provider 三端；同 #53 注册点注意 |
| 101 | 5012de6b8 | release | other | 高 | 跳过(特殊)+决策 | orphan 历史重导入载体；v1.22.0→v1.22.2 内容差（630 文件/+42.5k，含大量后续 commit 依赖的基建）未分解 → 需按内容对比并入基线，见"特殊拓扑警示" |

## 策略统计

| 策略 | 数量 |
|------|------|
| 手工合（含 手工合(重写)/(评估)/(待查)/(决策) 变体） | 86 |
| 跳过（release/chore/merge 载体） | 8（#1、#14、#19、#20、#21、#62、#84、#101） |
| 不做（上游 Mobile 整包） | 4（#31、#32、#36、#40） |
| 不适用（依赖 fork 缺失的上游基建） | 5（#9、#34、#49、#50、#87） |
| 已等价 | 1（#7） |
| 延后-扩展系统轮 | 0 |
| Windows-only 单独决策 | 0 |

注：merge 载体 6 个（#14/#19/#20/#21/#62 + #14 计 1）+ release 2 个；#101 记跳过但附决策项。

## 本段重点功能块

### 1. git hunk 级 stage/unstage/discard（#3443）：#11、#14、#16、#43、#44
净内容 = ui 侧 HunkActions 新组件 + DiffView 浮动按钮/patchFileDiff 解析，web 侧 git/service.js `applyHunk` 端点（临时文件 + `git apply --cached/--check` 白名单 flag）。fork 完全没有对应物，service.js 自研分叉 2120 行 —— applyHunk 是独立函数，可较干净地加入 fork service.js；DiffView 侧需在 fork 的 DiffView/PierreDiffViewer 上重接。建议单批次移植（server 端点 → patchFileDiff → HunkActions → DiffView 接线）。

### 2. 终端：libghostty-vt 替换（#93、#94、#96、#97）
#94 是 59 文件 +6.7k 的整包替换（ui/src/lib/ghostty vendored wasm+字体、TerminalViewport/TerminalView/useTerminalStore 重写、web index.html/vite 配置）。fork 停在 ghostty-web 0.3/0.4 + 自有 patch。建议只取终态：直接移植 #94，#96 被 #94 吸收；#97 与 #93 的**服务端** runtime.js 改动（快照尺寸重放、NODE_CHANNEL_FD）独立于渲染器，仍需移植。fork useTerminalStore 自研 705 行，store 接线要手工。

### 3. 配额 provider 簇（#7、#22 与 quota 相关、#53、#74、#80、#81、#83、#99、#100、#78、#66）
新增 ClinePass（#53）与 Charm Hyper（#100+#99）为三端（web provider + ui provider index + vscode quotaProviders）注册，fork 的 provider 注册表自研扩充过，注册点不同；其余为既有 provider（opencode-go/openrouter/neuralwatt/ollama-cloud）的修复，fork 均有同名文件但都有本地修改，逐文件手合。#7 已等价可跳。aa0a93527（#78）的 network-defaults fork 没有，需把超时语义映射进 fork 的 server 入口。

### 4. turn statistics（#98、#56）
依赖上游 WorkStatusPanel 面板体系（v1.22.0 已有，但 fork 从未引入——fork 把 work-status 目录用作自研 DraftContextOverview/contextUsage/draftStatus）。移植不是单 commit 的事：要么连 WorkStatusPanel 基建一起引入，要么把遥测逻辑做进 fork 自研 work-status 面板。#56 的"默认开"改的是 settings registry（fork 无），接入点要换成 fork 的设置持久化。

### 5. /btw isolated composer（#64）
fork 有自研 btw（BtwPanel/useBtwPanelState/useBtwStore/lib/btw + fork 私有 i18n namespace btw.i18n.ts），上游 bce838ca7 把 /btw 重构为隔离 composer（38 文件，含 sync/input-store、selection-store、session-actions 接线）。两边架构不同，不能整文件覆盖。决策项：跟随上游重构 or 保留 fork 自研并 cherry-pick 行为修复。

### 6. 可折叠 Markdown disclosures（#25、#72）
建立在 orphan 引入的上游 markdown/markdownCore+decorate 管线上；fork 渲染器完全自研。要么引入上游管线（波及大），要么在 fork MarkdownRendererImpl 上重实现 <details> 折叠语义。

### 7. 侧栏精确 ID 搜索（#54）
fork 侧栏结构自研（session/sidebar 无 projects/ 子目录、无 useSessionSidebarSections），移植=在 fork 的 sidebar 分组/过滤逻辑与 ArchiveView 现有 query 过滤上加"精确 ID 优先"匹配语义，非直接 apply。

### 8. mobile 分支/commit 对比与排序（#28、#33、#35）
按政策拆分：Branch/CommitComparisonSelector、useGitComparison、projectSort、DiffView/patchFileDiff 共享部分手工合；一切 MobileSessionsSheet/MobileChangesSurface/MobileOverlayPanel/MobileFullscreenSurface/useEdgeSwipe 面板不做（fork 自研 Capacitor 壳）。

### 9. 队列与同步可靠性（#13、#45、#46、#68、#76、#88）
fork messageQueueStore 自研改 495 行（follow-up mode）、sync-context 分叉 4887 行。#88（optimistic part 全量替换）已核实 fork 是预修复代码，可直接移植；#45/#46 的重连对账需在 fork 的 store 上重做；#60ecaf5c6 引入的新 session-message-loader 模块要与 fork 多服务器加载路径融合。

### 10. relay 流控（#3、#5、#15、#39、#41）
#41 引入 downstream-scheduler/flow-control 基建（fork web relay 无，且 fork 有自研 host-lock/identity/signing-key 扩展），protocol/handshake/ui tunnel-client 双端联动改；风险最高的一块，建议单独一轮并拉通 fork relay 测试。

### 11. 滚动/滚动条簇（#51、#58、#59、#60、#61、#63、#65、#89、#91）
fork 自研 scroll 系统（133da01f9 redesign）+ 自研 OverlayScrollbar（alwaysVisible/overlayScrollbarVisibility）。上游这批修复多数在 fork 有对应自研机制（可能已等价：#60/#63 待查），其余（#51/#89/#91 end-follow/锚定）需把语义映射到 fork 实现。不引入上游 timelineScrollAnchoring 基建。

### 12. 设置基建（#92）
settings registry + scope 存储是本段最大结构变更，fork 无任何对应物；它还被 #56/#63 依赖。必须先决策是否引入，再排其他设置类 commit。

## fork 侧现状核实记录（"已等价/缺失"判断依据）

- ghostty-web：fork ui 用 ^0.4.0 + 自有 patch（patches/ghostty-web+0.3.0.patch）；无 lib/ghostty → #94 需整包移植。
- turn stats：fork 无任何 turnStats/telemetry key；work-status 目录被 fork 自研 DraftContextOverview 占用；上游 WorkStatusPanel 在 fork 零引用。
- /btw：fork 自研（53dd45412、5f072088d），与 v1.23.0 版本差异 BtwPanel 801 行/lib/btw 513 行。
- hunk actions：fork 无 HunkActions.tsx、service.js 无 applyHunk；有自研 patchFileDiff.ts。
- ClinePass/Hyper：fork web providers 无 cline-pass.js/hyper.js；其余 provider 齐全且被 fork 修改。
- opencode-go reset 归一：fork 已实现（已等价）。
- event-reducer optimistic：fork 为预修复版本，#88 可直接移植。
- chunkLoadRecovery：fork 缺 isVSCodeRuntime 守卫，#26 需移植。
- overlay scrollbar：fork 自研（含 alwaysVisible、visibility 控制），上游 bindScrollbar 架构不适用。
- timelineScrollAnchoring/LiveTurnActivity/useFactsFit/session-message-loader/DraftTargetSelectors/useComposerDraft/network-defaults/downstream-scheduler/settings registry/markdown decorate 管线：fork 均无（部分属 orphan 未分解基建）。
- a3a8137ed：fork useUIStore 存在同款 hasManuallyResizedLeftSidebar 重置逻辑，需同步移除。
- fork i18n：de/en/es/ja/ko/pl/pt-BR/tr/uk/zh-CN/zh-TW ×（主+settings）+ 私有 namespace（btw/chats/linear-*/project-knowledge/third-party-integrations）——上游 i18n 改动合入时保留私有 key。

## 需要用户决策的疑点（汇总）

1. **orphan v1.22.2（#101）**：630 文件内容差未分解；建议以 `git diff v1.22.0 v1.22.2` 为基线清单做一次内容对比（排除 fork 已自研等价的部分），否则后续多个 commit 缺依赖基建。
2. **settings 基建（#92）**：是否引入上游 settings registry/scopes；影响 #56/#63 及后续 v1.24 段。
3. **turn stats（#98/#56）**：引入上游 WorkStatusPanel 还是把遥测做进 fork 自研 work-status。
4. **/btw（#64）**：上游隔离 composer 重构 vs fork 自研面板。
5. **markdown disclosures（#25/#72）**：引入上游 markdownCore 管线 or fork 渲染器重实现。
6. **live-activity 时间线（#34/#49/#50/#52）**：fork 无基建，是否整块引入。
7. **界面缩放（#20/#48/#18）**：上游新基建，fork 是否引入。
8. **relay 流控（#41/#39）**：fork relay 自研扩展并存，移植顺序与融合方案。
9. **electron（#22/#17/#71）**：host probes、updater 基建 fork 自研，是否对齐上游。
10. **SDK 升级（#38）**：1.18.30 vs fork 钉的 ^1.18.4。
11. **mobile 拆分范围（#28/#33/#35）**：共享对比视图/排序部分是否要。
