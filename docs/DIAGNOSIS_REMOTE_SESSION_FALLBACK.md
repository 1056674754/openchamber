# Diagnosis Notes: Remote Session File Open Failure (Fallback-to-Global Pitfall)

> 诊断思想记录。补足 [`DIRECTORY_AND_SESSION_CONTEXT_AUDIT.md`](DIRECTORY_AND_SESSION_CONTEXT_AUDIT.md) 缺失的"怎么发现问题"的方法论维度。
> 那次修复是对该审计结论（*"The most dangerous current pattern is mixing authoritative session/project/server context with mutable singleton `opencodeClient.currentDirectory`"*）的一次实锤验证。

## 症状

- 环境：本地 Electron（UI + server）通过 SSH tunnel 连远程 Dev3；远程目录 `/root/novel_editor`（**非 git 仓库**）
- 现象：点击远程文件，ContextPanel 文件面板显示 **"Pick a file from the tree"**，正文不显示
- 用户报告："**重启**之后又能开了"——偶发 503 "Remote instance not available"，重启即恢复

## 诊断时间线（两轮，方向完全不同）

### 第一轮（Sisyphus）：在症状层找 race —— 错误方向

1. 抓点击文件时的 fetch 时序 + `localStorage` byRoot 写入
2. 观察到 `handleOpenFile` 写入 `selectedPath=/root/novel_editor/AGENTS.md` 成功 → **紧接着** byRoot 被清空（`selectedPath:null, openPaths:[]`）
3. 误判为 store action 层同步 race：
   - grep `removeOpenPath` / `setSelectedPath` 全部调用点（FilesView / SidebarFilesTree）
   - 顺手修了 4 个周边 bug：`isPathWithinRoot` 放宽绝对路径、`shouldProbeRepository` 止 git/check 风暴、RightSidebarTabs git ref 循环、`readFileContent` 远程走 fetch
   - 在 store action 入口加 `[DBG]` log 准备抓业务栈
4. 结论：**未定位根因**，race 源不明

### 第二轮（codex）：在路由层找 serverId 解析 —— 正确方向

1. 直接指出证据不成立："只证明了**点击时**能读，没证明**刷新后**仍正常"
2. 识别出故障在**冷刷新/路由恢复**路径，不在热交互（点击）路径
3. 根因：`useRouter.applyRoute` 解析直接路由（URL 带 sessionId）时，`serverRegistry.getServerForSession(sessionId)` 未 index → `undefined` → **fallback 到本地默认 client**（`opencodeClient.getSdkClient()`）→ 用本地 client 查远程 session → 404 → `setCurrentSession(sessionId, undefined)` → FilesView 目录解析失败 → 清空 byRoot → 空状态 UI

## 根因机制：fallback 到全局默认的连锁反应

原项目设计埋坑的模式：**状态缺失时静默 fallback 到全局默认 / 全局 current state**。

本案例的完整链条（每一环都"看似合理"，叠加起来把远程 session 当本地处理）：

```
serverId 未 index
  → fallback 到本地默认 client
    → 用本地 client 查远程 session → 404
      → catch 静默吞错，directory 保持空
        → setCurrentSession(空 directory)
          → FilesView 目录解析失败
            → 清空 byRoot
              → 空状态 UI "Pick a file from the tree"
```

## 修复：权威绑定优先（`useRouter.ts:74-108`）

4 层，按权威降序，每层确定 `serverId` 后立即 `serverRegistry.indexSession` 巩固绑定：

1. **project 绑定（最高权威）**：`useSessionProjectStore.getProject(sessionId)` → `useProjectsStore.projects.find(id)` → `project.serverId`（用户明确配置的归属）
2. **持久化 last-session**：`readLastActiveSession(getRuntimeKey())`——sessionId 匹配且 serverId 一致时用持久化 directory 作 hint
3. **远程查询（兜底）**：仍未解析出 directory 时，远程走 `getOrRegisterRemoteConnection(serverId, label)` 拿远程 client 查 `session.directory`
4. 顺带限制远程文件状态请求并发，避免远程通道拥塞

## 诊断方法论教训（可复用原则）

1. **症状在下游，根因在上游。** 清空 byRoot 只是下游消费者对"目录解析失败"的连锁反应；真正的源头在路由/数据源层的 serverId 解析。盯症状（store action 谁调用的）永远修不到根因。
2. **证据要有时机维度。** "写入成功 + 某刻清空"只证明两个时间点，不证明因果关系。必须区分热交互（点击）与冷启动/刷新路径，并分别取证。
3. **用户的线索指向路径。** "重启后能开"直接暗示冷启动/路由恢复路径的 bug，而不是点击路径。诊断时把用户措辞当第一手证据。
4. **权威 context 优先于全局 current state。** 解析任何 entity（session/project/server）时，先找该 entity 自己的权威绑定；只有在确无绑定且该 fallback 语义安全时才用全局值，并显式记录。
5. **诊断 log 加在数据流源头。** 在 store action 层加 log，栈只会指向上游调用者，还是要人工上溯。应加在路由/解析入口（打印 sessionId/serverId/directory 的解析过程），一次看清整条链。
6. **证据不足以排除替代解释时，显式列出候选逐一证伪。** 不要因为一个解释能解释部分现象就锁定它。候选：刷新路径？路由变化？SSE 事件？存储回放？——逐一排除。

## 关联

- [`DIRECTORY_AND_SESSION_CONTEXT_AUDIT.md`](DIRECTORY_AND_SESSION_CONTEXT_AUDIT.md)：完整的 fallback 清单（Allowed / Conditionally Allowed / Forbidden）+ 12 项修复清单 + 高危文件。本次修复验证了其中"session 解析必须用权威绑定"的论断，属该清单第 6 项（`requireSessionDirectory`）方向的局部落地。
- 修复代码：`packages/ui/src/hooks/useRouter.ts:74-108`
- 回归测试：`packages/ui/src/hooks/useRouter.test.ts`（`restores remote ownership before applying a persisted direct session route`）
