# 上游 v2.1.0 合并轮计划（v1.24.2 → v2.1.0）

更新时间：2026-10-01
状态：盘点分类进行中

## 范围

| 区间 | Commit 数 | 文件变更 | 规模 |
| --- | ---: | ---: | --- |
| v1.24.2..v2.0.0 | 111 | 1224 | +84,050 / -37,385 |
| v2.0.0..v2.0.4 | 241 | 1337 | +87,896 / -13,470 |
| v2.0.4..v2.1.0 | 81 | 732 | +25,139 / -4,392 |
| **合计** | **433** | **2159** | **+192,110 / -50,272** |

拓扑：本区间**无 orphan release**（v2.0.0-v2.1.0 全部有父链），历史完全分解可审。

基线：merge/upstream @ c224009a9（1.24.2-sscity 版本号 + 公证壳构建链修复）。

## 外部依赖与分工（用户确认）

- **OpenCode 2.x 升级归隔壁 agent**（`../opencode` fork，branch sscity）。本仓库只移植 OpenChamber 侧代码。上游涉及 OpenCode 2.x 协议/session-metadata/SDK v2 行为的 commit：移植 OpenChamber 侧，但标记"运行时依赖 OpenCode 2.x——在隔壁 agent 落地前不得激活/部署相关路径"。
- 本机部署面（公证壳/runtime）与移植轮解耦，按 EMBEDDED_OPENCODE_PACKAGING.md runbook 单独管理。

## 预判的政策项（分类时标记，计划回填时用户拍板）

- **Isolated Spaces（隔离空间）**：全新子系统（约 15+ commits + docs/isolated-spaces/ 8 篇 + Docker 依赖）——建议参照上轮扩展系统"单独评估"，但用户未拍板前分类照常细化
- **Enterprise 模式**（机器策略文件/扩展白名单/断网模式）：用户场景可能不需要，标记待决
- **posthog 遥测**：不做（fork 惯例）
- packages/docs 216 文件：照例跳过
- 荷兰语 nl locale：新增第 12 locale，i18n 批次补齐

## 政策（沿用 1.24 轮）

1. 只读上游 diff，手工移植，不 merge/cherry-pick/覆盖 checkout
2. fork 本地功能保全：多服务器 serverId+directory 权威、自研 composer queue、globalPinned、新 sidebar 架构（B6a 已跟上游 rowModel）、第三方集成自研区
3. i18n：12 locale（新增 nl）保留本地 key
4. 每移植块：feat/fix commit + docs(migration) 追加 MERGE_V1.12.md
5. **不碰工作区未提交文件**（37 个，清单 docs/merge-v2.1/foreign-files.txt——鸿蒙会话在用）；绝不 git stash
6. 验证：每批次 type-check + 相关测试；阶段全量 vitest/build；MERGE_PROTECTION signature token 复查

## 分类批次（✅ 2026-10-01 三段全部完成，433/433 全覆盖）

- Segment A：v1.24.2..v2.0.0（111c）→ classify-seg-a.md
- Segment B：v2.0.0..v2.0.4（241c）→ classify-seg-b.md
- Segment C：v2.0.4..v2.1.0（81c）→ classify-seg-c.md

原始清单：docs/merge-v2.1/inventory-full.txt

### 策略统计（三段合并）

| 策略 | 数量 |
| --- | ---: |
| 直接移植/适配/概念移植/随块 | ≈290 |
| 【依赖OC2】（协议面，OpenChamber 侧先行） | 39 |
| 【Spaces 子系统】待用户拍板 | ≈24（~24k 行） |
| 【Enterprise】待用户拍板 | 6 |
| 跳过（上游基建/docs/merge 载体/遥测） | ≈55 |
| 已等价（fork 自研） | 2 |
| 待查/单独决策 | ≈10 |

### 勘误（相对初判）

- Enterprise 全系列、nl locale、Jev endpoint 在 **Segment B**（非 A）；posthog 在全区间为 0
- 上游 sidebar 也迁入 `sessions/`+`shell/` 子目录——与 fork 上轮跟的架构方向一致，sidebar 类 commit 需路径映射
- 已自研等价 2 处（选区复制、启动恢复），fork 无需移植

### 关键风险块

| 块 | 规模 | 说明 |
| --- | --- | --- |
| **OC2 迁移脊柱**（SegA #38） | ~450 文件 | client.ts/sync 三层/Question→Form/server opencode lib/small-model 全重写；建议单列工作项拆 6-8 子批，OpenChamber 侧先行、运行时门控 |
| 权限三模式 + classification providers | 89 文件 | 主轮必做 |
| sessions-in-work | 74 文件新子系统 | |
| SDK 文件编辑器 | 4554 行 | 按 #192 扩展终态移植 |
| multirun composer | 6133 行 | |
| Spaces 5e 系列（SegC） | 依赖 SegB 5a-5d | 随 D-Spaces 决策 |

## 决策清单

| # | 决策 | 默认/建议 | 状态 |
| --- | --- | --- | --- |
| D1 | OC2 脊柱（~450 文件）拆 6-8 子批"代码先行、运行时门控" | 执行 | ✅ 现在拆批并行推（2026-10-01） |
| D2 | Spaces 隔离空间（~24k 行，跨三段 + Docker 依赖） | 单独末批或延后 | ✅ 立项，排末批（B8） |
| D3 | Enterprise 模式（6c） | 待拍板 | ✅ 做（随权限批次） |
| D4 | nl 第 12 locale | 随 i18n 收尾批补齐 | 默认执行 |
| D5 | 触鸿蒙未提交文件的 8 个 commit | 与鸿蒙落地时间协调排序 | 协调项 |
| D6 | Excalidraw 只按 #192 扩展终态移植（跳过中间态） | 按分类建议 | 默认执行 |
| D7 | 评论模式块（SegA 5c） | 整块引入 | 默认执行 |
| D8 | #88 会话历史逐出 vs fork 自有 retention | 先做等价核实 | 默认执行 |
| D9 | dictation ×2、上游 markdownCore 修复、浏览器标注 | 不做（fork 自研/无表面） | 按分类建议 |
| D10 | PR 家族对齐上游 vs 保留 fork 自研 pr-status | 待核对后定 | 执行到对应批次核对 |

## 批次计划（按依赖序，执行前细化）

| 批 | 内容 | 前置 |
| --- | --- | --- |
| B0 | 基线验证（当前树 type-check/vitest/build 绿）+ 外来文件清单核对 | 无 |
| B1 | 低风险直移批（三段"直接移植"中的独立小项 + 服务器健壮性 6c + 文件面增强 3c） | 无 |
| B2 | OC2 脊柱拆批（6-8 子批，代码先行/运行时门控，每子批独立 type-check） | D1 |
| B3 | 权限三模式 + classification（89 文件） | B2 部分 |
| B4 | sessions-in-work + 聊天评论模式 + 单消息链接链 | B2 |
| B5 | Files/编辑器 + CodeMirror 三连 + multirun composer | B1 |
| B6 | SDK/extensions 增量（file editors 4554 行、browser provider、Excalidraw 终态） | B1 |
| B7 | VS Code（prompt navigator、共享 multirun）+ electron + 桌面环境剥离 | B2 |
| B8 | Spaces（若 D2 立项） | SegA 基础 + SegB 5a-5d + Docker |
| B9 | Enterprise（若 D3 做） | B2 |
| B10 | i18n nl + 杂项 + signature token 全量验证 + 三绿 + 台账 | 全部 |

## 执行挂账（滚动记录）

- **B1 完成**（2026-10-01，45 上游 commit / 14 git commit，HEAD 57e8f75e2）：quota/stats、服务器健壮性、主题/models、agents/settings/skills、chat 小修、worktree/玻璃、windows/vscode/control、dev-tunnel/fs、ui 收尾。跳过 24 项有因（鸿蒙 foreign 6、OC2/基建 7、fork 无表面 8、已等价 4）。type-check 8 包 0 错、web 1917 过。
- **OC2 脊柱 6/8 批完成**（2026-10-01/02）：S1 e7232d293（双栈+探测基座）、S2 1b333c5a2（translate-v2 24 事件+凭据+托管配置+hub mode 分支）、S3 e89cd32e8（config-v2+迁移链+routes 双轨）、S4 afa9f4f52（small-model 双轨+会话元数据/归档存储）、S5 a1811aaaf（UI SDK 双轨句柄+projection trio）、S7 cf334f00c（Question→Form 改名 94 文件+FormDock 家族+nl 起步）。**S6 已于 2026-10-02 落地（bee3dcd69 S6a + S6b，鸿蒙让位后）**；S8（最终接线）仍挂起。
- **OC2-S6 完成**（2026-10-02，bee3dcd69 + S6b）：① pipeline 摄入 mode 分支——event-pipeline 注入 `wireMode(serverId)`，v2 raw wire 经新纯桥 `lib/opencode/wire-bridge.ts` 译成 fork reducer 词汇**先于 coalescing**（v2 delta 同 key 合流），v1 路径逐字节未动；sync-context bus 摄入同桥；remote-tagged 帧保持 raw 转发、由属主 provider 按自身 mode 译（多服务器×双 mode 矩阵测试覆盖）。② 桥输出 3 个 fork 相邻事件名 `session.patched`/`message.patched`/`message.tool.transition`（reducer 增 v2-only 合并 case，v1 wire 永不产出——沿用 form.* 先例）；catalog.updated → 新 `stores/catalogRefresh.ts` 限速重读（上游 654705f7d port）。③ 发送路径：`client.ts` sendMessage/sendCommand 增 v2 分支——`resolveSdkHandle` 双轨句柄 + `sendWithProviderCircuit` 熔断共享 + `session.switchModel/switchAgent`（capture-at-queue-time 语义保全）+ `session.prompt`（client 生成 id，optimistic 原位回填）+ skills 附着与 404 退让（#4 基座）；structured format 在 v2 轨显式报错不静默。④ SegB：#4 61e6535cf（v2 下 /skill 走 prompt 路由+`buildSkillMentionInstruction` 共享，v1 保持 skill→command）、#96 b504deb88（assistant retry 倒计时，附加读 v1 无此字段零变化）、#166 a2297eb1b（`<subagent>` 信封解包，附加）、#48 cb7400923 UI 半（`getCurrentSessionAssist` 按 protocol track 分支：v2 用 generatedAt≥idle+未 revert 规则，v1 保持 forMessageID 规则）。⑤ S5 挂账落地：runtime-fetch coalesce key 加 `x-opencode-directory`（v1 key 空间不变）、session-status schema 容忍 v2 ask 命名+`forms` 桶、server pending tracker 追踪 form.created/settled、session-goal/assist/contextObligatory/linear 切 hub translated intake。
  **验证**：type-check 8 包 0 错；eslint 全部触及文件 0 错；sync 全目录失败集对 HEAD 基线 worktree 差集为空（基线自身 136 个并行 flake，本批 0 新增，隔离跑两树同为既有 2 个失败文件）；opencode lib 套件=基线+新桥测试；runtime-fetch 28 过；web vitest 全量跑（见下）。新测试：wire-bridge 16、v2-intake 10（双 mode 矩阵+reducer case）、v2-send 13、catalogRefresh 4。
  **单点挂账（R7 差距清单，待 projection/S8 轮）**：桥不译 plumbing-role 消息（synthetic/skill/instructions/switch notices——fork message store 为 user/assistant 形状）、shell.*（fork 走请求-响应）、compaction.*（无 fork role，展示差距）、session.viewed、revert.committed 的本地裁剪（下次拉取对账）；sendShell/abort/revert/fork 尚未上 v2 分支（S8 对齐 ../opencode 后统一）；#48 服务端 retireStored（需 metadata 删除写路径，客户端规则已覆盖用户可见行为）；useSmallModelStore 未移植（fork `lib/smallModel.ts` 经 S4 双轨 server 端点已服务两轨）。
- **B3 完成**（2026-10-02，2 commits：d84bf8b88 权限三模式 68 文件、1e5441ba0 Enterprise 52 文件 + v2 plugin shape 280272412）。fork 语义保全：v1 请求路径保留、client 仅 auto 会话代答、schedule-task 布尔兼容、vscode on/off 视图保留。**B3 挂账的 index.js 侧四处接线已于 S8 落地**（见下：resolveLegacyEnabledMode、isPermissionAutoAnswered、relayAvailable enterprise 门、断网监听门）。
- **OC2-S8 完成**（2026-10-02，7 commits：44445e21b index 接线、cf9d56642 S3 挂账实体路由、e150ccb0a S7 dock 挂载、f71ef172f S6 缺口补译+v2 发送分支、9cae396d2 embedded 双布局、eed4cfe52 vscode OC2 探针、1f971e271 v2 mock 端到端冒烟）。脊柱 S1-S8 全部合入。逐项：
  ① index.js 最终接线：S2 四订阅者 translated intake（S6a 已落地，本批核对）；B1 shutdown/guests 3 行（beginGuestServiceShutdown/stopAllGuestServices/getRelayService 入 gracefulShutdownRuntime）；B3 四处（resolveLegacyEnabledMode 经 routingRuntime.legacySafetyNetEnabled、通知 getter 换 isPermissionAutoAnswered 且 notifications runtime 改 getter 优先——safety-held 请求恢复通知、relayAvailable 走 relayBlockedByEnterprise 门、断网门=isNetworkAccessBlocked 启动抛错+非 loopback 连接销毁，新增 lib/security/bind-host.js）；S4 注入 dataDir+broadcastGlobalUiEvent（persistSessionMetadata 不注入：service 回退路径等价，goal 臂随 #22）。S4 的 configureOpenCodeRuntimeProviders 核对已在（index.js:860）。
  ② S3 挂账：agents/commands v2-only 形状+两条 v2-only 路由（agents/:name/permissions、commands/:name/config，v1 404）、providers 双写形状（Spelling 归一+aisdk: 包名+providers section 写入）、50766fa0f 服务端半（hasCredential）；v1 不变有测试钉死（agents-v2/commands-v2/providers-v2 套件）。
  ③ S7 挂载：PermissionDock/usePermissionResponse/permissionToolPresentation 新建，PermissionCard 拆 PermissionRequestContent+PermissionActions（dock variant+i18n），ChatInput 按上游互斥挂载（Permission→Form→queue/suggestion，hasPendingForm 抑制），ChatContainer 移除内联卡片栈，sync-context 增 useScopedBlockingPermissions，i18n 9 键×12 locale。
  ④ S6 缺口补译：wire-bridge 增 message.record/message.record.delta——plumbing 通知（synthetic/skill/instructions/switched）、shell.*、compaction.* 译入新 `State.nativeRecords` 侧通道（fork message store 保持 user/assistant 形状；id upsert+shellID 回退匹配；缓存清理接线）；**渲染这些 role 仍是登记的展示差距**。发送侧：sendShell→session.shell（v2 直发不建 optimistic user message——无 echo 可对账、零搁浅）、abort→session.interrupt、revert→stage+读回、unrevert→clear+读回、fork→before 单 id；全部 handle.mode 门控+共享熔断。#48 服务端半：session-assist persist 追踪+新回合 retireStored（v2 门控，v1 保持只覆写，两轨各有测试）。
  ⑤ embedded 双布局：embedded-opencode.cjs 解析 v1 单二进制/v2 包目录（packages/opencode|packages/cli→dist/<target>/bin）/npm tarball（相对路径解包）；v2 source-only 树（JS stub）响亮报错（runbook：离线兜底必须真可执行）；版本归一兼容 `opencode v2.0.21-sscity`；签名/标识符/after-pack 顺序不动。
  ⑥ VS Code OC2 对位：opencode-server-probe 助手（/api/info 优先、global/health 回退、永不 throw、保留各调用点错误文案）；bridge-system-runtime 版本/健康、upgrade 状态、waitForReady、extension 诊断接线；proxy/sse/spawn 不动。
  **联调**：`scripts/oc2-v2-smoke.mjs` 9/9 腿全过——真 web server 对 scripted OC2 mock（loopback，SKIP_START+OPENCODE_HOST）：/api/info 探测记 v2 → 事件流经 hub+客户端 SSE（raw v2 形状含 permission.asked/form.created）→ v2 prompt/permission decision/form reply 走 OC 代理到 mock → stop() 干净退出。
  **验证**：type-check 8 包 0 错；触及文件 eslint 0 新增（全仓 lint 债为基线既有，逐文件比对 HEAD 确认）；web vitest 全量 3882 过/8 失败全部归因（5 spaces/code-out=HEAD 基线同败、config-file-watcher=S4 预declared 环境、guests/background=HEAD 基线同败、network-defaults=并行负载超时且隔离绿）；ui bun 全量失败集对 HEAD 基线差集为空（354 vs 355，均为并行 flake）；sync 全目录差集为空（同 S6 方法）。
  **仍挂账**：v2 激活门（J1-J10）待 ../opencode 2.x 就绪后统一执行；nativeRecords 渲染面；MERGE_V1.12.md 脊柱各批证据补录（本批已录，S1-S7 证据随各批 commit message+本台账）。
- **B5 进行中**：files/editor + CodeMirror 三连 + multirun composer。
- **B8 Spaces 接线批完成**（2026-10-02，4 commits：3e56d479f server+proxy、640074aec runtime-fetch+terminal、5845ba7af sidebar/composer/挂载/Archive、台账 MERGE_V1.12.md）：鸿蒙落地+OC2 S6/S8 后 6 项挂账全收口。switch 默认关零行为变化（journey 读 gating、拒绝路径 fall-through）；fork 多服务器重适：合并只在宿主 OpenCode proxy lane、remote lane 永不合并；index.js 与 OC2/guests/enterprise 四套接线逐处核对共存。type-check 0 错，ui 触及域 342 测试绿。Header 标题 hunk 与 realtime-proxy allowlist 为 fork 无表面 N/A。
- **待鸿蒙让位后补（更新 2026-10-02）**：MERGE_V1.12.md 台账（B1 14 条 + 脊柱 S1-S7 + B3 明细）仍待补录；index.js 接线/S8 final wiring/VS Code OC2 探针 **已落地**（S8）；VS Code enterprise-policy 桥路由待 B 系 Enterprise 批对账；MobileApp 2 行待鸿蒙面归属确认。
- **等价核实挂账**：启动族 3 项（367e5c926/2832c9254/b3760852e）；perf 3 项（40a17b11a/7a5568769/32d0b4de0）；#88 retention 等价核实；PR 家族对齐核对（D10）。
- **stash 遗留**：事故副本 stash@{2}（f305b975b WIP 重复件）仍待用户审后清理。

## 验证计划

沿用：type-check（8 包）/ packages/web vitest / build / signature token / 人工回归。
