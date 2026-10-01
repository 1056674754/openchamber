# Segment B 分类：v2.0.0..v2.0.4（241 commits）

更新时间：2026-10-01
基线：merge/upstream @ c224009a9（1.24.2-sscity，1.24 轮已全部落地）
方法：逐 commit 读 subject + 变更文件 + shortstat，关键 commit 抽查 diff；与 fork 当前树逐面对照（server lib、sync 层、composer/、sidebar rowModel、settings registry、guests/extensions、quota/routing/small-model/session-goal/agent-tool/notifications/browser-control）。

## fork 状态锚点（本段冲突判定依据，已逐项对树核实）

- 有：`lib/message-queue`、`lib/routing`（jev/routes/runtime/store，**无 classifier.js**）、`lib/small-model`、`lib/session-goal`、`lib/session-assist`、`lib/permission-auto-accept`（**无 modes.js/classification**）、`lib/notifications`（含 runtime.js）、`lib/browser-control`（broker/routes）、`lib/guests`（=上游 extensions 服务端）、`lib/agent-tool`、`lib/skills-catalog`、`lib/quota`、`lib/opencode`（core-routes/lifecycle/settings-helpers 等 40+ 文件）、`packages/sdk`、`packages/extensions`、`btw.ts`+`useBtwStore`。
- 无（段 A 引入，本段部分 commit 依赖）：**spaces/（整个子系统）、dictation/、websearch 设置页、TimelineNotice.tsx、bin/lib/commands-tunnel.js**。
- 布局差异：上游 sidebar 行已迁 `sidebar/sessions/`、`sidebar/shell/`、`sidebar/projects/`；fork 为根目录 rowModel + 自有 `sessions/`（内容不同）。sidebar 类 commit 全部需要路径映射。
- 鸿蒙会话未提交文件（foreign-files.txt，不可碰）：MobileApp.tsx、Header.tsx、MainLayout.tsx、useUpdateStore.ts、MobileSessionsSheet 邻域等。本段 8 个 commit 触 MobileApp、3 个触 Header、5 个触 MainLayout、2 个触 useUpdateStore。

## 策略词表

- **移植**：直接移植或小适配
- **随块移植**：随所属功能块一起移植（含测试/fixture）
- **移植【依赖OC2】**：移植代码进 fork，但在隔壁 agent（`../opencode` 2.x）落地前不得激活相关路径
- **随OC2升级**：纯版本 pin，随 OC 侧统一处理
- **随SegA**：依赖段 A（v1.24.2..v2.0.0）先移植的功能
- **待决【Spaces】/【Enterprise】**：待用户拍板的子系统
- **跳过**：上游基建（ci/release/docs/changelog/build）；或被后续 commit 取代的中间态

## 逐 commit 分类表（旧→新）

| # | hash | 类型 | 区域 | 风险 | 策略 | 冲突点/说明 |
|---|------|------|------|------|------|------------|
| 1 | 94f6e0788 | fix | mobile/files | 低 | 移植 | 文件浏览器随项目切换重置 |
| 2 | c36556d64 | fix | skills-catalog | 中 | 移植 | symlink/junction 扫描；fork skills-catalog 扫描逻辑相交 |
| 3 | ca99eb0f8 | fix | skills+opencode | 中 | 移植【依赖OC2】 | OC v2 skill path 字段读取 |
| 4 | 61e6535cf | fix | chat/slash-routing | 高 | 移植【依赖OC2】 | 前导斜杠 skill 按提示路由；与 fork 自研 slash-routing/queue 直交 |
| 5 | 2e3b071d3 | fix | composer submit | 高 | 移植 | 发送时跳过不可解析 mention；15 文件，需适配 fork submit/队列链 |
| 6 | 0d855acef | perf | chat markdown | 高 | 移植 | 流式代码块增量高亮 751+；fork MarkdownRenderer 自研，热路径需按性能规则验证 |
| 7 | 55ba16afa | fix | websearch server | 低 | 随SegA | fork 无 websearch（段 A 引入），随段 A 块移植 |
| 8 | 709179352 | fix | models UI | 低 | 移植 | 自定义 provider 模型能力显示 |
| 9 | 1e19af570 | fix | vscode diff | 低 | 移植 | before 侧缩进恢复（跨端 parity） |
| 10 | 8730ec10c | fix | files 预览 | 低 | 随块移植(Files/评论) | Android 选区工具条；依赖段 A 富预览评论条 |
| 11 | ea1fc2051 | fix | btw | 低 | 移植 | fork 有 btw.ts/useBtwStore |
| 12 | 1fcb1dce3 | fix | opencode lib | 中 | 移植 | 不支持的外部 OC 报错；与 fork OPENCODE_HOST/外部服务器面相交 |
| 13 | 5848b9eb2 | fix | sync | 高 | 移植 | 其他客户端 fork 实时可见；新 forked-session 模块需并入 fork MultiServerSyncLayer 自研架构 |
| 14 | c7900f19e | fix | chat 状态 | 中 | 移植 | no-reply 卡前复查会话；fork session-assist/useAssistantStatus 相交 |
| 15 | e921edad5 | test | ui mocks | 低 | 随块移植(测试) | mock 导出补齐 |
| 16 | 8dcc61279 | feat | mobile | 高 | 移植【⚠协调】 | /fork+运行时提示+移动 About，37 文件；**MobileApp.tsx/useUpdateStore 为鸿蒙未提交文件** |
| 17 | 7f01569d1 | fix | chat skills | 中 | 移植 | /skill 路由前实时加载；与 #4 同一路由面 |
| 18 | a7c3bb361 | fix | skills-catalog | 低 | 移植 | 任意深度 symlink 跟随 |
| 19 | 3d8291a2a | fix | chat markdown | 低 | 移植 | live split memo 排除 reference definitions |
| 20 | fe2ec474f | feat | About | 高 | 移植【⚠协调】 | OpenChamber/OpenCode 更新分离，19 文件；**useUpdateStore 鸿蒙在改** |
| 21 | 90267ff3f | fix | skills | 中 | 移植 | 失败的 skill 列表不算完成（部分依赖 OC2 行为） |
| 22 | 9dfdacf91 | feat | settings | 中 | 移植 | session warming 开关；fork settings registry + server settings-helpers 相交 |
| 23 | 1cf3b8755 | fix | vscode | 低 | 随块移植(#21) | skills bridge 失败标记 |
| 24 | 8f897f486 | fix | About | 低 | 随块移植(#20) | reload 提示清除 |
| 25 | 52680f534 | fix | mobile/files | 低 | 移植 | 移动端上传按钮 |
| 26 | 942f5df37 | fix | composer submit | 中 | 随块移植(#5) | 同一 mention 链的静默化 |
| 27 | 1f3cc4c3a | fix | providers | 低 | 移植 | 编辑保留自定义协议 |
| 28 | 6f50e8122 | fix | providers | 低 | 移植 | 编辑表单回填 |
| 29 | 8b3ab14f3 | fix | vscode types | 低 | 随块移植(#28) | re-export 类型声明 |
| 30 | ee61a8d89 | test | 测试基建 | 低 | 随块移植(测试) | happy-dom GC 修复 |
| 31 | 85feba55d | fix | provider logos | 低 | 移植 | copilot logo 别名 |
| 32 | cceb92daa | fix | chat 链接 | 中 | 移植 | 文件引用点击先于异步标注；fork markdown-image-grants/链接授权相交 |
| 33 | df2fd1663 | fix | quota | 低 | 移植 | kimi-code-plan-global 凭证 |
| 34 | 1e8e8e0e5 | fix | chat | 中 | 随块移植(#14) | no-reply 卡打开状态报告 |
| 35 | 5b6d996ec | fix | composer mentions | 中 | 移植 | 带空格路径保持完整 |
| 36 | 85466693f | fix | agents | 低 | 移植 | picker 显示 display name |
| 37 | c717b416c | fix | git | 低 | 移植 | 分支自身远端副本不作 base；fork git hunk UI 邻域 |
| 38 | f0621bfb3 | fix | chat subagent | 中 | 移植 | 缺 id 时找运行中子代理会话；fork subagent 展示自研 |
| 39 | 50a445599 | fix | config/startup | 高 | 移植 | 坏 config 显示而非启动失败，317+；server lib/opencode 深度相交 |
| 40 | b3760852e | fix | startup UI | 中 | 移植 | 恢复屏说明失败原因 |
| 41 | 45205224b | fix | goals | 中 | 移植 | 长 objective 进 fork；fork session-goal 库 |
| 42 | 65b3a5135 | feat | sidebar | 中 | 移植 | next-step 未闭环标记；上游 `sidebar/sessions/` 路径需映射到 fork rowModel |
| 43 | 459d164be | fix | goals server | 高 | 移植 | 服务端 fork 目标继承修复；**必须保全 fork serverId+directory 权威** |
| 44 | 3b4d5b03b | fix | goals | 低 | 随块移植(goals) | 继承目标默认暂停 |
| 45 | 619c32fa8 | chore | OC bump | 中 | 随OC2升级 | bump 2.0.16，随隔壁 agent |
| 46 | 388cc3046 | test | ui | 低 | 随块移植(测试) | 过期 fixture |
| 47 | ee99e079d | fix | sessions 导入 | 中 | 移植【依赖OC2】 | v2 中已删的 1.x 会话不再重导入；fork retention 相交 |
| 48 | cb7400923 | fix | session-assist | 中 | 移植【依赖OC2】 | OC2 下回合后建议 |
| 49 | 59439040d | fix | sidebar | 中 | 随块移植(#42) | 徽标避让 hover 操作 + 图标说明 |
| 50 | 5dda4026a | fix | windows/分发 | 低 | 移植 | Windows ARM64 原生构建；fork 无 Windows 发行面，低优先 |
| 51 | 7f6475011 | docs | docs | 低 | 跳过 | 上游文档 |
| 52 | c841fe2ad | feat | mcp 设置 | 中 | 移植【依赖OC2部分】 | Code Mode 默认交 OC 决定 |
| 53 | 15e51be9e | feat | settings/lifecycle | 中 | 移植 | 手动 Restart OpenCode；fork lifecycle/事件 runbook 面 |
| 54 | d06fdc407 | feat | sidebar/settings | 高 | 移植 | worktree 排序设置（默认 manual）；**fork 新 sidebar 架构+自研排序/globalPinned 直交** |
| 55 | 6c5a1ff1b | feat | sdk/extensions | 高 | 移植 | 扩展加 Work Status 区块，126 文件 4171+；延伸 1.24 轮 guests/sdk 移植面 |
| 56 | 0ec304cb2 | fix | opencode managed | 中 | 移植【依赖OC2】 | 托管配置禁用内置浏览器插件 |
| 57 | e348013ca | feat | sdk/ui | 中 | 移植 | surface viewer 标识 + docked 页可调宽 |
| 58 | c06a9f53d | feat | chat 评论 | 高 | 移植 | 评论 popover（可编辑）；**聊天评论子系统起点**，fork 消息渲染自研 |
| 59 | 9b3fcc16c | feat | chat | 低 | 随块移植(#58) | 选区菜单随滚动跟随 |
| 60 | 0d358adea | feat | vscode | 低 | 移植 | 启用 prompt navigator |
| 61 | de5a6f4ed | fix | chat 状态 | 中 | 移植 | 状态快照到达前不报缺回复 |
| 62 | 1edf908ce | feat | browser-control | 高 | 移植 | agent 按 id 寻址浏览器 tab，462+；fork browser-control broker 自研相交 |
| 63 | c0fb97ac1 | feat | notifications | 中 | 移植 | 插件/agent 发通知，41 文件；fork notifications 库延伸 |
| 64 | 7c5637ab7 | feat | diff | 中 | 移植 | 文件树模式单文件打开，489+；fork diff 面相邻（DiffWorkerProvider 无直接命中） |
| 65 | 85be91762 | feat | git UI | 低 | 移植 | changes 树形读取 |
| 66 | 72e231d15 | fix | settings | 低 | 移植 | 去掉无用 runtime 检查 |
| 67 | 63bd5070c | release | release | - | 跳过 | 版本自管 |
| 68 | ed0b27cfc | test | ui | 低 | 随块移植(测试) | browser guard 路径 |
| 69 | ccad7ec55 | feat | spaces 3b | 高 | 待决【Spaces】 | 空间产出带出并应用，7042+ 行（本段最大）；依赖段 A stages 1-3a |
| 70 | 49c5e7560 | fix | agents | 低 | 移植 | 启动后重读一次 agent 列表 |
| 71 | 531d4f8d8 | fix | markdown | 低 | 移植 | 引号内 $ 不进行内公式 |
| 72 | c8efc7363 | style | chat | 低 | 移植 | 目标条 glass 覆盖 |
| 73 | a7b01887a | fix | models | 低 | 随块移植(#127) | Fast 模型按 catalog id 解析 |
| 74 | ffa12ea39 | fix | spaces+OC2 | 中 | 待决【Spaces】 | OC2 迁移后恢复空间保护与测试 |
| 75 | f9d212f38 | feat | spaces 4a | 高 | 待决【Spaces】 | 特性开关+dispatcher，2289+ |
| 76 | d67dcca2d | feat | spaces 4b | 高 | 待决【Spaces】 | 合并会话列表+space 事件+socket 转发；**与 fork 多服务器 sync 架构强相交** |
| 77 | 1290fd121 | feat | spaces 4c | 高 | 待决【Spaces】 | sidebar 空间+前缀聊天+设置开关，88 文件 |
| 78 | 05691e0b7 | test | fixture | 低 | 随块移植(测试) | persistence exports |
| 79 | 4195309ed | fix | chat | 低 | 移植 | context-chip 预览不出视口 |
| 80 | f7fc68ee4 | fix | relay/browser | 中 | 移植 | browser-control 事件走私有 relay；fork relay+remote-instances 自研相交 |
| 81 | 4b71a2112 | fix | sync | 低 | 随块移植(#95) | revert 恢复附带上下文 |
| 82 | 450692d18 | fix | markdown | 低 | 移植 | 表格标识符不换行 |
| 83 | 8630f9ea4 | fix | release | - | 跳过 | 上游发布基建 |
| 84 | 2c9eaa246 | fix | sync 状态 | 高 | 移植 | 归档快照不误报进行中回复；**fork session-authority/live-state 规则面** |
| 85 | 981aa5146 | style | chat | 低 | 移植 | auto-review 横幅 glass |
| 86 | 7e026cde7 | fix | mobile | 低 | 移植 | 信任弹层盖过 worktree sheet |
| 87 | fe30a560c | fix | chat | 低 | 移植 | 窄屏 dock 操作可见 |
| 88 | 86bb286fd | fix | relay | 低 | 移植 | relay 健康探测超时 |
| 89 | ca8ae6972 | feat | small-model | 中 | 移植 | Claude Code 可用+插件加载期重试；fork small-model 库 |
| 90 | 9e7cce16c | fix | models | 低 | 移植 | OC 实时上下文上限进元数据 |
| 91 | 1a541f97f | feat | chat timeline | 中 | 随SegA | 压缩/shell 通知作 timeline 行；fork 无 TimelineNotice（段 A 引入） |
| 92 | de5e22545 | fix | config | 高 | 移植 | provider/agent 目录按 worktree 目录作用域；与 fork 目录权威同向但实现相交 |
| 93 | 78b6af1d9 | ci | ci | - | 跳过 | 上游 CI |
| 94 | 03a0eead3 | fix | markdown | 低 | 随块移植(#82) | 超宽表格标识符换行 |
| 95 | 5a6cc6c2d | fix | sync | 中 | 移植 | revert/fork 带走 context carriers；fork fork/revert 流自研 |
| 96 | b504deb88 | fix | chat retry | 中 | 移植【依赖OC2】 | OC2 retry 事件倒计时 |
| 97 | eed16b8c8 | fix | config | 低 | 移植 | 读 opencode.json 全局旁的 jsonc |
| 98 | 25ccc6b95 | fix | settings | 中 | 移植 | 拒绝覆盖他处编辑过的 AGENTS.md |
| 99 | 69ac0b7e1 | fix | chat forms | 低 | 移植 | 切会话保留表单答案 |
| 100 | e45e79b77 | fix | agents/composer | 低 | 移植 | 插件新增 agent 时刷新 composer |
| 101 | 367e5c926 | fix | startup | 低 | 移植 | 上次项目目录丢失仍可启动 |
| 102 | aea1d2a0e | fix | remote/ssh | 中 | 移植 | 托管远端找 nvm npm；fork remote-instances |
| 103 | bc323582b | fix | vscode auth | 中 | 移植【依赖OC2】 | 对 OC 后台服务认证 |
| 104 | c570fa82c | fix | settings | 低 | 随块移植(#98) | 拾取外部编辑器对 AGENTS.md 的修改 |
| 105 | 38ea51fce | feat | sidebar | 中 | 移植 | 目录缺失项目标记 |
| 106 | e0ee886e8 | feat | spaces 5a | 高 | 待决【Spaces】 | journey 服务端路由+实时开关，1564+ |
| 107 | ec306ec02 | chore | spaces | 低 | 待决【Spaces】 | 设置里隐藏 isolated-spaces 开关 |
| 108 | 7175b51fb | fix | composer | 低 | 移植 | 发送按钮旁幻影滚动条 |
| 109 | 7a5568769 | perf | model-picker | 低 | 移植 | 长 provider 区块虚拟化（与 fork 性能规则同向） |
| 110 | 9c1556b39 | release | release | - | 跳过 | 版本自管 |
| 111 | 102bff7e9 | feat | spaces 5b | 高 | 待决【Spaces】 | 服务端 grants+网络窗口绑定内网；安全敏感 |
| 112 | 9c6f33e25 | chore | OC bump | 中 | 随OC2升级 | bump 2.0.18 |
| 113 | cc99bec6c | fix | chat/shell | 低 | 移植 | 信号杀死的 shell 命令显示失败 |
| 114 | a8b1e93dd | feat | sidebar | 低 | 移植 | timeline 行显示 provider logo |
| 115 | 22a929a08 | fix | plugins | 中 | 移植 | 尊重 npm registry 配置；fork package-manager.js 相交 |
| 116 | 29c6be6cf | fix | plugins | 低 | 随块移植(#115) | registry 提示不点名 npm |
| 117 | dab2f8b19 | test | vscode | 低 | 随块移植(测试) | config 测试隔离用户配置 |
| 118 | 60d836c48 | feat | settings | 高 | 移植 | providers 卡片网格+账户切换，1186+/638-；**fork providers 页+settings registry 大相交** |
| 119 | 4e5f26d07 | feat | settings | 高 | 移植 | MCP/plugins 卡片网格+列表搜索+移动紧凑行，1394+/1543-；与 #118 同批 |
| 120 | 0ebe53fc8 | fix | chat subagent | 中 | 移植 | 显示命令启动的后台子代理，682+ |
| 121 | 8acc35453 | fix | sidebar/worktrees | 中 | 移植 | 切远端实例后重发现 worktree；fork worktree 发现/remote 自研 |
| 122 | 1bc709ed0 | feat | permissions/routing | 高 | 移植 | ask/safety net/accept-all + classification providers，89 文件 2265+；**fork permission-auto-accept/permissionStore 大相交**；classification 面【依赖OC2部分】 |
| 123 | ea15762ee | feat | sessions-in-work | 高 | 移植 | 会话保持“工作中”直到用户标记完成，74 文件 2349+；**新子系统**，sidebar/sync/session-assist 相交 |
| 124 | 91daa42bf | docs | docs | - | 跳过 | packages/docs 照例跳 |
| 125 | 54fc3f28a | feat | mobile | 中 | 移植【⚠协调】 | 抽屉 recent/固定/短滑动行；MobileSessionsSheet 鸿蒙邻域 |
| 126 | 7c4667b74 | fix | sessions-in-work | 低 | 随块移植(#123) | 完成判定读整回合 |
| 127 | c82fae5ee | fix | models | 中 | 移植 | Fast 模型按 catalog id（含 #73） |
| 128 | b7f50fa0d | fix | sidebar/sync | 中 | 移植 | 元数据广播应用到全局列表；fork 全局列表自研 |
| 129 | 559c78de5 | fix | sessions-in-work | 低 | 随块移植(#123) | done 阈值 0.8 |
| 130 | 53795a605 | test | permissions | 低 | 随块移植(#122) | 等 reconnect 回复 |
| 131 | 211a5e713 | feat | spaces 5c | 高 | 待决【Spaces】 | 创建流程+设置实时开关，87 文件 2506+ |
| 132 | 8a773cce8 | fix | sidebar | 低 | 随块移植(#123) | done 提示挨着时间 |
| 133 | 0b936476e | feat | routing | 高 | 移植 | Jev 走 OpenRouter/Vercel AI Gateway，602+；fork routing/jev 库；Jev 面【依赖OC2部分】 |
| 134 | f42715c25 | feat | ui | 低 | 移植 | 快捷键弹窗两列 |
| 135 | ff555e677 | fix | ui | 低 | 移植 | 状态点贴时间+计划任务背景 |
| 136 | d9fbf6b78 | feat | multirun | 高 | 移植【⚠协调】 | composer 多模型并发，101 文件 6133+/2266-；fork multirun 基座+queue；**触 MobileApp/Header/MainLayout（鸿蒙未提交）** |
| 137 | 9f8af62d4 | feat | vscode multirun | 中 | 随块移植(#136) | Agent Manager 换共享 multirun（-3328 行） |
| 138 | 8dd842a3b | fix | opencode auth | 中 | 移植【依赖OC2】 | 托管 OC2 按其实际密码认证 |
| 139 | 275b636fc | fix | mobile | 中 | 移植 | Android 下载+聊天文件链接 |
| 140 | 220d7e0ae | feat | settings | 高 | 移植 | Claude Code 集成卡回归，1522+；依赖 #118/#119 网格形态；fork claude-cli-auth 相交 |
| 141 | f757d99fc | fix | windows/server | 低 | 移植 | 无界 spawnSync 挂启动 |
| 142 | 5d8029739 | fix | vscode | 低 | 随块移植(#141) | 同上（vscode 侧） |
| 143 | 02211ba73 | fix | web favicons | 低 | 移植 | Windows favicon 查找 |
| 144 | b60150132 | fix | sync watchdog | 中 | 移植 | keepalive 计入活动；fork stale-stream watchdog 规则相交 |
| 145 | 82bc5733e | fix | header/归档 | 中 | 移植【⚠协调】 | 头部菜单恢复归档会话；**Header.tsx 鸿蒙在改** |
| 146 | 8de16d7fb | fix | github | 低 | 移植 | enrichment 失败则 PR 搜索失败（不吞错，与 fork 契约同向） |
| 147 | 5208fd961 | fix | chat/composer | 低 | 移植 | 大粘贴选择后恢复焦点 |
| 148 | ba68df0e8 | fix | sync | 低 | 移植 | 恢复后状态读按会话目录作用域（与 fork 目录权威同向） |
| 149 | f159fba8b | test | electron | 低 | 随块移植(#102) | nvm/SSH 登录 shell 测试 |
| 150 | 3784892c6 | fix | browser-control | 低 | 移植 | stop-loading 后死 localhost 保持失败 |
| 151 | bd01f9566 | fix | worktrees | 低 | 移植 | attach 期间保持新建选择 |
| 152 | 75da88dfa | fix | worktrees | 中 | 移植 | 删除后刷新 Manage worktrees |
| 153 | 5c03ecc6e | fix | sync/ui | 中 | 移植 | 外部删除事件错过也关会话；fork delete-shield 相交 |
| 154 | 54d51fad6 | fix | quota | 中 | 移植 | Zhipu CREDIT_LIMIT 窗口+体内错误；fork quota |
| 155 | 1f0004f2a | fix | composer | 中 | 移植 | 链接引用单独发送；fork queue |
| 156 | 117e45456 | feat | spaces 5d-1 | 高 | 待决【Spaces】 | 进入空间+被拦尝试，57 文件 |
| 157 | 0a19aa804 | fix | git/opencode | 高 | 移植【依赖OC2部分】 | 移除 worktree 时释放 OC 实例，604+；fork worktree store；**部分被 #172 取代** |
| 158 | 09ec21a72 | perf | ui 全局 | 中 | 移植 | tooltip/menu 不再全 app restyle；与 fork 性能规则同向 |
| 159 | caa9d84d9 | fix | windows | 低 | 随块移植(#141) | 其余启动探测设界 |
| 160 | 5a7956915 | fix | mobile/sync | 低 | 移植【⚠协调】 | 移动端清理外部删除会话；触 MobileApp |
| 161 | 85dc07f69 | refactor | worktrees | 低 | 随块移植(worktrees) | 去掉死 store 镜像 |
| 162 | 24bb51512 | test | composer | 低 | 随块移植(测试) | 引导中 worktree 保持草稿选择 |
| 163 | a367cbce4 | fix | vscode/quota | 低 | 随块移植(#154) | Zhipu 信封解析对齐 |
| 164 | 152bddab5 | test | electron | 低 | 随块移植(测试) | Windows 跳过 nvm 测试 |
| 165 | 32d0b4de0 | fix | model-picker | 低 | 随块移植(#109) | 长区块滚到底 |
| 166 | a2297eb1b | fix | chat | 低 | 移植【依赖OC2】 | OC2 子代理输出按 Markdown 渲染 |
| 167 | 50766fa0f | fix | providers | 中 | 移植【依赖OC2】 | OC2 下带 key 保存自定义 provider |
| 168 | ae6659944 | fix | worktrees | 中 | 移植 | Windows 占用下完成移除 |
| 169 | 26d114ef4 | fix | cli/tunnel | 中 | 随SegA | 隧道实例给 UI 密码；**fork 无 bin/lib/commands-tunnel.js（段 A）** |
| 170 | 03706c92c | fix | extensions | 低 | 移植 | schannel-only Git 装 git 扩展 |
| 171 | d0af2666e | fix | extensions UI | 低 | 移植 | 暗色面板白闪 |
| 172 | 309ddc2b1 | fix | git/opencode | 中 | 移植【依赖OC2】 | 经 OC2 client 释放 worktree（取代 #157 一部分） |
| 173 | 67dd1ad5c | fix | startup/MCP | 中 | 移植 | 启动不再拉起所有项目 MCP |
| 174 | 814f7caf3 | fix | agents/config | 低 | 移植 | 收藏按被编辑项目解析 |
| 175 | 5badd2472 | feat | mobile | 低 | 移植 | 复制会话 ID 滑动操作 |
| 176 | a30029f90 | feat | files/Excalidraw | 中 | 跳过(中间态) | 内置 Excalidraw 1317+；**一天后被 #192 移入扩展，按最终态移植** |
| 177 | 18ca96969 | feat | stats | 中 | 移植 | token 构成/效率/工具调用，736+；fork UsagePage 延伸 |
| 178 | 282914bc9 | fix | stats | 低 | 随块移植(#177) | 工具调用按需加载+文案 |
| 179 | 46dfffa2e | fix | files/Excalidraw | 低 | 跳过(中间态) | 并入 #192 最终态 |
| 180 | 10bf8b559 | fix | sidebar | 低 | 随块移植(#123) | 分组行 done 提示位置 |
| 181 | a0c0bce3e | fix | chat subagent | 中 | 移植 | 并行子代理调用关联回子会话 |
| 182 | e840823dc | release | release | - | 跳过 | 版本自管 |
| 183 | ed371c2cd | fix | build | - | 跳过 | 上游 runner 堆配置 |
| 184 | 8c70e9812 | ci | ci | - | 跳过 | 上游 CI |
| 185 | 80c888eb6 | ci | ci | - | 跳过 | 上游 CI |
| 186 | e0645023d | fix | chat 评论 | 低 | 随块移植(#58) | 评论框文字清晰度 |
| 187 | 6f43b5ec7 | fix | sync/goals | 中 | 移植 | 压缩后恢复 pinned 上下文与目标进度 |
| 188 | d945cdaf6 | refactor | chat | 低 | 移植【依赖OC2】 | 清理 v1 compaction 检查 |
| 189 | ef010f42a | fix | sidebar/mobile | 中 | 移植 | timeline/移动行显示目标+待批请求 |
| 190 | 9a2f2d8b5 | fix | ui glass | 低 | 移植 | glass 阴影灰带 |
| 191 | fae74f78d | feat | goals/Jev | 高 | 移植 | Jev 检查目标进度（small-model 兜底），674+；fork session-goal+small-model+routing 三库相交 |
| 192 | c8ce4565b | feat | sdk/extensions | 高 | 移植 | SDK 文件编辑器 + Excalidraw 迁入扩展，123 文件 4554+/2405-；**Excalidraw 最终态（含 #176/#179）** |
| 193 | 953d00e0f | fix | chat/sync | 低 | 移植 | 答后 fork 不复制更晚压缩 |
| 194 | 25c28a4b6 | docs | changelog | - | 跳过 | 上游 changelog |
| 195 | 049ad42ae | docs | readme | - | 跳过 | 上游 readme |
| 196 | 4454c44f7 | fix | mobile | 低 | 移植 | pending-request hook 移出徽标组件（重渲染） |
| 197 | 3509f5c44 | test | 修复 | 低 | 随块移植(测试) | 上游套件修复 |
| 198 | 8e8e0e1bd | test | chat | 低 | 随块移植(测试) | renderer 测试 DOM fake |
| 199 | 41c7c10c9 | fix | files 预览 | 中 | 移植 | README HTML+徽章渲染，464+；依赖段 A 富预览面 |
| 200 | cd51cb09c | fix | routing | 中 | 随块移植(#122) | classification 显式 Off 可选 |
| 201 | ca6ff558d | fix | ui glass | 低 | 移植 | composer 附近 glass 去阴影 |
| 202 | 4032c1f11 | ci | ci | - | 跳过 | 上游 CI（Blacksmith） |
| 203 | 3c54187cc | feat | spaces 5d-2 | 高 | 待决【Spaces】 | 空间状态+修复，60 文件 |
| 204 | dc454ca6b | fix | sdk 事件 | 低 | 移植【依赖OC2】 | shell ended 事件对齐 pinned SDK |
| 205 | 9536b3e07 | fix | terminal/env | 中 | 移植 | 登录 shell 启动输出不进环境 |
| 206 | 352454547 | fix | chat RTL | 中 | 移植 | 混排文本方向按块/composer 行解析 |
| 207 | 52206d97a | fix | chat errors | 低 | 移植 | 切会话重置错误；fork SessionErrorNotice |
| 208 | 67bba611a | fix | chat errors | 中 | 随块移植(#207) | 切换时保留新错误（与 #207 互补） |
| 209 | 167883d45 | feat | spaces 5d-3 | 高 | 待决【Spaces】 | 空闲空间自停，74 文件 |
| 210 | 6d3c7fc0b | fix | small-model | 中 | 移植 | 留在用户当前 provider |
| 211 | c54e90427 | fix | extensions 安全 | 高 | 移植 | 扩展 frame 断网，644+；fork guests 移植面；安全边界 |
| 212 | 14f529c6c | feat | enterprise | 高 | 待决【Enterprise】 | enterprise 模式+自定义 Jev endpoint，86 文件 2345+；依赖段 A dictation/websearch + #122 |
| 213 | d67e8040c | fix | goals | 低 | 随块移植(#191) | 默认 small-model 除非指定 Jev |
| 214 | 80d0f6e46 | docs | changelog | - | 跳过 | 上游 changelog |
| 215 | dc0a6089c | feat | enterprise 策略 | 高 | 待决【Enterprise】【⚠协调】 | 机器策略文件（含 VS Code）；触 MobileApp |
| 216 | de319de21 | feat | i18n | 中 | 移植 | 荷兰语 nl locale，108 文件 10902+；机械量大；并入 locale 批次 |
| 217 | 2f88cd6c3 | fix | sidebar | 低 | 移植 | Shift keyup 丢失不再只剩 Delete |
| 218 | 098434da0 | test | web | 低 | 随块移植(Enterprise) | config-paths fixture；随 Enterprise 拍板 |
| 219 | 4ef0ed80b | fix | settings/routing | 低 | 待决【Enterprise】 | enterprise 关 Jev 时藏 Routing |
| 220 | 3792ec325 | feat | enterprise 网络 | 高 | 待决【Enterprise】 | 管理员未允许则不出网 |
| 221 | 1e8b2c268 | fix | files 预览 | 低 | 随块移植(Files/评论) | 移动端评论条停靠底部 |
| 222 | 55bc0ba2d | fix | chat a11y | 中 | 移植 | 折叠用户消息加可见键盘展开控件 |
| 223 | a86e93351 | fix | settings | 中 | 移植【⚠协调】 | 首开无延迟；触 MainLayout（鸿蒙在改） |
| 224 | 688c31477 | feat | spaces 5d-4 | 高 | 待决【Spaces】 | 空间内跑项目 setup 命令，68 文件；触 MobileApp/MainLayout |
| 225 | f42e632a1 | fix | git UI | 低 | 移植 | PR base 空白点击不开下拉 |
| 226 | 620f028ba | fix | multirun | 低 | 随块移植(#136) | 非 secure origin 可启动 |
| 227 | 4e9ff5824 | fix | diff | 低 | 移植 | alt+arrow 在文件边界内循环 |
| 228 | e1f9dfd36 | fix | agents | 中 | 移植 | 用 config isBuiltIn 分类内置 agent |
| 229 | 2a387e6f1 | fix | electron/mac | 高(流程) | 待用户拍板【壳刷新】 | Info.plist 加 NSLocalNetworkUsageDescription（LAN 访问）；**electron-builder extendInfo 变更=新 Developer ID 公证壳**，按 EMBEDDED_OPENCODE_PACKAGING runbook 走 |
| 230 | 07461335a | docs | changelog | - | 跳过 | 上游 changelog |
| 231 | f84e31f7e | docs | changelog | - | 跳过 | 上游 changelog |
| 232 | b2a5f9ed6 | fix | sidebar/i18n | 低 | 移植 | 紧凑时间去 "ago" |
| 233 | 64d80f48a | feat | files 图片 | 中 | 移植 | 图片查看器缩放/平移，406+ |
| 234 | 7a19d120e | ci | ci | - | 跳过 | 上游 CI |
| 235 | 4f0f59a47 | fix | chat 评论 | 中 | 随块移植(#58) | 评论留在发送时所附消息，253+ |
| 236 | c1cd3e5dd | feat | enterprise/扩展 | 高 | 待决【Enterprise】 | 仅批准仓库的扩展+边界 skill，1058+ |
| 237 | 8aebeaa77 | fix | extensions UI | 低 | 移植 | 桌面/dev UI 包图标恢复 |
| 238 | 6d166beb5 | fix | agent-tool | 高 | 移植 | OpenChamber 工具作为直接工具暴露，376+；fork agent-tool 管理插件面 |
| 239 | de69117bf | fix | worktrees UI | 低 | 移植 | New Worktree 长错误换行 |
| 240 | 862691a82 | fix | classification UI | 中 | 随块移植(#122/#212) | 自定义 endpoint 独立区块；Enterprise 关联部分随拍板 |
| 241 | a5b7ee80a | release | release | - | 跳过 | 版本自管 |

## 策略统计（241 全覆盖）

| 策略 | 数量 |
| --- | ---: |
| 直接移植 | 137 |
| 随块移植（功能块内 fix/style/测试，31 功能 + 14 测试） | 45 |
| 移植【依赖OC2】 | 15 |
| 随OC2升级（bump 2.0.16/2.0.18） | 2 |
| 随SegA（依赖段 A 先行：websearch、TimelineNotice、tunnel CLI） | 3 |
| 待决【Spaces】 | 13 |
| 待决【Enterprise】（+240 半随块、218 随块测试） | 5 |
| 待用户拍板【壳刷新】（#229） | 1 |
| 跳过（上游基建 18 + Excalidraw 中间态 2） | 20 |
| **合计** | **241** |

风险分布：**高 42**（其中 Spaces 块内 11、Enterprise 块内 4、壳流程 1 → 非待决高风险 26）；中约 72；低约 127。

## 功能块小结

1. **Spaces 子系统（13c，≈24k 行）**：3b/4a/4b/4c/5a/5b/5c/5d-1..4 + OC2 适配 + 隐藏开关。依赖段 A stages 1-3a（fork 尚无 `lib/spaces/`）。4b 的 socket 转发与 fork 多服务器 sync、5b 的网络 grants 属安全敏感面。整体待拍板，建议照扩展系统先例单独立项评估。
2. **Enterprise + 网络边界（5c+2 随块）**：enterprise 模式、机器策略文件、管理员允许前不出网、扩展仅批准仓库、自定义 Jev endpoint、Routing 隐藏。依赖段 A dictation/websearch 与 #122 classification。
3. **权限重做（#122 主 commit 89 文件 + #200/#240 + 测试）**：ask/safety net/accept-all 三模式 + classification providers。fork permission-auto-accept/permissionStore/settings registry 大相交，是本段最深的一次性改造之一。
4. **Sessions-in-work/done-hint（#123 74 文件 + 7 个后续）**：新“工作中直到标记完成”子系统，跨 sync/sidebar/session-assist；fork 无对应物，为净新增。
5. **Multirun composer（#136 101 文件 6133+ + #137/#226）**：fork 已有 multirun 基座（useMultiRunStore），本块是 composer 级多模型并发；触 3 个鸿蒙未提交文件。
6. **Settings 大改版（#118/#119/#140/#223）**：providers/MCP/plugins 卡片网格+搜索+账户切换、Claude Code 卡回归、首开提速；fork settings registry 全程相交，建议作为单独批次。
7. **聊天评论 popover（#58 起共 5c + files 评论条 2c）**：选区评论、可编辑 popover、消息绑定；fork 消息渲染自研，需逐一适配。
8. **SDK/extensions 大块（#55 4171+、#57、#192 4554+）**：Work Status 扩展区、surface viewer/docked resize、SDK 文件编辑器 + Excalidraw 终态。延伸 1.24 轮 guests/sdk 移植面。
9. **OC2 适配簇（15c gated + 2 bump）**：skills 路径/symlink、slash 路由、retry 事件、子代理 markdown、托管密码认证、worktree 释放、v1 compaction 清理、1.x 会话重导入抑制。全部待隔壁 agent OC2 落地后激活。
10. **Goals/Jev/small-model（7c）**：目标检查用 Jev/small-model 兜底、Jev 走网关、small-model 粘 provider；fork 三库相交。
11. **Worktrees 簇（8c）**：删除/占用/释放/Manage 刷新/错误包装。
12. **Files/编辑器（6c）**：图片缩放平移、README HTML 徽章、Excalidraw（按终态）、评论条移动端。
13. **Sidebar 行为簇（≈14c）**：next-step 标记、缺失目录、worktree 排序、provider logo、done 提示、timeline/移动行目标显示。全部需映射 fork rowModel 布局。
14. **其他**：quota（Kimi/Zhipu×2）、stats 扩展、i18n nl、性能 4c（markdown 流式、tooltip restyle、picker 虚拟化）、启动/Windows 健壮性 ≈10c、sync/会话生命周期修复 ≈10c、测试基建 13c。

## 需用户拍板项

1. **Spaces 子系统**（13c，本段）：是否立项移植。依赖段 A stages 1-3a + Docker 面；若立项建议单独排批（参照扩展系统先例），并预审 4b socket 转发 vs fork 多服务器 sync、5b 网络窗口的安全设计。
2. **Enterprise 模式**（5c）：机器策略/断网/扩展白名单是否需要。若跳过，需同时决定 #218（测试）与 #240 中 enterprise 关联 UI 的取舍。
3. **#229 NSLocalNetworkUsageDescription**：electron-builder `extendInfo` 变更 → 新 Developer ID 公证壳。是否纳入下一次 shell refresh（不可用 runtime:install 通道）。
4. **OC2 gated 16c 的激活时点**：与 `../opencode` 升 2.x 的 agent 对齐；两个版本 bump（2.0.16/2.0.18）随 OC 侧统一。
5. **Excalidraw 中间态**：#176/#179（内置形态）建议跳过、只按 #192 扩展终态移植——请确认。
6. **鸿蒙 foreign files 协调**：#16/#20/#136/#145/#160/#215/#223/#224 等触 MobileApp/Header/MainLayout/useUpdateStore——需与鸿蒙会话排序移植先后。
7. **nl locale**：政策已定 12 locale（含 nl），确认并入哪个 i18n 批次。
