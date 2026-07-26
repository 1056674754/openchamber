# Native Mobile Runbook（fork #9）

Capacitor iOS + Android shell for OpenChamber. UI assets come from `packages/web` `mobile.html`; the phone talks to a remote OpenChamber host (desktop/serve). See [`NATIVE_MOBILE_FORK_ADR.md`](NATIVE_MOBILE_FORK_ADR.md).

## Prerequisites

- Workspace root: `bun install`
- Xcode + CocoaPods (iOS)
- JDK 21 + Android SDK platform/build-tools 35 (Android)
- A running OpenChamber host reachable from the device/simulator (LAN IP or tunnel)

Default tool paths (override with env):

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
- `JAVA_HOME=/opt/homebrew/opt/openjdk@21`
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` → Android command-line tools

## Build web mobile entry

```sh
bun run build:web          # must emit packages/web/dist/mobile.html
bun run --cwd packages/mobile build:assets
# or:
bun run mobile:build       # web build + assets
```

Root `bun run build` builds all non-mobile packages, then `packages/mobile build:assets`.

## Sync native projects

```sh
bun run mobile:sync
```

## iOS Simulator

```sh
bun run mobile:build:ios:simulator
bun run mobile:sim:run
```

Connect to `http://<lan-ip>:<port>` (not `127.0.0.1` from a physical device; Simulator can often reach host LAN).

## Android debug APK

```sh
bun run mobile:build:android:debug
```

APK path (typical):

`packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

Install with `adb install -r …` or Android Studio. HarmonyOS sideload is optional self-test and **not** a #9 acceptance gate.

## Connection / auth notes

- First launch shows connect URL (+ password when `/auth/session` requires it).
- After connect: Header **Instances** (server icon) opens saved connections / Disconnect (no floating Disconnect).
- Bridge registers `mobile-active` in `serverRegistry` and calls `switchRuntimeEndpoint` so `/api` resolves to the absolute host.
- Server must allow packaged origins: `capacitor://localhost`, `https://localhost`, `openchamber-ui://app` (see `packages/web/server/lib/security/request-security.js`).

## Local device debug scripts

Root wrappers (delegate to `packages/mobile`):

```sh
bun run mobile:android:devices
bun run mobile:android:install   # install latest debug APK via adb
bun run mobile:android:launch
bun run mobile:android:run       # install + launch
bun run mobile:android:logcat
bun run mobile:sim:boot
bun run mobile:sim:install
bun run mobile:sim:launch
bun run mobile:sim:run
```

## Update check (Android APK vs AAB)

- Capacitor clients send `appType=mobile-capacitor` + `platform=android|ios` to `/api/openchamber/update-check`.
- Server resolves a real `.apk` download URL when the update API points at an AAB (`resolveAndroidApkUrl` in `packages/web/server/lib/package-manager.js`).
- iOS has no APK path; release notes / store flow remain out of scope for local debug.
- Store signing / CI release workflows are still out of scope.

## iPad smoke

- Capacitor iPad uses shared `SessionSidebar` with a persistent left sidebar in landscape / width ≥768 (no `MobileSessionsSheet`).
- Portrait phone-width iPad still uses the mobile drawer chrome.
- Smoke: rotate landscape → sidebar stays visible; select a session; open Instances; keyboard does not cover composer.

## Composer / keyboard pick-list (#37)

| Accepted | Skipped |
|---|---|
| `--oc-keyboard-inset` + Capacitor Keyboard listeners | Upstream pill composer / fullscreen editor |
| Browser `visualViewport` → same CSS var | ComposerDictation / #11 |
| Touch `preventDefault` on model/attach controls | Full v1.14 MobileApp rewrite |
| Capacitor safe-area without `display-mode: standalone` | |

## Idle CPU acceptance（#40 / M5）

前置：已连 host、落在 chat、**左右抽屉关闭**、无 streaming。

| Check | Pass |
|---|---|
| 关抽屉后无 SessionSidebar 1.5s / multi-server 3s interval | Android Studio Profiler / Chrome Performance：空闲 5s 无周期尖峰 |
| 未打开 Git/Diff 前无 Diff worker / shiki warmup | 无 Worker 创建 / 大 WASM 拉取 |
| 关右抽屉后无 git light burst / `ensureAll` | Network 无周期 `/api/git/*` light status |
| Instances 列表有数据但不挂 N×SyncProvider | #41：仅 active remote 可有额外 Sync |
| 空闲 5s 平均 CPU | 目标 **&lt;15–20%**（相对改前 60%+） |

测量提示（Android）：Android Studio Profiler → CPU → Sample Java Methods，连上后静置 5–10s 取平均。iOS：Instruments Time Profiler 同场景。

## P2 backlog（未完成 — 不宣称关卡）

| WI | 主题 | 状态 |
|---|---|---|
| [#11](https://coding.s-s.city/songsong/openchamber/-/work_items/11) | Capacitor Voice resume / dictation overlay | 待 voice 主轨；本轮无 ComposerDictation 可接 |
| [#49](https://coding.s-s.city/songsong/openchamber/-/work_items/49) | Push APNs/FCM | 未实现 |
| [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) | Pairing / redeem 移动面 | 挂桌面 ADR；移动 UX 未做 |
| [#50](https://coding.s-s.city/songsong/openchamber/-/work_items/50) | 商店签名 / CI release | 仅本地 debug；无商店流水线 |

## Troubleshooting

- **Black screen after splash/logo**: broken Capacitor pack. `index.html` must reference `/assets/mobile-*.js`, and `android/.../public/assets/` must be present (tens of MB). Rebuild: `bun run mobile:sync` then `mobile:build:android:debug`. `prepare-web-assets.mjs` fails fast if the mobile entry or `dist/assets` is missing. Avoid Vite chunk names with a leading `.` (e.g. old `vendor-.bun-*`); aapt can drop them — chunk sanitizer now emits `vendor-bun-*`.

## Out of scope (do not block #9)

Store signing, Push (APNs/FCM), pairing v2, Oniro, ArkUI Harmony shell, CI release pipelines.

## Verification checklist

1. `bun run type-check:ui` / focused `mobileRuntimeBridge` tests green
2. `mobile.html` present after web build; `packages/mobile/dist/index.html` after assets
3. iOS Simulator: connect + chat against LAN host
4. Android debug APK: install + connect
5. Idle CPU acceptance（上表）在真机/模拟器复测并记入 Evidence
6. Epic #1 / MERGE Mobile：P0/P1 勾选；P2 仍为后置清单

## Evidence captured (2026-07-26 first cut)

| Check | Result |
|---|---|
| UI type-check / lint | green (after relay stub lint fix) |
| `mobileRuntimeBridge` + `runtime-auth` tests | 12 pass |
| `build:web` → `dist/mobile.html` | yes |
| `cap sync` | iOS + Android plugins updated |
| iOS Simulator | `build:ios:simulator` + `sim:run` → `com.openchamber.app` |
| Android debug APK | `app-debug.apk` (~28MB) under `android/app/build/outputs/apk/debug/` |
| Epic #1 Mobile section | written via glab (re-apply from `docs/gitlab-epic-1-mobile-section.md` if API 502) |
| Idle CPU（#40 / M5） | 门槛已写入；真机复测结果补本表 |
