# Merge v1.12.0 → merge/v1.11.0

**Date**: 2026-06-04
**Upstream**: v1.11.7 (`5eccf83b`) → v1.12.0 (`996ffb08`), 56 commits, 347 files, +22816/-5022
**Method**: 手工逐功能点移植，禁止 git merge/force

---

## 已移植功能

| Batch | 功能 | 文件数 | 说明 |
|---|---|---|---|
| 1.1 | Markdown 换行修复 | 1 | `UserTextPart.tsx` 添加 `applyHardLineBreaks()` |
| 1.2 | StatusRow selector 优化 | 1 | `useDirectorySync` 窄选择器，避免无关 re-render |
| 1.3 | 队列消息修复 | 3 | `useQueuedMessageAutoSend` 移除 `firstSeenIdle` 路径；`QueuedMessageChips` 重写为卡片式 UI + Edit/Send 按钮；`ChatInput` 集成发送逻辑 |
| 1.4 | ForkSessionDialog | 9 | 新建 `ThinkingPill`、`ForkSessionDialog` 组件；`executionMeta` 新增 fork 常量和 `composeForkSessionMessage`；`MessageBody` 集成对话框工作流；`session-ui-store` 签名改为接受 execution 参数；`sessionTypes`、`api/types` 类型更新 |
| 1.5 | JetBrains 主题 | 3 | `jetbrains-dark.json`、`jetbrains-light.json`；`presets.ts` 注册 |
| 1.7 | Agent 定义 | 2 | `.opencode/agent/reproduce-issue.md`、`triage.md` — GitHub issue 自动复现和分类 agent |
| 1.8 | 会话历史加载修复 | 1 | `session-prefetch-cache.ts` — `shouldSkipSessionPrefetch` 逻辑重排，修复无消息会话误跳过预取的 bug（#1468） |
| 1.9 | 浏览器语音 variant | 1 | `useBrowserVoice.ts` 把 `variant` 参数传入 `sendMessage`，仅 6 行改动 |

**总计**: 26 files changed, +398/-84

---

## 未移植 / 还原 / 延后

### Batch 1.6 — Draft Welcome Starters + Chat 重构（已还原）

**涉及文件**: `ChatContainer.tsx`、`MessageList.tsx`、`useChatTimelineController.ts`、`session-prefetch-cache.ts` (+ 3 个新建文件: `draftStarters.ts`、`useDraftStarters.ts`、`DraftPresetChips.tsx`)

**为何还原**：首次应用后导致严重 bug：
- 聊天区域塌缩至 ~120×80px（`useCompactDraftLayout` / flex 布局变更）
- 会话列表不显示对话，显示 "No sessions in this workspace yet."，远程分支大量重复
- 运行时不稳（`handleHistoryScroll` 滚动检测效果引发测量死循环）

**新建文件保留**：`draftStarters.ts`、`useDraftStarters.ts`、`DraftPresetChips.tsx` 及相关 i18n 键、store 字段、persistence 逻辑均已写入，仅核心渲染管线（4 个文件）被 git checkout 还原。重新移植时只需重新处理这 4 个文件即可。

**重新移植建议**：拆成更小的独立改动——
1. 先移植 `handleHistoryScroll` 滚动加载逻辑（仅 `useChatTimelineController.ts`），测试无回归后再继续
2. 再移植 `ChatContainer` 的 draft welcome 布局（`DraftPresetChips` + `renderDraftTitle`），需仔细验证 flex 布局与现有 `isDesktopExpandedInput` 分支的兼容性
3. 最后移植 `MessageList` 的虚拟化优化，需验证与现有渲染逻辑不冲突

### Batch 1.10 — Mobile UI（延后）

**涉及文件**: 18 个文件，`packages/ui/src/apps/MobileApp.tsx` 等完整移动端应用层

**延后原因**：用户选择 "Port mobile but defer"；移动端是一个独立应用层，不与桌面端共用渲染管线，延后移植无风险。

---

## 跳过的功能

| 功能 | 原因 |
|---|---|
| 远程实例重构 (#1228) | 用户决定："官方改法已被我们抛弃"，我们的方案是 Electron server 转发 |
| VS Code adapter 主题颜色映射 | 不影响核心功能，暂不移植 |

---

## 验证

- `bun run type-check` — 全部通过 (0 errors)
- `bun run lint` — 通过 (0 errors, 3 pre-existing warnings)
- 服务端运行正常（`electron:dev`）
