# OC2 迁移脊柱子批执行计划（B2 拆批）

更新：2026-10-01。对应总计划 D1（已拍板：拆 6-8 子批，OpenChamber 侧代码先行、运行时门控）。
范围：上游 SegA #38 `654705f7d`（feat: move OpenChamber to OpenCode 2.x，770 文件，squash 合并含 2.0.3→2.0.14 全部跟进修复）+ Segment B 15 个【依赖OC2】适配簇。

## 0. 脊柱的架构事实（移植判断依据）

- 上游不是双栈硬切：`654705f7d` 是一次性 cutover，v2.1.0 时 `MINIMUM_OPENCODE_VERSION='2.0.20'`，v1 路径全部删除（config-reader/writer/routes、small-model call.js 等在后续 SegB/C 段删除）。**fork 不照抄硬切**——v1 文件全部保留为 v1 轨，删除推迟到激活后的独立清理批。
- 上游自己的适配层是移植的锚点：
  - 服务端 `server/lib/event-stream/translate-v2.js`（313 行，纯函数）：v2 wire 事件 → 服务端消费者既有的 v1 词汇（notifications/message-queue/goal/auto-accept 等零改动）；关键语义：v2 无 `session.status`/`session.idle`，由 `session.execution.*` 合成；`session.step.ended` → assistant `message.updated`，仅最后一步带 `finish:"stop"`。
  - 客户端 `lib/opencode/{model,projection,events,tools,ids}.ts`（~2.8k 行，纯、带全套上游测试）：v2 wire → UI 内部词汇，reducer 永远不见 wire 形态；part 身份 = `(assistantMessageID, ordinal)` / tool call id。
- 协议要点（2.0.8→2.0.14 已含在脊柱内）：`/api/health` 删除→`/api/info`；`project.current`→`location.get`；`session.rename` 并入 `session.update`（partial update 语义）；permission 回复字段 `decision`；forms 走 `session.form.*`；inbox steer/queue→`inbox.update`；catalog.updated 风暴移除（provider/model.updated 驱动重读）；`?directory=` → `x-opencode-directory` header；workspace API 删除。
- 依赖：`@opencode/client` + `@opencode/schema`（脊柱 pin 2.0.14；上游 v2.1.0 已到 2.0.21）。服务端与 UI 都直接 import `@opencode/client`。

## 1. fork 侧核心策略决策：边界翻译，不换 sync 词汇（本计划的定盘星）

**决策**：fork 侧 v2 适配采用"边界翻译"——新增 UI 桥模块（S5，改写自上游 events.ts/projection.ts/translate-v2.js 语义）把 v2 wire 事件/记录翻译成 **fork 现行 v1 形态的内部词汇**（`@opencode-ai/sdk/v2` 的 `Event`/`Message`/`Part` 形状），再喂给既有 reducer/store。

**理由**：
- fork sync 三层（`MultiServerSyncLayer` + `global-sync-store` + `ChildStoreManager` + session-actions 2692 行 + session-ui-store 2705 行）是 fork 自研多服务器架构，AGENTS.md 硬约束要求保全 `serverId + directory` 权威；照抄上游 SyncEvent 词汇意味着重写 15k+ 行 fork 热路径，违反"最小正确改动"与性能规则。
- 服务端消费者零改动的同款思路上游已验证（translate-v2.js 的存在即证明 v1 词汇可承载 v2 语义）。
- 代价与对策：v2 独有状态（Code Mode execute 工具、form steps、compaction delta）在桥内合成最接近的 v1 形态 + 相邻 typed 通道；S7 的新组件（FormDock/PermissionDock/FormFieldControl）直接消费 projection 层 v2 原生类型，不走 legacy 形状。无法合成的差距清单在 S5 落地时登记进 MERGE_V1.12.md。

**此决策在 S5 开工前不可再摇摆**；若实施中证明某 v2 语义不可桥接（预期候选：`inbox.update` 语义、partial session update 合并），允许该点局部改用 SyncEvent 通道，但必须单点登记。

## 2. 双版本共存 / 门控机制设计

**探测与存储**：服务端为唯一权威探测点。managed OpenCode 在 spawn 后探测（v2：`GET /api/info` 取 `version`；v1：legacy `/global/health` probe 兜底，直接移植上游 `compatibility.js` 的双探测逻辑，含 sscity 后缀兼容）；外部 remote 实例在 remote-instances 健康检查时探测。结果归一化为 `protocolMode: 'v1' | 'v2'`，**按服务实例（serverId）存储**（managed 为 default 实例）——fork 多实例下允许本地 2.x + 外部 1.x 混跑，这是与上游硬切的刻意分叉。UI 通过既有 bootstrap/config 通道拉取各实例 mode；`resolveSdkForDirectory` 同时返回 mode，UI 任何 v2 分支只允许从该句柄取值，禁止组件内散布 `mode === 'v2'` 判断（S7 dock 显示互斥为唯一例外）。

**默认与激活**：默认 `v1`，合入的所有 v2 路径都死在 `mode==='v2'` 分支内——v1 默认行为零变化是每子批的回归红线（既有 vitest 套件全绿）。激活 = 在 ../opencode 2.x 落地并通过 §6 对接清单后，把 managed 实例默认翻为 `v2`（env `OPENCHAMBER_PROTOCOL_MODE=v1|v2` 可强制覆盖以便联调与回退）；外部 1.x remote 继续走 v1 轨。v1 专属文件（config-reader/writer/routes、small-model call.js、SDK 1.18.31 依赖）保留到激活稳定后的清理批（不属于本脊柱，另立工作项）。

## 3. 子批清单

每子批 = merge/upstream 上**单个 commit**（= 回滚单位），落 `bun run type-check`（8 包）+ 指定 vitest 套件 + `bun run lint`，并按轮次规矩追加 MERGE_V1.12.md 证据、关联 GitLab 工作项。上游 commit 列标注：`[spine]`=654705f7d 的对应文件段，`[SegB #n]`=分类表行号。

### OC2-S1 协议门控基座 + 依赖双栈

- 前置：无（B0 基线绿）
- 上游：[spine] deps/vite 段；compatibility 探测按上游 v2.1.0 终态改写（fork 版探测不阻断、不报错）
- 触及（fork 路径）：`package.json`、`bun.lock`、`packages/{ui,web,vscode}/package.json`（+`@opencode/client`/`@opencode/schema`，**保留** `@opencode-ai/sdk@1.18.31`）、`vite.config.ts`（根）/`packages/web/vite.config.ts`/`packages/vscode/vite.config.ts`（新 dep 分包，SDK alias 不动）、新增 `packages/web/server/lib/opencode/protocol-mode.js`、`packages/web/server/lib/opencode/compatibility.js`（fork 版：readOpenCodeCliVersion/readExternalOpenCodeVersion/版本比较，去 UnsupportedOpenCodeVersionError 硬失败）、`packages/ui/src/lib/opencode/protocolMode.ts`
- 适配要点：版本正则兼容 `-sscity` 后缀；探测结果按 serverId 存实例表；env 覆盖开关在本批就位；零行为变化
- 门：type-check；新增单测（版本解析/双探测/mode 判定）；lint
- ⚠ 外来文件：无

### OC2-S2 服务端事件/凭据/托管配置适配层

- 前置：S1
- 上游：[spine] event-stream 段 + credential-db + managed-config-file + auth.js；[SegB #56 0ec304cb2]（managed config 禁用内置浏览器插件）、[#138 8dd842a3b]（server 部分：auth-state-runtime）、[#3 ca99eb0f8]（server 部分：skill-routes v2 path 字段）
- 触及：`server/lib/event-stream/{translate-v2.js+, index.js, delta-coalescer.js, global-hub.js, protocol.js}`、`server/lib/opencode/{credential-db.js+, auth.js, managed-config-file.js+, managed-plugin-config.js, auth-state-runtime.js, skill-routes.js}`
- 适配要点：translate-v2 纯新增；global-hub/upstream-reader 摄入处按 mode 分支（v1 透传、v2 过 translateWireEvent）；credential-db sqlite 读取仅 v2 轨启用，v1 auth.json 路径不动；codemode 缺省=on 语义属 v2 写入轨
- 门：vitest（translate-v2 / credential-db / managed-config-file 新套件 + event-stream 既有套件全绿）；type-check
- ⚠ 外来文件：无

### OC2-S3 服务端 config-v2 / 实体路由 / 生命周期与迁移链

- 前置：S2
- 上游：[spine] config-v2 全家、agents/commands/mcp/plugins/providers/shared、env-runtime、watcher、lifecycle、routes.js、settings-runtime；[SegB #47 ee99e079d]（v1-migration-topup 语义终态）、[#172 309ddc2b1]（server git/routes.js 部分）
- 触及：`server/lib/opencode/{config-v2.js+ config-v2.d.ts+ config-entity-routes.js agents.js commands.js mcp.js plugins.js providers.js shared.js env-runtime.js env-config.js watcher.js lifecycle.js routes.js settings-runtime.js settings-helpers.js v1-migration-topup.js+}`、`server/lib/git/routes.js`
- 适配要点：config CRUD 双轨——v1：既有 config-reader/writer/config-routes 原样保留；v2：config-v2 + OC2 API 代理；**routes.js 不照抄上游 -431 行删除，改为 mode 分支挂载**；lifecycle spawn 后探测写 mode；env-runtime 双布局解析（1.x `opencode-ai` / 2.x `@opencode/cli` 平台包，上游 Windows resolver 先例）；`serverId+directory` 权威逐点核对
- 门：vitest（config-v2 / config-entity-v2 / env-runtime / lifecycle / auth / v1-migration-topup / skill-routes 新套件 + agents/commands/mcp/plugins/providers 既有套件）；type-check
- ⚠ 外来文件：`server/lib/opencode/routes.test.js`（foreign）——新增断言移植需与鸿蒙会话协调时序；未落地前先落实现 + 既有测试

### OC2-S4 small-model 双轨 + 会话元数据存储

- 前置：S2（与 S3 可并行，建议串行）
- 上游：[spine] small-model 段 + openchamber-sessions 段（session-metadata-store / archive-store / opencode-client / routes）
- 触及：`server/lib/small-model/{client.js+, index.js, routes.js}`（call.js/resolve.js/catalog.js/runtime-providers.js 保留为 v1 轨）、`server/lib/openchamber-sessions/{session-metadata-store.js+, archive-store.js+, opencode-client.js+, routes.js}`
- 适配要点：small-model v2 轨 = 经运行实例 generation 端点（client.js，`configureOpenCodeRuntimeProviders` 由 server/index.js 接线——接线本身放 S8，本批先落模块+单测）；v1 轨 = 现 call.js 直连 provider；调用方（assist/goal/notifications/agent-tool）经 index 统一入口无感切换；session-metadata-store 为 spine 基座版（SegA #22 的 2.0.15 大改是独立后续工作项，不混入）；openchamber-sessions/routes.js（381/316）与 fork 自研 routes+service 直交——按 fork directory 权威手工对位，"单一属主 + 同事务 seed"语义照搬
- 门：vitest（small-model index / metadata-store / archive-store / openchamber-sessions routes / session-knowledge 套件）；type-check
- ⚠ 外来文件：无（注意 foreign 的是 `opencode/routes.test.js`，不是本批的 openchamber-sessions）

### OC2-S5 UI SDK 适配层（client.ts + projection trio + stores）

- 前置：S1（纯 UI 侧，可与 S2-S4 并行；建议 S4 后串行）
- 上游：[spine] `lib/opencode/{model,projection,events,tools,ids}`+tests、client.ts 重写、session-status、runtime-fetch coalescing、`stores/{useConfigStore, useAgentsStore, useMcpConfigStore}`、`catalogRefresh.ts+`、`useSmallModelStore.ts+`；[SegB #204 dc454ca6b]（events.ts 1 行）
- 触及：`ui/src/lib/opencode/{model.ts+ projection.ts+ events.ts+ tools.ts+ ids.ts+ 及对应 test}`、`ui/src/lib/opencode/client.ts`、`session-status.ts`、`ui/src/lib/runtime-fetch.ts`、`ui/src/stores/{useConfigStore.ts useAgentsStore.ts useMcpConfigStore.ts catalogRefresh.ts+ useSmallModelStore.ts+}`
- 适配要点：**按 §1 边界翻译决策落地桥**——trio 基本原样移植（纯函数+上游测试），新增薄桥层输出 fork v1 词汇；client.ts 在 `resolveSdkForDirectory` 后按 mode 返回 v1 SDK 句柄或 v2 client 句柄，fork 的 provider-tracker 熔断、directoryBridge、多服务器路由两轨都生效；v2 轨 `x-opencode-directory` header；coalescer 按 header 分键；差距清单登记
- 门：type-check；vitest（trio/client 新套件 + runtime-fetch 既有）；lint
- ⚠ 外来文件：`ui/src/lib/runtime-fetch.ts`（foreign）——协调

### OC2-S6 sync 接线 + 发送路径（最大风险批；超限时切 S6a 摄入/S6b 发送）

- 前置：S5、S2
- 上游：[spine] event-pipeline、event-reducer v2 语义、sync-context 摄入面、session-actions、session-ui-store、sanitize、bootstrap、global-blocking-requests、`hooks/{useAssistantStatus, useSessionAssist}`、message-queue/agent-tool/notifications/session-goal/session-assist runtime 段；[SegB #4 61e6535cf]（前导斜杠 skill 路由）、[#96 b504deb88]（retry 倒计时）、[#48 cb7400923]（OC2 下回合后建议）、[#188 d945cdaf6]（清 v1 compaction 检查）、[#166 a2297eb1b]（子代理输出 Markdown）
- 触及：`ui/src/sync/{event-pipeline.ts event-reducer.ts sync-context.tsx session-actions.ts session-ui-store.ts sanitize.ts bootstrap.ts global-blocking-requests.ts question-recovery.ts}`、`ui/src/hooks/{useAssistantStatus.ts useSessionAssist.ts}`、`ui/src/components/chat/lib/turns/{projectTurnActivity.ts projectTurnRecords.ts projectTurnSummary.ts}`、TaskCard 子代理渲染等价点、`server/lib/{message-queue/runtime.js agent-tool/runtime.js notifications/runtime.js session-goal/runtime.js}`、`server/lib/session-assist/*`
- 适配要点：pipeline 摄入按 mode 分支（v1 现行为不动；v2 wire 经 S5 桥进既有 reducer）；**严禁以上游单目录 sync-context 替换 fork MultiServerSyncLayer/global-store/child-store**；turn 结束语义（execution.* 合成 status/idle）集中在桥；发送路径保持 capture-send-config-at-queue-time 与 fork 自研 queue；"runtime 切换后每步 re-check"（上游 client 修复）进 v2 轨；server 侧消费者经 S2 的 translate-v2 已说 v1 词汇，本批只做事件语义适配（#14/#29 的 response-envelope/session-activity 属 SegA 独立项，不混入）
- 门：type-check；**fork sync 全套件全绿（v1 回归红线）** + v2 桥新套件；按 AGENTS.md 性能规则复核热路径（delta 合流、按 key coalesce、无新增 findIndex 于 60/s 通道）
- ⚠ 外来文件：无直接命中；`sync-context.tsx` 引用的 mobile/platform 邻域文件为 foreign——只读不写

### OC2-S7 Question→Form 改名 + dock 面 + 表面杂项

- 前置：S6
- 上游：[spine] FormCard/FormDock/FormFieldControl/formCardState/formSerializers/form-recovery、PermissionDock、PermissionCard 重构、ToolPart、ChatInput/ChatContainer、McpPage、provider-oauth、SettingsAutosave、composer-forms；[SegB #52 c841fe2ad]（codemode 缺省交 OC）、[#167 50766fa0f]（OC2 带 key 保存自定义 provider）
- 触及：`ui/src/components/chat/{QuestionCard.tsx→FormCard.tsx FormDock.tsx+ FormFieldControl.tsx+ formCardState.ts+ questionSerializers.ts→formSerializers.ts questionTextareaSizing→并入 PermissionDock.tsx+ PermissionCard.tsx ToolPart.tsx ChatInput.tsx ChatContainer.tsx}`、`ui/src/sync/question-recovery.ts→form-recovery.ts`、`ui/src/components/chat/lib/{blockingRequests.ts questionDraftPersistence.ts questionToolRecovery.ts}`（改名或保留别名，随桥接实际）、`ui/src/types/question.ts`→FormRequest 归并、`lib/i18n/messages/*`（11 locale 键同步；nl 归 B10）、`ui/src/components/sections/{mcp/McpPage.tsx providers/custom-provider-form.ts provider-oauth.ts}`、`sections/shared/SettingsAutosave.tsx+`
- 适配要点：fork ChatInput 5247 行——机械改名+接线，量大事缓；pending permission 隐藏 form dock/queue chips/suggestion 的互斥规则照上游；fork 自研 composer queue 保全；`MobileApp.tsx` 2/1 行（#52）碰 foreign——协调或拆出
- 门：type-check；vitest（formCardState / formSerializers / composer-forms / provider-oauth / i18n parity / SettingsAutosave）；lint
- ⚠ 外来文件：`ui/src/apps/MobileApp.tsx`（foreign，2 行）——协调项

### OC2-S8 VS Code / electron 打包 / index 接线 / 激活联调

- 前置：S3、S5、S6
- 上游：[spine] vscode 段（opencodeConfig 599/761、opencodeAuth、bridge-*、opencodeVersion、sessionActivityWatcher、sseProxy、webview/main.tsx）、electron scripts 段；[SegB #103 bc323582b]（vscode 认 background service）、[#157 0a19aa804→#172 309ddc2b1]（vscode bridge-git 释放 worktree）
- 触及：`packages/vscode/src/{opencodeConfig.ts opencodeAuth.ts opencodeVersion.ts+ opencodeServiceUrl.ts+ opencode.ts opencode-config-v2.ts bridge-config-runtime.ts bridge-git-runtime.ts bridge-git-special-runtime.ts bridge-proxy-runtime.ts bridge-system-runtime.ts bridge-settings-runtime.ts sessionActivityWatcher.ts sseProxy.ts webview/main.tsx}`、`packages/electron/scripts/embedded-opencode.cjs`（fork 等价面，加 1.x/2.x 双布局解析）、verify-* 脚本、`packages/web/server/index.js`（small-model connection、event-stream v2 reader、routes 挂载的最终接线）
- 适配要点：vscode 无上游同名文件的以 fork bridge-runtime 架构对位；electron 侧**开工前必读 `docs/EMBEDDED_OPENCODE_PACKAGING.md` 全文**，只改 fork 自有 staging/build 链，绝不触碰 `/Applications/OpenChamber.app`，不做签名/公证；server/index.js 是 final wiring 的自然落点，**须待鸿蒙会话该文件落地后进行**（否则把接线拆成独立小 commit 顺延）
- 门：vscode/electron tsc+测试；全仓 type-check；不跑打包；激活联调按 §6 清单执行
- ⚠ 外来文件：`packages/web/server/index.js`（foreign）——硬协调项

## 4. 风险清单与回滚单位

| # | 风险 | 等级 | 缓解 | 回滚单位 |
|---|---|---|---|---|
| R1 | S6 sync 接线：fork 热路径回归/性能退化 | **最高** | S6a/S6b 可拆；v1 套件红线；性能规则逐条复核；桥层纯函数化 | 单 commit revert（S6a 或 S6b） |
| R2 | 双轨分支熵：mode 判断散布、v1 行为漂移 | 高 | mode 分支集中在 adapter 模块；组件禁读 mode（S7 互斥例外）；每批 v1 套件全绿 | 按 commit revert |
| R3 | 外来文件相交（server/index.js、runtime-fetch.ts、MobileApp.tsx、Header.tsx、MainLayout.tsx、opencode/routes.test.js） | 高 | 时序协调（鸿蒙落地先）；不可协调的接线点顺延为独立 commit | 不适用（调度项） |
| R4 | 协议 pin 漂移（脊柱=2.0.14 词汇；SegA #22/#33 与 SegB/C 抬到 2.0.15/2.0.20/2.0.21） | 中 | 依赖 pin 由 S1 占位、S8 联调前与 ../opencode 对齐；2.0.15+ 面归后续工作项 | 依赖版本单独 revert |
| R5 | small-model 认证语义差：v2 轨依赖 `GET /api/credential`（2.0.20+），../opencode 首发低于该版本时 quota/voice/routing 断供 | 中 | 版本门槛写进 mode 判定（capability 探测），不达标面保持 v1 轨 | capability 门独立开关 |
| R6 | i18n 漂移（脊柱改 34 个 i18n 文件 × 11 locale） | 低 | parity 测试每批跑；nl 归 B10 | 按 commit revert |
| R7 | 桥无法表达某 v2 语义（候选：inbox.update、partial session update） | 中 | §1 允许局部 SyncEvent 通道 + 单点登记；S5 差距清单先out | 桥模块单独 revert |

## 5. 执行规矩（每子批）

1. 单 commit = 回滚单位；commit message 引用上游 hash 段与子批号（如 `feat(oc2-s3): config-v2 dual-track routes [spine 654705f7d][segb ee99e079d]`）。
2. `bun run type-check` + `bun run lint` + 批内指定 vitest 全绿才算落批；MERGE_V1.12.md 追加证据并链接 GitLab 工作项（issue #1 勾选在脊柱整体关闭时统一做）。
3. **不改产品行为的验证底线**：每批落完后用 v1 默认 mode 冒烟（启动、发消息、队列、权限、归档）。
4. 全部子批不 commit 计划文档本身；本文件由主会话统一提交。

## 6. 与隔壁 agent（../opencode 2.x）对接点清单

激活任何 v2 运行时路径（即 managed 默认 mode 翻 `v2`）前，逐项确认：

| # | 对接点 | 消费方子批 | 需要隔壁 agent 提供 |
|---|---|---|---|
| J1 | 最终协议 pin：`@opencode/client` + `@opencode/schema` + `opencodeCli.version` | S1 定占位、S8 对齐 | ../opencode 2.x 目标 release 号 |
| J2 | `/api/info` 就绪端点（version/pid/urls/paths） | S1/S3 探测 | 2.x 必含（2.0.8+） |
| J3 | 事件词汇：`session.execution.*`、`session.step.*`、`session.form.*`、`permission.*`、`inbox.update`、`session.usage.updated`、`vcs.branch.updated`、`mcp.status.changed` 等与 translate 覆盖集一致 | S2/S6 联调 | 事件发射清单对照 |
| J4 | `x-opencode-directory` header 取代 `?directory=` | S5/S6 | header 语义确认 |
| J5 | `GET /api/credential`（2.0.20+） | S2（credential-db）、small-model/quota/voice/routing v2 轨 | 若首发 <2.0.20，相关面维持 v1 轨（R5 门） |
| J6 | generation / small-model 端点与认证（server password 语义） | S4/S8 | 端点路径 + 认证约定 |
| J7 | v1→v2 会话迁移协议（迁移游标、重导入语义） | S3（v1-migration-topup 联调） | 迁移行协议、删除语义（#47 已按"宁重导不丢"定案） |
| J8 | managed OC2 实际密码认证（auth-state-runtime）、外部实例 background service URL | S2/S8 | 密码存取与 service URL 约定（8dd842a3b / bc323582b） |
| J9 | 2.x 二进制产物形态（npm `@opencode/cli` tarball vs fork 自研合并二进制）与 runbook 更新 | S8 | 产物布局；随后按 EMBEDDED_OPENCODE_PACKAGING.md 走 runtime:install 门 |
| J10 | 激活门：J1-J9 全部就绪 + S1-S8 全部合入 + v2 mode 冒烟通过 | 收尾 | ../opencode 2.x 可部署版本 |

## 7. 与其他批次的边界（不混入本脊柱）

- SegA #14（response-envelope/session-activity）、#22（session metadata 2.0.15）、#33（CLI 升级 + OpenCodeCompatibilityGate UI）、#29/#36 等【依赖OC2】独立项：踩在 S2-S6 表面上，归主计划 B2 之外的对应批次，不混入子批。
- SegB【依赖OC2部分】项：#52 已拆入 S7；#122（权限三模式，classification 面）与 #133（Jev）随 B3/B4 主批次，仅要求其 OC2 部分在 S8 激活前不接 v2 轨。
- v1 轨文件删除、SDK 1.18.31 移除：激活稳定后的独立清理工作项。
