# Web Multi-Instance: 从 Electron SSH 到 Web 远端代理

## 目标

Web/PWA 模式支持多个远端 OpenChamber 实例，体验与 Electron SSH 多实例一致：
sidebar 可见多实例，session 绑定到具体实例，SSE/消息/API 请求路由到正确后端。

## 现有架构

### Electron 模式（已实现）

```
Electron Main Process
  ├── ElectronSshManager (ssh-manager.mjs)
  │     SSH tunnel → http://127.0.0.1:{localPort} → 远端 OpenChamber
  │     生命周期: connect → probe → port-forward → health-monitor → reconnect
  │
  └── IPC (openchamber:invoke)
        desktop_ssh_connect/disconnect/status/instances_get/set

UI Layer
  ├── serverRegistry (server-registry.ts) — 核心：多 server 注册 + session→server 路由
  ├── useDesktopSshStore — SSH 状态管理，ready 时注册到 serverRegistry
  ├── MultiServerSyncLayer — 每个非 default server 挂一个独立 SyncProvider
  ├── resolveSdkForDirectory() — session→server→client 路由链
  └── DesktopHostSwitcher — 实例切换 UI
```

### Web 模式（现状：单实例）

```
OpenChamber Express (port 3000)
  ├── /api/* → proxy 到本地 OpenCode (http-proxy-middleware)
  ├── SSE → forwardSseRequest() 手动 fetch + stream
  ├── SSE → GlobalHub → WebSocket bridge (global-ws-bridge.js)
  └── 只有一个 OpenCode 后端 (openCodePort)
```

## 核心洞察：UI 层已支持多实例

以下组件**不需要改**，已经抽象为多 server：

| 组件 | 状态 |
|------|------|
| `serverRegistry` (server-registry.ts) | ✅ 多 server 注册、session 路由、health polling |
| `MultiServerSyncLayer` | ✅ 每个非 default server 挂独立 SyncProvider |
| `resolveSdkForDirectory()` (session-actions.ts) | ✅ session→server→client 路由链 |
| `session-ui-store.ts` setCurrentSession | ✅ 接受 serverId，indexSession |
| `useProjectsStore.ts` ProjectEntry.serverId | ✅ project 绑定 server |
| `OpencodeService` (client.ts) withDirectory | ✅ 切换到远端 SDK |

**缺的是：把远端实例注册到 serverRegistry 的 Web 通路。**

Electron 用 SSH tunnel + IPC 完成。Web 需要：server 端代理 + UI 端 store。

---

## 改动清单

### 第一部分：Server 端 — 远端代理层

#### 1.1 远端实例配置存储

**新增文件**: `packages/web/server/lib/remote-instances/config.ts` (或 .js)

配置存在 `settings.json` 的新字段 `remoteInstances`：

```jsonc
{
  "remoteInstances": [
    {
      "id": "prod-server",
      "label": "Production",
      "url": "https://prod.example.com:3000",
      "auth": {
        "type": "password",        // "password" | "bearer" | "none"
        "value": "encrypted:..."   // 或明文 password，跟现有 uiPassword 同策略
      },
      "connectionTimeoutSec": 30,
      "enabled": true
    }
  ]
}
```

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/web/server/lib/opencode/settings-runtime.js` | `sanitizeSettings()` 加入 `remoteInstances` 字段白名单；`readSettingsFromDiskMigrated()` 加入 migration |
| `packages/web/server/lib/opencode/settings-helpers.js` | `persistSettings()` 校验 remoteInstances schema |
| `packages/web/server/lib/opencode/core-routes.js` | `GET/PUT /api/config/settings` 已经透传，可能需要额外 `GET /api/remote-instances` + `PUT /api/remote-instances` 独立端点 |

#### 1.2 远端实例管理 API

**新增文件**: `packages/web/server/lib/remote-instances/routes.js`

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/remote-instances` | GET | 列出所有远端实例 + 状态 |
| `/api/remote-instances` | PUT | 批量更新实例配置 |
| `/api/remote-instances/:id/health` | GET | 探测指定实例健康状态 |
| `/api/remote-instances/:id/connect` | POST | 建立连接（probe health + 启动 SSE relay） |
| `/api/remote-instances/:id/disconnect` | POST | 断开连接（停止 SSE relay） |

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/web/server/index.js` | 在 main() 中 import 并注册 remote instance routes |

#### 1.3 远端 API 代理

**新增文件**: `packages/web/server/lib/remote-instances/proxy.js`

路由规则：`/api/remote/:instanceId/*` → 代理到 `remoteInstance.url/api/*`

实现方式：复用现有 `http-proxy-middleware` 模式（参考 `proxy.js`），但 target 动态解析：

```
GET /api/remote/prod-server/session
  → proxy to https://prod.example.com:3000/session
  → 注入远端实例的 auth headers
```

**关键细节**:

| 问题 | 方案 |
|------|------|
| target 解析 | 从 remoteInstances config 按 `instanceId` 查找 URL |
| Auth 注入 | 按 instance config 的 auth.type 注入对应 header |
| path rewrite | `^/api/remote/{instanceId}` → 空 |
| readiness gate | 远端不可用时返回 503，跟现有 OpenCode readiness gate 一致 |
| 错误处理 | 超时、连接失败返回结构化错误 `{ error, instanceId, upstreamStatus }` |

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/web/server/index.js` | 在 main() 中注册 remote proxy middleware，挂在普通 /api 路由之后 |

#### 1.4 远端 SSE Relay（最复杂的部分）

**新增文件**: `packages/web/server/lib/remote-instances/sse-relay.js`

浏览器不能直连远端 SSE。需要一个 server 端的 relay：

```
远端 OpenChamber SSE  ← upstream-reader ← sse-relay → /api/remote/:id/event → 浏览器 SSE
                                                              ↓
                                                    /api/remote/:id/event/ws → 浏览器 WS
```

**实现策略**：

复用现有 `upstream-reader.js`（已支持 SSE 解析 + 自动重连 + backoff），
为每个已连接的远端实例创建一个实例，事件 relay 到浏览器客户端。

需要为每个远端实例维护：

| 状态 | 说明 |
|------|------|
| upstreamReader | 连到远端 `/api/global/event` 的 SSE reader |
| subscribers | 浏览器 SSE 或 WS 客户端列表 |
| lastEventId | 断线重连游标 |
| healthState | 连接健康状态 |

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/web/server/index.js` | 注册 SSE relay 端点 `/api/remote/:id/event` 和 `/api/remote/:id/event/ws` |
| `packages/web/server/lib/event-stream/upstream-reader.js` | 可能需要提取为更通用的类，支持任意 upstream URL（目前硬编码依赖 buildOpenCodeUrl） |

#### 1.5 远端 Health Monitor

**新增文件**: `packages/web/server/lib/remote-instances/health-monitor.js`

定期 ping 远端 `/health`，更新状态，通过 SSE 推送给 UI。

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/web/server/index.js` | 在 main() 中启动 health monitor |

---

### 第二部分：UI 端 — Web 远端实例 Store

#### 2.1 Web 远端实例 Store（替代 Electron 的 useDesktopSshStore）

**新增文件**: `packages/ui/src/stores/useRemoteInstancesStore.ts`

职责与 `useDesktopSshStore` 平行，但不走 IPC，走 HTTP API：

| 功能 | Electron (现有) | Web (新增) |
|------|----------------|-----------|
| 实例列表 | `desktop_ssh_instances_get` IPC | `GET /api/remote-instances` |
| 保存配置 | `desktop_ssh_instances_set` IPC | `PUT /api/remote-instances` |
| 连接 | `desktop_ssh_connect` IPC → SSH tunnel | `POST /api/remote-instances/:id/connect` → server 端 probe |
| 断开 | `desktop_ssh_disconnect` IPC | `POST /api/remote-instances/:id/disconnect` |
| 状态 | IPC event `openchamber:ssh-instance-status` | SSE event 或 polling |
| 注册 serverRegistry | 在 `phase: 'ready'` 时 | 在 health check 通过时 |

Store 接口统一，组件通过同一个 store 接口消费，不关心底层是 SSH 还是 HTTP。

#### 2.2 ServerRegistry 注册

`useRemoteInstancesStore` 在实例健康时调用：

```typescript
serverRegistry.register({
  id: instance.id,
  label: instance.label,
  baseUrl: `/api/remote/${instance.id}`,   // 本 server 代理路径
  sseUrl: `/api/remote/${instance.id}`,     // SSE relay 路径
});
```

**注意**：baseUrl 指向本 server 的代理路径，不是远端直连 URL。浏览器只知道本 server。

#### 2.3 MultiServerSyncLayer 适配

**现有文件**: `packages/ui/src/sync/MultiServerSyncLayer.tsx`

`loadAdditionalServers()` 已经从 `serverRegistry.getAll()` 读取，不需要改。
只要 `serverRegistry.register()` 被正确调用，SyncProvider 自动挂载。

**但需要验证**：SSE URL 指向 `/api/remote/:id/event` 时，SyncProvider 的 SSE 连接逻辑是否兼容。
目前 SyncProvider 用 `useEventStream` hook，需要确认它能正确处理 `/api/remote/:id/` 前缀的路径。

**可能需要改动的文件**:

| 文件 | 改动 |
|------|------|
| `packages/ui/src/hooks/useEventStream.ts` | 确认 SSE 路径拼接逻辑，可能需要支持 serverId 前缀 |

#### 2.4 Host Switcher 适配

**现有文件**: `packages/ui/src/components/desktop/DesktopHostSwitcher.tsx`

当前逻辑：
- Web：`window.location.assign()` 跳转到新 URL
- Desktop bridge（Electron）：IPC connect → navigate

Web 多实例模式下，不应该 `window.location.assign()` 跳转。
应该在当前页面内：
1. 调用 `useRemoteInstancesStore.connect(id)`
2. 等待 serverRegistry 注册完成
3. 切换活跃实例

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/ui/src/components/desktop/DesktopHostSwitcher.tsx` | 添加 Web 多实例模式分支：不走 `window.location.assign()`，改用 store + serverRegistry |

#### 2.5 Settings UI 适配

**现有文件**:
- `packages/ui/src/components/sections/remote-instances/RemoteInstancesSidebar.tsx`
- `packages/ui/src/components/sections/remote-instances/RemoteInstancesPage.tsx`

当前这些组件硬编码使用 `desktopSshStore`（Electron preload IPC）。

**改动**:

| 文件 | 改动 |
|------|------|
| `RemoteInstancesSidebar.tsx` | 替换数据源：`useDesktopSshStore` → `useRemoteInstancesStore`（自动选择 SSH 或 HTTP） |
| `RemoteInstancesPage.tsx` | 表单字段：SSH 模式显示 SSH 命令等字段，Web 模式显示 URL + auth 字段。条件渲染 |
| `packages/ui/src/lib/desktopSsh.ts` | 类型提取：`DesktopSshInstance` 的通用部分（id, label, auth）可以复用，新增 `WebRemoteInstance` 类型 |

---

### 第三部分：共享抽象层

#### 3.1 统一远端实例接口

**新增文件**: `packages/ui/src/lib/remote-instances/types.ts`

```typescript
// Electron 和 Web 共用的远端实例接口
interface RemoteInstanceBase {
  id: string;
  label: string;
  auth: { type: "password" | "bearer" | "none"; value?: string };
  enabled: boolean;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  errorMessage?: string;
}

// Electron 专用：SSH 配置
interface SshRemoteInstance extends RemoteInstanceBase {
  transport: "ssh";
  sshCommand: string;
  remoteOpenchamber: { mode: "managed" | "external"; ... };
  localForward: { bindHost: string; preferredLocalPort: number };
  portForwards: PortForward[];
}

// Web 专用：HTTP 直连
interface HttpRemoteInstance extends RemoteInstanceBase {
  transport: "http";
  url: string;
  connectionTimeoutSec: number;
}

type RemoteInstance = SshRemoteInstance | HttpRemoteInstance;
```

#### 3.2 统一 Store 接口

`useRemoteInstancesStore` 提供统一接口，内部根据 runtime 分发：

```typescript
// 统一接口
interface RemoteInstancesStoreApi {
  instances: RemoteInstance[];
  connect(id: string): Promise<void>;
  disconnect(id: string): void;
  getStatus(id: string): ConnectionStatus;
  saveInstances(instances: RemoteInstance[]): Promise<void>;
}

// 内部实现
// Electron runtime → 转发到 useDesktopSshStore (IPC)
// Web runtime → 转发到 /api/remote-instances (HTTP)
```

**改动文件**:

| 文件 | 改动 |
|------|------|
| `packages/ui/src/stores/useDesktopSshStore.ts` | 不删除，作为 Electron 的实现层 |
| 新增 `packages/ui/src/stores/useRemoteInstancesStore.ts` | 统一 facade，根据 runtime 选择实现 |
| `packages/ui/src/lib/runtime.ts` (或类似) | 检测当前 runtime：electron / web / vscode |

---

### 第四部分：Server 端注册集成

**改动文件**: `packages/web/server/index.js`

在 `main()` 函数中集成所有新模块：

```javascript
// 1. 加载远端实例配置
const remoteInstancesRuntime = createRemoteInstancesRuntime({ settings });

// 2. 注册管理 API
registerRemoteInstanceRoutes(app, remoteInstancesRuntime);

// 3. 注册远端代理 (在 /api 路由之后)
registerRemoteProxy(app, remoteInstancesRuntime);

// 4. 注册远端 SSE relay
registerRemoteSseRelay(app, remoteInstancesRuntime);

// 5. 启动 health monitor
remoteInstancesRuntime.startHealthMonitoring();

// 6. 在 shutdown 时清理
gracefulShutdownRuntime.addCleanup(() => remoteInstancesRuntime.shutdown());
```

---

## 文件改动总表

### 新增文件（Server 端）

| 文件 | 职责 |
|------|------|
| `packages/web/server/lib/remote-instances/config.js` | 远端实例配置读取/校验/持久化 |
| `packages/web/server/lib/remote-instances/routes.js` | CRUD API + connect/disconnect 端点 |
| `packages/web/server/lib/remote-instances/proxy.js` | `/api/remote/:id/*` → 远端 OpenChamber 代理 |
| `packages/web/server/lib/remote-instances/sse-relay.js` | 远端 SSE → 浏览器 SSE/WS relay |
| `packages/web/server/lib/remote-instances/health-monitor.js` | 远端实例健康探测 |

### 新增文件（UI 端）

| 文件 | 职责 |
|------|------|
| `packages/ui/src/lib/remote-instances/types.ts` | 统一远端实例类型定义 |
| `packages/ui/src/stores/useRemoteInstancesStore.ts` | 统一 store facade |

### 改动文件（Server 端）

| 文件 | 改动范围 |
|------|---------|
| `packages/web/server/index.js` | 集成新模块（~50 行），注册路由 |
| `packages/web/server/lib/opencode/settings-runtime.js` | remoteInstances 字段白名单 + migration |
| `packages/web/server/lib/opencode/settings-helpers.js` | 校验 remoteInstances schema |
| `packages/web/server/lib/opencode/core-routes.js` | 可能新增独立 CRUD 端点 |
| `packages/web/server/lib/event-stream/upstream-reader.js` | 泛化：支持任意 upstream URL |

### 改动文件（UI 端）

| 文件 | 改动范围 |
|------|---------|
| `packages/ui/src/components/desktop/DesktopHostSwitcher.tsx` | Web 模式分支：不走 location.assign |
| `packages/ui/src/components/sections/remote-instances/RemoteInstancesSidebar.tsx` | 数据源切换到统一 store |
| `packages/ui/src/components/sections/remote-instances/RemoteInstancesPage.tsx` | Web 模式表单字段（URL + auth） |
| `packages/ui/src/hooks/useEventStream.ts` | 可能需支持 `/api/remote/:id/` 前缀路径 |
| `packages/ui/src/lib/desktopSsh.ts` | 类型提取/复用 |

### 不需要改的文件

| 文件 | 原因 |
|------|------|
| `packages/ui/src/lib/opencode/server-registry.ts` | 已支持多 server，只需正确 register |
| `packages/ui/src/sync/MultiServerSyncLayer.tsx` | 已支持多 SyncProvider，自动从 registry 读取 |
| `packages/ui/src/sync/session-actions.ts` | 路由链已支持 serverId |
| `packages/ui/src/sync/session-ui-store.ts` | setCurrentSession 已支持 serverId |
| `packages/ui/src/stores/useProjectsStore.ts` | ProjectEntry.serverId 已有 |
| `packages/ui/src/lib/opencode/client.ts` | withDirectory 已支持远端 SDK |
| `packages/ui/src/sync/sync-context.tsx` | SyncProvider 已支持 serverId + baseUrl |

---

## 实现顺序建议

```
Phase 1: 数据通路（让数据能流）
  1. Server: remote-instances config 存储
  2. Server: /api/remote-instances CRUD API
  3. Server: /api/remote/:id/* API 代理（不含 SSE）
  4. UI: useRemoteInstancesStore（CRUD + connect）
  5. UI: serverRegistry.register() 调用
  → 验证：能通过代理创建远端 session、发消息

Phase 2: 实时事件（让 SSE 能流）
  6. Server: SSE relay (upstream-reader 泛化 + per-instance relay)
  7. Server: WS relay (复用 global-ws-bridge 模式)
  8. UI: useEventStream 适配 /api/remote/:id/ 前缀
  → 验证：远端 session 的消息能实时流到浏览器

Phase 3: UI 完善
  9. UI: HostSwitcher Web 模式分支
  10. UI: RemoteInstancesSettings Web 表单
  11. UI: Health status 显示
  → 验证：完整的多实例切换体验

Phase 4: 健壮性
  12. Server: 远端 health monitor + 自动重连
  13. Server: readiness gate（远端不可用时的 503）
  14. Server: 错误处理 + 超时
  15. Server: graceful shutdown 清理远端连接
```

---

## 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| SSE relay 复杂度 | 每个远端实例需要独立的 upstream reader + subscriber 管理 | 复用 upstream-reader.js，它已有重连/错误处理 |
| WebSocket relay | 现有 WS bridge 假设单一 upstream | 评估是否需要 per-instance WS bridge，或复用 global-ws-bridge 实例化 |
| Auth 传递 | 远端 OpenChamber 可能有 UI password，需要正确注入 | 跟现有 OpenCode auth 传递模式一致（Basic/Bearer header） |
| settings.json 并发 | Web + Electron 同时运行可能冲突 | 已有 promise lock（persistSettings），但需要测试 |
| 远端版本兼容 | 远端 OpenChamber 版本不一致可能导致 API 不兼容 | 在 health check 时带版本号，UI 层做兼容判断 |
| useEventStream 路径 | SyncProvider 的 SSE 连接路径是否支持 serverId 前缀 | Phase 2 第一步验证，可能需要小改 |
