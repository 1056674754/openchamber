# 社区 v1.11.4 手工合并核对

更新时间：2026-05-25

## 结论

可以把“社区 v1.11.1 到 v1.11.4 的功能移植”视为已经完成。

还不能把它等同于“可以直接发布”，原因不是还有上游 commit 没合，而是这次改动面很大，发布前仍需要做一次真实运行回归，重点是多服务器、父子 session、Electron、VS Code、文件/Git/权限/问题回复这些我们 fork 特有的路径。

## 覆盖核对

| 项目 | 结果 |
| --- | --- |
| 上游区间 | `v1.11.1..v1.11.4` |
| 上游 commit 数 | 82 |
| 本文档记录 commit 数 | 82 |
| 漏记 commit | 0 |
| 多记 commit | 0 |
| 重复 commit | 0 |
| 已手工移植 | 78 |
| release-only / 发布决策类 | 3 |
| 按需跳过 | 1 |

## 状态解释

| 状态 | 含义 |
| --- | --- |
| 已手工移植 | 已按“官方旧版 -> 官方新版 -> 我们旧文件手动改”的方式落到当前 fork |
| release-only | 只影响版本号、发布流程、打包迁移策略，按我们 fork 的发布策略处理 |
| 按需跳过 | 上游辅助脚本或素材，当前 fork 不需要，后续有发布素材需求再补 |

## 需要特别说明的 commit

| Commit | 状态 | 说明 |
| --- | --- | --- |
| `8482bbc8` | 按需跳过 | 上游 changelog 卡片生成脚本和图片素材；不是运行时功能 |
| `db057c3c` | release-only | v1.11.2 发布元数据 |
| `587e06da` | release-only | v1.11.3 发布元数据 |
| `4beab0e3` | release-only | 上游切 Electron 发布目标；我们 fork 仍保留 Tauri 迁移兼容，不能直接照搬切掉 |

## 22 个合并单元结果

| 单元 | 内容 | 结果 |
| --- | --- | --- |
| 1 | Chat revert、undo/redo、revert/fork 附件恢复 | 完成 |
| 2 | reasoning 折叠、完成后折叠、动画和用户设置 | 完成 |
| 3 | tool 详情动画、多文件 diff 安全拆分 | 完成 |
| 4 | context panel 尺寸、持久化、todo 拖拽排序 | 完成 |
| 5 | Git history inline diff、本地优先 base ref、分支搜索、换行规范化 | 完成 |
| 6 | session switcher、根项目匹配、侧边栏作用域、归档虚拟列表、子树计数 | 完成 |
| 7 | skills 以 OpenCode 为准、skill 链接、slash/mention 补全 | 完成 |
| 8 | question card 复制 Markdown/JSON | 完成 |
| 9 | chat 外链 favicon 和对比度/对齐修复 | 完成 |
| 10 | reconnect/offline、OpenCode health check 韧性 | 完成 |
| 11 | Web/Desktop/VS Code 通知修复和去重 | 完成 |
| 12 | 移动端 terminal 键盘避让和 viewport fallback | 完成 |
| 13 | Wafer.ai quota、Zhipu 去重、quota 百分比保护 | 完成 |
| 14 | OpenCode update/PWA toast 可关闭、changelog hover 修复 | 完成 |
| 15 | VS Code editor chat actions、subtask 打开、大 session 切换性能 | 完成 |
| 16 | Multi-Run prompt/model 分组和 prompt-template 阶段 | 完成；后续 snippets 已覆盖最终形态 |
| 17 | snippets 替代 prompt templates、`#` 补全、设置页、server routes | 完成，并已适配 server-aware routing |
| 18 | 统一 model picker 行为 | 完成 |
| 19 | workspace shell 刷新：header、chat shell、sidebar/context panel 尺寸动画 | 完成 |
| 20 | Electron 发布目标、artifact、Tauri 迁移签名、菜单/update 行为 | 运行时完成；Electron cutover 保持发布决策 |
| 21 | Voice/TTS 清理、voice preview blob 清理、markdown note 保留 | 完成 |
| 22 | UI/可靠性零散修复：FilesView、file search cache、safe storage、中文术语等 | 完成 |

## 已验证

最近一次完整基础验证：

| 命令 | 结果 |
| --- | --- |
| `bun run type-check` | 通过 |
| `bun run lint` | 通过；仍有 2 个既有 warning：`MessageList.tsx:1879`、`MainLayout.tsx:231` |

本次额外核对时补跑的重点测试：

| 测试范围 | 结果 |
| --- | --- |
| snippets、OpenCode core routes、Multi-Run title | 11 pass |
| Git base ref、notifications、template runtime | 11 pass |
| UI 重点批量测试 | 65 pass；`session-switch-resync.test.ts` 混跑时出现测试桩隔离问题 |
| `session-switch-resync.test.ts` 单独执行 | 9 pass |

启动崩溃也已修复：`useMenuActions` 不再在 `<SyncProvider>` 外调用 `useEffectiveDirectory()`，菜单打开 terminal 时改为动作触发时读取当前 session 的权威目录。

## 还建议做的人工回归

这些不是“还有上游没合”，而是发布前的验收项：

1. Electron dev 启动，确认不再出现 `useSyncSystem must be used within <SyncProvider>`。
2. 本地服务器 + 远程服务器同时存在时，创建 session、打开子 session、切换 session。
3. 对已有 session 执行 prompt、permission reply、question reply、abort、archive/delete。
4. 文件、Git、snippets、skills、quota 都在正确的 serverId/directory 下工作。
5. VS Code 面板里打开大 session、subtask、editor chat action。
6. 决定是否执行上游 `4beab0e3` 对应的 Electron cutover；在决定前继续保留 Tauri 迁移兼容。

## Commit 清单压缩版

已移植 78 个：

`c02bde73`, `3f439596`, `93b852ac`, `c5b998ea`, `4a4c0903`, `432aa705`, `51f2b0ca`, `e1050037`, `42e1da47`, `45fc1d4f`, `06cd1888`, `789d6991`, `9aec156b`, `6b890fdb`, `3eeaad45`, `9cd70659`, `2c40eb2e`, `acdadd1e`, `3ee004fa`, `74036a93`, `8457c776`, `e0cd03d9`, `862400e9`, `6f569795`, `0b434e4c`, `7bbc9a24`, `4a211ef3`, `95fcd70f`, `8b86881e`, `1479aa34`, `065252a4`, `b989b629`, `5825df05`, `5cbf960a`, `84a9f06c`, `0426ec6a`, `9ee8a09e`, `04a54290`, `254e31c5`, `9cd49dac`, `aa42db9a`, `4a6cbb8b`, `b4868fa8`, `e6ee4a2a`, `c29925bf`, `b86668c0`, `0ebb3151`, `745c6b15`, `4fe3a5ed`, `b9c0124c`, `449a8be3`, `c386600d`, `538d4bab`, `44d6e6ac`, `aaca2515`, `1717c96f`, `47e01c98`, `ccaa3efc`, `a4d3998e`, `090b1f3c`, `5eec2275`, `955c7f8d`, `6c6115e6`, `a2d4933b`, `155be789`, `469cfea5`, `41dbef39`, `4b87fbf9`, `6589a92b`, `f69574c2`, `83edb6aa`, `3a84e09d`, `1d5007b8`, `ff0ede4e`, `f48a3a93`, `6df09a71`, `0419a139`, `9b8df30d`

release-only 3 个：

`db057c3c`, `587e06da`, `4beab0e3`

按需跳过 1 个：

`8482bbc8`
