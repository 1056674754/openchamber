# 社区 v1.22.0 → v1.24.2 手工合并计划

更新时间：2026-09-19
状态：盘点分类进行中（本文档先落骨架与规则，批次表由分类结果回填）

## 当前结论

本轮上游区间是 `v1.22.0..v1.24.2`，跨 v1.23.0 / v1.24.0 / v1.24.2 三个版本。

| 区间 | Commit 数 | 文件变更 | 规模 |
| --- | ---: | ---: | --- |
| `v1.22.0..v1.23.0` | 101 | 1008 | +77,218 / -13,512 |
| `v1.23.0..v1.24.0` | 133 | 1065 | +74,726 / -10,972 |
| `v1.24.0..v1.24.2` | 71 | 426 | +19,397 / -3,921 |
| **合计** | **305** | **1907** | **+169,128 / -26,192** |

commit 类型分布：193 fix、53 feat、13 test、9 docs、8 chore、7 release、6 refactor、5 perf、4 style、1 ci。

按既有规则：只读上游 diff，不执行 `git merge` / `git cherry-pick`，逐 commit 手工移植。fork 历史与上游无共同祖先（graft 导入），merge-base 不可用，一切以 `git diff v1.22.0..v1.24.2` + 逐 commit numstat 为准。

前置：现场已 checkpoint（`89b311a42` wip: checkpoint before v1.22.0..v1.24.2 upstream port）。

## 本轮范围决策（已确认）

1. **扩展/SDK 子系统整轮延后**：`packages/sdk`、`packages/extensions`（103 个新文件）及横跨 ui/web/vscode 的扩展集成面（extension gallery、@openchamber/sdk、SSH identities、pages/storage/workspace、background actions/toasts）本轮不做，单独开轮评估。
2. **mobile**：按 `docs/MERGE_V1.12.md` Mobile 轨道政策执行——只选合 shared `packages/ui` / `packages/web` 的移动可用性修复；上游独立 `MobileSessionsSheet` / `MobileChangesSurface` 整包、原生壳、Push、商店 CI 一律不做。
3. **跳过**：`packages/docs/**`、`.github/pr-evidence/**`、`.github/workflows`、release/version-bump、CHANGELOG、`v2-preview`。
4. **Windows-only** 改动单独决策，不混入运行时功能批次。

## 特殊拓扑：orphan v1.22.2 基线（本轮第一阻塞项）

上游 `5012de6b8 release v1.22.2` 是**无父 orphan 提交**（历史重导入）。v1.22.0→v1.22.2 的真实内容差为 **630 文件 / +42,546 / -6,024**，全部未分解为可审 commit。

**2026-09-19 内容核实修正**（逐文件核查 v1.22.0/v1.22.2/v1.23.0/v1.24.2/fork 五方存在性）：

- orphan 内容 = **v1.22.1 + v1.22.2 两个版本的常规发布变更**，可用上游 CHANGELOG 精确分解（服务端消息队列、分支切换 DirtyBranchSwitchDialog、prompt history/useInputHistoryStore、ProjectActionsButton worktree 化、terminal chunk replay、fileContentPoller/fileStatChange、toolDiffPreview、IME 修复、worktree 系列修复等 ~45 项）。
- **澄清**：早期分类报告把 DraftTargetSelectors/useDraftTarget、timelineScrollAnchoring、markdown/ 管线、WorkStatusPanel、sidebar 子目录归为"orphan 基建"是**错的**——这些在 v1.22.0 之前就存在，属 fork 长期自研替换的既有架构分歧（按 D3/D4 模式适配，不属于 B0）。LiveTurnActivity 由已分解 commit `b2058db3d` 引入；settings registry 由 `82a0ee757` 引入（分类表 #92，B1 批次）。
- 分类表中所有"不适用（依赖 orphan 基建）"判定需按此重估：真正缺的是 orphan delta 里的具体功能，而非那些基建。

**结论**：B0 = 按 CHANGELOG 把 orphan delta 分解为功能块移植；fork 已自研等价的块记不做；依赖前述长期自研区域的功能在对应批次做语义适配。

## 架构级冲突（逐 commit 移植不可行，需整体决策）

| 上游子系统 | 情况 | 待决策 |
| --- | --- | --- |
| **orphan v1.22.2 基线** | 630 文件/+42.5k 未分解基建，后续 commit 硬依赖 | 见上节；决策项 D1 |
| **settings registry/scopes 基建**（82a0ee757，163 文件 +11k） | fork 设置体系完全自研、无 registry；被 turn stats 默认开、滚动条偏好、contextEditorVisible、context panel 持久化、work-status 分区排序、queue 偏好、routing 设置面等依赖 | 决策项 D2 |
| **SessionSidebar 全面重写 + 虚拟化** | 上游 v1.24.2 重构为 `SessionSidebarRows.tsx` + `folders/ list/ projects/ recent/ sessions/ shell/` 子目录 + `sessionSidebarVirtualization.ts`（63e3911e7 +2261/-1347）；fork 的 `SessionNodeItem.tsx` 上游已删除。fork 侧本地功能：globalPinned、MobileSwipeActionsRow、BulkActionBar、matrix spinner、remote status、多服务器分组 | 决策项 D3 |
| **composer 悬浮重构系列**（v1.24.0 段 12 commit） | 上游 composer 浮于 transcript + 玻璃化 + 附件内移 + ComposerFloatingPanel；fork ChatInput 4985 行/85 自研 commit（followUpBehavior queue、45° 按钮、draft context） | 决策项 D4 |
| **任务级模型路由**（ec95fe2e0 旗舰） | 硬依赖 v1.24.0 的 message-queue + lib/settings/registry.ts，fork 均无 | 依赖 D2；决策项 D8 |
| **bootstrap 解耦**（eb8eb5591 / f2d1954b8） | "启动不全量 bootstrap、不初始化 MCP"直击 fork 多服务器目录权威（sync-context / session-ui-store 热点），语义需按 fork 架构重设计 | 决策项 D5 |
| **libghostty-vt 终端** | 上游 59 文件 +6.7k 整包替换 ghostty-web（含 vendored wasm/字体）；fork 停在 ghostty-web 0.3/0.4 + patch | 建议按终态整批移植（#94），服务端 runtime 改动独立移植 |
| **热点文件分叉度**（HEAD vs v1.24.2） | `ChatInput.tsx` +2757/-3648、`sync-context.tsx` +2239/-1945、`MessageBody.tsx` +910/-610、`MessageList.tsx` +728/-1298、`en.ts` +1071/-723、`web/server/index.js` +669/-637、git `service.js` -1695（fork 自研裁剪） | 逐文件按 hunk 人工重放，不 cherry-pick |

## 分类结果汇总（2026-09-19 三段分类完成）

逐 commit 全表见 `docs/merge-1.24.2/classify-v1.23.md`、`classify-v1.24.0.md`、`classify-v1.24.2.md`（原始清单 `inventory-full.txt` 同目录）。

| 段 | commits | 手工合 | 跳过 | 延后-扩展轮 | 不做 | 不适用 | 已等价 | Windows-only | 待查/决策 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v1.22.0..v1.23.0 | 101 | 86 | 8 | 0 | 4 | 5 | 1 | 0 | — |
| v1.23.0..v1.24.0 | 133 | 100 | 17 | 12 | 2 | 0 | 0 | 2 | — |
| v1.24.0..v1.24.2 | 71 | 55 | 8 | 4 | 0 | 0 | 0 | 0 | 4 |
| **合计** | **305** | **241** | **33** | **16** | **6** | **5** | **1** | **2** | **4** |

高风险集中区：composer 悬浮系列、settings/useConfigStore 重写、bootstrap/sync 热区、git service 健壮性链、sidebar 虚拟化、routing 旗舰、主题系统、vscode bridge / electron main.mjs 自研热区。

## 决策清单（编号供批次引用）

**2026-09-19 已确认：D1=(a) 按功能块移植基线；D2=(a) 引入 settings registry；D3=(b) 跟 sidebar 新架构 + 重挂本地功能（本轮最大单项，B6 批次加重）；D4=(a) 采纳悬浮布局 + 保留 fork queue 语义。**

| # | 决策项 | 选项 | 结论 |
| --- | --- | --- | --- |
| D1 | orphan v1.22.2 基线 | (a) 按功能块分解移植基线 (b) 跳过基线只上无依赖 commit (c) 整树对齐 v1.22.2 | ✅ (a) |
| D2 | settings registry 基建（82a0ee757） | (a) 引入 (b) 不引入、逐个映射 | ✅ (a) |
| D3 | sidebar 新架构 + 虚拟化 | (a) 不跟、行为级选合 (b) 跟新架构重挂本地功能 (c) 延后 | ✅ (b) |
| D4 | composer 悬浮方向 | (a) 采纳悬浮玻璃布局、分层保留 fork queue (b) 保留 fork 布局 | ✅ (a) |
| D5 | bootstrap 解耦语义 | 按 fork 多服务器重设计后单独批次 | 重设计（不可直译） |
| D6 | /btw | (a) 跟上游隔离 composer 重构 (b) 保留 fork 自研面板 + cherry-pick 行为修复 | (b) |
| D7 | live-activity 时间线 + turn stats/WorkStatusPanel | (a) 整块引入（依赖 orphan 基建） (b) 遥测做进 fork 自研 work-status (c) 不做 | (a) 若 D1=(a) |
| D8 | 任务级模型路由 | 依赖 D2=(a) + message-queue；否则延后 | 满足前置则上 |
| D9 | relay 流控（downstream-scheduler） | 单独一轮，双端联动 | 单独轮 |
| D10 | markdown disclosures 管线 | (a) 引入 markdownCore (b) fork 渲染器重实现折叠语义 | (b) |
| D11 | 界面缩放基建（zoom） | (a) 引入 (b) 不做 | (b) 本轮不做 |
| D12 | Windows-only 2 笔 | 单独决策 | 暂缓 |
| D13 | SDK 升 1.18.30（fork 钉 ^1.18.4） | 升级需回归多服务器行为 | 延后到扩展轮 |
| D14 | 功能移除：非 git 轮次 changed-files 下拉（23e26f443 → fdef13cbd 替代） | (a) 跟随移除 (b) 保留 fork 现状 | (a) 跟随上游 |
| D15 | mcp-reconnect 模块（前段引入后段又删除） | 前段不移植则后段两笔空操作 | 不移植，两条记 N/A |
| D16 | mobileComposerMorph / per-port cookie / dictation / realtime-proxy | 逐项单独决策（多为 fork 架构下 N/A 倾向） | 执行到对应批次时定 |

## 合并规则（沿用 1.11.7 轮）

1. 只读上游 git 历史和 diff，不直接执行 `git merge` / `git cherry-pick` / 覆盖式 checkout。
2. 每个上游 commit 按"官方旧版 → 官方新版"先理解，再手工改我们的当前文件。
3. 以 fork 为根本：保留多服务器、`serverId`、`sessionId`、directory 权威上下文、remote instance、父子 session、OpenChamber server 父子结构。
4. 任何 session、permission、question、git、file、terminal、plugin、tunnel、settings 相关改动，必须检查是否误用全局 active project / current directory。
5. Release-only、CI-only、Windows-only 改动单独决策。
6. i18n：fork 实为 11 个 locale（de/en/es/ja/ko/pl/pt-BR/tr/uk/zh-CN/zh-TW，与上游一致；MERGE_PROTECTION.md 里"7 locale"已过时），本地独有 key 全部保留，上游新 key 逐 locale 补齐。
7. 每移植一个功能块：`fix/feat(...)` commit + `docs(migration): record ...` 追加到 `docs/MERGE_V1.12.md`（沿用现行实践）。
8. 碰 `docs/MERGE_PROTECTION.md` 热点文件后，跑该文件对应 signature token 检查。

## 热点文件清单（MERGE_PROTECTION）

`ChatInput.tsx`（queue mode）、`FilesView.tsx`、`ChatMessage.tsx`、`MessageList.tsx`、`MessageBody.tsx`、`sync-context.tsx`、`SessionNodeItem.tsx`、`electron/main.mjs`、`i18n/messages/*.ts`（7 locale × 本地 key）。

## 批次计划（按依赖序）

每批次 = 若干功能块；每功能块移植完：`fix/feat(...)` commit + `docs(migration)` 追加台账 + type-check（涉及包）+ vitest。高风险批（B5/B6/B8）每批后加全量 build。

| 批次 | 内容 | 前置 |
| --- | --- | --- |
| **B0 基线与准备** | ✅ 基线验证绿 + **全部落地（2026-09-19，22 commits）**：B0a exe.dev+XDG（b1d19176d）；B0b 文件/渲染 5 项（0cd74f0c1 文件闪烁、72785335c 巨型 patch 防冻结、ac48e6c9d markdown 表格、9c44e2db8 IME、2fc594542 JSON 视图记忆）；B0c git/worktree 6 项（049c56da8 分支切换保护+recent branches、68f11aa31 fetch fallback、55b11e1b8 后台删除、bf285bcfe 批量归档提速、5aa327f7d missing-worktree 迁移、5fd150c62 bootstrap 期间状态隐藏）；B0d+B0e prompt history + 服务端消息队列（105afe614、6475ba88f，保留 fork followUpBehavior，sessionId 单键遗留复合键迁移给 B5）；B0f project actions worktree 化 + vscode XDG + Fixel 字体（ecf6796a7、08dfba569、0d30e751f）；B0g thinking effort 持久化（f66471d0d）、记住上次侧（73527b343）、Goal Mode 截断续跑（08c2fa372）+ 交叉修复（6122a78ab）。**N/A**：OPENCHAMBER_CHATS_DIR、rename 全选（fork 对话框已等价）、desktopHostStatus（实为实例切换器缓存，fork 自研已覆盖）；**延后**：DirectoryActionIndicator→B6、unarchive 迁移变体→B6、设置面 scope/条数→B1、mcp-reconnect 不移植（D15）、Windows-only 暂缓、Docker/CLI/l10n→B7/B9 | D1 ✅ |
| **B1 设置基建** | ✅ **已完成（2026-09-19，5 commits：4b5aca8cf → ea9524ed7）**：lib/settings registry（fork 保留 DesktopSettings 为 canonical、registry 反向绑定护栏）+ registry-snapshot 生成双侧 settings-registry.json（709 行）；server 写入门控 + preferences.json 拆分 + 一次性 seed + .openchamber/project.json 项目配置 + 信任哈希；vscode registry-gate/settings-files 镜像（保留 fork 跨进程锁）+ project-setup 桥；stores/components/i18n（11 locale +20 key）。独立复验：7 包 type-check 0 错、web vitest 全绿。**跳过（记后续批次）**：settings 页 7 个重写组件、BehaviorPage、ThemeSystemContext、settings/search.ts（归 UI-parity/搜索批次）；useQuotaStore/useGitIdentitiesStore 改造（fork 已有远端感知等价读取） | D2 ✅ |
| **B2 低风险独立修复** | ✅ **已完成（2026-09-19，15 commits）**：B2a server/electron/scripts 7 commits（1d54a39b9 依赖升级+cron-parser 5、c7739946c neuralwatt/agent-tool/runNow、410f19b7e 测试改造、cdecebd70 electron 条目过滤、db455abda gemini-3 默认选+SessionErrorNotice、f893e8053 mobileConnections 测试、93fc9bb90 bun:test shim 修 vitest 混跑）；B2b ui 8 commits（4996ba012 文件预览滚动位置、6601f9523、56bb0c967 启动 splash、bc7b74664、4d748be53、7a763f5df、cdc6bfb2e Catppuccin、e8b2baf72）。**N/A/已等价 18 项均有据**（多为依赖 fork 未移植的上游组件）。独立复验：web 185 文件/1524 测试全绿、type-check 0 错。**跳过记后续**：a9944a28e 删 Crof（功能移除待决）、downstream-scheduler 相关（D9 单独轮）、shell-environment（前置未移植） | 无 |
| **B3 web-server 功能批** | ✅ **已完成（2026-09-19，~16 commits）**：82e68c6f6 ClinePass+Charm Hyper 三端（均走 auth.json，fork 无托管凭据库）；git 健壮性链严格按上游序：272686793 applyHunk+--full-index、4d928f09d serial-refresh+bounded ls-files、1cf71736c stall kill、2f475b6aa Windows 进程树终止、6a1cbd1fe/08229a095；b71927285 proxy 就绪门、4e4e122be PR diff 端点、ef2e84d41 worktree 拓扑指纹+SSE；42f6526c9/20c1a910a/6adbb246f/7ec082afd/7ff503c35/fd1616a7c/4274922ac 零散。**B3 交接给 B4b**：fork ui splitPatchIntoHunks 是旧版 CRLF 拆分，接 HunkActions 前先按上游重写。**已知 flake**：session-assist/runtime.test.js 满载偶发时序失败，隔离跑稳过。独立复验：web 194 文件/1668 测试（4 failed 为该 flake） | B0 ✅ |
| **B4-theme 主题链** | ✅ **全链路完成（2026-09-19）**：ui 侧 4 commits（3d88cd06a 调色板紧凑化 62 JSON 重生成 + fork 扩展键保留、99cf5a81a 语义色、6fbac720d 导入 ui、48d5f8f59 强调色；真实上游序按依赖落地）+ server 侧 452346221（theme-runtime 导入/删除/409/413 + theme-archive VSIX 安全读取 + theme-catalog Open VSX 白名单/sha256 + 路由接线，与 ui 契约逐端点核对）。i18n 27 key × 11 locale。测试 196 文件/1684 全绿 | B1 ✅ |
| **B4a ui 功能块** | ✅ **已完成（2026-09-19，5 commits）**：2c027c925 context panel（占位 tab 语义 + Esc 守卫 + FilesView 离屏优化；editor toggle/文件树宽度 N/A——fork 文件面为自研 FilesView 无 docked 树，单宽是既定设计）；3f33ad9df+ad46d4b7a retention（archived-only 清理 + 级联安全重写 + server 白名单 3 行）；4849005e5 精确 ID 搜索（fork 自研侧栏管线等价实现）；3811e74d4 KaTeX eager import。**N/A 有据**：AI rename（fork 已有 RegenerateTitleDialog 候选式等价）、work-status 排序（D7 fork 自研路线无落点）。**B4-theme** 见上（全链路含 server 452346221） | B0，部分 B1 |
| **B4b git hunk UI** | ✅ **已完成（fecc8444d，+591/-50）**：splitPatchIntoHunks 升级 v1.23.0（hunk-header-offset 切片保 CRLF + isBinaryPatch + haveMatchingPatchVersions blob 身份 + getPatchHunkAnchors）、HunkActions 浮动胶囊（fork 无 staged scope → stage+discard，turn/branch 只读）、gitApi 三方法 + 9 i18n key × 11 locale。d5fbd86e9 N/A（fork collapsedContextThreshold=0 无该分隔符） | B3 ✅ |
| **libghostty-vt 终端** | ✅ **已完成（2 commits：9876f551f 渲染器 58 文件 +7037/-2427、092183e92 server 快照尺寸+PTY env）**：vendored lib/ghostty 全包、TerminalViewport 换 libghostty surface、ghostty-web+patch 全移除、wasm/woff2 vite 资产管线 + PWA precache 验证、i18n 4 key × 11 locale；fork TerminalView 会话管理（多 server store key/provisional 尺寸/单活跃 tab/1MiB 回滚）全保留；server runtime.js NODE_CHANNEL_FD + env -u 修复 | B0 ✅ |
| **B5 composer 批（高危）** | ✅ **已完成（2026-09-19，8 commits：382958863 → 81f57dcc0）**：真实上游序为 a16d947a0 最先（ComposerFloatingPanel），按依赖落地。悬浮几何/玻璃/附件内移/补全锚点/队列偏好面板采纳上游；**fork 语义层全保留**（Ctrl+Enter follow-up、45° 按钮、sessionId 键控队列、PendingChangesBar 保留——fork 无 work-status 替代面）。server session-assist context/prompt 拆分随落。**跳过有据**：recap 链（fork 自研 in-flow SessionRecapNote，上游链依赖 882 行 useChatTimelineScroll）、18f6bb2c9 pill variant（fork 无 pill）、9caa4f8ec（fork 附件桶已 session 键控）。D6 /btw 维持 fork 自研（面板已接入共享停靠）。queue 面板偏好 messageQueueExpanded 已注册（3ef1fbd5e） | B0 ✅，D4 ✅ |
| **B6a sidebar 新架构** | ✅ **已完成（2026-09-19，5 commits：7574d5b8c → 964092bdc）**：support 层（session-ordering/global-session-status/global-blocking-requests/performance-diagnostics + 27 i18n key × 11 locale）→ rowModel 架构落盘 → SessionSidebar 切换 + useVirtualizer 真接线（overscan 8、pinned 行保活、未就绪降级 24 行）→ 本地功能逐项重挂（globalPinned 走 orderIndex 进模型排序、matrix spinner、BulkActionBar、MobileSwipe、DirectoryActionIndicator 适配 fork projectActionRuns、useSessionRowMenuState）→ 删 SidebarProjectsList(631 行)。**多服务器语义**：分组留 fork section 组装层（project.serverId），模型只收折叠/pinned/orderIndex/状态表。**signature 全部存活**（15 文件 globalPinned 等 12 项复 grep 通过）。231 tests 0 fail。**遗留**：per-project pin 拖拽重排未在平列表重建；useSessionListSync/bootstrap-demands 未引入（sync 轮）；备用 sortableItems 落盘 | D3 ✅ |
| **B6b sync/bootstrap 解耦** | ✅ **已完成（2026-09-19，9 commits）**：bootstrap 去 MCP/command 预热（slash 未命中 live 回退，仅默认 server）+ 零请求回归测试；server pendingRequestsBySession + host status map；UI host-session-status-seed（跨目录 status 索引 + blocking-request 索引 + fork sessionStatuses 三处；tray 5s 轮询改默认 server 单请求 + remote 有界刷新 excludeServerId）；createSession 迟到响应拒绝 + 空 transcript 确认；队列 resync（ownership 后重读/保留新于快照的 broadcast/take 失败先 refresh）；stale tools 收敛 + interrupted-turn 恢复（serverId 感知）。**D5 重设计**：bootstrap 需求模型 = 默认 server 活跃目录按需 + remote 单 SyncProvider，禁全量 fanout | D5 ✅ |
| **B7 vscode/electron 批** | ✅ **已完成（2026-09-19，11 commits）**：vscode——77968115f 连接超时（补 networkDefaults.ts + server 入口漏项）、8f3c285e8 surfaceAttention（fork isPageActivelyViewed 与 host 报告融合）、42f6c5781 编辑器新会话目录、f135ed3f9 孤儿事件流清理、8d14680a6 Ollama 注入式校验 +18 测试、24d3b31da gitService 触点、8a55a19f4 owned 进程（opencode.ts 语义合并保 fork 自动恢复/remote env）；electron——4615485a9 shell 环境探测、72d4a25e3 进程收割（server-shutdown + terminal shutdown.js）、088a34a30 dock badge 解耦、f8ab7ecb3 ssh-manager 复用运行中 server + XDG +16 测试。**N/A 有据**：16cbb92c5（fork 事件已走 sync 通道）、f8b929edf（state.localOrigin 等价）、25bfdd777（fork 走 fetch）、33d86414e（fork 自研 updater 链） | B0 ✅ |
| **B8 routing 旗舰批** | ✅ **已完成（2026-09-19，3 commits）**：6d052046d routing 全套（server lib/routing 11 文件 + /api/routing + message-queue resolvePromptBody 钩子 + permission-auto-accept 接线 + registry 注册 + RoutingPage/useRoutingStore/routing.i18n.ts 771 行 + 11 locale；适配：history 用 fork collectRecentTurns 有界窗口、openchamberEvents 保 fork 信封分发加四事件）；4f32e4ad8 contextWindowLimits；9f97504ec Auto 跨重启（**fork 自研 openchamber-sessions/service.js 重写**：auto 哨兵放行 + dispatchPrompt 双路径 resolvePromptBody 重写 + 双跑测试）。跳过项均有据（fork 无对应落点） | B1 ✅ + message-queue ✅ |
| **B9 i18n 与收尾批** | 11 locale 全量补齐（含删除 2 key/locale 的 73ad4f859）；滚动/滚动条行为簇映射 fork 自研 scroll；视觉低风险批；Windows-only 按 D12；**MERGE_PROTECTION signature token 全量验证**；全量 build + e2e + 人工回归 | 全部 |

## 验证计划

- 每批次后：`bun run type-check`（涉及包）+ `bun run --cwd packages/web test`（vitest）。
- 阶段性：`bun run build` 全量构建。
- 合并完成后：`bun run test:reconnect-recovery-e2e` + 人工回归（重点：多服务器切换、remote session 打开、queue mode、全局置顶、移动端 shared UI、terminal、git hunk 操作）。
- MERGE_PROTECTION signature token 全量 grep。
