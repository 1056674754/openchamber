# 分类：上游 v1.23.0..v1.24.0（133 commits）

> 仓库 /Users/song/dev_ai/openchamber-merge-v1.11.0（fork, merge/upstream）。政策与格式见 CONTEXT.md。
> 说明：本段含 feature/add-project-scoped-agent-configuration 分支的 11 个早期 commit（16046a98d..304dac98e，含 2 个 merge），时间戳早于 v1.23.0 但落在区间内。
> 通用标注：「跨段依赖」= 该 commit 触及的文件由 v1.22.0..v1.23.0 段引入，fork 尚不存在，需前段先行移植。

## 逐 commit 分类

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
|---|------|------|------|------|------|------------|
| 1 | ea3ffa863 | release | docs-ci | 低 | 跳过 | release v1.24.0 |
| 2 | 6c51a6a95 | fix | ui | 中 | 手工合 | 主题导入 UI 的键盘/安全区修复；主体是共享组件（select.tsx、ThemeCatalogDialog），随主题块移植；MobileOverlayPanel 小改 |
| 3 | 3700682c3 | fix | mobile-shared | 低 | 不做 | 仅 MobileChangesSurface（上游独立移动面，政策不做） |
| 4 | 5d4c8f38f | fix | ui | 高 | 手工合 | 子模块/嵌套仓库 diff：git service/routes 核心路径 + DiffView；MobileChangesSurface hunk 跳过；vscode gitPathDiff.ts 新文件逐文件比对；i18n 13 key ×12 |
| 5 | 0d59ddf3c | feat | ui | 中 | 手工合 | 侧栏粘性 header 换 CrossfadeZoneHeaders（新文件），SessionProjectScroller 重写 22/133；fork 侧栏项目分组有本地改动，删除 useStickyProjectHeaders 需整体跟移 |
| 6 | 2bcff882c | perf | electron | 高 | 手工合 | shell-environment.mjs 新文件 + main.mjs 18/52；fork main.mjs 自研 66 commit（SSH manager 等），不能整文件覆盖 |
| 7 | 1fcd8827b | fix | ui | 低 | 手工合 | index.css 底部渐隐 5/3 |
| 8 | 80ac4b3e7 | perf | ui | 中 | 手工合 | ContextPanel/SidebarFilesTree 离屏行跳过渲染；ContextPanel fork 自研 37 commit |
| 9 | 60edf969e | fix | electron | 中 | 手工合 | useTraySync 58/46（fork 有 2 个本地 commit）；dock badge 与菜单栏解耦 |
| 10 | bc3926eca | fix | ui | 高 | 手工合 | ContextPanel 46/40 + useUIStore 10/15；面板宽度折叠逻辑与 fork useUIStore（50 自研 commit）相交 |
| 11 | 9e3ece8dc | fix | ui | 低 | 手工合 | 启动 splash 渐隐 + logo 配色；AppStartupOverlay 新文件 |
| 12 | f239b34ca | fix | vscode | 高 | 手工合 | surfaceAttention.ts 新文件 + sync-context 6/9（fork 多服务器热区 65 自研）+ vscode 4 文件逐文件比对（fork bridge 自研） |
| 13 | 049e2e523 | fix | ui | 高 | 手工合 | compaction 后上下文用量：tokenUtils 重写、session-ui-store 2/36、work-status contextUsage、VSCodeLayout/MiniChatLayout；fork work-status 区域自研（DraftContext），跨段依赖 work-status 组件 |
| 14 | e885faf49 | fix | vscode | 中 | 手工合 | 编辑器新会话用当前 workspace folder；vscode SessionEditorPanelProvider +10（fork 自研需比对）、vscodeBootstrap |
| 15 | ae6a5f447 | fix | ui | 中 | 手工合 | TextSelectionMenu 定位重写 selectionMenuPosition；fork 侧菜单有本地改动 |
| 16 | 76e6d1163 | fix | ui | 中 | 手工合 | behaviorPrompt.ts 新文件：AGENTS.md 先于 settings.json 读取；BehaviorPage |
| 17 | 6fa83c77e | fix | ui | 中 | 手工合 | taskToolModel.ts 解包 task result envelope（跨段依赖该文件） |
| 18 | e8f5858be | fix | sdk-extensions | 低 | 延后-扩展系统轮 | build-builtin-extensions.test.mjs 1 行 |
| 19 | 77c8fa79c | docs | docs-ci | 低 | 跳过 | .agents skills 文档 |
| 20 | 1a3b47842 | fix | sdk-extensions | 低 | 延后-扩展系统轮 | 主体 packages/sdk/examples（含 340/9827 mcp.js）；连带 ssh-install.test 与 run-isolated-tests 小改，延后轮一起 |
| 21 | 0c4c75854 | refactor | ui | 低 | 手工合 | useProjectsStore 复用 settings parser（default agent 块收尾） |
| 22 | 9934110cd | feat | ui | 高 | 手工合 | merge commit（numstat 空，首父 diff 才是内容）：default agent 集成——useConfigStore 90/57、selection-store 61/51、session-ui-store 75/28、openchamber-sessions routes 44/11；fork sync 层热区 |
| 23 | 49bfdac7f | feat | ui | 高 | 手工合 | merge commit（首父 diff）：context panel 持久文件树 + editor toggle——ContextPanel 55/31、useUIStore 79/13、settings registry +1；fork ContextPanel/useUIStore 热区 |
| 24 | a42052c69 | fix | ui | 中 | 手工合 | useAgentColors 新 hook + agentColors 重构 66/27（fork 有本地版）；MessageBody/ModelControls |
| 25 | 32e0f52f6 | fix | ui | 低 | 手工合 | AI rename 菜单图标尺寸 + 批量 3（依赖 AI rename 块先行） |
| 26 | 70b7aacbf | fix | sdk-extensions | 低 | 延后-扩展系统轮 | sdk examples 滚动条 + guests html-styles；主体 sdk |
| 27 | 6f3227fa8 | fix | ui | 中 | 手工合 | theme/vscode/adapt.ts 新文件（本段 6a20db4d0 引入）；导入主题强调色适配，随主题块 |
| 28 | 9df61f0f3 | feat | sdk-extensions | 低 | 延后-扩展系统轮 | sdk examples 交互画廊（13607 行 mcp.js 等） |
| 29 | 6a20db4d0 | feat | ui | 高 | 手工合 | VS Code 调色板导入（Open VSX + 本地文件）：server theme-catalog/theme-runtime、ThemeCatalogDialog/ThemeImportButton 新组件、electron theme-file-picker（fork main.mjs 需手工）、i18n 27 key ×12、convert-vscode-theme.cjs -627；settings/theme 核心路径 |
| 30 | b59ab5671 | feat | sdk-extensions | 低 | 延后-扩展系统轮 | 扩展 built-in 基础设施；碰 ExtensionsPage/PluginPane/guests，主体扩展系统 |
| 31 | 9caa4f8ec | fix | ui | 高 | 手工合 | 草稿附件按 session 隔离：ChatInput + useComposerDraft + input-store（fork 有本地版）+ session-ui-store；与 fork draft context 自研相交 |
| 32 | 7db68b1c7 | fix | ui | 低 | 手工合 | Header 图标/间距 20/20 + sprite |
| 33 | 2a4051987 | style | ui | 低 | 手工合 | settings metadata 拼图图标 |
| 34 | d7a6479c9 | fix | ui | 中 | 手工合 | 语义色替换大扫除（~150 文件、几乎全是等量 class 替换）；机械但面广，fork index.css/组件类名有本地差异需抽查；sdk examples 部分随延后轮 |
| 35 | 293fe65e3 | refactor | ui | 高 | 手工合 | 调色板紧凑化：theme/definition.ts、readableColors.ts 新建，cssGenerator 22/276，全部 themes/*.json 重生成，types/theme 1/49；theme 核心重写 |
| 36 | 201a5c83a | feat | sdk-extensions | 低 | 延后-扩展系统轮 | 扩展 SSH 身份 + relay 资产；guests/clone.js 74/11 属扩展安装链路 |
| 37 | 4c6963392 | fix | sdk-extensions | 低 | 延后-扩展系统轮 | guests 目录/安装诊断 |
| 38 | 260913b53 | fix | sdk-extensions | 低 | 延后-扩展系统轮 | guest frame 过期鉴权恢复 + PluginPane 图标 |
| 39 | 7a90ad619 | fix | sdk-extensions | 低 | 延后-扩展系统轮 | guest-integrations.i18n 措辞 12/12 |
| 40 | d144cfd4b | fix | vscode | 高 | 手工合 | owned-process.ts 新建 + opencode.ts 71/205 重写 + bridge-git-process-runtime；fork vscode 有自研进程管理/bridge，逐文件比对不可整覆盖 |
| 41 | 7475da70f | docs | docs-ci | 低 | 跳过 | AGENTS.md 一行 |
| 42 | 6ab756350 | chore | docs-ci | 低 | 跳过 | Dockerfile 去 patch-package（依赖 sdk workspace；若延后 sdk 则无意义，扩展轮复核） |
| 43 | 5b6b1c29a | test | ui | 低 | 手工合 | 测试超时放宽（Windows）+ POSIX 路径断言；LiveTurnActivity.test / bun-test.d.ts 部分 |
| 44 | b6be795d3 | chore | docs-ci | 低 | 跳过 | .github/workflows mobile bun pin |
| 45 | e4b235bf4 | fix | docs-ci | 低 | 跳过 | Dockerfile 修复 sdk workspace 构建依赖；同 42 联动 |
| 46 | a6168a851 | chore | docs-ci | 低 | 跳过 | bun 1.4.2 工具链升级 |
| 47 | a9944a28e | chore | web-server | 低 | 手工合 | 删除 Crof quota provider（ui/types/vscode/server 四处）；先查 fork 是否有本地 crof 引用 |
| 48 | ac5005ddf | fix | electron | 高 | 手工合 | 进程收割：server-shutdown.mjs 新建 + main.mjs 31/43 + lifecycle.js 54/67 + terminal/fs 路由；fork electron main 自研热区 |
| 49 | 43d1fff2e | fix | sdk-extensions | 低 | 延后-扩展系统轮 | sdk examples 状态快照保持 |
| 50 | dda966fa6 | fix | ui | 低 | 手工合 | contextEditorVisible 注册为 local device key（registry 1 行 + 两侧 settings-registry.json）；随 context panel 块 |
| 51 | cf0904586 | feat | ui | 高 | 手工合 | 文件树宽度持久 + editor toggle：ContextPanel 55/31、useUIStore 71/11、i18n 1×12；fork ContextPanel/useUIStore 热区 |
| 52 | 2a1a4c553 | ci | docs-ci | 低 | 跳过 | .github/workflows sdk-preview（扩展相关，延后轮复核） |
| 53 | 556ee4bb5 | fix | docs-ci | 低 | 跳过 | packages/docs tr frontmatter |
| 54 | 85b20dbf0 | feat | docs-ci | 低 | 跳过 | .github issue 模板 + triage skill（上游仓库自身流程） |
| 55 | e0cb68fc6 | feat | sdk-extensions | 低 | 延后-扩展系统轮 | 扩展 pages/storage/workspace 会话访问；注意其 ui 侧小改（worktreeCreate 18/6、worktreeManager、sync/global-session-status 38/4）延后轮要一并补，避免 fork 侧语义缺口 |
| 56 | c52a0b325 | fix | ui | 中 | 手工合 | retireScrollContent.ts 新文件 + useChatTimelineScroll（跨段依赖）；timeline DOM 释放 |
| 57 | 5181bcd33 | feat | sdk-extensions | 高 | 延后-扩展系统轮 | 第三方扩展 + @openchamber/sdk 主体（sdk 全新 5000+ 行、guests server 全套、ExtensionsPage 853 行）；**边界记录**：它同时改 ChatInput 279/11（guest 命令）、ui-auth 43/8、MessageBody/ToolPart guest 渲染、runtime-auth 54/24——这些 ui/web 集成面延后轮必须补，否则 composer/渲染侧移植会出现缺口 |
| 58 | 64648f7ba | release | docs-ci | 低 | 跳过 | release v1.23.2 |
| 59 | 3bc42c1c4 | docs | docs-ci | 低 | 跳过 | changelog |
| 60 | aaaf3ba28 | chore | docs-ci | 低 | 跳过 | @opencode-ai/sdk 依赖升级 |
| 61 | 5f6754164 | fix | ui | 低 | 手工合 | SessionProjectCollection 分页 4/4 |
| 62 | 29e35421e | fix | ui | 中 | 手工合 | runtime-switch + useQuotaStore 同源初始化 |
| 63 | 2b511c315 | fix | web-server | 低 | Windows-only 单独决策 | Windows 自更新 listener 关闭（openchamber-routes） |
| 64 | 0d49422cb | fix | web-server | 低 | Windows-only 单独决策 | Windows web 自更新改走 .bat（openchamber-routes 59/14） |
| 65 | 2edf535db | fix | ui | 中 | 手工合 | useProjectIdentityForm 68/9（跨段依赖）+ settings parsers；重命名表单不再重置 |
| 66 | 4647d80e1 | fix | ui | 中 | 手工合 | work-status telemetry 吞吐残差隐藏（telemetry.ts 跨段依赖） |
| 67 | 2bdae1e8e | fix | ui | 中 | 手工合 | SessionSearchInput 新组件（回车提交搜索）；SidebarHeader -30 |
| 68 | 9000cf7fd | fix | ui | 高 | 手工合 | 侧栏加载与 workspace 初始化解耦：bootstrap.ts 90/172 大改 + sync-context 57/35 + child-store 74/12 + useDirectoryStore 10/51 + client.ts 28/30；fork 多服务器 sync 核心，逐段语义比对 |
| 69 | 5d474c199 | fix | ui | 中 | 手工合 | editorFocus.ts 新文件：Escape 到 Vim keymap；ContextPanel/快捷键 |
| 70 | 827ae628e | fix | ui | 低 | 手工合 | UsageCard 供应商错误隔离 |
| 71 | b3ca350e3 | fix | ui | 高 | 手工合 | 移动/Recent 归档删除整棵子树：sessionSubtreeActions + child-session-discovery 新文件 + sync-context 9/13 + useSessionActions 9/45；**与 fork 自研父子 session 语义相交**，需比对 fork 的子会话发现/删除逻辑后择一 |
| 72 | 1636fd2bf | test | ui | 低 | 手工合 | OverlayScrollbar 测试去固定延时 |
| 73 | 25bfdd777 | test | vscode | 低 | 手工合 | webview settings 测试时序（fork vscode 测试需对齐） |
| 74 | 9aa8a7ec8 | fix | ui | 中 | 手工合 | 听写时玻璃重叠（ComposerDictation 跨段依赖；ChatInput 1 行） |
| 75 | cd23d89e9 | feat | ui | 高 | 手工合 | work-status 分区排序 + 任务折叠：WorkStatusSectionsDialog 112/20 + settings registry/helpers；碰 settings 核心路径，且 fork work-status 区域自研（DraftContextOverview），渲染面需融合 |
| 76 | c3a8326d6 | fix | ui | 低 | 手工合 | gitApiHttp 嵌套仓库发现限定项目根（fork gitApiHttp 有 14 本地 commit） |
| 77 | 961f1611c | release | docs-ci | 低 | 跳过 | release v1.23.1 |
| 78 | 680800b8d | fix | ui | 高 | 手工合 | useConfigStore 87/95 重写（就绪前显示会话选择）+ ModelControls；settings 核心路径 |
| 79 | 6b90818cc | fix | ui | 高 | 手工合 | 草稿默认值跨发现/运行时切换：useConfigStore 108/53 + persistence 30/7 + session-ui-store 13/1；与 fork 多服务器 draft 默认值逻辑相交 |
| 80 | 23e26f443 | fix | ui | 高 | 手工合 | 删除非 git 轮次 changed-files 下拉：删 ChangedFilesList/TurnChangedFilesDropdown/changedFiles.ts（fork 均有，v1.11 遗留）；**功能移除决策**：fork 是否跟随移除（替代品 fdef13cbd 同段移植） |
| 81 | 6cf247894 | fix | ui | 高 | 手工合 | sidecar 默认模型保留：useConfigStore 185/86 + persistence + DefaultsSettings + vscode settings.ts；settings 核心 |
| 82 | 18f6bb2c9 | feat | ui | 高 | 手工合 | 建议消息停靠进 composer：ComposerFloatingPanel 新建 + ChatInput + SessionSuggestionChip；composer 块，fork queue 模式相交 |
| 83 | 0666f0c7a | fix | ui | 高 | 手工合 | 自动补全弹层锚到玻璃 composer 外：ChatInput 21/15 |
| 84 | e5e835a87 | fix | vscode | 高 | 手工合 | webview 重载后孤儿事件流清理：3 个 Provider + bridge；fork vscode bridge runtime 自研 |
| 85 | 2a3d6ab25 | fix | ui | 中 | 手工合 | recap hint 按实测距离渐隐：ChatContainer + useChatTimelineScroll（跨段） |
| 86 | 637169d45 | fix | ui | 中 | 手工合 | recap hint 抽屉滑动/切会话保持：ChatContainer + mobile.css |
| 87 | 111c4bf9d | fix | ui | 中 | 手工合 | ghostty core Option 词编辑（ghostty 模块跨段依赖；fork 终端为自研壳，需确认是否采用 ghostty 路径） |
| 88 | a5bdcd6df | feat | ui | 高 | 手工合 | recap hint 悬浮于 composer + 弹层玻璃化：ChatContainer + SessionRecapSpacer 13/22 + 4 个 autocomplete；composer 块 |
| 89 | 0a338962a | fix | web-server | 中 | 手工合 | 删除 mcp 自动重连插件（mcp-reconnect 目录整删，跨段依赖）；若前段未移植该模块则本 commit 空操作（联动决策） |
| 90 | 8fb85d0cb | fix | ui | 中 | 手工合 | 终端右键复制/粘贴：TerminalViewport 78/5 + i18n 3×12；fork 终端自研需比对 |
| 91 | 5a7b355f7 | fix | web-server | 中 | 手工合 | mcp-reconnect 重试上限（跨段依赖；与 89 联动） |
| 92 | 084eeabc3 | feat | ui | 高 | 手工合 | **composer 悬浮于 transcript**：ChatContainer 79/14 + ChatInput 95/74 + MobilePillComposer + design-system.css；fork ChatInput 4985 行/85 自研 commit（followUpBehavior queue），必须语义级重构合并 |
| 93 | a24524aa9 | refactor | mobile-shared | 低 | 不做 | 上游移动面 pending changes bar→header 点；其 shared 文件改动（changedFiles.ts/session-ui-store -23）由 80/93（23e26f443/af15c1154）吸收，本条不单独移植 |
| 94 | af15c1154 | feat | ui | 高 | 手工合 | 附件移入 composer 内部 + 粘贴文件引用：ChatInput 124/95、删 PendingChangesBar（fork 有）、FileAttachment；composer 块核心 |
| 95 | 8062a7bf6 | fix | ui | 高 | 手工合 | reasoning/bash auto-follow：ReasoningPart/ToolPart（fork 聊天渲染自研热区） |
| 96 | 461574dd9 | style | ui | 低 | 手工合 | ChatInput 聚焦环统一（1/4，搭车 composer 块） |
| 97 | 66b067a17 | fix | web-server | 低 | 手工合 | scheduled tasks runNow 允许跑 paused 任务 + 双执行回归测试 |
| 98 | 8ee477207 | feat | ui | 中 | 手工合 | 侧栏活动 header 粘性切换（SessionProjectScroller 24/3；与 0d59ddf3c 同块，先本条后 crossfade） |
| 99 | 0e9e93dc7 | feat | ui | 高 | 手工合 | archived-only 保留清理：sync/session-retention.ts +34/18、registry/search、SessionRetentionSettings、settings-registry 两侧；session 删除核心路径，fork 有旧版 useSessionAutoCleanup（3 自研 commit）需先对齐 |
| 100 | f01b893b4 | fix | ui | 高 | 手工合 | 清理级联安全：useSessionAutoCleanup 37/208 重写 + session-retention.ts 新建 170 行；同块，fork 旧实现被替换 |
| 101 | f0f30febd | fix | ui | 高 | 手工合 | 队列注记预览 + 默认折叠：QueuedMessageChips + messageQueueStore（**fork 队列系统自研**，6+7 commit）+ server message-queue（跨段）；语义需映射到 fork followUpBehavior/queue UI |
| 102 | fdef13cbd | fix | ui | 高 | 手工合 | 轮次只列其编辑的文件并折叠长列表：turns/liveActivitySummary、projectTurnSummary 46/22、MessageBody 52/7（fork 渲染自研热区）；是 80 的替代面 |
| 103 | f07b88434 | chore | docs-ci | 低 | 跳过 | electron runtime 版本 bump |
| 104 | 561d5c1b3 | fix | web-server | 中 | 手工合 | 深嵌套 checkout 的 per-project 目录名限长：settings-runtime/project-context/project-id |
| 105 | c87bd31b4 | fix | ui | 高 | 手工合 | 大文本文件编辑不截断：FilesView 20/69（fork 54 自研 commit）+ fileEditorContent.ts 新建 |
| 106 | bb7bededf | feat | ui | 高 | 手工合 | Changes 里审已发布 PR diff：PullRequestComparisonSelector/usePullRequestComparison/snapshotCache 新建 + DiffView + walkthrough PR 路由 + usePullRequestSelectionStore；git 核心路径；MobileChangesSurface hunk 跳过 |
| 107 | a16d947a0 | feat | ui | 高 | 手工合 | 会话辅助与浮动面板：ComposerFloatingPanel 落地 48 行 + ChatInput/QueuedMessageChips 35/26/BtwPanel + server session-assist 重构（context.js/prompt.js 拆分）；composer+队列双热区 |
| 108 | cd261645e | fix | ui | 中 | 手工合 | 重命名回车保存：sessionRenameKeyboard.ts 新建 + SessionNodeItem/Header |
| 109 | 0c7653c4c | feat | ui | 中 | 手工合 | AI 会话重命名（近期对话轮）：sessionTitle.ts/session-title-generation.ts/use-session-ai-rename.ts 等全新文件集 + SessionAiRenameMenuItem；fork 无等价实现，additive；sync/session-actions 5/1 小改注意多服务器 |
| 110 | ba3dbfcc7 | perf | ui | 高 | 手工合 | 隐藏视图暂停 + 事件减负：event-pipeline + server event-stream global-hub/protocol（fork 多服务器事件链）+ FilesView 98/110/DiffView |
| 111 | 1e71b90b8 | fix | web-server | 中 | 手工合 | worktree checkout 完成前不初始化 OpenCode：server proxy +33、worktreeSessionCreator、useDraftTarget |
| 112 | afed886f1 | fix | ui | 低 | 手工合 | session tab 标题渐隐 hover 保持（index.css 2/8） |
| 113 | 751ae66e6 | fix | ui | 中 | 手工合 | slash 命令跨项目切换保留：useCommandsStore 25/30 |
| 114 | 06d9e1578 | fix | ui | 中 | 手工合 | 数字导航快捷键在 chat input 生效：keyboard-shortcut-dom +9；fork 快捷键 hook 有本地改动 |
| 115 | 42f47730a | fix | ui | 低 | 手工合 | 终端选择附加后聚焦聊天（2 行） |
| 116 | eb12a3a1c | fix | ui | 低 | 手工合 | markdown 内联代码主题色：index.css + cssGenerator +6 + 各 theme json +2 |
| 117 | 819b2b218 | feat | web-server | 中 | 手工合 | relay 连接上报 app 元数据：tunnel-client/host-client；fork relay 为多服务器传输层 |
| 118 | 0d242314f | fix | ui | 高 | 手工合 | 旧历史测量时保持滚动位置：MessageList 9/13（fork 36 自研）+ browser 测试脚本 |
| 119 | 8ffb31a76 | fix | web-server | 中 | 手工合 | 超长项目路径的配置文件名限长：project-config/project-id/settings-runtime + vscode bridge-project-setup 46/8 |
| 120 | 9081d1f28 | test | ui | 中 | 手工合 | createSession mock 对齐 child store/global index（跨段特性）；fork sync 测试为自研版本，mock 需映射 |
| 121 | a8eec23f4 | fix | web-server | 中 | 手工合 | bundled OpenCode 路径不进更新环境：env-runtime + lifecycle |
| 122 | 14f32cc3a | fix | ui | 高 | 手工合 | 仓库 worktree 变化刷新侧栏拓扑：worktreeTopologyRefresh.ts 新建 + worktreeManager 123/8 + SessionSidebar + git service/routes 159/4；fork worktree 管理有自研 |
| 123 | 16046a98d | docs | docs-ci | 低 | 跳过 | README vacation notice |
| 124 | 0e3aff884 | fix | ui | 高 | 手工合 | 宽度调整时保持 timeline 钉底：MessageList 7/3 + useChatTimelineScroll 30/6（跨段依赖） |
| 125 | 2c8ae9adc | fix | ui | 低 | 手工合 | 项目操作按钮预留空间（sortableItems 8/1） |
| 126 | d6bbbe9f4 | feat | ui | 高 | 手工合 | **项目默认 agent**（块起点）：useConfigStore/session-ui-store 1 行/openchamber-sessions routes 41/15/settings-normalization + i18n key ×13 locale；fork settings/session-ui-store 热区 |
| 127 | f31c24d72 | fix | ui | 高 | 手工合 | 草稿目标变化时重应用项目默认：session-ui-store 37/10（fork draft 逻辑自研） |
| 128 | bd8cb2a5e | fix | ui | 高 | 手工合 | sync/refresh 保留项目默认 agent：useConfigStore 32/2 |
| 129 | 0cf0041a7 | fix | ui | 高 | 手工合 | 无项目新草稿重应用全局默认：session-ui-store 14/14 |
| 130 | 85a95bb8e | fix | web-server | 中 | 手工合 | HTTP 代理后允许外部 host origin：request-security 14/5；安全路径，回归测试齐全 |
| 131 | e525b935d | merge | docs-ci | 低 | 跳过 | merge（内容即 85a95bb8e 的 request-security，随 130 移植） |
| 132 | 55df65f9a | merge | docs-ci | 低 | 跳过 | feature 分支 merge main，无独立内容 |
| 133 | 304dac98e | fix | ui | 高 | 手工合 | rebase 冲突修复（default agent 块收尾）：session-ui-store 7/6 + issue-2039 测试 |

## 策略统计

| 策略 | 数量 |
|------|------|
| 手工合 | 100 |
| 跳过 | 17 |
| 延后-扩展系统轮 | 12 |
| Windows-only 单独决策 | 2 |
| 不做 | 2 |

手工合中：高风险 42、中风险 ~35、低风险 ~23。

## 本段重点功能块

**A. composer 悬浮重构系列（高，12 条：92/94/88/82/83/107/31/74/96/85/86/101）**
顺序建议按上游：084eeabc3(悬浮) → af15c1154(附件内移,删 PendingChangesBar) → a5bdcd6df(recap 悬浮) → 18f6bb2c9(建议停靠,新建 ComposerFloatingPanel) → 0666f0c7a(补全锚点) → a16d947a0(浮动面板+session-assist) → 9caa4f8ec(草稿附件按会话)。核心冲突：fork ChatInput 4985 行、85 个自研 commit（followUpBehavior/Ctrl+Enter queue、45° 按钮、draft context）；ChatContainer 43、messageQueueStore/QueuedMessageChips 自研。移植必须把上游的 glass/floating 布局层与 fork 的 queue 逻辑分层合并，不能整段替换；f0f30febd 的队列注记预览要映射到 fork 队列数据结构。SessionRecapSpacer/useChatTimelineScroll 为跨段依赖。

**B. 主题系统（高，6 条：29/35/34/27/116/2）**
6a20db4d0（Open VSX 导入 + server theme-catalog + electron file picker）→ 6f3227fa8 → 293fe65e3（调色板紧凑化，themes/*.json 全量重生成）→ d7a6479c9（~150 文件语义色机械替换）。注意：i18n settings 27 key ×12 locale、fork index.css/类名差异抽查、electron main.mjs 手工接线；convert-vscode-theme.cjs 被 server 端替代。建议一个批次连做，避免半新半旧调色板。

**C. context panel 持久文件树（高，5 条：51/23/50/10/8）**
cf0904586 → 49bfdac7f(merge 内容) → dda966fa6（contextEditorVisible 本地设备键）→ bc3926eca（面板宽度折叠）→ 80ac4b3e7。fork ContextPanel 37、useUIStore 50 个自研 commit，逐块手工；settings registry 两侧 JSON 要同步。

**D. 项目默认 agent（高，8 条：126/127/128/129/133/22/21/125）**
d6bbbe9f4 → f31c24d72 → bd8cb2a5e → 0cf0041a7 → 304dac98e → 9934110cd(merge 集成) → 0c4c75854 → 2c8ae9adc。贯穿 useConfigStore/session-ui-store/selection-store/openchamber-sessions routes；fork 多服务器 draft 语义（f31c24d72 的 target 变化重应用）需映射到 fork 的 serverId/目录权威上下文。i18n key ×13 locale（fork 7 locale 取交集）。

**E. session 保留清理（高，2 条：99/100）**
archived-only 清理 + 级联安全，新建 sync/session-retention.ts 并重写 useSessionAutoCleanup；fork 有旧版（3+5 个自研 commit），先 diff fork 旧实现再整体切换，settings registry 两侧同步。

**F. git/worktree/PR review（高，7 条：4/76/122/106/111/104/119）**
5d4c8f38f（子模块/嵌套 diff）→ 14f32cc3a（拓扑刷新）→ bb7bededf（PR diff review，依赖跨段 useGitComparison）→ 1e71b90b8（checkout 就绪）。git service/routes 是核心路径；MobileChangesSurface hunk 一律跳过。

**G. AI 会话重命名（中，4 条：109/108/25/32）**
全量新增文件（sessionTitle、session-title-generation、use-session-ai-rename、SessionAiRenameMenuItem），fork 无等价实现；仅 session-actions 5/1 与 SessionNodeItem 小改需多服务器视角检查。

**H. sync/bootstrap 热区（高，5 条：68/71/13/78/79/81 归此组理念）**
9000cf7fd（bootstrap 90/172 重写）与 b3ca350e3（子树归档/删除）直接压在 fork 多服务器核心上；b3ca350e3 的 child-session-discovery 与 fork 自研父子 session 语义重叠，须先比对再择一实现。

**I. VS Code（高/中，5 条：12/14/84/40/73）**
每条都要与 fork 自研 bridge/进程管理逐文件比对（f239b34ca 还碰 sync-context）；d144cfd4b 的 opencode.ts 大重写尤甚。

**J. Electron（高，3 条：6/48/9）**
shell-environment 与进程收割均为 main.mjs 旁路新文件 + 少量接线，fork main.mjs 自研 66 commit，只接事件不搬逻辑。

**K. 延后-扩展系统轮边界（12 条）**
5181bcd33 除 sdk/guests 主体外还改 ChatInput guest 命令、ui-auth、ToolPart guest 渲染、runtime-auth；e0cb68fc6 改 worktreeCreate/worktreeManager/global-session-status。延后轮必须回补这些 ui/web 面的修改，否则 composer（A 块）和 worktree（F 块）移植会出现语义缺口——建议在延后清单里显式记录这两条的"非扩展部分"。

## 待用户决策的疑点

1. **23e26f443 功能移除**：上游删除非 git 轮次 changed-files 下拉（fork 现存这 4 个文件），由 fdef13cbd 的"轮次只列编辑文件"替代。fork 是否跟随移除？
2. **mcp-reconnect 联动**：0a338962a（删除）/5a7b355f7（限流）依赖 v1.22..1.23 段是否移植了 mcp-reconnect 模块；若前段不移植，这两条空操作。
3. **composer 悬浮布局方向**：上游把 composer 浮在 transcript 上并玻璃化（084eeabc3 系），与 fork 自研 queue/follow-up UI 是两种交互方向，是否整体采纳上游布局。
4. **b3ca350e3 子树归档/删除**：与 fork 父子 session 自研实现重叠，采用上游 sessionSubtreeActions 还是保留 fork 实现。
5. **Windows-only**（2b511c315/0d49422cb）：Windows 自更新批处理化，单独决策。
6. **docker 两连**（6ab756350/e4b235bf4）：仅在有 sdk workspace 时有意义，随扩展轮再定。
7. **主题语义色大扫除**（d7a6479c9/293fe65e3）一次合入 vs 分批；fork index.css 有本地改动，建议整批合入 + 回归跑主题快照测试。
