# Segment C 分类：v2.0.4..v2.1.0（81 commits，v2.1.0 收官段）

生成：2026-10-01。基线 merge/upstream @ c224009a9（fork 1.24 轮已全部落地）。
清单来源：`docs/merge-v2.1/inventory-full.txt` 行 1–1757（逆时序），本文按**时间正序**编号 #1→#81。

## fork 现态核对要点（逐项对当前树验证，非旧印象）

- **存在**：`sessionSidebarRowModel.ts`（B6a）、`useGitHubPrStatusStore.ts`+自研 `pr-status.js`、`lib/router/`（parseRoute/openSessionFromRoute）、`settings/registry.ts`+server `settings-registry.json`、`useUIStore.contextPanel`、`useTerminalStore`、`useFilesViewTabsStore`、`useConfigStore`（1.24 形态，**无** catalogRefresh）、`lib/linkedIssues.ts`、`lib/modelVariants.ts`、`server lib/{git,routing,scheduled-tasks,dev-tunnel,fs,quota,openchamber-control,openchamber-sessions,inherited-env}`、`components/ui/CodeMirrorEditor.tsx`+`lib/codemirror/{flexokiTheme,languageByExtension,vimModeExtension}`、`PierreDiffViewer`、`electron/ssh-manager.mjs`、`MessageBody`/`SessionErrorNotice`/`session-error-log`、`chat/lib/scroll`（自研滚动架构）、`message/selectionMarkdown.ts`+`TextSelectionMenu`（自研选区复制）、`sync/last-session-cache.ts`+`last-session-restore-target.ts`（自研启动恢复）、`composer/ui/ComposerFloatingPanel`（自研悬浮 composer）、`MarkdownRendererImpl` 用 remend ^1.2.1、i18n 11 locale（**无 nl**）。
- **不存在**（fork 从未引入/已被自研替代）：上游 `sessions/SessionNodeItem.tsx` 目录形态（fork 为 `sidebar/SessionNodeItem.tsx` 同名异构）、`prStatusLabel.ts`、`github/pr-summaries.js`、`lib/codemirror/{documentSymbols,gitChangeGutter,editingAids,codeFolding}`、`DocumentSymbolsPanel`、`lib/shortcuts/config.ts`（fork 快捷键自研）、`hooks/useChatTimelineScroll.ts`、`chat/markdown/`（fork 用 `MarkdownRendererImpl`，无 marked-linkify-it）、`WorkStatusPinnedSection`（fork work-status 为自研 DraftContext 系列）、`BrowserPane`/`annotationOverlay`/`devServerWait`（fork 浏览器 UI 自研于 ContextPanel）、`message-search`、`spaces` 全套、`enterprise-mode`、`opencode/credential-db`（fork auth.js 仍读 auth.json）、`opencode/events.ts`（fork 事件走自研 event-pipeline）、`catalogRefresh`、`views/usage/`（fork 为 sections/usage）、portless、server 端 dictation（sherpa；fork 听写为浏览器端自研）。
- fork 与上游历史不连续（无 merge-base），全部移植为手工行为对齐。

## 策略图例

| 代码 | 含义 |
| --- | --- |
| 直接 | 直接移植：目标文件在 fork 且形态接近，低风险 |
| 适配 | 移植+适配：目标存在但需对 fork 架构/命名/i18n(12 locale) 适配 |
| 重适 | 概念移植/重度适配：fork 架构不同，按 fork 方式重写实现 |
| PR族 | sidebar PR/issue 家族，6 commit 合并一块移植（含服务端 pr-summaries） |
| 随段内 | 依赖段内其他 commit，跟随其移植（或被取代不单独移植） |
| 随SegA/B | 依赖 Segment A/B 才引入的代码，本段不单独移植 |
| Spaces | 【Spaces 子系统】汇总，随 Spaces 单独评估轮 |
| OC2 | 【依赖OC2】运行时依赖 OpenCode 2.x，隔壁 agent 落地前不得激活 |
| Ent | 【Enterprise 待用户拍板】 |
| 自研等价 | fork 已有等价实现，仅评估差异、默认不重复移植 |
| 不做 | fork 无此功能/上游分支卫生/不适用 |
| 版本 | 按 fork 发布流程处理，不照搬上游 release 文件 |

## 逐 commit 分类表

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 011820691 | test | sync | 低 | 随SegA/B | 修 4f0f59a47（v2.0.4~6，Segment B）skill prompt context minted id 的测试；fork `session-ui-store.test.js` 在，前置行为属 Segment B |
| 2 | 566ba6185 | ci | mobile CI | 低 | 不做 | fork 无 `.github/workflows/mobile-*.yml`（Capacitor CI）；鸿蒙走 `packages/harmony` 另一套 |
| 3 | 1a566db6c | feat | spaces 5e-1 | 高 | Spaces | 空间成果应用为分支/未提交变更（SpaceApplyDialog/space-apply.ts）；依赖 Segment B spaces 5a-5d 全套（fork 无 `lib/spaces`） |
| 4 | f82f10229 | fix | spaces i18n | 低 | Spaces | isolated-spaces.i18n.ts 全量文案重写（907 行）；随 Spaces 轮 |
| 5 | c09c773dd | fix | dictation | - | 不做 | 上游 server 端 sherpa 本地听写子系统 fork 未引入（fork 听写为浏览器端自研）；如要引入上游本地听写属独立决策（见疑点） |
| 6 | 12cd7247b | fix | dictation | - | 不做 | 同 #5，静音帧切分算法；随听写子系统决策 |
| 7 | abee2ffb0 | fix | routing | 低-中 | 适配 | thinking level 取名字不取序号（modelVariants/RoutingPage fork 有）；数据形态为 OC2 list-style levels【依赖OC2·弱】 |
| 8 | a394d7013 | fix | chat 错误展示 | 低 | 适配 | LongErrorText 新组件+折叠长错误；SessionErrorNotice/MessageBody fork 有，直接挂接；i18n 12 locale |
| 9 | 1a186e152 | feat | spaces | 中 | Spaces | setup 失败列出被拦域名+逐域 Allow；随 Spaces 轮 |
| 10 | 14d603e96 | fix | agents | 中 | 适配 | 去掉必败 Reset+删除后刷新列表；AgentsSidebar/useAgentsStore 在，但目录 catalog 事件链路为 fork 自研 sync；注意 agents 设置页尚未接远程实例（known issue） |
| 11 | d78dac542 | fix | browser | 中-高 | 重适 | 恢复标签不重试死 dev server；devServerWait.ts 新 lib 可直接引入，但挂载/恢复模型在 fork 自研浏览器 UI（ContextPanel）需重写对接 |
| 12 | 6e9c57bf3 | feat | spaces 5e-2 | 高 | Spaces | 删除空间聊天转只读归档（server space-archive.js 275 行+ArchiveView 扩展）；随 Spaces 轮 |
| 13 | 3db4e7adf | fix | sidebar 间距 | 低 | 直接 | Recent 与 projects 双倍间距 4 行修复；目标 `SessionSidebarRows.tsx` 为**工作区未提交文件**——实现时只读不碰、与鸿蒙会话协调 |
| 14 | e3a6392ab | fix | sidebar/usage | 低 | 适配 | sidebar footer Usage 改为真 toggle（读 useUIStore 开关态）；fork usage 挂接不同（sections/usage），映射开关字段 |
| 15 | 6a1e43e56 | fix | chat 变更文件 | 低-中 | 适配 | 多余变更文件折叠 +N chip；MessageBody 在，fork 变更文件 UI 为自研（TurnActivity/TurnChangedFilesDropdown） |
| 16 | c29158dd6 | fix | model-picker | 低 | 直接 | star 不抢焦点+列表不回跳；ModelPickerList fork 同名 |
| 17 | 692ab16a6 | feat | sidebar worktree | 中 | 适配 | Shift+click 快速删干净 worktree+本地分支；clean/unpushed 校验必须留在逻辑层（policy-first）；worktreeStatus.ts 新 lib；SessionDialogs/SessionGroupSection fork 同名异构 |
| 18 | 155411b73 | fix | sidebar PR | 中 | PR族 | 家族起点：新建 prStatusLabel.ts（PR 状态色+tooltip）；与 #59/#61/#62/#63/#68 合并移植 |
| 19 | 030f9ecdc | feat | spaces 5e-3 | 高 | Spaces | Settings Spaces 页+孤儿空间列表+SpacesView；随 Spaces 轮（sortableItems.tsx fork 已有同名自研文件，注意对齐） |
| 20 | 1ac782ef6 | fix | chat/composer | 低-中 | 适配 | (#4221) 直播回复尾部在悬浮 composer 上方渐隐不切断；fork 悬浮 composer 为自研 ComposerFloatingPanel，index.css 选择器需映射 |
| 21 | 904b212cf | fix | sidebar folder | 中 | 适配 | 文件夹内会话缩进一级；fork rowModel（B6a）已跟上游，但 SessionProjectScroller/RunSidebarRow fork 无对应名（自研虚拟化），映射到 fork 行模型 |
| 22 | 3c0d1e3b4 | fix | quota | 低 | 直接 | Kimi China plan（kimi-code-plan-cn）凭证读取；kimi.js/vscode quotaProviders fork 有 |
| 23 | 10cf1f8c1 | fix | chat markdown | 中 | 适配 | remend 1.2.1→1.4.0（O(n²) 修复）+3 处行为回归处理；fork 用 remend ^1.2.1 于 MarkdownRendererImpl，依赖升级直接适用，markdownCore 部分随 fork 渲染器评估等价改法 |
| 24 | e20f7b918 | fix | enterprise | 中-高 | Ent | 【Enterprise 待用户拍板】MCP OAuth 登录放行+provider-connect 路径归一化加固（#4228 matcher）；**即使不做 enterprise，路径归一化安全加固建议单独摘取**（见疑点） |
| 25 | 31b512530 | fix | control/agent-tool | 低-中 | 直接 | agent-tool session 读按 projectId 收敛+404/400 语义；openchamber-control/openchamber-sessions fork 有 |
| 26 | 64105c60a | fix | desktop/runtime | 低-中 | 适配 | 登录屏切换 host 后 runtime 复位订阅移到入口（main.tsx）不被 auth gate 卸载；fork runtimeEndpointReset.ts 已有；App.tsx/SessionAuthGate 为工作区未提交文件——协调后改 |
| 27 | 2810193e0 | fix | chat markdown | 低 | 不做 | 修上游 markdownCore 的 marked-linkify-it start hints O(n²)；fork 渲染器无此栈→不适用；fork 大消息性能自行安排体检（见疑点） |
| 28 | 59d8a162d | fix | quota | 低 | 直接 | OpenRouter usage 读配置的 baseURL（网关场景）；openrouter.js/vscode 在 |
| 29 | 201de9de2 | fix | desktop SSH | 低-中 | 直接 | SSH 主转发改 `-O forward`（避免登录 shell 状态误判）；ssh-manager.mjs+test fork 有 |
| 30 | 405e90381 | fix | browser 标注 | 低 | 不做 | 页面标注 overlay 与 top-layer dialog 层级；fork 未引入 annotationOverlay 功能→不适用 |
| 31 | 4c1af0e42 | feat | spaces 5e-4 | 高 | Spaces | Settings Places 页（磁盘占用+清理，docker-disk.js）；随 Spaces 轮 |
| 32 | e61d44594 | fix | desktop/env | 中 | 适配 | AppImage 注入的 PATH/LD_LIBRARY_PATH 等从 PTY+受管 OC env 剥离；fork 已有自研 inherited-env.js（ARGV0 剥离）→合并上游剥离规则并接线 terminal/git/lifecycle |
| 33 | 940c9f46d | fix | chat 悬浮操作行 | 低 | 随SegA/B | 用户消息悬浮操作行收进行内；该操作行为 Segment B 引入，fork 无此组件 |
| 34 | 8ee35503f | chore | 依赖 | - | OC2 | OpenCode 2.0.19 bump；随隔壁 agent 版本节奏 |
| 35 | 1ac71e5ae | fix | diff | 低 | 直接 | PierreDiffViewer 同步 stat 回调 TDZ（句柄先声明后订阅）；fork 有该文件 |
| 36 | 6064f9915 | fix | browser | 中-高 | 重适 | 恢复标签按需挂载（睡眠态）+capture 不再弹出面板；fork 浏览器挂载模型自研，controlClient 可直接吸收睡眠注册/隐藏截图逻辑 |
| 37 | f70725c35 | feat | chat 后台工作 | 高 | OC2 | 后台命令/子代理就地渲染（/api/shell、session.background、Shell.NotFoundError=用户停止语义均为 OC 2.0.18+）；新增 sync/background-shells、lib/opencode/background-shell、subagent-run 等；fork sync/activity/sidebar 自研→OC2 落地前只备料不激活 |
| 38 | 031d2af7e | feat | worktree/git | 低-中 | 直接 | 新 worktree 从已发布基分支的 fetched upstream 起（server git/service.js+vscode gitService fork 有；本地分支永不移动，失败回退告警） |
| 39 | 6333f9469 | feat | chat 选区复制 | 低 | 自研等价 | 选区复制为 markdown（KaTeX/mermaid/表格保形）；fork 已有 `message/selectionMarkdown.ts`+TextSelectionMenu 自研等价→仅评估差异（KaTeX annotation、跨列表项再嵌套） |
| 40 | 612103ec0 | feat | ui 多区 | 中-高 | 适配 | 归档撤销（Cmd+K Backspace+toast Undo）、会话前进/后退键、终端标签拖拽排序/重命名/关闭语义；fork useTerminalStore/sortable-tabs-strip/TerminalView/sessionSubtreeActions 在；快捷键系统 fork 自研（无 lib/shortcuts）→键位映射；归档撤销对接 fork session-archive-batch |
| 41 | 3c5390c92 | fix | dev-tunnel | 低 | 直接 | 宿主端拨 ::1（IPv6 loopback）+拒绝日志；dev-tunnel lib fork 有 |
| 42 | 718129060 | feat | chat 宽布局 | 低-中 | 适配 | 宽表格/代码块突破 64rem 列至聊天宽度；fork typography.css 在（主题系统已跟），需对照 fork 宽布局 CSS 现状 |
| 43 | b41935caf | feat | files/editor | 中 | 适配 | git change gutter/代码折叠/occurrence 高亮/单击预览标签；fork CodeMirrorEditor+lib/codemirror 基础在，新增 4 扩展可移植；preview tabs 对接 fork useFilesViewTabsStore |
| 44 | 6008e24d5 | chore | 依赖 | - | OC2 | OpenCode 2.0.20 bump（本段功能分水岭：/api/credential、错误体、needs_auth） |
| 45 | eb8e276cd | refactor | server 凭证 | 高 | OC2 | 凭证读取改走运行中 OC 的 GET /api/credential（并发共享请求、失败抛错不视为无 key、env-var 连接值回读、stored 优先；删 credential-db 中间态——fork 从未引入该中间态，直接对齐终态）；波及 quota/tts/routing/github/linear/vscode auth（fork auth.js 仍 auth.json 形态）；**OC 2.0.20 落地前不得激活** |
| 46 | 43c11d1c4 | feat | chat/providers | 中-高 | OC2 | 错误响应体折叠展示+needs_auth "Sign in again"；依赖 OC 2.0.20 错误体；UI（ErrorResponseDetails/session-error-log/ProviderAccounts）可先行适配，数据门控 OC2 |
| 47 | b876c86a2 | fix | chat 宽布局 | 低 | 随段内 | breakout 限定 assistant 正文（修 #42 副作用）；随 #42 |
| 48 | e086a6021 | feat | 命令面板 | 中 | 适配 | 面板重设计（+183/-62）；CommandPalette fork 有（1.24 形态），redesign 需核对 fork 自研差异；i18n 12 locale |
| 49 | de9b86d2b | fix | providers catalog | 高 | OC2 | 冷 worktree 目录 catalog 陈旧标记/重试/composer 兜底标签；依赖 Segment A 的 catalogRefresh/useConfigStore OC2 catalog 事件形态（fork 无 catalogRefresh）→随 Segment A config 重构+OC2 门控 |
| 50 | 81ab2ab13 | feat | scheduled-tasks | 中 | 适配 | chats 域（`openchamber:chats`，server chats-scope.js 直接移植）+移动端入口；server 部分 fork scheduled-tasks 在；移动端部分按 fork 移动壳适配（上游 MobileSessionsSheet fork 无） |
| 51 | 8fd19f95a | fix | mobile Android | 中 | 适配 | Android 返回先关最上层 sheet/popup（mobileBackLayers.ts 新 lib+Base UI Escape 分发）；MobileOverlayPanel fork 有；**MobileApp.tsx 为工作区未提交文件**——协调后改 |
| 52 | 3eb78ee73 | fix | routing | 低-中 | 随段内 | 模型未列出的 thinking level 回落默认（修 #7 遗留存量 "0/1/2"）；routing/runtime.js fork 有；随 #7 |
| 53 | 7bc55a15a | fix | routing | 低 | 直接 | autosave 不再回灌 trimmed 文本吃掉正在输入的换行/"-"；RoutingPage fork 有 |
| 54 | eae34ed11 | fix | chat 宽布局 | 低 | 随段内 | 宽布局 transcript 用满聊天宽度；随 #42 宽布局家族 |
| 55 | 29310bda4 | feat | chat 滚动恢复 | 高 | 重适 | 重进会话回到离开时视口（内存 100 会话锚点+逐帧对齐+turn 展开缓存）；上游基于 LegendList MessageList，fork 滚动架构自研（chat/lib/scroll+viewport-store）→按 fork 模型重实现 sessionScrollMemory/viewportAnchor 概念 |
| 56 | 13e0f02e1 | fix | sync 通知 | 低 | 随段内 | 修 #46 引入的 responseBody ReferenceError；并入 #46 移植 |
| 57 | 222fe9af1 | feat | 启动恢复 | 低 | 自研等价 | 启动重开 last session；fork sync/last-session-cache+last-session-restore-target 已实现 per-runtime 恢复→评估差异（route/link 先到者优先、草稿清指针、sidebar 挂载不自动开会话） |
| 58 | ffd38f6c2 | feat | chat 消息链接 | 中-高 | 适配 | 单条消息深链（web ?session=&message=、desktop/mobile openchamber://、Copy link、聚焦请求通道+加载旧历史对齐）；fork router/deepLinks/electron main 在；**本段基础**：#73 pin 跳转、#64 搜索命中打开均依赖此 |
| 59 | 57e302a07 | fix | github PR | 中-高 | PR族 | 新 POST /api/github/pr/summaries（25 PR/GraphQL 批量+checks-summary 共享）+store 可见期 2min 批量刷新替代按分支轮询；fork 有自研 pr-status.js+useGitHubPrStatusStore→家族块内决定对齐或保留（见疑点） |
| 60 | 404826896 | feat | preview 动作 | 中 | 适配 | 动作 URL 支持 {worktree}/{branch} 变量+终端 portless 地址识别；fork ProjectActionsButton/terminalPreview/devTunnel(ui) 在；**portless 半边 fork 未引入→随 Segment B portless 决策**，变量模板可单独移植 |
| 61 | ca506e2d5 | fix | sidebar PR | 中-高 | PR族 | Timeline/Recent/In-work 行徽章纳入刷新集合；上游 SessionProjectCollection fork 无（自研列表架构）→随家族映射到 fork 行模型 |
| 62 | a3ff2cab7 | feat | sidebar PR | 中 | PR族 | 会话关联 PR 与分支 PR 并列展示；fork lib/linkedIssues.ts 已有（1.24 跟过）→家族内对齐数据源 |
| 63 | f437a4fe6 | feat | sidebar PR | 低 | PR族 | PR tooltip 加标题行；随家族 |
| 64 | 6a87eb822 | feat | 消息搜索 | 中-高 | 适配 | opt-in 全文搜索（server lib/message-search 全新：FTS5 trigram、node:sqlite/bun:sqlite 无新依赖、事件游标+慢回填、关=真 no-op 503；UI：Cmd+P Messages 组+Cmd+F 搜索条+CSS Highlight API；settings registry/search 注册——fork registry 在、settings/search.ts 新建）；依赖 #58 链接机制；reasoning 二级开关 |
| 65 | e9bc7aa1b | fix | lint/test | 低 | 不做 | 上游分支 lint 卫生+他 branch 测试 mock 维护；PierreDiffViewer 初始化已随 #35；fork lint 自己跑 |
| 66 | 56fbe4e3a | fix | server 安全 | 中-高 | OC2 | /api/credential GET 一律 403（防隧道/配对手机拖库）、POST enterprise 拒绝+跨源路径校验（vscode bridge 同）【依赖OC2·/api/credential 为 2.0.20 路由；Enterprise 半边随 #24 拍板】；**OC2 升级落地时必随行的安全项** |
| 67 | 4225ad17f | fix | sync 停止判定 | 低 | 随段内 | observed-turns "本页见过它跑"+15min 静默规则；**被 #72 终态完全取代**（同段引入同段删除）→不单独移植，只移植 #72 终态 |
| 68 | 3a82f75be | feat | sidebar PR/issue | 中 | PR族 | 无 PR 会话行显示关联 issue（含 live 状态，sessionPrSummaries 终态+server pr-summaries 扩展+vscode/webview api）；家族收尾 |
| 69 | 2f726f8e8 | feat | files/editor | 中 | 适配 | 符号列表（Mod+Shift+O，读 #43 折叠语法树）+括号匹配/自动闭合+多光标+gitignored 快捷开关；documentSymbols/editingAids 新扩展；随 #43 家族 |
| 70 | 7ac275296 | fix | fs | 低 | 直接 | 符号链接目录下找到 git 仓库（fs/routes.js fork 有） |
| 71 | bfb44fce1 | feat | chat shell 输出 | 低 | 适配 | shell 工具输出复制按钮；ToolPart fork 有 |
| 72 | 9ffccb623 | fix | sync 停止判定 | 高 | OC2 | 终态：turn 停止只认 OC 记录的 interrupted/failed 结果（live session.execution.* 事件+历史隐形 idle 记录）；删除观测/快照/静默猜测（含 #67 全部）；**事件语义为 OC2**；fork event-pipeline 自研→概念对齐移植终态，OC2 落地前不得激活 |
| 73 | 78db01c4b | fix | work-status pin | 中-高 | 重适 | 未加载历史的 pin：按需 getSessionMessage 取单条文本+按下走消息链接请求通道（转圈直到落地）；上游 WorkStatusPinnedSection fork 无（fork pin UI 自研+useSessionPinnedStore）→概念移植到 fork pin 位置；依赖 #58 |
| 74 | ed92c66c5 | fix | chat 草稿提示 | 低 | 随SegA/B | 脏分支警告改 hover-only；改动点在 Segment B 引入的 DraftTargetSelectors（fork 无） |
| 75 | 038078dd8 | feat | sidebar spinner | 低 | 适配 | Timeline 行 AI 改名/移动中显示 spinner；fork SessionNodeItem 同名异构，直接对齐 |
| 76 | a3c9e42b7 | feat | usage 布局 | 低 | 随SegA/B | 效率磁贴移到 token 组成下方（2 行）；上游 views/usage 为 Segment A/B 重构产物，fork 无该目录 |
| 77 | 2b0df427a | fix | chat/composer | 低 | 随段内 | 尾部渐隐仅在 streaming 跟随时生效（修 #20 常开副作用）；随 #20 |
| 78 | dde866380 | chore | 依赖 | - | OC2 | OpenCode 2.0.21 bump |
| 79 | 66d590410 | fix | files/editor | 低 | 随段内 | 符号面板不透明/按钮可关/Escape 留在编辑器；随 #69 家族收尾 |
| 80 | fa471e2d7 | chore | 仓库卫生 | 低 | 不做 | 删 .github/pr-evidence 截图；fork 无该目录 |
| 81 | 90726f994 | release | 发布 | 低 | 版本 | fork 按自身节奏出 2.1.0-sscity；CHANGELOG.md/changelog//package.json 版本号照 fork 发布流程，不照搬 changelog/index.json |

## 策略统计（81 全覆盖）

| 策略 | 数量 | commits |
| --- | ---: | --- |
| 直接移植 | 13 | #13,16,22,25,28,29,35,38,41,53,70,71,75 |
| 移植+适配 | 22 | #7,8,10,14,15,17,20,21,23,26,32,40,42,43,48,50,51,52*,58,60,64,69 |
| 概念移植/重度适配 | 4 | #11,36,55,73 |
| PR 族合并移植 | 6 | #18,59,61,62,63,68 |
| 随段内（跟随/被取代） | 6 | #47,54,56,67,77,79 |
| 随 Segment A/B | 4 | #1,33,74,76 |
| 【Spaces 子系统】 | 6 | #3,4,9,12,19,31 |
| 【依赖OC2】 | 9 | #34,37,44,45,46,49,66,72,78 |
| 【Enterprise 待用户拍板】 | 1 | #24（#66 兼） |
| 已自研等价（评估） | 2 | #39,57 |
| 不做/N-A | 7 | #2,5,6,27,30,65,80 |
| 版本流程 | 1 | #81 |

（#52 兼"随段内"——依赖 #7；#60 portless 半边随 Segment B。）

## 功能块小结（建议移植批次视角）

1. **sidebar PR/issue 家族（6c）**：#18→#59→#61→#62→#63→#68 链式；server pr-summaries.js+checks-summary 为新建，UI 侧映射到 fork 自研行模型与 useGitHubPrStatusStore。中-高，建议整块一个工作项。
2. **消息链接/恢复/滚动（4c）**：#58（链接基础）→#73（pin 跳转）→#64（搜索命中）；#55、#57 与之同族（滚动/启动恢复）。fork 滚动与启动恢复部分自研，需先做对齐盘点。
3. **files/editor 家族（3c）**：#43（折叠/gutter/occurrence/预览标签）→#69（符号/括号/多光标）→#79（收尾）。fork CodeMirror 基础完备，是本段适配性价比最高的大块。
4. **消息搜索（1c）**：#64 独立 opt-in 子系统，无新依赖（builtin sqlite），可单独成批次。
5. **同步停止语义（2c）**：#67 被 #72 取代，只移植 #72 终态；OC2 门控。
6. **凭证链（2c）**：#45+#66 一体（OC API 读凭证+key 防泄漏）；OC 2.0.20 硬依赖。
7. **后台工作（1c）**：#37 大特性，OC2 硬依赖，fork sync/活动指示自研需重度适配。
8. **宽布局/composer 渐隐（4c）**：#20→#77、#42→#47、#54；CSS 层小步。
9. **routing/thinking（3c）**：#7→#52、#53；fork routing 全套在。
10. **桌面/环境（3c）**：#26、#29、#32（fork inherited-env 合并上游剥离规则）。
11. **配额（2c）**：#22、#28 低风险快赢。
12. **其余独立修复**：#8,10,13,14,15,16,17,21,23,25,30(N),35,39(评),51,57(评),70,71,75 —— 多数可按区域凑小批次。
13. **Spaces（6c）**：随 Spaces 单独评估轮，不进常规批次。
14. **OC2 版本推进（3c）**：#34,44,78 与隔壁 agent 协同。

## 需用户拍板疑点

1. **Enterprise（#24，兼 #66）**：是否采纳 enterprise 模式改动。即便整体不做，**#24 的 provider-connect 路径归一化加固与 #66 的 /api/credential 403 是通用安全修复**，建议摘取——请确认。
2. **凭证终态跳迁（#45）**：fork auth.js 仍在 auth.json 形态；#45 要求一步到位走 OC API（OC ≥2.0.20），隐含放弃 Segment A 的 credential-db 中间态。是否与 OC2 升级同批激活？
3. **PR 家族路线**：fork 已有自研 pr-status.js+useGitHubPrStatusStore。整块对齐上游 pr-summaries（服务端 GraphQL 批量+live 刷新），还是保留自研仅吸收徽章/tooltip/issue 展示？
4. **已自研等价两处**：#39 选区复制 markdown、#57 启动恢复 last session——fork 均有自研实现，默认不重复移植、仅评估差异（KaTeX/mermaid 序列化、route 先到优先）；是否需要吸收上游细节？
5. **上游 server 端听写（#5,6）**：非本段新功能，但两修复触发盘点——fork 听写为浏览器端自研，是否引入上游 sherpa 本地听写子系统？（不引入则两 commit 关闭为 N/A）
6. **portless（#60 半边）**：fork 未引入 portless（Segment B 决策）；{worktree}/{branch} 模板变量是否先行单独移植？
7. **fork 侧渲染性能体检**：#27 修复的 O(n²) 是上游 markdownCore 专属；fork 渲染器栈不同但同样可能有大消息/长流卡顿——是否安排 fork 等价体检工作项？
8. **i18n nl**：本段 10+ commit 携带 nl locale 新增；fork 现为 11 locale，nl 作为第 12 随各批次补齐——确认随批次走而非单列。
9. **工作区未提交文件碰撞**：#13（SessionSidebarRows.tsx）、#51（MobileApp.tsx）、#26（App.tsx/SessionAuthGate.tsx/MainLayout）触碰鸿蒙会话在用的 foreign files——实现阶段须先协调（清单 docs/merge-v2.1/foreign-files.txt）。

## 段内依赖链速查

- #7 → #52（thinking 名字/存量回落）
- #20 → #77（composer 渐隐开/关）
- #42 → #47、#54（宽布局 breakout/满宽）
- #46 → #56（错误体引用修复）
- #43 → #69 → #79（编辑器扩展链）
- #58 → #73、#64（消息链接请求通道）
- #18 → #59 → #61 → #62 → #63 → #68（PR 家族，时间序）
- #67 → #72（引入后被终态取代：只移植 #72）
- 段外：#1←Segment B(4f0f59a47)；#33,#74,#76←Segment B 组件；#49←Segment A(654705f7d catalog)；#45,#46,#66←OC 2.0.20；#37←OC 2.0.18+；#72←OC2 结果记录语义
