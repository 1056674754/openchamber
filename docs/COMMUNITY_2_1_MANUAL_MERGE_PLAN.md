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
| D1 | OC2 脊柱（~450 文件）拆 6-8 子批"代码先行、运行时门控" | 执行 | 待确认 |
| D2 | Spaces 隔离空间（~24k 行，跨三段 + Docker 依赖） | 单独末批或延后 | 待拍板 |
| D3 | Enterprise 模式（6c：策略文件/扩展白名单/断网） | 待拍板（单机自用大概率不做） | 待拍板 |
| D4 | nl 第 12 locale | 随 i18n 收尾批补齐 | 默认执行 |
| D5 | 触鸿蒙未提交文件的 8 个 commit | 与鸿蒙落地时间协调排序 | 协调项 |
| D6 | Excalidraw 只按 #192 扩展终态移植（跳过中间态） | 按分类建议 | 默认执行 |
| D7 | 评论模式块（SegA 5c） | 整块引入 | 待确认 |
| D8 | #88 会话历史逐出 vs fork 自有 retention | 先做等价核实 | 默认执行 |
| D9 | dictation ×2、上游 markdownCore 修复、浏览器标注 | 不做（fork 自研/无表面） | 按分类建议 |
| D10 | PR 家族对齐上游 vs 保留 fork 自研 pr-status | 待核对后定 | 待确认 |

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

## 验证计划

沿用：type-check（8 包）/ packages/web vitest / build / signature token / 人工回归。
