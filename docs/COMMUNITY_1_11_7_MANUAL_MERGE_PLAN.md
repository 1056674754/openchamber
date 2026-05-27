# 社区 v1.11.7 手工合并计划

更新时间：2026-05-27

## 当前结论

本轮社区区间是 `v1.11.5..v1.11.7`。

这不是一个小补丁区间：上游共有 31 个 commit，累计 201 个文件变更，约 17924 行新增、1288 行删除。可以继续合，但必须分批手工移植，不能直接 merge、cherry-pick 或覆盖文件。

当前本地包版本已经是 `1.11.5`，但工作区还有上一轮 `1.11.5` 手工合并和后续 bug 修复的大量未提交改动。正式动手合 `1.11.6/1.11.7` 前，建议先确认是否要把当前状态做一次 checkpoint commit，否则后续排错会很难分清是哪一轮引入的问题。

## 合并规则

1. 只读上游 git 历史和 diff，不直接执行 `git merge` / `git cherry-pick` / 覆盖式 checkout。
2. 每个上游 commit 都按“官方旧版 -> 官方新版”先理解，再手工改我们的当前文件。
3. 以我们 fork 为根本：保留多服务器、`serverId`、`sessionId`、directory 权威上下文、remote instance、父子 session、OpenChamber server 父子结构。
4. 任何 session、permission、question、git、file、terminal、plugin、tunnel、settings 相关改动，都必须检查是否会误用全局 active project/current directory。
5. Release-only、CI-only、Windows-only 改动单独决策，不混进运行时功能合并。

## 上游范围

| 区间 | Commit 数 | 文件变更 | 规模 |
| --- | ---: | ---: | --- |
| `v1.11.5..v1.11.6` | 10 | 79 | 6173 新增 / 180 删除 |
| `v1.11.6..v1.11.7` | 21 | 145 | 11760 新增 / 1117 删除 |
| `v1.11.5..v1.11.7` | 31 | 201 | 17924 新增 / 1288 删除 |

## 主要新功能和修复

| 编号 | 功能块 | 类型 | 风险 |
| --- | --- | --- | --- |
| 1 | 插件管理页面、npm registry 检查、user/project scope plugin API | 新功能 | 高 |
| 2 | Ngrok tunnel provider、desktop tunnel 设置、CLI tunnel 支持 | 新功能 | 中 |
| 3 | Desktop 本地 UI password 设置 | 新功能 | 中 |
| 4 | Electron launch-at-startup 设置、CLI startup launch | 新功能 | 中高 |
| 5 | Windows Electron desktop 支持 | 平台/发布 | 高，建议分离决策 |
| 6 | Git history graph、commit row actions、VS Code/web git API 扩展 | 新功能 | 高 |
| 7 | 繁体中文 `zh-TW` locale | 新功能 | 低 |
| 8 | Usage card 隐藏 prediction rows 设置 | 新功能 | 低中 |
| 9 | Agent 选择时自动切到 agent 配置模型 | 修复 | 中 |
| 10 | malformed tool diff 防崩溃 | 修复 | 中 |
| 11 | VS Code live streaming 恢复、git/fs/proxy 去重 | 修复/性能 | 中 |
| 12 | Multi-Run slash command 和新 run 立即显示 | 修复 | 中高 |
| 13 | 启动 request fanout 降低、worktree 状态请求减少 | 性能 | 高，和我们的 remote sidebar 刚修过的逻辑相关 |
| 14 | 移动端 composer 键盘处理简化 | 修复 | 中 |
| 15 | inline session rename focus race 修复 | 修复 | 中，和我们已有 inline rename/tooltip 修复重叠 |
| 16 | todos 完成项置底、send dialog model picker 改进 | 修复 | 低中 |
| 17 | context panel 边界、browser webview 折叠状态保存 | 修复 | 中 |
| 18 | tool expansion 动画最终改为禁用 | 修复 | 低中 |
| 19 | Electron dev instance 隔离 | 修复 | 低 |

## Commit 逐项计划

| 顺序 | Commit | 内容 | 处理策略 |
| ---: | --- | --- | --- |
| 1 | `40c23e02` | 降低启动请求 fanout | 手工合。重点检查 remote project、worktree、PR status、sync child store，不能破坏我们刚修的折叠和 session 跳转。 |
| 2 | `53511b6e` | VS Code git/fs read dedupe | 手工合。只影响 VS Code bridge，可相对独立验证。 |
| 3 | `85308983` | Desktop UI password setting | 手工合。确认只作用本地 desktop server，不误伤 SSH remote OpenChamber password。 |
| 4 | `7954fd55` | 移动端侧栏恢复新会话按钮 | 手工合。注意 mobile/sidebar header 和我们多项目动作上下文。 |
| 5 | `685e63b3` | Multi-Run slash command 修复 | 手工合。必须保留队列发送时 captured session/provider/model/agent/server 上下文。 |
| 6 | `1d4ec42d` | Multi-Run session 立即显示 | 手工合。检查 optimistic session 插入和 serverId/directory 归属。 |
| 7 | `3b2199af` | Ngrok tunnel provider | 手工合。服务端 provider、desktop UI、CLI 三块分开做；docs 可按需。 |
| 8 | `a7c142b9` | tunnel warning 文案修正 | 跟随 Ngrok 一起合。 |
| 9 | `9ef786ea` | Plugin settings | 手工合但作为单独大块。先合 server plugin spec/routes/tests，再合 UI store/page。project scope 必须显式 directory。 |
| 10 | `b1f2f8df` | release v1.11.6 | release-only。最后统一版本号/changelog。 |
| 11 | `937a6b65` | 移动端 composer keyboard 简化 | 手工合。我们的 ChatInput 已有 1.11.5 手工改动，必须逐段比对，避免删掉附件预览/队列/server-aware 逻辑。 |
| 12 | `b364f1b6` | malformed tool diff 防崩溃 | 手工合。优先抽 `toolDiffUtils` 和测试，再改 `ToolPart`。 |
| 13 | `29f6d4a0` | launch-at-startup | 手工合运行时部分。CLI parity 要按核心逻辑校验，不只靠 prompt；Electron 部分保留我们 in-process server 架构。 |
| 14 | `6dbe3f02` | context panel 不越界 | 手工合。和我们右侧栏/context panel 状态并存。 |
| 15 | `b92abb8c` | usage prediction rows toggle | 手工合。settings persistence 要兼容 desktop/web/vscode。 |
| 16 | `ab1770e1` | 选择 agent 时切 model | 手工合。不能覆盖我们的 model/agent skeleton、remote provider loading 和 captured queue config。 |
| 17 | `b17477e1` | 繁体中文 locale | 手工合。新增 `zh-TW` 文件和 locale registry，尽量机械移植。 |
| 18 | `65de5ec1` | opencode/triage GitHub Actions | CI-only，默认跳过或单独评估。 |
| 19 | `bfe79ac1` | VS Code live streaming | 手工合。检查 SSE proxy lifecycle，避免影响 web/desktop 全局 event stream。 |
| 20 | `d5e69ae3` | completed todos stay at end | 手工合。局部 UI 逻辑。 |
| 21 | `bdaade01` | inline rename focus race | 手工合。和我们已有 session rename/tooltip 修复对比后最小改动。 |
| 22 | `0e38e2e0` | Windows Electron desktop support | 拆开处理。运行时跨平台安全修复可合；Windows 发布/打包策略和 CI 默认延后。 |
| 23 | `267b5011` | GitHub Actions runtime actions | CI-only，默认跳过或最后统一处理。 |
| 24 | `f4989c2e` | disable Windows release artifact | CI-only，跟 Windows 支持一起决策。 |
| 25 | `3b680eb3` | browser icon toggle + webview state | 手工合。注意 context panel、browser collapsed state 和我们的右侧栏 tab 状态。 |
| 26 | `db275332` | todo send dialog model picker | 手工合。和 agent/model selector 改动一起验证。 |
| 27 | `55380901` | Git graph + commit actions | 大块手工合。先 server/web/vscode git API，再 UI graph。所有 git API 必须显式 directory。 |
| 28 | `5e565c98` | smooth tool expansion animation | 只作为中间态参考。 |
| 29 | `38ee8294` | disable tool expansion animation | 采用最终态；和上一个 commit 合并理解后落最终效果。 |
| 30 | `ae031678` | Electron dev instance 隔离 | 手工合。确认不影响我们 Electron 主进程内 server。 |
| 31 | `5eccf83b` | release v1.11.7 | release-only。最后统一版本号、changelog、lock。 |

## 建议手工合并顺序

### 第 0 步：保护现场

- 确认当前 1.11.5 工作区是否先 checkpoint commit。
- 跑一次当前基线：`bun run type-check`、`bun run lint`。
- 记录当前已知 warning，避免把旧 warning 当新问题。

### 第 1 批：低风险独立修复

- `53511b6e` VS Code fs/git read dedupe
- `7954fd55` mobile new-session action
- `6dbe3f02` context panel bounds
- `d5e69ae3` todos completed order
- `bdaade01` rename focus race
- `ae031678` Electron dev isolation

这批用于快速降低明显 bug，冲突面较小。

### 第 2 批：我们的上下文高风险路径

- `40c23e02` startup fanout
- `685e63b3` / `1d4ec42d` Multi-Run
- `937a6b65` mobile composer keyboard
- `ab1770e1` agent model selection

这批必须严格按 session/directory/serverId 权威上下文审查。尤其要验证：

- 点击任意 session 不会跳到第一个项目。
- 已折叠 remote project 不会登录后展开。
- queued message 仍发送到排队时的原 session。
- Multi-Run 生成的 session 归属正确 server/directory。

### 第 3 批：插件系统

- `9ef786ea`

先合 server：

- `plugin-spec`
- `plugins`
- `npm-registry`
- `plugin-routes`
- tests

再合 UI：

- `usePluginsStore`
- Plugins settings page/sidebar/dialog
- i18n/settings metadata

重点：project scope plugin 必须传明确 directory；不能用 active directory 猜。

### 第 4 批：tunnel / desktop network

- `85308983`
- `3b2199af`
- `a7c142b9`
- `29f6d4a0` 中和 desktop/network 相关的部分

重点：

- Desktop local UI password 和 SSH remote OpenChamber password 不能混。
- Ngrok provider 要和现有 Cloudflare tunnel provider 并存。
- CLI 启动登录项要核心逻辑校验，不只靠交互 prompt。

### 第 5 批：Git graph

- `55380901`

这是本轮最大用户功能之一。建议独立做：

1. 合 server git service/routes。
2. 合 web/vscode git API 类型。
3. 合 UI git graph 算法和测试。
4. 合 History modal UI 和 commit row actions。

重点：我们 fork 对 git 子目录、worktree、remote directory 已经改过，不能被上游较简单的 directory 寻址覆盖。

### 第 6 批：chat/tool 渲染和 UI 最终态

- `b364f1b6`
- `5e565c98`
- `38ee8294`
- `3b680eb3`
- `db275332`
- `b92abb8c`

其中 tool expansion 要以 `38ee8294` 最终态为准，不先落动画再删除。

### 第 7 批：locale / 平台 / release

- `b17477e1` 繁体中文
- `0e38e2e0` Windows Electron 支持中可移植的 runtime 修复
- `65de5ec1`、`267b5011`、`f4989c2e` CI-only 默认延后
- `b1f2f8df`、`5eccf83b` 版本号/changelog 最后处理

## 默认跳过或延后项

| 项目 | 原因 |
| --- | --- |
| GitHub Actions workflow 新增/升级 | 不影响本地运行；和我们发布流程可能不同 |
| Windows release artifact 策略 | 需要单独确认是否发布 Windows |
| `.opencode/agent/triage.md` | 上游仓库自动 triage 资产，不是运行时功能 |
| docs 多语言全文 | 可按功能合并后补；不阻塞运行时 |

## 验证计划

每批至少：

- `bun run type-check`
- `bun run lint`

重点测试按模块追加：

| 模块 | 建议测试 |
| --- | --- |
| plugins | `plugins.test.js`、`plugin-routes.test.js`、`plugin-spec.test.js`、`npm-registry.test.js` |
| tunnels | tunnel provider 单测 + desktop settings 手动点选 |
| Multi-Run | `useMultiRunStore.test.ts`，实际创建 run 并发 prompt/slash command |
| Git graph | `gitGraph.test.ts`、`git service/routes` 测试，真实 repo 子目录打开 history |
| VS Code streaming | `sseProxy.test.js`、`bridge-proxy-runtime.test.js` |
| session/sidebar | 登录、折叠 remote project、切任意会话、子 session、archive/delete |
| chat/tool | malformed diff、tool 展开/收起、reasoning、移动端 composer |

## 发布前人工回归

1. Electron dev 和 packaged app 都能启动。
2. 本地项目、SSH remote 项目、多个 remote server 同时存在。
3. 登录后已折叠项目保持折叠，不触发全量 remote session 展开。
4. 点击任意项目任意 session 都打开目标 session，不跳第一个项目。
5. 新 session、子 session、Multi-Run、queued message 都走正确 `serverId/sessionId/directory`。
6. Git history graph 在本地 repo、repo 子目录、worktree 下都可用。
7. Plugin user/project scope 不串目录。
8. Tunnel 设置中 Cloudflare 和 Ngrok 都能独立工作或给出明确错误。

