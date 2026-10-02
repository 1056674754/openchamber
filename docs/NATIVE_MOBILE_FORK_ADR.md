# ADR — Native Mobile (Capacitor iOS + Android) Fork Adaptation

Status: **Accepted (implementation in progress via [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9))**
Date: 2026-07-26
Work Item: [#9](https://coding.s-s.city/songsong/openchamber/-/work_items/9)
Related: [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16) private relay / pairing (desktop design accepted; mobile pairing non-goal for this cut)
Non-goals: Oniro / OpenHarmony Capacitor adapter; ArkUI Harmony shell; App Store / 华为商店 signing pipelines; APNs/FCM Push; pairing v2 / `openchamber://` redeem; replacing fork desktop multi-instance with upstream single-runtime assumptions.

## Context

Upstream introduced `packages/mobile` (Capacitor) around v1.13.9. The native shell bundles a dedicated `mobile.html` → `MobileApp` web surface; the phone does **not** embed OpenChamber/OpenCode servers. Users connect to an existing desktop/server URL (LAN, tunnel, reverse proxy).

This fork already differs from upstream connectivity:

| Surface | Authority |
|---|---|
| Desktop / web multi-instance | `serverRegistry` + `serverId + directory` |
| Upstream mobile tip | Often `switchRuntimeEndpoint` as the sole active runtime |

Blindly importing upstream `MobileApp` (~full Instances/pairing/push/composer redesign) would conflict with registry semantics and pull many unfinished fork dependencies (relay, push, MobileSessionsSheet).

Today’s phone path without a native shell remains: browser/PWA against a desktop-exposed URL. That is **not** native app delivery.

## Decision drivers

1. First cut must ship a real Capacitor iOS + Android shell that can chat against a LAN/desktop host.
2. Connection must register a fork `serverId` and keep `serverRegistry` authoritative; do not treat bare `switchRuntimeEndpoint` as a replacement for the registry.
3. Shared UI components stay in `packages/ui`; the app shell entry may differ (`MobileApp` vs `main.tsx` → `App`).
4. HarmonyOS is out of DoD: users may sideload the Android APK at their own risk; Oniro/ArkUI are separate future WIs if ever pursued. **Update (2026-09-19): the HarmonyOS track started as its own WI** — `packages/harmony`, a thin ArkTS/ArkWeb shell reusing the same `MobileApp` web build (no Capacitor/Oniro, per the "independent WI, not bound to Capacitor" decision below). See `packages/harmony/README.md`.
5. Store distribution, Push, and mobile pairing wait until the shell exists and #16 desktop transport work progresses.

## Decision

### In scope for #9 (first cut)

1. **Introduce `packages/mobile`** Capacitor project (iOS + Android) consuming `packages/web` `mobile.html` assets.
2. **Thin `MobileApp`**: connect URL + optional password unlock + saved instances list; after connect, render the existing shared `App` (not a full upstream mobile shell rewrite).
3. **Bridge**: `connectMobileEndpoint` calls `switchRuntimeEndpoint` **and** registers `mobile-active` (plus retargets `DEFAULT_SERVER_ID` for legacy readers) in `serverRegistry`.
4. **CORS/auth**: allow packaged WebView origins (`capacitor://localhost`, `https://localhost`, `openchamber-ui://app`) on the OpenChamber server.
5. **DoD**: iOS Simulator and/or device run; Android debug APK install + connect. Harmony sideload is optional self-test only.

### Explicit non-goals (first cut)

| Topic | Status |
|---|---|
| Oniro Capacitor-OpenHarmony | Rejected for #9 |
| ArkUI / 鸿蒙原生壳 | Unplanned; separate WI if needed |
| 鸿蒙 NEXT official support / acceptance gate | Not a #9 gate |
| App Store / 华为商店 / release signing CI | After #9 |
| APNs / FCM Push | After shell + server readiness |
| Pairing v2 / mobile redeem | #16 mobile face; not desktop ADR scope |
| Upstream MobileSessionsSheet / composer keyboard mega-refactor | Evaluate after shell lands |

## Consequences

- Epic [#1](https://coding.s-s.city/songsong/openchamber/-/issues/1) and [`docs/MERGE_V1.12.md`](MERGE_V1.12.md) keep a dedicated **Mobile** product track (web/PWA done vs native in progress vs unplanned).
- Desktop multi-instance UX remains unchanged; mobile first cut is single-active connection with registry IDs suitable for later multi-URL Instances expansion.
- #16 mobile pairing remains blocked on a shipped shell + desktop transport design, not on Oniro.
- Follow-ups under #9 (not required for first Done): APK/AAB updater distinction, iPad layout polish, CI debug build scripts.
