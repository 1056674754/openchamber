# v2.1.0 人工回归清单

适用：/Applications/OpenChamber.app = 公证壳 2.1.0-sscity.20261003-123928 + runtime 133636-bff3a9de5488（OpenCode 2.0.21-sscity，协议 mode=v2）。
前置：应用已启动；Docker Desktop 运行中（Spaces live 测试需要）；建议准备两个项目目录（多服务器/双目录探针）。

## A. 冒烟与核心（先跑）

- [ ] About 版本 = `2.1.0-sscity.20261003-123928`；应用正常启动无 Gatekeeper 弹窗
- [ ] 新建会话 → 发消息 → 流式回复正常（v2 prompt 扁平形状）
- [ ] **会话 busy 时再发消息** → 入队 → 空闲后自动派发（v2 dispatch 扁平形状——本轮修的最后一个用户面缺口）
- [ ] 队列编辑：busy 时入队 → 编辑队列项 → 文本/附件还原正确
- [ ] 权限弹窗：三模式（ask / safety net / accept-all）切换生效；safety 模式下 held 请求有恢复通知
- [ ] 侧栏：merge/upstream 等**项目组会话行有两个空格缩进**（本轮修复）；子任务行再缩一级
- [ ] 命令面板重设计可用；`/skill` 附着、`/fork`、消息链接跳转

## B. v2.1.0 大块功能

- [ ] **Spaces**（需 Docker）：设置里开 Isolated Spaces → 创建 space（setup commands）→ 会话进 space 跑 → sidebar 空间组徽章/状态 → idle 自动停 → 归档命名/徽章/禁 restore → 关闭开关后一切如旧
- [ ] **files 编辑器**：git change gutter、code folding（fold-at-cursor）、symbols 列表（⌘⇧O）、多光标、preview tab、富预览（图片缩放/CSV/mermaid/字体）、树工具栏上传、agent file.open
- [ ] **multirun**：composer 多模型并行 chips → 多 worktree 快照跑 → RunOverview/lane 卡片
- [ ] **权限分类 provider**：routing 页 classification（off/zen/typesafe + custom endpoint）
- [ ] **Enterprise**（如启用）：策略文件生效面、扩展白名单、断网模式
- [ ] **主题**：Cursor/Osaka 内置盘、可搜索主题选择器、nl 界面语言

## C. 1.24 轮回归（v2 下的再确认）

- [ ] 多服务器：remote 实例添加/切换/移除；切远端后 worktree 重发现
- [ ] queue mode（Ctrl+Enter 入队）与 45° 按钮在 v2 派发下行为一致
- [ ] 全局置顶 pin/拖拽；globalPinned 分区
- [ ] git hunk 操作：stage/unstage/discard；分支切换保护对话框；PR diff review
- [ ] 终端：libghostty 渲染、复制按钮、重连快照
- [ ] routing 页：per-task 模型路由、Auto 跨重启；**OpenCode 2.0.21 下 small-model 调用**（goal 续跑/摘要依赖它）
- [ ] Extensions 页：SDK 文件编辑器、Excalidraw 扩展安装、browser provider、插件通知
- [ ] iCloud 受保护目录（ops）打开/列会话 200（此前 mode 门控 500 已修）
- [ ] 插件状态：plugin-status loaded:true；三个文件型插件显示 degraded（上游生态问题，预期）
- [ ] VS Code：prompt navigator、multirun 命令、enterprise-policy 桥

## D. 已知问题（不报）

- session-assist / git-service / config-file-watcher / network-defaults 测试满载超时（隔离全绿）
- Spaces code-out 读回预算重载机饿死（单跑 267/269）
- Docker live 套件 12 失败 = pinned 镜像拉取停滞（镜像可得后复跑）
- 三个文件型插件 degraded（v2 需目录形态，上游生态）
- guests background CSP 断言先存失败（extensions 批遗留，待修）

## E. 回归环境（无头/隔离）

- 回归 worktree：/Users/song/dev_ai/oc-regression-wt（@ d574c837f+补丁，需 rebase 到 HEAD 后重构建）
- 隔离数据目录 /tmp/oc-guest-test-data，端口 3471，密码 testpass123，**必须用 localhost 访问**（127.0.0.1 会误分类 tunnel scope）
