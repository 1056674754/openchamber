# 扩展/SDK 轮：v1.22.2..v1.24.2 guests + @openchamber/sdk（2026-09-20 启动）

主轮（[COMMUNITY_1_24_MANUAL_MERGE_PLAN.md](COMMUNITY_1_24_MANUAL_MERGE_PLAN.md)，110 commits）把扩展/SDK 系统整轮延后；本轮回补。上游 commit 链 20 个（去 release/CI）：`5181bcd33`(#3460) → `e0cb68fc6` → `43d1fff2e` → `260913b53` → `4c6963392` → `201a5c83a` → `b59ab5671` → `9df61f0f3` → `70b7aacbf` → `1a3b47842` → `ecad0a2db` → `4adb70398` → `1d945a4f3`，加 `03811ff52`(脚本)、`10c51f678`/`aaaf3ba28`(SDK 升级)、`6ab756350`/`e4b235bf4`(Docker)、`f3752d534`(lockfile)。

## 规模

| 部分 | 文件数 | fork 现状 |
| --- | ---: | --- |
| packages/sdk | 100 | 无（整包新增） |
| packages/extensions | 3 | 无（内置注册表） |
| packages/web/server/lib/guests | 41 | 无 |
| ui extensions/guests 面 | ~20 | PluginsPage 等 6 文件为 fork 旧版 plugin 系统；ExtensionsPage/GuestHosts/PluginPane/guestCommands 全缺 |

## 主轮记录的集成缺口（本轮回补清单）

- `5181bcd33` 非 sdk 部分：ChatInput guest 命令（279/11）、ui-auth（43/8）、MessageBody/ToolPart guest 渲染、runtime-auth（54/24）、guests server 全套
- `e0cb68fc6` ui 侧：worktreeCreate（18/6）、worktreeManager、sync/global-session-status（38/4——B6a 已落基础版 7574d5b8c，对 delta）
- B1 跳过：ExtensionsPage(853)/PluginPane/GuestHosts、settings extensions 页 case、guests html-styles（70b7aacbf）
- SDK 升级 1.18.30（D13 归本轮）+ Docker 两笔（sdk workspace 落地后才有意）
- fork 自研 `third-party-integrations.i18n.ts`（9151cefe6）为独立功能，**保留不动**

## 批次

| 批 | 内容 | 状态 |
| --- | --- | --- |
| E1 | server guests 41 文件 + 接线 + runtime-auth/ui-auth server 面 | ✅ **已完成（5 commits：fee72f765 → ca8eff9c3）**：catalog/install(OAuth+git identities)/auth-store/files/service(epoch 取消+loopback spawn)/storage/sockets/updates/upload/builtins/html-tokens + routes.js 23 端点 + `POST /auth/url-token?scope=guest:` 作用域 token + core-routes OAuth 回调免鉴权 + index.js stop() async 停 guest services。149 测试全绿。**契约**（供 E3）：`GET /api/guests` catalog、`POST /api/guests|upload`、`PUT :id/capabilities|enabled|service/sockets`、oauth/status|client|token|settings|start、代理 `:id/request|service/request|files|generate|storage`、资产 `GET /api/guests/:id/{*path}` |
| E2 | packages/sdk + extensions 整包 + build 脚本 + SDK 升级 + Docker | ✅ **已完成（5 commits：3240a64bb → ad0736499）**：sdk 100 文件终态（examples bundles 用本机 bun 1.3.14 重生成，168/168 绿）+ extensions registry（空表）+ build-builtin-extensions 脚本 + bun-executable helper + **SDK ^1.18.4→精确 1.18.31**（对照实验证明 5 个超时 flake 非升级回归）+ Dockerfile sdk workspace。**契约**（供 E3）：apiVersion 1、`OPENCHAMBER_SDK_API_VERSION=1` envelope、panel iframe connectHost、contributes.service 走 host spawn+127.0.0.1 临时端口、权限分 exec/sockets、exports `.`/`/schemas`/`/ui` |
| E3 | ui 集成：ExtensionsPage/PluginPane/GuestHosts 家族、guest 渲染（MessageBody/ToolPart/GuestToolTable）、guestCommands+ChatInput、ui-auth、worktreeCreate/Manager、global-session-status delta、i18n | ✅ **已完成（6 commits：ce7ecfe0d → 4d956f31c，154 文件 +13417）**：guest client `lib/guests/` 61 文件终态 + surfaces/registry（fork 保 preview mode）+ Extensions 页 + IntegrationsPage 并入 GuestIntegrationsSection（保 fork 三方集成区）+ guest 渲染 + guestCommands 接 ChatInput（B5 后结构：handleSubmit 在 unsynced-skill 后、consumeDrafts 前；slash 用 fork parseSlashInvocation）+ App.tsx 挂 GuestHosts（Header/MainLayout 有并行改动改挂 App）+ plugins/ 对齐上游终态（去 restartDeferred、保 fork 导出）+ worktree runtime 守卫 + i18n 3 模块 × 11 locale。触及域 268 测试全绿 |
| E4 | 收尾：9df61f0f3/70b7aacbf/1a3b47842 尾巴核对 + 三绿 + 台账 | ✅ **已完成（2026-09-20）**。尾巴核对：三 commit 文件面均已被 E1/E2/E3 终态吸收；两处**有意分叉**记录（ssh-install.test 满载加固 timeout、bun-test-shim 保留 mock.restore——fork routes.test.js 在用）。三绿全过。**local install 实测**（隔离数据目录 + 独立端口 3469，curl 驱动 API）：本地 folder 安装 ✅ → catalog 列出 ✅ → panel 资产 200/html ✅ → enabled 开关 ✅ → zip 上传 replace=true ✅（source 转 zip 落 data-dir extensions/）。**浏览器 UI 级验证受阻**（非移植问题）：工作区含并行会话对 `SessionAuthGate.tsx` 的未提交改动，解锁后 clientToken 注册不稳定导致 /api 401 闪断；待其入库后重测 UI 流 |

## 规矩（沿用主轮）

只读 diff 手工移植；fork 自研优先（多服务器/serverId、plugin 旧版语义、third-party-integrations）；绝不 git stash；不碰 harmony 会话未提交文件；每批 type-check + 测试 + 独立 commit。

## 决策记录

- D13（SDK 升 1.18.30）→ 本轮执行，升级后全量 type-check + web 相关域测试作回归门。
