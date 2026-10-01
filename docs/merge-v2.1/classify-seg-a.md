# Segment A 分类：v1.24.2..v2.0.0（111 commits）

更新：2026-10-01。基线：merge/upstream @ c224009a9（fork 1.24.2-sscity）。
清单来源：docs/merge-v2.1/inventory-full.txt 第 5324-7617 行（`@@@hash|date|subject` + numstat）。
方法：逐 commit numstat + 对当前 fork 树做文件存在性 / 关键符号核实（非按旧印象）。

## Fork 基线核实要点（对当前树逐一核实，2026-10-01）

**fork 已有（1.24 轮落地，勿按"fork 无 X"判断）**：settings registry/scopes（`lib/settings/registry.ts`）、server message-queue（`server/lib/message-queue/`）+ 客户端 hydrate（`stores/messageQueueStore.ts`）、sidebar 新架构（`SessionSidebarRows.tsx` + `sessionSidebarRowModel.ts` + `SessionNodeItem.tsx`）、composer 悬浮系列（`composer/ui/ComposerFloatingPanel.tsx`）、任务级 routing（`lib/routing/` + `sections/routing/RoutingPage.tsx`）、guests/extensions 子系统（`server/lib/guests/` 30+ 文件 + `packages/sdk` + `packages/extensions`）、libghostty-vt 终端、小模型（`server/lib/small-model/` 含 call.js）、walkthrough（含 pull-request.js）、`server/lib/opencode/shutdown-runtime.js`、`sync/session-ordering.ts`、`sync/global-session-status.ts`、`session-knowledge/`、11 个 locale（**无 nl，无 fr** —— 注意：fork 实际为 11 locale，nl 为第 12）。

**fork 确认没有（本轮核实）**：
- 整个 OC2 表面：`lib/opencode/{events,projection,tools,model,ids,compatibility,plugins,websearch,session-stats}.ts`、`server/lib/opencode/{config-v2,v2-install,compatibility,cli-upgrade,v1-migration-topup,credential-db,managed-config-file,response-envelope,session-activity}.js`、`server/lib/event-stream/translate-v2.js`
- `server/lib/spaces/`（整个 Spaces 子系统，0 文件）
- `server/lib/openchamber-sessions/session-metadata-store.js`（fork 仅 routes.js + service.js）
- `sync/session-cache-retention.ts`（fork 另有 `session-retention.ts` + `session-cache.ts`，为 1.24 轮自有 retention 面）
- sidebar：`worktreeIndex.ts`、`recent/sessionLocation.ts`、`sessions/SessionTreeItem.tsx`（fork 用 SessionSidebarRows 取代）、`useGlobalSessionsPolling.ts`（fork 全局会话走 `stores/useGlobalSessionsStore` 自有轮询）、`sync/session-message-loader.ts`
- `update/OpenCodeCompatibilityGate.tsx`、`lib/startupDiagnostics.ts`、`lib/opencode/upstreamError.ts`、`sync/session-action-failures.ts`
- chat：`QuestionCard→FormCard` 改名未发生（fork 仍 `QuestionCard.tsx`/`questionSerializers.ts`）、`work-status/` 面板整块无、`composer/comment/` 模式无（fork `components/comments/` 是 diff 行内评论，另一功能）、`composer/keyboardPolicy.ts` 无
- 上游 Capacitor mobile 表面（`MobileSessionsSheet/MobileTimelineList/useEdgeSwipe/ComposerDictation@dictation/`）——fork mobile 为自有架构（`apps/MobileApp.tsx` + `components/voice/` + packages/mobile + packages/harmony）
- `lib/outsideFileGrants.ts`（fork 从未引入该授权层）、`components/browser/BrowserPane.tsx`（fork 浏览器面为自研 `lib/browser/controlClient.ts` + ContextPanel）
- electron：`opencode-readiness.mjs`、`early-startup.mjs`/`entry.mjs`（fork main.mjs + runtime-loader/shell-environment 等自有链）
- scripts：`oc-dev.mjs`、`run-isolated-tests.mjs`、`bump-version.test.mjs`；bin：`commands-tunnel.js`；`.github/workflows` pr-intake/Blacksmith 全套
- `changelog/` 目录（fork 用根 CHANGELOG.md）

**与任务书预期的出入（按实分类）**：
- **Enterprise 起点（机器策略/断网/扩展白名单/Jev endpoint）与 nl locale 均不在本段**——全部落在 v2.0.0..v2.0.4（Segment B，2026-09-28 前后）。本段 0 个 enterprise、0 个 posthog、0 个 nl commit。
- **Spaces 本段只有"未接线"基础**（design docs + unwired docker place + gatekeeper + stage 3a code-in）；feature switch/dispatcher（stage 4a）及之后全部在 Segment B。
- 大量 commit 写在 OC2 迁移（654705f7d，2026-09-22）之后，事件/接口形态按 OC2 设计——标【依赖OC2】或注"随脊柱批"。

策略后缀定义：【依赖OC2】= 移植 OpenChamber 侧代码，但运行时依赖隔壁 agent 的 ../opencode 2.x fork，落地前不得激活/部署相关路径；【Spaces 子系统】= 归入 Spaces 功能块整体决策。

## 逐 commit 分类（新→旧）

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
|---|---|---|---|---|---|---|
| 1 | 19112c58e | release | 发布 | 低 | 不做 | 版本发布固定项；fork 自管版本号（1.24.2-sscity 惯例），无 changelog/ 目录 |
| 2 | f45c1bff2 | fix | usage-stats | 低 | 移植【依赖OC2】 | UsageStatsView 布局修复；依赖 #5 的 stats 页先落地（读取 OC2 会话统计 API） |
| 3 | 9aeb6fe93 | feat | providers | 中 | 移植【依赖OC2】 | 自定义 provider reasoning levels；UI 侧 custom-provider-form fork 有，server 侧写入走 config-v2.js（OC2 config API） |
| 4 | 69f2a3252 | feat | websearch | 中 | 移植【依赖OC2】 | 新 WebSearchPage/WebSearchResults/useWebSearchStore + server websearch-config.js；config 读写走 config-v2.js；+507 行 i18n 新文件 |
| 5 | 4e3b82c82 | feat | usage-stats | 中 | 移植【依赖OC2】 | 新 usage stats 页（364 行 View + store + session-stats.ts 客户端）；数据源为 OpenCode 会话统计端点，OC2 才稳定 |
| 6 | 142357ee7 | feat | chat | 中 | 移植【依赖OC2】 | 内联 /skill 提及随 prompt 发送；改 ChatInput(20/4)+buildOutgoingMessage+client.ts(86/17)+session-ui-store——client.ts 为 OC2 重写后的形态，fork client.ts(2162 行自研)需手工对位 |
| 7 | 0a6198389 | feat | plugins | 中 | 移植【依赖OC2】 | 插件加载状态徽标+非 pinned 自动更新；lib/opencode/plugins.ts 为 OC2 客户端面；fork usePluginsStore/PluginsPage 已有，可接状态层 |
| 8 | e33735799 | fix | sync | 中 | 移植 | 工具 live 转换后刷新 Git 状态；sessionEvents.ts+sync-context.tsx——fork sync 层自研（sync-context 3620 行），手工移植判定逻辑 |
| 9 | 10a7bd75f | fix | tunnels | 低 | 移植（部分） | 公开隧道前强制 UI 密码；server tunnels/routes.js fork 有可直接移植；bin commands-tunnel.js fork 无此文件（CLI 结构不同），需对位 fork bin |
| 10 | 8b101d55d | fix | opencode-install | 中 | 移植【依赖OC2】 | OC2 在 Windows/VS Code 安装修复 + oc-dev/test-runner 脚本；v2-install.js 属 OC2 安装链；oc-dev/run-isolated-tests/sdk-override fork 无对应脚本——脚本部分不做，v2-install 随脊柱 |
| 11 | 0af1eb00c | fix | memory | 低 | 移植 | memory 每 entry 只读一次；agent-tool/runtime+openchamber-control/actions+session-knowledge/runtime 三处 fork 均有，小 diff |
| 12 | 3793538ed | fix | theme | 中 | 移植 | 28 个内置 palette 文本/边框软化；fork 1.24 轮已做主题紧凑化+语义色——需逐 palette 对比后合入，防覆盖 fork 调整 |
| 13 | b88b95cfe | fix | sync/global-status | 中 | 移植 | 子代理运行期间保持 turn 打开；global-session-status.ts+useQueuedMessageAutoSend+reviewFlow；事件形态按 OC2 编写（随脊柱批）；fork mobile 文件跳过 |
| 14 | f1058bcde | fix | server/turn-end | 高 | 移植【依赖OC2】 | 后台子代理结束后才结束 turn；新增 response-envelope.js/session-activity.js（OC2 server 助手）；**改 message-queue/runtime.js(27/12)——fork server 消息队列自研，热冲突**；notifications/session-goal 同改 |
| 15 | 52230df84 | fix | browser-ui | 低 | 不做 | 上游 BrowserPane 后台化修复；fork 无 components/browser/（自研 controlClient 面），不适用 |
| 16 | 4e17f1b25 | fix | vscode | 低 | 移植 | vscode/opencode.ts 托管 CLI 解析一致性；小 diff |
| 17 | 800b2aee9 | feat | providers | 低 | 移植【依赖OC2】 | OpenCode Go Console 登录入口；ProvidersPage+providerAuth；认证端点属 OC2 Console |
| 18 | 6c1735a70 | fix | sync | 低 | 移植 | 陈旧快照不覆盖 live 子代理链接；sync/materialization.ts fork 有；形态按 OC2（随脊柱批） |
| 19 | 2d406f9f9 | feat | files | 中 | 移植 | 文件夹菜单/树工具栏上传；SidebarFilesTree+FilesView+新 useFileTreeUpload(211)；fork FilesView 有 |
| 20 | 31c1be6c0 | fix | markdown | 低 | 移植 | streaming lexer 失败后跳过重复 parse；markdownCore 单点 5/1 |
| 21 | 9d4def814 | fix | desktop | 高 | 移植【依赖OC2】 | 桌面启动/实例恢复改进：新增 electron/opencode-readiness.mjs + OpenCodeCompatibilityGate + lifecycle.js(13/1)；**electron 侧与 fork 公证壳/runtime 链相交，按 EMBEDDED_OPENCODE_PACKAGING runbook 评估**；兼容门为 OC2 版本门槛 |
| 22 | 461f91452 | feat | opencode | 高 | 移植【依赖OC2】 | session metadata 迁 OC2.0.15：session-metadata-store 大改(166/213)+compatibility.js+proxy+openchamber-sessions routes；**fork 无 session-metadata-store**（fork openchamber-sessions 仅 routes+service）——属脊柱批的存储层重建 |
| 23 | 662b81aba | fix | sidebar | 低 | 移植 | 按 last turn 而非任意更新排序；sync/session-ordering.ts fork 有（7/1） |
| 24 | af9d928a9 | fix | sessions | 中 | 移植 | 归档/恢复保留完整记录；session-actions(38/20)+session-archive-batch——fork session-actions 自研，手工移植；fork 有自有 session-retention.ts 需对照 |
| 25 | 133577aeb | fix | agents | 低 | 移植 | override 缺省时保留 resolved mode；AgentsPage/AgentsSidebar 小 diff |
| 26 | f99fe1fd6 | feat | memory | 中 | 移植 | 会话级 memory 保存指令全端送达；跨 5 文件（reviewFlow/useMultiRunStore/openchamber-sessions routes/scheduled-tasks/session-knowledge）——fork 各文件均为自有版本，逐点手工 |
| 27 | 570250737 | fix | agent-tool | 低 | 移植 | 显式用户请求可越过工具约束；agent-tool/runtime(2/2)+control/actions(1/1) |
| 28 | d7a0df9c7 | feat | chat | 高 | 移植 | 从 agent 回答 fork 会话；MessageBody(49/36 热点，fork 2496 行)+session-actions(31/11)+session-ui-store——fork 消息区/sidebar 动作自研，手工移植；依赖 OC2 fork 语义 |
| 29 | a585e81c6 | fix | sessions | 中 | 移植【依赖OC2】 | 等 v2 turn end 而非 step end；btw/reviewFlow/message-queue/notifications/session-goal 五处——turn 语义为 OC2 |
| 30 | 04282b084 | feat | chat | 低 | 移植 | 权限请求白话描述；PermissionCard(64/21)+新 permissionSummary(118)+i18n；fork PermissionCard 有 |
| 31 | 431972e0f | feat | theme | 低 | 移植 | 新增 Cursor 内置配色（2 json+presets）；fork themes 目录有 |
| 32 | 39a4940db | feat | theme | 低 | 移植 | 新增 Osaka Jade Refined 配色；同上 |
| 33 | e80f25367 | fix | opencode | 高 | 移植【依赖OC2】 | CLI 升级 + v1 迁移恢复：新 cli-upgrade.js/v2-install.js/v1-migration-topup.js/compatibility.js(ui+server)+OpenCodeCompatibilityGate(116)+routes.js upgrade 段——升级/迁移链整体属脊柱批 |
| 34 | dad8588a4 | fix | server/shutdown | 低 | 移植 | graceful shutdown 关闭已升级 socket；shutdown-runtime.js fork 有，22 行新增 |
| 35 | 90a8d8f10 | fix | sidebar/sessions | 中 | 移植 | 启动失败后恢复 sidebar 列表；useGlobalSessionsPolling(52/13) fork 无同名 hook（fork 走 useGlobalSessionsStore 自有轮询）——移植到 fork 等价面；useSidebarGroupStatus/useGlobalSessionsStore fork 有 |
| 36 | e91ab06be | fix | chat | 低 | 移植【依赖OC2】 | 恢复 v2 edit/patch diff 计数；ToolPart(16/2)+新 diff-stats 测试——v2 part 形态 |
| 37 | 0c4fbe362 | feat | sidebar | 低 | 移植 | 空分组"开始会话"动作；SessionGroupSection+rowModel+SessionProjectScroller；fork rowModel 架构有 |
| 38 | 654705f7d | feat | 全仓 | 高 | 移植【依赖OC2】 | **OC2 迁移脊柱（#3837）**：~450 文件 ±19k 行。client.ts 重写(1242/1385)+新 lib/opencode/{events,projection,tools,model,ids}.ts(计 ~2.8k 行)+sync 层重写(event-reducer 399/261、event-pipeline 217/263、sanitize/session-actions/sync-context)+Question→Form 改名(FormCard/FormDock/formSerializers/form-recovery)+server opencode lib 重写(config-v2 747、translate-v2 313、credential-db、managed-config-file、v1-migration-topup、routes 61/431)+small-model 重构(call.js 删 851→client.js 新 113)+vscode 大改+electron 打包脚本+sdk。**fork 全部热点（ChatInput 5247/sync-context 3620/MessageBody 2496/client.ts 2162/server index.js 2195）均相交；建议整轮脊柱，拆 6-8 子批手工移植** |
| 39 | f25d6f503 | feat | spaces | 高 | 移植【Spaces 子系统】 | stage 3a：项目代码带入 space（code-in.js 641+host-git+run-command，~2.5k 行）；fork lib/spaces 不存在 |
| 40 | 49f5c852d | fix | CI | 低 | 不做 | .github pr-intake workflow，fork 无此流程 |
| 41 | 0f79a82a9 | docs | 流程 | 低 | 不做 | 上游 AGENTS.md 贡献规则；fork AGENTS.md 自有 |
| 42 | 0e72889ce | docs | 流程 | 低 | 不做 | CONTRIBUTING 定义 |
| 43 | 43a469e2a | docs | 流程 | 低 | 不做 | CONTRIBUTING 定义 |
| 44 | 2e98bb567 | docs | 流程 | 低 | 不做 | CONTRIBUTING/PR 模板 |
| 45 | d8003eaaa | docs | 流程 | 低 | 不做 | discussions 模板 |
| 46 | fdd3a58a5 | docs | 流程 | 低 | 不做 | discussions 模板 |
| 47 | 7be5f80bb | fix | sidebar | 低 | 移植 | Recent 子任务 worktree metadata 解析；activitySections+rowModel+SessionProjectCollection；fork 架构有 |
| 48 | ff8679be0 | fix | server/guests | 低 | 移植 | 共享关停期间 guest 启动设栏；guests/service(54/5)+shutdown-runtime(30/14)；fork 两文件均有 |
| 49 | 8e75a1dc0 | fix | server/guests | 低 | 移植 | graceful shutdown 停 guest 服务；shutdown-runtime(9/0) |
| 50 | 2426ede0e | fix | sidebar | 中 | 移植 | Recent worktree tooltip 显示 PR 行+共享 worktree 索引；新增 worktreeIndex.ts(103)+sessionLocation 扩展——fork sidebar 新架构可直接挂载 |
| 51 | 336e19248 | docs | 流程 | 低 | 不做 | triage skill 日期 |
| 52 | 93d7c9b75 | chore | 流程 | 低 | 不做 | 上游贡献流程/workflows；含 electron main.mjs 3/3 微调随 #87 评估 |
| 53 | 1dd434753 | revert | model-picker | 低 | 不做（净零） | 与 #58 互相抵消，净效果为零 |
| 54 | fafbd50bc | feat | settings | 中 | 移植 | 可搜索主题选择器（ThemePicker 305 新）+select/index.css 调整；fork OpenChamberVisualSettings 有（27/31 相交） |
| 55 | b939370c1 | docs | changelog | 低 | 不做 | 上游 changelog 笔记 |
| 56 | e4f64319d | merge | — | 低 | 跳过 | merge commit，无内容 |
| 57 | 19ac67674 | deps | 依赖 | 低 | 移植 | @simplewebauthn/server →13.3.3（安全补丁）；需跑 passkeys 相关测试 |
| 58 | fe2ee07ed | fix | model-picker | 低 | 不做（净零） | 被 #53 revert，净零 |
| 59 | a86c4eed6 | chore | CI | 低 | 不做 | actions/checkout v7，.github only |
| 60 | 13171ba21 | deps | 依赖 | 高 | 移植 | node-pty →1.2.0-beta.15；**native 模块变更：走 electron:runtime:install 兼容门，不得动公证壳；先跑 scripts/restore-native-modules.mjs 门**（memory 孤本陷阱） |
| 61 | 0cfb158e1 | chore | CI | 低 | 不做 | .github only |
| 62 | 1938b9c5f | feat | diff | 中 | 移植 | PR 对比展开折叠上下文；DiffView+新 pullRequestDiff.ts/useGitComparison（fork 无此二文件——上游 PR 对比 hook 面 fork 缺，需一并补或对位 fork DiffView 数据源）+walkthrough/pull-request.js(61/8) fork 有 |
| 63 | 0d68efeeb | fix | small-model | 低 | 移植 | Codex Luna 目录解析；small-model/resolve.js fork 有（fork small-model 为 1.24 轮落地版） |
| 64 | 02cdb8c95 | fix | notifications | 低 | 移植 | control 事件流多 web 消费者共享；useWebNotificationStream+openchamberEvents+新 emitter-runtime.js；fork 全部有 |
| 65 | 03fe441ce | fix | dictation | 中 | 移植（部分） | 失败听写恢复控件不滚出屏；新 heightLimit 三件套+ComposerDictation——**fork dictation 在 components/voice/ 自研路径**，heightLimit 通用逻辑移植到 fork 编辑器，上游 ComposerDictation 差异对照 |
| 66 | 945abf48b | docs | spaces | 低 | 移植【Spaces 子系统】 | isolated-space-boundary skill（.agents/）——随 Spaces 块 |
| 67 | c469a40bf | feat | review | 低 | 移植 | review 会话继承 permission auto-accept；reviewFlow.ts(15/0)；fork permission-auto-accept 已接线 |
| 68 | 1eb8d5c23 | fix | settings | 低 | 移植 | 移动端项目选择复用 chat 项目抽屉；DraftTargetSelectors+SettingsProjectSelector——fork mobile 自有，SettingsProjectSelector 部分移植 |
| 69 | 7a21ba6a5 | test | sync | 低 | 移植 | retention 测试脱离 idle-grace 时钟；纯测试，目标文件 session-cache-retention.test.ts 随 #88 落地 |
| 70 | 45ff8c648 | feat | spaces | 高 | 移植【Spaces 子系统】 | gatekeeper 通道+program（~2.9k 行）+escape/contract suites |
| 71 | 8e51f9ad6 | merge | — | 低 | 跳过 | merge commit |
| 72 | 83ec4fbde | feat | ui | 低 | 移植 | opt-in 会话活动 spinner；新 SessionActivityIndicator+VisualSettings 开关+rowModel 接线；fork collapsedActivityIndicator 已有 |
| 73 | 00ee267dc | fix | sessions | 中 | 移植 | 恢复的 worktree 会话保持可见；sessionOwnership(65/10)+useSessionGrouping+sessionLocation——fork sidebar 新架构手工适配 |
| 74 | 8c9e08234 | feat | files | 中 | 移植 | 富 artifact 预览（image/media/font/table/binary）+agent file.open 动作；previews/ 8 新文件+fs byte-range+control file-open+ui-auth——fork 全部基座有 |
| 75 | 9480e0fab | fix | mobile | 低 | 移植（部分） | settings 提示可点按+四处手机边角；Mobile* 文件 fork 无（自有 mobile），SettingsInfoHint/BranchSelector 通用部分移植 |
| 76 | 1c2bd6561 | fix | github | 低 | 移植 | merged PR 归属需分支 commits 已 checkout；git/service+github/pr-status fork 有 |
| 77 | deb25dc0d | fix | mobile | 低 | 移植（部分） | sessions 抽屉退出保持分支行序；MobileSessionsSheet fork 无；useGitStore(11/2) fork 有——只取 store 部分 |
| 78 | 0ca21cf8d | fix | chat | 低 | 移植 | 清除 timeline reveal fade 保 overlay 滚动条可用；ChatContainer(26/2) |
| 79 | 896776d81 | fix | sessions | 中 | 移植 | 会话动作路由到会话自身 directory+失败解释；**正中 fork serverId+directory 权威关切**：新 sessionActionError/upstreamError/session-action-failures + client.ts(9/6)——高价值，按 fork directory 语义移植 |
| 80 | fbf027ada | perf | sidebar | 低 | 移植 | session row wrapper memo 化；SessionTreeItem fork 无（SessionSidebarRows 已带 memo 比较器）——**先核实等价，多半已覆盖** |
| 81 | 7ad4b2897 | feat | sidebar | 高 | 移植 | Timeline 视图+Grouped/Timeline 切换：SessionTimelineRowBody(127 新)+rowModel(85/17)+useSessionDisplayStore+settings 注册+TitlebarLeftControls；fork sidebar 新架构可挂载；**MobileTimelineList/Swipe/RenameForm 等 fork mobile 自有——仅桌面部分** |
| 82 | 40a17b11a | perf | sessions | 中 | 移植 | 全局会话列表首页立即绘制；useGlobalSessionsStore(49/3) fork 有 |
| 83 | e1ed8727b | fix | desktop | 低 | 移植 | dev 用捆绑 OC CLI+清理陈旧 HMR chunks；electron-dev.mjs(21 新)+main.mjs(10/0)——仅 dev 影响 |
| 84 | a91777602 | fix | files | 低 | 不做 | 移除 outsideFileGrants 授权层；fork 从未引入该层（N/A）；若要"工作区外文件打开"能力另立工作项 |
| 85 | 918eb9300 | feat | spaces | 高 | 移植【Spaces 子系统】 | tools volume+space 内 server（docker-tools/tools-pack/space-server，~2.5k 行） |
| 86 | 83fefdf22 | perf | server | 低 | 移植 | OpenAI/WebAuthn/jose/web-push 首用加载；index.js+tts+ui-auth+push-runtime；fork 全有 |
| 87 | e601f1627 | perf | desktop | 高 | 待拍板 | 窗口先于 main 进程显示：新 early-startup.mjs(619)+entry.mjs(94)，main.mjs -473 重构；**触及公证壳加载链（shell loader/CodeDirectory 敏感），按 runbook 属壳级风险**——用户拍板：整块不做 or 吸收可分离修复 |
| 88 | 449d9b42a | feat | sync/memory | 高 | 移植 | 空闲会话历史整段逐出（新 session-cache-retention.ts 159+session-message-loader 192/43+use-sync -130+useChatTimelineController -179）；**fork sync 热路径自研且已有自有 retention 面（session-retention.ts/session-cache.ts）——先做等价性核实再定移植范围** |
| 89 | 8f02f56fb | fix | chat | 低 | 不做 | pinned 区不再保留所有 transcript parts；WorkStatusPinnedSection——fork 无 work-status 面板（上游面 fork 未引入） |
| 90 | 959d179c6 | feat | sdk | 中 | 移植 | browser provider 调用按 surface 隔离+页面停靠共享 surface；sdk service-providers/parse+ContextPanel+guests catalog；依赖 #106 先行 |
| 91 | d63d1bf9c | docs | chat | 低 | 移植 | blocker 关闭后 steer 送达说明；ChatInput 注释级(7/25)+session-actions 注释——低价值随相关块 |
| 92 | 66b42b32c | feat | spaces | 高 | 移植【Spaces 子系统】 | 起点：未接线 Docker place+manager+isolated-spaces 设计文档（docs/isolated-spaces/ 6 篇+lib/spaces 基座 ~2k 行） |
| 93 | be8eed934 | fix | chat | 低 | 移植 | 权限卡文件 patch 预览；PermissionCard(16/2)+permissionFilePreviews(11 新) |
| 94 | d8dbd2567 | fix | chat | 低 | 待拍板 | comment 高亮半透明恢复（index.css）——属"composer 评论模式"块（fork 未引入该功能面） |
| 95 | 2832c9254 | fix | startup | 低 | 移植 | 启动恢复屏显示 OpenCode 失败诊断；新 startupDiagnostics.ts+App.tsx(39/3) |
| 96 | 6c980f29f | fix | desktop | 低 | 移植 | 配对导入失败准确上报；RemoteInstancesPage+新 pairingResponse.ts |
| 97 | 49a9aff7e | fix | desktop | 低 | 移植 | SSH 表单焦点在确认后保留；新 useSshConfirmation.tsx |
| 98 | de67c9391 | fix | chat | 中 | 移植 | 关闭 blocker 后保留显式 steer；ChatInput(8/1)——小 diff 热点文件 |
| 99 | 56f33fd59 | fix | chat | 低 | 待拍板 | comment quote 预览宽度——评论模式块 |
| 100 | f6318ae2c | style | chat | 低 | 待拍板 | comment 高亮色简化——评论模式块 |
| 101 | 71d68cd13 | fix | chat | 中 | 待拍板 | 移动快捷键+comment 草稿整合——评论模式块 |
| 102 | 499700ab1 | merge | — | 低 | 跳过 | 空 merge（#3733 内容已在分支） |
| 103 | 90d2e9f9c | merge | — | 低 | 跳过 | 空 merge |
| 104 | e01b0660f | merge | — | 低 | 跳过 | 空 merge |
| 105 | 601270072 | merge | — | 低 | 跳过 | 空 merge |
| 106 | 5883d28af | feat | sdk/guests | 高 | 移植 | browser provider role+扩展服务共享 surface：server guests/surface.js(630 新)+ui GuestSurfacePane(307 新)+guests surface-client(278 新)+sdk service-surface（~800 行）+settings 注册——fork guests 子系统大，本块为增量；**先于 #90** |
| 107 | dca0239a3 | feat | chat | 中 | 待拍板 | 移动评论 overlay→composer 评论模式（MobileCommentComposer 152 新+mobileCommentDraft 197 新+TextSelectionMenu 82/68+ChatInput 69/7）——评论模式块主体，fork 未引入 |
| 108 | ec11d02b5 | fix | mobile | 低 | 不做 | 文本选择不触发边缘滑动；useEdgeSwipe——fork mobile 自有手势方案 |
| 109 | 18d7cf8cd | merge | — | 低 | 跳过 | merge commit |
| 110 | bd86f4a89 | fix | chat/mobile | 低 | 不做 | 移动端仅按钮发送（keyboardPolicy）；fork mobile 发送策略自研（packages/mobile+harmony），不适用 |
| 111 | 1e650924c | fix | chat | 低 | 移植 | 图片导出跳过外部 favicon；新 imageExport.ts(+测试)+MessageBody(2/1)+decorate——fork exportSession 有 |

## 策略统计

| 策略 | 数量 | 说明 |
|---|---:|---|
| 移植 | 58 | 含 移植（部分）3（#75/#77/#65）、test-only 1（#69）、等价待核实 1（#80）、注释级 1（#91） |
| 移植【依赖OC2】 | 15 | #2/3/4/5/6/7/10/14/17/21/22/29/33/36/38——OpenChamber 侧代码照常移植，隔壁 agent 的 ../opencode 2.x 落地前不激活 |
| 移植【Spaces 子系统】 | 5 | #39/66/70/85/92——本段全部为"未接线"基础，接线在 Segment B |
| 待拍板 | 6 | #87（桌面 early-startup 拆分，壳链）+ 评论模式块 5（#94/99/100/101/107） |
| 不做 | 20 | 上游流程/CI/docs/changelog/release 13 + 净零 revert 对 2 + fork 无对应表面 5（#15/84/89/108/110） |
| 跳过 | 7 | merge commits（#56/71/102/103/104/105/109），无内容 |
| **合计** | **111** | |

## 功能块小结

1. **OC2 迁移脊柱（15c，本段最大块）**：654705f7d 一次性把 client/sync/chat 消息面/server opencode lib/small-model/vscode 切到 OpenCode 2.x；随后 14 个 commit（session metadata→2.0.15、CLI 升级+v1 迁移恢复、v2 turn end、v2 diff counts、websearch、usage stats、plugins 状态、form 提交等）全部踩在其上。fork 的对应热点（client.ts 2162 行、sync 三层、Question→Form 未改名、message-queue 自研）全部相交。**建议作为整轮脊柱单列工作项、拆 6-8 子批，且排在 Segment B 分类结论之前定案**——B 段（241c）几乎全部构建在其上。
2. **Spaces 基础（5c）**：本段只落地 design docs + unwired docker place + tools volume + gatekeeper + code-in（stage 0-3a），无任何接线（feature switch 在 B 段 stage 4a）。**建议整块推迟：与 B 段接线 commit 合并为单一 Spaces 工作项评估**；若用户否掉 Spaces，本段 5 个 commit 全部不做（当前为死代码，不移植无运行时影响）。
3. **Sidebar/会话治理（~12c）**：Timeline 视图、worktreeIndex 共享、Recent 子任务 metadata、空分组开始会话、活动 spinner、目录路由动作修复（#79，正中 fork directory 权威）、启动失败恢复。fork 新 sidebar 架构（rowModel）可承接，但 mobile 相关文件（TimelineList/Swipe）fork 自有——只取桌面面。
4. **会话缓存/内存治理（2c+1）**：#88 整段逐出 + #69 测试。fork 1.24 轮已有自有 retention 面，**移植前先做等价性核实**，避免双轨。
5. **Files 面（3c）**：artifact 富预览+file.open、上传入口、favicon 导出修复。基座 fork 全有，属干净增量。
6. **SDK/guests browser surface（2c）**：5883d28af（role+shared surface）→959d179c6（隔离+停靠）。fork guests/extensions 已落地，此为该子系统增量，注意 server guests/service 相交。
7. **评论模式块（5c，待拍板）**：composer comment mode（选区→评论→随消息发送）。fork 未有此功能面（fork comments/ 是 diff 行内评论，另一功能）。整块引入或整块不做。
8. **桌面/启动（3c）**：#21（OC2 兼容门+readiness）随脊柱；#87 early-startup 拆分触及公证壳链待拍板；#83 仅 dev。
9. **服务器健壮性（~6c）**：graceful shutdown 三连（socket/guest/设栏）、tunnel 密码、lazy-load 模块、memory 读取——多为 fork 已有文件小 diff，干净。
10. **杂项修复（~10c）**：主题 palette、权限白话描述+patch 预览、markdown lexer、dictation 高度限制（fork voice/ 自研路径对照）、配对/SSH 焦点、启动诊断。
11. **上游流程（20c 不做 + 7 merge 跳过）**：贡献流程/docs/CI workflows/changelog/release/净零 revert 对。

## 需用户决策疑点清单

1. **OC2 脊柱时序**（阻塞项）：15 个【依赖OC2】commit 的代码可先行移植，但激活/部署必须等隔壁 agent 的 ../opencode 2.x fork 就绪。是否按"代码先行、运行时门控"执行？
2. **Spaces 子系统**：本段 5c 全为未接线基础。整体推迟到 Segment B 一并拍板（推荐），还是本段就开始铺底？
3. **评论模式块**（#94/99/100/101/107）：整块引入 or 不做？fork 无 composer comment 基座，引入是净新功能（~1.5k 行）。
4. **#87 桌面 early-startup**：触及公证壳加载链。整块不做（fork 启动链自有、已达标），还是吸收 main.mjs 中可分离的修复？
5. **#60 node-pty 升级**：native 模块，走 runtime:install 兼容门 + restore-native-modules 门。beta 版本是否接受？
6. **#57 @simplewebauthn/server 升级**：安全补丁，建议做；确认 passkeys 面回归。
7. **#88 会话历史整段逐出 vs fork 自有 retention**：先等价核实；若 fork 已覆盖，标记已等价并关项。
8. **#81 Timeline 的 mobile 部分**：fork mobile 自有架构——确认只移植桌面 sidebar/设置部分，MobileTimelineList/Swipe 系列不做。
9. **#62 PR 对比展开**：fork 缺 pullRequestDiff.ts/useGitComparison 基座（上游 PR 对比 hook 面）——补基座还是对位 fork DiffView 现有数据源？
10. **任务书勘误**：enterprise 全系列、nl locale、Jev endpoint 均在 Segment B；posthog 本段为零。B 段分类时按此预期。
