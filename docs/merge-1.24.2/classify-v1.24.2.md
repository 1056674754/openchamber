# 移植分类：上游 v1.24.0..v1.24.2（71 commits）

> 顺序与 `git log v1.24.0..v1.24.2 --oneline` 一致（新→旧）。fork 侧核实基于 worktree /Users/song/dev_ai/openchamber-merge-v1.11.0（checkpoint 89b311a42，移植前状态）。
> 策略统计：**手工合 55 / 跳过 8 / 延后-扩展系统轮 4 / 待查（单独决策）4 / 不做 0 / 已等价 0**。
> 风险统计：高 13 / 中 25 / 低 33。

## 逐 commit 分类

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
|---|------|------|------|------|------|------------|
| 1 | 614d7f76e | release | other | 低 | 跳过 | 版本号/CHANGELOG/bun.lock |
| 2 | 6943ecdf4 | fix | ui | 中 | 手工合 | 目标 markdownCore.ts fork 未采用（fork 自研 MarkdownRenderer 管线）；修复逻辑需人工适配；与 v1.22.0 段 markdownCore 是否移植联动 |
| 3 | e31013943 | fix | web-server | 中 | 手工合 | git/service.js fork 分歧巨大（vs v1.24.0 差 -1695 行），逻辑简单（忽略 / 与 ~ 为根的仓库）但落点需重找 |
| 4 | 48ce6028d | feat | ui+web-server | 高 | 手工合 | 依赖段内 ec95fe2e0 + 27b170d69（contextWindowLimits 段内新建）；openchamber-sessions/routes.js fork 完全自研（差异 1005 行），Auto 默认值落库需按 fork 重写；含新测试可整取 |
| 5 | d5fbd86e9 | feat | ui | 低 | 手工合 | DiffView/PierreDiffViewer fork 均有，改动局部 |
| 6 | 73ad4f859 | fix | ui+web-server+ui-i18n | 高 | 手工合 | DiffView +205/-47 近重写；git service 进程树终止依赖 f16ca02b8 的 bounded listing；i18n 每 locale **删 2 key**（fork 需同步删，保留本地 key）；sprite.ts -1 图标 |
| 7 | 27b170d69 | fix | ui | 高 | 手工合 | 段内新建 lib/routing/contextWindowLimits + useContextWindowLimits hook（后续 48ce6028d 依赖）；WorkStatusPrimaryGroup/Header fork 无对应（work-status 为 v1.22 段范围）；Auto 语义核心 |
| 8 | 0fe20a5cf | fix | ui | 中 | 手工合 | ContextPanel fork 大幅扩展（+2664），宽度上限逻辑落点需定位；useUIStore 小改 |
| 9 | b43ccb44d | fix | ui | 中 | 手工合 | NewWorktreeDialog fork 分歧（328/598）；新 worktreeCreateKeyboard.ts 可整取；DraftTargetSelectors fork 无（composer/ui 目录结构 fork 缺） |
| 10 | a03ae481e | fix | ui | 中 | 手工合 | KaTeX CSS 从 index.css @import 改 JS import（katex-css.ts 新文件）+ 6 个入口；fork index.css 有自定义 .katex 规则，需先确认 fork 的 KaTeX 引入方式 |
| 11 | 6a76e0732 | fix | ui | 中 | 手工合 | 上游 SessionNodeItem 在 sidebar/sessions/，fork 同名文件在 sidebar/ 且自研重写（多服务器）；新 hook useSessionRowMenuState（96 行）可参考移植"Rename 后关菜单"行为 |
| 12 | 0f3592f0b | fix | electron+web-server | 中 | 手工合 | ssh-manager.mjs fork 自研分歧（+347/-124），"复用已运行 managed server"需人工重放；web/bin/lib/commands-status.js fork 无（v1.22 段引入）；测试 +227 可整取 |
| 13 | 7bf8d6584 | fix | ui | 高 | 手工合 | useConfigStore（fork 差 925/1429）+ session-ui-store（fork 热点）；pinned agent 的 model/variant 作用域与 fork 多服务器/父子 session 相交，需语义核对 |
| 14 | 01af9bb1b | fix | web-server | 低 | 手工合 | agent-tool/runtime.js fork 分歧小（235/153），patch 小 |
| 15 | 65dfecd5d | fix | web-server | 中 | 手工合 | 目标 message-queue/runtime.js 为 **v1.24.0 新增**、fork 无 → 不独立移植，随 v1.24.0 段 message-queue 子系统 |
| 16 | 2ca49fc95 | fix | web-server | 中 | 手工合 | "server 绑定具体地址时可达 managed tool"——与 fork 多服务器/绑定地址架构直接相关，需按 fork server bind 逻辑适配；含 server/index.js +2 |
| 17 | 5587a3b3a | fix | ui+web-server | 中 | 手工合 | chatDirectories（fork 分歧 95/82）+ web fs/routes（分歧 261/466）；"managed root 别名服务端解析"与 fork 目录权威上下文相交 |
| 18 | 5c4c3e33b | docs | docs-ci | 低 | 跳过 | .agents/skills 上游内部技能文档 |
| 19 | 3f958a397 | fix | electron+web-server | 中 | 手工合 | 新 terminal/shutdown.js（106 行）可整取；依赖 server-shutdown.mjs（v1.24.0 新增，fork 无，随前段）；electron main.mjs fork 大改 |
| 20 | 208f1fb17 | fix | web-server | 中 | 手工合 | small-model/call.js fork 分歧中等（26/87）；thinking switch 条件发送 + "SDK-hosted providers" 相邻延后范围但主体是 server 逻辑 |
| 21 | 33d86414e | fix | electron | 中 | 手工合 | main.mjs fork 巨幅分歧；fork 有自研 AppImage 更新流程，"update install 接管退出"时序需按 fork 验证 |
| 22 | ebe2e107e | fix | mobile-shared | 中 | 手工合 | MobileApp.tsx fork 有（Capacitor 壳加载的共享层）；平板断点下文件编辑器保持；+scripts/test-mobile-workspace-resize.mjs 可整取 |
| 23 | 5df72db27 | fix | ui | 低 | 手工合 | Catppuccin 双 json 对齐官方色；fork 侧有少量自定义（差异 130/78）需保留后再覆盖 |
| 24 | f9b46dfa9 | fix | mobile-shared/ui | 中高 | 待查（单独决策） | 段内新建 mobileComposerMorph 子系统（+218/-64 重构）依赖上游 mobileNativeChrome（fork 无）；fork 移动壳自研 → 整包移植价值存疑，倾向不做，与 #25 的 mobile 部分一起决策 |
| 25 | dabfe7ab9 | fix | web-server(+mobile) | 高 | 手工合（git 部分） | git 读超时 kill（+42/7）是 f16ca02b8 serial-refresh 的直接后续，必须同批；**该 commit 还打包了 mobileComposerMorph 新建（+179）**，mobile 部分随 #24 决策 |
| 26 | db6945a55 | fix | ui | 中 | 手工合 | useGitStore fork 分歧（234/705）；乐观 staging 行数保持 |
| 27 | d67f59b76 | fix | ui | 高 | 手工合 | 上游把 multirun 抽到 lib/multirun 新模块（identity/groups/fusion/createSession）+ store 大改；fork multirun 自研（MultiRunFusionDialog、useMultiRunStore 本地改过）→ 逐块对照 fork 差异，不能整取 |
| 28 | 1c5c75874 | fix | ui | 中 | 待查 | ComposerDictation/useDictationOrigin 属上游 composer/ui + dictation 体系，fork 均无（composer 目录结构 fork 缺）；随 v1.22.0/v1.24.0 段 dictation 是否移植的决策 |
| 29 | 24eb87762 | docs | docs-ci | 低 | 跳过 | 技能文档 |
| 30 | 0d047e5bd | docs | docs-ci | 低 | 跳过 | 技能文档 |
| 31 | eb8eb5591 | fix | ui+web-server+vscode | 高 | 手工合 | **本段最需设计决策**：启动不全量 bootstrap 已知目录。直击 fork 多服务器目录权威：sync-context（-57/+118）、session-ui-store、useTraySync（-60/+29）均热点；sidebar/list/* fork 无；vscode webview/main.tsx fork 自研需逐行；新增 host-session-status-seed/global-blocking-requests 可整取；"哪些目录需要 bootstrap"在 fork 多服务器语义下要重新定义 |
| 32 | 12063fe2f | fix | web-server | 低 | 手工合 | web 依赖升级 + 代码适配（project-config/scheduled-tasks）+ 新 tts 测试；建议并入依赖统一升级批次 |
| 33 | 03811ff52 | fix | scripts | 低 | 延后-扩展系统轮 | builtin extensions 构建链（scripts/build-builtin-extensions.mjs）fork 无 |
| 34 | e1b2892a9 | docs | docs-ci | 低 | 跳过 | CONTRIBUTING/PR 模板 |
| 35 | db4aadb0f | fix | web-server | 中 | 待查 | realtime-proxy.js fork 未采用（v1.22.0 已有，fork 走自研 relay/remote-instances）；若前段未移植 realtime-proxy 则本笔 N/A |
| 36 | f2d1954b8 | fix | ui | 高 | 手工合 | 目录 bootstrap 不再初始化 MCP fleets；bootstrap.ts + session-ui-store（热点）+ sync/types；fork MCP/bootstrap 逻辑需对照 |
| 37 | d54d57c09 | release | other | 低 | 跳过 | 版本号/CHANGELOG |
| 38 | 921f764c8 | feat | web-server+scripts | 低 | 跳过 | changelog 基建（changelog 类）；update-notes.js fork 无（v1.24.0 新增） |
| 39 | 86ca68005 | fix | ui | 低 | 手工合 | StatusRow/WorkingPlaceholder/ScrollToBottomButton + index.css 动画；fork 均有 |
| 40 | 90a392fcd | fix | ui | 中 | 手工合 | 目标 SessionSidebarRows.tsx 为段内 63e3911e7 新建 → 随虚拟化批次 |
| 41 | 7bd3834af | fix | ui | 低 | 手工合 | typography.ts + design-system.css 共享 label 13.5px；fork 有自定义字号需对照 |
| 42 | fb2f7ff22 | fix | ui | 低 | 手工合 | fontOptions fork 可能有自研分歧，1+2 行小改 |
| 43 | 6604f9e5e | fix | ui | 低 | 待查 | useMiniChatKeyboardShortcuts fork 有；+5 行接 dictation 状态，fork 无 dictation 子系统 → 随 dictation 决策 |
| 44 | b2b8cdea9 | fix | ui | 低 | 手工合 | 可读性小改散点多文件；composer/editor/theme.ts fork 无（随 composer 结构决策），其余 checkbox/radio/ReasoningPart/ToolPart 可套 |
| 45 | ec95fe2e0 | feat | ui+web-server | 高 | 手工合 | **本段旗舰**：任务级模型路由 + risky auto-accepted actions 拦截。新建 web lib/routing 全套（store/runtime/jev/history/defaults/flag/routes+tests）+ ui RoutingPage(510)/useRoutingStore/useRoutingSync/autoModel/routingApi + permission-auto-accept 接线（fork 该文件与 v1.24.0 仅差 14/6，低冲突）+ message-queue 钩子（**v1.24.0 新增依赖，fork 无**）+ lib/settings/registry.ts（**v1.24.0 新增，fork 无**）+ i18n 新模块 routing.i18n.ts（771 行）+ 11 locale 各 +2 行 + vscode settings-registry.json（fork 无）。fork 挂点：App.tsx +2、sync-context +3（小）。工作量最大，建议整批独立移植 |
| 46 | 159130435 | fix | ui | 低 | 手工合 | 注册 messageQueueExpanded 偏好（1+4+4 行）；依赖 #49 queue panel 与 v1.24.0 settings registry 体系（fork 的 web/vscode settings-registry.json 均无） |
| 47 | f16ca02b8 | fix | web-server+ui+vscode | 高 | 手工合 | 新 serial-refresh.js（串行化 git status + untracked 扫描限额）+ service.js 大改（172/13）；与 #25/#6/#3 构成 git 健壮性批次；i18n +2/locale；vscode gitService fork 有需逐行；MobileChangesSurface 部分 N/A（fork 无该文件，不做）；electron process-lifecycle.md 文档 |
| 48 | 807d820a0 | feat | ui | 高 | 手工合 | /btw composer 文件附件；fork 有自研 /btw（lib/btw.ts）+ 自研 composer（无 composer/ui 子目录，ComposerAttachmentControls/ComposerFooter fork 无）→ 附件上传需在 fork ChatInput 重实现，不能 cherry-pick |
| 49 | 7ffa37158 | fix | ui | 中 | 手工合 | queue panel 保持展开且不遮 transcript；与 fork 自研 queue/follow-up 模式直接相交（QueuedMessageChips 两边都有但实现分歧）；ComposerFloatingPanel 为 v1.24.0 新增、fork 无 → 面板部分随 v1.24.0 |
| 50 | 4adb70398 | feat | sdk-extensions | 低 | 延后-扩展系统轮 | sdk background entry；ui lib/guests、PluginPane/GuestHosts fork 均无 |
| 51 | ecad0a2db | feat | sdk-extensions | 低 | 延后-扩展系统轮 | sdk background actions + interactive toasts；ui 侧 guests/toast 全套随延后（MessageBody/ChatMessage/SessionNodeItem 触点极小，随延后整体处理） |
| 52 | 1d945a4f3 | fix | sdk-extensions | 低 | 延后-扩展系统轮 | 仅 packages/sdk/src/ui |
| 53 | df5a8b3cc | test | mobile-shared | 低 | 手工合 | mobileConnections.test fork 有且近源（差异 98/156），大概率可套 |
| 54 | 5271bba42 | fix | ui | 低 | 手工合 | fork SessionErrorNotice 与 v1.24.2^ 完全同源（两文件 diff 恰为本 patch）→ 近乎干净 cherry-pick；session-actions.ts fork 有 |
| 55 | f3752d534 | fix | scripts | 低 | 跳过 | release/chore（bump-version 脚本） |
| 56 | db183e2f0 | test | electron | 低 | 手工合 | shell-environment.test.mjs 为 **v1.24.0 新增**、fork 无 → 随前段测试；前段未移植则跳过 |
| 57 | bc798178b | fix | ui+web-server+vscode | 中 | 手工合 | staged/unstaged 计数按范围隔离；useGitStore/DiffView fork 分歧；vscode gitService 逐行；MobileChangesSurface N/A |
| 58 | 49ead213c | fix | ui | 中 | 手工合 | 单 $ 行内公式 + 实体损坏 display math 还原；同 #2，markdownCore fork 未采用 → 逻辑适配 fork MarkdownRenderer |
| 59 | c97feaebe | fix | ui | 低 | 手工合 | quota/model-families fork 有，patch 小（14/2）+ 测试整取 |
| 60 | 7af8f4555 | fix | web-server | 低 | 手工合 | package.json 声明 zod runtime dep，一行 |
| 61 | 51e023fc3 | perf | ui+web-server | 中 | 手工合 | 新 event-stream/delta-coalescer（服务端 delta 合流）+ global-hub 改（fork 有 event-stream 但有自研分歧）+ ui BusyDots CSS + scripts/perf 工具（可整取或跳） |
| 62 | 0225d5086 | test | ui | 低 | 手工合 | persistence.test fork 有（persistence.ts 存在） |
| 63 | c3b3a4e43 | fix | ui | 高 | 手工合 | 修复 63e3911e7 虚拟化行为，随同批；目标文件 fork 无（fork sidebar 扁平自研） |
| 64 | 63e3911e7 | perf | ui | 高 | 手工合（建议单独决策） | 本段最大 ui 重构（+2261/-1347）：新建 sessionSidebarRowModel(464)/virtualization、重写 SessionProjectScroller(360/259)、删 RecentSessionSection/SidebarActivitySections；fork sidebar 自研扁平结构 + 多服务器分组 → 直接套不可能；**建议用户决策：整体重构移植 vs 放弃虚拟化**，牵连 #63/#40/#11 |
| 65 | 0667e739d | test | electron | 低 | 手工合 | ssh-manager.test fork 有，追加用例 |
| 66 | 6991c1d08 | test+fix | web-server | 中 | 手工合 | 随 #70 port-scoped cookies 批次；request-security.js fork 有（fork 侧引入）需对照 |
| 67 | 04697da25 | fix | ui+web-server | 中 | 手工合 | push routing 保持 + 真实 ref 变化上报；随 #69 commitAndPush 批次；git service fork 分歧需重放 |
| 68 | 3f503aeac | fix | electron | 中 | 手工合 | ssh-manager XDG cache 二进制发现（9/4 小 patch）；fork ssh-manager 自研分歧，落点需定位 |
| 69 | 6cde97a00 | fix | ui+web-server | 中 | 手工合 | commitAndPush.ts 为段内新建（fork 无此模块）；GitView fork 有；MobileChangesSurface N/A；git service 测试整取 |
| 70 | dc011229e | fix | web-server | 中 | 手工合（需架构确认） | UI session cookie 按请求端口隔离（session-cookie.js 段内新建）；fork ui-auth 有旧版 + 自研 client-auth；多服务器架构下 per-port cookie 语义是否适用需确认 → 疑点 |
| 71 | baa1df382 | fix | electron | 低 | 手工合 | AppImage icon 指向 app-icon.svg（1 行）；fork linux icon 仍指 icon.png 可套，需确认 svg 资源在仓库内 |

## 本段重点功能块

### A. 任务级模型路由（ec95fe2e0 → 27b170d69 → 48ce6028d，+159130435 部分）
本段旗舰特性：per-task 模型路由（JEV 评分）、risky auto-accepted actions 拦截（permission-auto-accept hold）、Auto 跨重启保持并作为 session 默认、按应答模型测 context。移植要点：(1) web/server/lib/routing 全套为纯新增，可整取；permission-auto-accept/runtime.js fork 与 v1.24.0 仅差 14/6，接线低冲突；(2) **硬依赖 v1.24.0 的 message-queue 与 lib/settings/registry.ts，fork 两者皆无**——若 v1.24.0 段不移植这两个子系统，routing 无法完整落地，需用户决策；(3) i18n 走独立 routing.i18n.ts 模块 + 各 locale 2 行注册，fork 11 个 locale 与上游一致，本地 key 不受影响；(4) 48ce6028d 对 openchamber-sessions/routes.js 的改动 fork 侧完全自研（差异 1005 行），Auto 持久化需按 fork 的 session 存储重写。建议作为独立批次最后落。

### B. Git 健壮性批次（f16ca02b8 → dabfe7ab9(git) → 73ad4f859；e31013943；db6945a55；bc798178b；6cde97a00 → 04697da25）
串行化 git status（serial-refresh.js 新文件）、超时 kill 挂死进程、进程树终止、scoped change counts、乐观行数、push 新分支与 push routing。移植要点：必须按上游顺序整批落 git/service.js（f16ca 先建 bounded listing/serial-refresh，dabfe 的 kill 与 73ad 的进程树终止都建立在上面）；fork 的 git/service.js 相对 v1.24.0 删了约 1700 行（自研裁剪），每笔都要人工重放而非 cherry-pick；ui 侧 useGitStore/DiffView/GitView 同步改；MobileChangesSurface 触点一律 N/A；vscode gitService 两笔小改需逐行；i18n 一删一增各 2 key/locale。

### C. Sidebar 虚拟化（63e3911e7 → c3b3a4e43 → 90a392fcd；6a76e0732 行为）
上游把统一 session 列表虚拟化（新 rowModel/virtualization/scroller，删两个 section 组件），后有两笔修复。**fork sidebar 为自研扁平结构 + 多服务器分组（SessionNodeItem 位于不同路径且重写过）**，无法文件级移植。建议用户决策：a) 整体重构移植（工作量大，长列表性能收益）；b) 放弃虚拟化，仅摘"Rename 关菜单"（6a76e0732 的 useSessionRowMenuState 行为）等小行为到 fork 结构。

### D. Sync/bootstrap 语义（eb8eb5591、f2d1954b8）
启动不再全量 bootstrap 已知目录、bootstrap 不再初始化 MCP fleets。直击 fork 多服务器目录权威（sync-context/session-ui-store/useTraySync 均热点）。新增的 host-session-status-seed.ts、global-blocking-requests.ts、opencode/session-runtime 扩展可整取；但"哪些目录/服务器需要 bootstrap"的规则在 fork 多服务器语义下需重新设计，不能直译。建议与 fork 侧目录权威 owner 共同定方案后单独批次移植。

### E. /btw 附件 + queue panel（807d820a0；7ffa37158 → 159130435）
/btw 附件：fork 有自研 /btw 与自研 composer（无 composer/ui 子目录），需在 fork ChatInput 重实现附件上传与 footer 展示，参考上游 ComposerAttachmentControls。queue panel：上游 ComposerFloatingPanel 为 v1.24.0 新增；fork 已有自研 queue/follow-up 模式与 QueuedMessageChips——建议只吸收行为语义（panel 不遮 transcript、保持展开、messageQueueExpanded 偏好持久化）映射到 fork 的 queue UI，不引入上游面板组件。

### F. Markdown/数学渲染（49ead213c → 6943ecdf4；a03ae481e）
两笔 markdownCore 修复（单 $ 行内公式、实体损坏还原、解析失败回退纯文本）：fork 未采用 markdownCore（自研 MarkdownRenderer），需把修复逻辑适配进 fork 管线，是否值得取决于 fork 是否复现这些 bug（疑点）。KaTeX CSS 改 JS import（多入口打包正确解析字体路径）：fork 需先确认自己的 KaTeX CSS 引入方式再套用。

### G. Electron/桌面与 SSH（0f3592f0b、3f503aeac、0667e739d、33d86414e、3f958a397、db183e2f0、baa1df382）
ssh-manager 两笔功能修复 + 测试：fork ssh-manager 自研分歧（+347/-124），patch 小但要人工落点；测试可整取。terminal graceful shutdown（新 shutdown.js 可整取）依赖 v1.24.0 新增的 server-shutdown.mjs（随前段）。update install 接管退出：fork 有自研 AppImage 更新链，需验证时序。AppImage icon 一行可直套。

### H. 认证/Cookie（dc011229e → 6991c1d08）
UI session cookie 按请求端口隔离（session-cookie.js 段内新建 + request-security 调整）。fork ui-auth 为旧版 + 自研 client-auth，多服务器下 per-port 语义需架构确认（疑点）。若确认适用，两笔一组移植。

### I. SDK/扩展（ecad0a2db、4adb70398、1d945a4f3、03811ff52）
全部延后-扩展系统轮（政策），包括 ui 侧 lib/guests、PluginPane/GuestHosts、toast 等（fork 均无对应基础设施）。

### J. 视觉/低风险批（86ca68005、7bd3834af、fb2f7ff22、b2b8cdea9、0fe20a5cf、5df72db27、d5fbd86e9、5271bba42、c97feaebe、0225d5086、12063fe2f、7af8f4555）
可批量处理的低风险笔：状态 pill/字体/对比度/Catppuccin 色板/ContextPanel 宽度/diff loading；5271bba42 近乎干净 cherry-pick；依赖类（12063fe2f、7af8f4555）并入依赖升级批次。

## 需用户决策的疑点

1. **Sidebar 虚拟化（63e3911e7 + 2 修复）**：整体重构移植还是放弃（fork sidebar 自研扁平 + 多服务器）？
2. **Routing 旗舰的硬依赖**：ec95fe2e0/48ce6028d 依赖 v1.24.0 新增的 message-queue 与 lib/settings/registry.ts——若 v1.24.0 段未移植这两个子系统，routing 是否仍上？
3. **eb8eb5591 bootstrap 语义**：fork 多服务器下"哪些目录需要 bootstrap"需重新设计，需目录权威 owner 参与定方案。
4. **mobileComposerMorph（f9b46dfa9 + dabfe7ab9 的 mobile 部分）**：上游 mobile web 键盘联动新子系统，fork Capacitor 壳是否需要？倾向不做。
5. **dc011229e per-port cookie**：与 fork 自研 client-auth 的关系，是否适用多服务器架构。
6. **markdownCore 两笔**：fork 未采用 markdownCore，修复逻辑是否值得适配进自研 MarkdownRenderer（fork 是否复现单 $ 公式/实体损坏 bug）。
7. **dictation（1c5c75874、6604f9e5e）**：fork 无 dictation 子系统，随前段决策。
8. **db4aadb0f realtime-proxy**：fork 未采用 realtime-proxy（走自研 relay），确认 N/A。
9. **数据更正**：CONTEXT 写"fork 7 个 locale"，实际 fork 为 11 个 locale（de/en/es/ja/ko/pl/pt-BR/tr/uk/zh-CN/zh-TW，与上游一致）+ 每语言 settings 变体 + 多个功能级 i18n 模块；本段 i18n 冲突按 11 locale 计。

## 段内依赖链（建议移植顺序）

- routing：ec95fe2e0 → 27b170d69 → 48ce6028d（先决：v1.24.0 message-queue + settings registry）
- git 健壮性：6cde97a00 → 04697da25；f16ca02b8 → dabfe7ab9(git) → 73ad4f859；e31013943、db6945a55、bc798178b 同批
- sidebar：63e3911e7 → c3b3a4e43 → 90a392fcd（6a76e0732 可独立）
- queue：7ffa37158 → 159130435
- cookies：dc011229e → 6991c1d08
- ssh：3f503aeac → 0667e739d（0f3592f0b 独立）
- markdown：49ead213c → 6943ecdf4
- sdk（延后）：ecad0a2db → 4adb70398 → 1d945a4f3
