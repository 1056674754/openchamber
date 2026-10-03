# v2 轨道集成缺口总账（2026-10-04 审计）

> 本文档是 v1.24.2→v2.1.0 轮**本应在激活 v2 前产出**的特点清单与风险账，因激活时未立项，现作为补课依据。
> 来源：5 路并行审计（SDK/client 层、server 边界、UI 功能面、次级调用面、分类对账），全部对照
> OC2 2.0.21 真实路由表（../opencode-v2/packages/protocol/src/groups/*.ts）与上游 v2.1.0 实现。

## 一、漏掉的结构性特点（开工文档本应逐条立项的）

| # | 特点 | v1 | v2 | 现状 |
|---|---|---|---|---|
| C1 | UI 数据层 SDK 代际 | @opencode-ai/sdk 1.18.31（v1 形状路径） | 上游整体重写为 @opencode/client 2.0.21（envelope 内置解包） | **未移植**——fork client.ts 仍旧 SDK，双轨靠 5 条手写改名表 + 零散 unwrap |
| C2 | 响应 envelope | 裸数组/裸对象 | `{location, data[, cursor]}`（Location.response 包装遍布 groups/*） | 逐点打补丁中，无单一边界 |
| C3 | 路径表 | v1 根路径 | 全部 /api/* + 多处改名（question→form、find/file→fs/find、credential、provider 等） | 手写 5 条，缺 ~10 条 |
| C4 | 消息记录形状 | `{info, parts}` | 扁平 `{id, type, text|content, time}`，列表 `{data, cursor}` | server 侧 ~8 个消费方未翻译 |
| C5 | 凭证面 | auth.json + credential-db 中间态 | GET /api/credential + 403 保护（上游终态） | fork 持有上游已删的中间态，且无 403 保护 |
| C6 | question→form | /question/* | /api/form + session 域 /form/:id/reply（typed Form.Reply） | S7 只搬了事件侧，读/答/取消全断 |
| C7 | 依赖 pin | — | @opencode/client 2.0.14 ≠ 上游 2.0.21（J1 未做） | 未对齐 |

## 二、Findings 台账（去重后，按批次归组）

### R1 凭证安全（P0）
- [ ] `/api/credential` 无 403 保护、enterprise POST 拒绝缺失（上游 56fbe4e3a）
- [ ] 凭证读取改走 GET /api/credential，拆除 credential-db 私有 sqlite schema 读取（上游 eb8e276d）

### R2 client.ts 对齐 @opencode/client 2.0.21（P1 根治）
- [ ] 移植上游 2116 行 client.ts（getLocation、mergeConfigDocuments、forms、PermissionReply、inbox、cursor 分页），fork 增量（多服务器路由、globalPinned、temp-sessions、双轨 handle）重挂
- [ ] 依赖 bump @opencode/client 2.0.14→2.0.21（上游 4 个 bump commit）
- [ ] 改名表补：/question→/form、/find/file→/fs/find、/permission→/permission/request、/experimental/config(PATCH) 等约 8-10 条
- [ ] envelope 解包收敛到单一边界（client 层），删除零散 unwrap
- [ ] session/status `{data}` 纯嵌套分支（bootstrap 启发式不命中）
- [ ] config.get：Config.Entry[] 按 document 顺序 merge `.info`
- [ ] 下游独立加载路径换统一解包：useConfigStore loadProviders/loadAgents、useCommandsStore、useAgentsStore、useMcpStore、useFileSearchStore、multirun keep.ts/laneData、RegenerateTitleDialog、gitApi 生成链、ToolPart/MultiRunFusionDialog messages
- [ ] 消息历史翻页：before→cursor（v2），游标读 body
- [ ] revert/unrevert 走 client 双轨臂（session-actions 绕过了它）
- [ ] session.children 已删：改 session.list parentID 派生
- [ ] todo/tool.ids/lsp/project.current/mcp-OAuth：v2 无等价，显式降级或 N/A 标注

### R3 server 边界（P1 同批或紧随）
- [ ] 消息记录 normalizer（v2 扁平→{info,parts} + envelope 拆包）放 fetch 边界，覆盖 8 消费方：openchamber-sessions（waitForPromptLanded 误报）、openchamber-control、session-goal、notifications、markdown-image-grants、routing、context-obligatory、session-assist
- [ ] openchamber-sessions createSession/archive 补 v2 分支（/api/session + 204=成功 + metadata 归档标记）
- [ ] scheduled-tasks session.create/command/list 补 v2 分支
- [ ] session-goal：statuses/{data}/messages 信封 + metadata 读法 + children 替代
- [ ] WS directory-ws-bridge：v2 剥 ?directory=，桥内按 wireEventDirectory 过滤（跨目录事件泄漏）
- [ ] remote-instances 健康探测改 /api/opencode/health
- [ ] ?directory= 在翻译后才追加的三处（isOpenCodeIdle、notifications、markdown-image-grants）复用 V2_DIRECTORY_PARAM 模式
- [ ] subscriptions auth-adapter DELETE /auth/:id → /api/credential 映射；MCP OAuth 面对照 /api/integration 重接或显式隐藏
- [ ] translate-v2 补 session.retry.scheduled→status retry
- [ ] win32 会话合并 envelope；skill-routes 探针 v2 分支；lifecycle 外部探测 500 也回退 /api/info
- [ ] small-model/runtime-providers 信封 + index.js 接线 v2 传输（S8 遗留）

### R4 分类对账批次（P2/P3，来自分片 5）
- [ ] SegA 悬空批立项：#14 子代理 turn / #22 session metadata 2.0.15 / #29 等 v2 turn end / #33 CLI 升级 / #36 diff 计数 / #21-electron readiness
- [ ] 功能回补：websearch 链、usage stats 链、插件状态徽标、后台命令渲染、Go Console
- [ ] 对账销账：896776d81、5848b9eb2 逐一核实；GitLab issue #1 勾选同步

## 三、执行序

R1 → R3（server 先行，解锁派发/归档/goal）→ R2（client.ts 根治）→ R4。
每批：移植 + 触及域测试 + 三绿 + 实弹（UI 冷启动全量 bootstrap 对真 2.0.21）+ 台账。
