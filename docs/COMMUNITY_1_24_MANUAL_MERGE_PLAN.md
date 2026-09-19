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

上游 `5012de6b8 release v1.22.2` 是**无父 orphan 提交**（历史重导入）。v1.22.0→v1.22.2 的真实内容差为 **630 文件 / +42,546 / -6,024**，全部未分解为可审 commit，且包含大量后续 commit 依赖的基建：

- composer draft-target 基建（DraftTargetSelectors / useComposerDraft）
- LiveTurnActivity 时间线 + timelineScrollAnchoring
- markdown / markdownCore + decorate 渲染管线
- 上游 WorkStatusPanel（turn stats 载体）
- session-message-loader、network-defaults、downstream-scheduler（relay 流控）

分类中被判"不适用"的 commit（#9/#34/#49/#50/#87 等）都源于缺这些基建。**基线必须先按内容对比移植（按功能块分解），否则后续约 1/3 的 commit 缺依赖**。

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
| **B0 基线与准备** | 基线验证（type-check/vitest/build 全绿）；orphan v1.22.2 基线按功能块移植（draft-target、markdownCore 管线、LiveTurnActivity、WorkStatusPanel、session-message-loader、network-defaults 等，按 D1=(a)）；fork 已自研等价的部分记不做 | D1 |
| **B1 设置基建** | 82a0ee757 settings registry/scopes + 两侧 settings-registry.json；若 D2=(b) 则改为产出"fork 设置体系映射表"供后续批次引用 | D2 |
| **B2 低风险独立修复** | 三段分类中标"手工合(低)"的 ~56 笔 + 已核实可直接移植的（7f089b08a、096f67b62、a3a8137ed、5271bba42）+ relay 测试适配 + 依赖升级类（12063fe2f、7af8f4555） | 无 |
| **B3 web-server 功能批** | quota provider 簇（ClinePass/Charm Hyper/既有 provider 修复）；git service applyHunk 端点 + 健壮性链（f16ca02b8 → dabfe7ab9(git) → 73ad4f859 → e31013943 等，按上游顺序）；worktree/PR review 服务端；scheduled-tasks；small-model；credential-helper | B0 |
| **B4 ui 功能批（独立组件）** | git hunk UI（HunkActions + DiffView 接线）；精确 ID 搜索（fork 侧栏等价实现）；AI 会话重命名（纯新增）；主题块（6a20db4d0 → 6f3227fa8 → 293fe65e3 → 语义色 d7a6479c9 整批）；context panel 文件树；retention 清理（先 diff fork 旧 useSessionAutoCleanup）；libghostty-vt 终端整包；KaTeX JS import | B0，部分 B1 |
| **B5 composer 批（高危）** | 按 D4 决策：悬浮系列按上游序 084eeabc3 → af15c1154 → a5bdcd6df → 18f6bb2c9 → 0666f0c7a → a16d947a0 → 9caa4f8ec 分层合并，保留 fork queue/follow-up 语义；队列注记 f0f30febd 映射 fork 队列结构；/btw 按 D6 | B0，D4/D6 |
| **B6 sidebar/sync 批（高危，D3=(b) 加重）** | **sidebar 新架构移植**：SessionSidebarRows + folders/list/projects/sessions/shell 子目录 + 虚拟化（63e3911e7 → c3b3a4e43 → 90a392fcd），并把 fork 本地功能重挂到新架构（globalPinned、MobileSwipeActionsRow、BulkActionBar、matrix spinner、remote status、多服务器分组）——本轮最大单项，内部再按"新架构落地 → 本地功能逐个重挂"拆顺序；sticky headers（8ee477207 → 0d59ddf3c）；bootstrap 解耦按 D5 重设计；消息队列重连对账（在 fork store 重做）；session-message-loader 融合多服务器加载 | B0，D3/D5 |
| **B7 vscode/electron 批** | vscode 逐文件比对批（f239b34ca、d144cfd4b、e5e835a87 等）；electron shell-environment、进程收割、ssh-manager 修复（只接事件不搬逻辑）；isVSCodeRuntime 守卫 | B0 |
| **B8 routing 旗舰批** | ec95fe2e0 → 27b170d69 → 48ce6028d（+ messageQueueExpanded 159130435）；Auto 持久化按 fork session 存储重写 | B1 + message-queue（D8） |
| **B9 i18n 与收尾批** | 11 locale 全量补齐（含删除 2 key/locale 的 73ad4f859）；滚动/滚动条行为簇映射 fork 自研 scroll；视觉低风险批；Windows-only 按 D12；**MERGE_PROTECTION signature token 全量验证**；全量 build + e2e + 人工回归 | 全部 |

## 验证计划

- 每批次后：`bun run type-check`（涉及包）+ `bun run --cwd packages/web test`（vitest）。
- 阶段性：`bun run build` 全量构建。
- 合并完成后：`bun run test:reconnect-recovery-e2e` + 人工回归（重点：多服务器切换、remote session 打开、queue mode、全局置顶、移动端 shared UI、terminal、git hunk 操作）。
- MERGE_PROTECTION signature token 全量 grep。
