# Epic #1 — paste target: independent `## Mobile` section

> Applied to epic [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1). MERGE mirror: `docs/MERGE_V1.12.md` →「Mobile 产品轨道」。ADR: `docs/NATIVE_MOBILE_FORK_ADR.md`。

```markdown
## Mobile

联结现实（fork 今天）：手机 = 浏览器/PWA 打开桌面暴露的 URL（LAN / Tunnel `/connect?t=` / 反代）；另有 Capacitor 原生壳（[#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) 第一刀已落地）。
UI 现实：共享 `packages/ui` 组件；Capacitor 另有入口壳 `MobileApp`。业务组件一套，App 壳不是同一文件。

**Instances 契约（纠正）**：多 host **要有**。权威在 Electron；手机与桌面 UI 拉取 host **已聚合**的 instances 列表，**禁止**客户端为列表/侧栏对每个 remote 再挂一套 sync fanout。一次会话连接仍是单 URL；列表 ≠ 并行多 Sync 引擎。

### A. 已做（Web / PWA mobile surface — 无原生壳）

这些是「手机浏览器可用」的选合，**不等于** native UX 已收口：

- [x] PWA keyboard / safe-area / auth fallback（web）
- [x] Mobile typography + composer controls（web）
- [x] Mobile history prefetch / virtualizer overscan（web）
- [x] Mobile Markdown file-reference probe guard（web）
- [x] Mobile 子会话箭头触摸尺寸（web）
- [x] VS Code 不被 `mobile.css` 误伤（desktop-runtime 判定）
- [x] Terminal：mobile web hidden-input autofocus（[#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) 协议已关；web touch only）
- [x] `MobileSessionStatusBar` 等沿用共享侧栏（已删上游独立 `MobileSessionsSheet` 路径）

跳过 / 架构不适用（记为不做，勿再开卡重复）：

- 官方独立 `MobileSessionsSheet` / `MobileChangesSurface` 整包（fork 共用多实例 `SessionSidebar`）
- 上游 v1.14 composer/keyboard mega-refactor 整包
- Oniro / ArkUI 鸿蒙原生壳
- 纯视觉 mobile shadows（无设计目标不跟）

### B. 进行中 / 已规划（Native Capacitor）

- [x] **[#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9) Native Capacitor iOS + Android（第一刀落地；子项仍开）**
  - 引入 `packages/mobile` + `mobile.html` / 薄壳 `MobileApp`
  - 连接：URL + 密码解锁 + Saved instances；`connectMobileEndpoint` = `switchRuntimeEndpoint` **+** `serverRegistry`
  - DoD：iOS Simulator/真机 + Android debug APK
  - **非 DoD**：鸿蒙侧载验收、商店上架、Push、pairing v2
- **#9 follow-up（合并顺序：chrome → composer → sidebar → packaging）**
  - [x] [#36](https://coding.s-s.city/songsong/openchamber/-/work_items/36) Capacitor native chrome：safe-area / keyboard inset / Instances·Disconnect
  - [x] [#37](https://coding.s-s.city/songsong/openchamber/-/work_items/37) Mobile composer/keyboard **增量**（非整包上游 v1.14）
  - [x] [#38](https://coding.s-s.city/songsong/openchamber/-/work_items/38) 窄屏会话侧栏 UX（共享 `SessionSidebar`）
  - [x] [#39](https://coding.s-s.city/songsong/openchamber/-/work_items/39) Android APK/AAB 更新器 + iPad 共享侧栏 + 本地 debug 脚本（无商店 CI）
- **P0 — 变轻 / 纠正 fanout（index [#40](https://coding.s-s.city/songsong/openchamber/-/work_items/40)）**
  - [x] [#41](https://coding.s-s.city/songsong/openchamber/-/work_items/41) M1 — instances 由 Electron 聚合下发；禁客户端逐 host Sync fanout（手机+桌面）
  - [x] [#42](https://coding.s-s.city/songsong/openchamber/-/work_items/42) M2 — 抽屉懒挂载 SessionSidebar / GitView
  - [x] [#43](https://coding.s-s.city/songsong/openchamber/-/work_items/43) M3 — Diff/shiki warmup 延后
  - [x] [#44](https://coding.s-s.city/songsong/openchamber/-/work_items/44) M4 — 抽屉关闭停轮询（open-only mount + hooks `enabled`）
  - [x] [#45](https://coding.s-s.city/songsong/openchamber/-/work_items/45) M5 — 空闲 CPU 验收写入 runbook（真机复测补 Evidence）
- **P1 — 机感（仍共用侧栏）**
  - [x] [#46](https://coding.s-s.city/songsong/openchamber/-/work_items/46) M6 — Capacitor 显示密度
  - [x] [#47](https://coding.s-s.city/songsong/openchamber/-/work_items/47) M7 — 键盘/composer 收口（不回归黑屏）
  - [x] [#48](https://coding.s-s.city/songsong/openchamber/-/work_items/48) M8 — 连接页 / 空会话密度
- **P2 — 产品缺口（有意后置，已开卡）**
  - [ ] [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) M9 — Capacitor Voice resume / dictation overlay（已挂 `appStateChange` → `openchamber:capacitor-resume`；dictation 待主轨）
  - [ ] [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) M10 — Push（APNs / FCM）
  - [x] [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) M11 — Pairing / redeem 移动面（QR + `openchamber://` + Instances transport）
  - [ ] [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) M12 — 商店签名 / CI release

### C. 相关但非 Mobile 主轨（交叉引用）

- [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) Private relay / pairing — **已实现**（桌面 Anywhere + 官方中继 + Mobile M11）；ADR Implemented
- [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) Voice — browser voice 可先做；Capacitor resume / overlay 见 M9
- [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19) Terminal v3 — **已关闭**；后置 terminalContext / shell UI / mobile fullscreen quick keys（仍不引入鸿蒙壳）

### D. 明确不做 / 后置说明

| 主题 | 状态 | 说明 |
|---|---|---|
| Oniro Capacitor-OpenHarmony | 不采用 | 0.1.x、插件不全；不进 #9 |
| ArkUI / 鸿蒙原生壳 | 已启动（独立轨道） | `packages/harmony`：ArkTS 薄壳 + ArkWeb 复用同一份 web 构建（不绑 Capacitor）；见 `packages/harmony/README.md` |
| 鸿蒙 NEXT 官方支持 | 未规划 | 用户可自测 Android APK；失败不阻塞 #9 |
| App Store / 华为商店上架与签名流水线 | 已开卡 | [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) |
| APNs / FCM Push | 已开卡 | [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) |
| Pairing v2 / `openchamber://` mobile redeem | ✅ #16 | M11 已落地（扫码 / deep link redeem） |
| 上游 Mobile composer/keyboard 大重构整包 | 不做 | 增量见 [#37](https://coding.s-s.city/songsong/openchamber/-/work_items/37) / [#47](https://coding.s-s.city/songsong/openchamber/-/work_items/47) |
| Terminal mobile fullscreen workspace / quick keys | 未规划 | #19 Phase4；web touch 另议 |
| 中央 `api.openchamber.dev` push relay | 未规划 | 产品/合规另定 |
```
