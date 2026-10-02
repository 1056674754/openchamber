# OpenChamber HarmonyOS Shell

Native HarmonyOS (ArkTS + ArkWeb) shell loading the same web build as the
Capacitor iOS/Android apps (`MobileApp` renderer). Per
`docs/NATIVE_MOBILE_FORK_ADR.md` this is an independent track — no Capacitor,
no Oniro. It mirrors `packages/mobile` architecturally: thin shell, bundled web
assets, JS bridge for native capabilities.

## Architecture

- **Web bundle**: `packages/web/dist` copied into
  `entry/src/main/resources/rawfile/www/` by `scripts/prepare-web-assets.mjs`
  (`mobile.html` → `index.html`, same fail-fast guards as the mobile package).
- **Virtual origin**: ArkWeb has no mixed-content toggle, so the shell serves the
  bundle via `onInterceptRequest` under `http://app.openchamber.local` (http —
  https would block plain-http LAN fetches as mixed content). The OpenChamber
  server allowlists this origin in
  `packages/web/server/lib/security/request-security.js` (covers HTTP CORS and
  WebSocket upgrades).
- **Platform detection**: the shell injects `window.__OPENCHAMBER_OHOS__` plus a
  `window.__ocShell` event hub via `javaScriptOnDocumentStart`
  (`entry/src/main/ets/bridge/ShellBootstrap.ets`). The web side detects it in
  `packages/ui/src/lib/platform.ts` (`isOhosApp`, `isNativeShellApp`) — the same
  injected-global pattern as the Electron/VS Code runtimes.
- **Bridge** (`window.openchamberBridge`, async JavaScriptProxy):
  `secureStoreGet/Set/Remove` (asset store), `requestCameraPermission`,
  `scanBarcode` (HMS Scan Kit default UI), `cancelScan`. Client: the web side's
  `packages/ui/src/apps/nativeShell.ts`.
- **Shell → web events**: `appstate` (`{isActive}`) on foreground/background and
  `launchurl` (`{url}`) for `openchamber://` deep links, driven by EntryAbility
  through hooks Index.ets registers on `globalThis`.
- **Keyboard**: `KeyboardAvoidMode.RESIZE` shrinks the ArkWeb viewport; the web
  visualViewport fallback owns `--oc-keyboard-inset` (no Capacitor Keyboard
  plugin on this shell).
- **Back button**: `onBackPress` asks the page via a synchronous hook;
  Index answers from `controller.accessBackward()` (web history back), else
  default system behavior.
- **Transport**: chat locks to SSE on ohos (`sync-context.tsx`), same
  conservative choice as the Capacitor shells.

## Commands

From the repo root:

```sh
bun run harmony:build:debug   # web build + package assets + hvigor assembleHap
bun run harmony:install       # hdc install the debug HAP
bun run harmony:launch        # aa start the ability
bun run harmony:run:debug     # build + install + launch
bun run harmony:log           # hilog stream for the app pid
```

All build/deploy commands run through `scripts/with-harmony-env.mjs`
(env overrides win): `DEVECO_SDK_HOME` → bundled DevEco SDK, `JAVA_HOME` →
`/opt/homebrew/opt/openjdk@21`, hdc from the SDK toolchains. `hvigorw` inside
commands is rewritten to the DevEco-bundled hvigor CLI (no network install).

Required local tools: DevEco Studio (`/Applications/DevEco-Studio.app`) with the
HarmonyOS SDK; JDK 21. No global hvigor/ohpm installs needed.

## Signing (one-time, interactive)

CLI builds produce an unsigned HAP that devices reject. To sign:

1. Open `packages/harmony` in DevEco Studio (Open Project).
2. File > Project Structure > Signing Configs → check
   **Automatically generate signature** and sign in with a Huawei account.
3. This writes `signingConfigs` into `build-profile.json5`; CLI builds are then
   signed automatically (`entry-default-signed.hap`).

The bundle id is `com.openchamber.app` — same as the iOS/Android apps.

## Quirks / gotchas

- **http virtual origin**: `crypto.subtle`, service workers and `getUserMedia`
  are unavailable on the insecure origin. QR scanning therefore bridges the HMS
  Scan Kit instead of web `BarcodeDetector`/`getUserMedia`.
- **Scan cancel**: the HMS scan UI dismisses itself; the web-side Cancel button
  ignores the late scan result rather than closing the system UI.
- **web bundle refresh**: run `bun run harmony:build:debug` after every web/UI
  change — the shell serves a frozen copy of `packages/web/dist`.
- **`getRawFileContentSync` + `onInterceptRequest`**: SPA fallback serves
  `index.html` for extension-less paths; asset MIME types map by extension in
  `entry/src/main/ets/bridge/LocalAssetServer.ets`.
- **hvigor CLI resolution**: the bundled hvigor distribution has
  `@ohos/hvigor` unlinked next to `@ohos/hvigor-ohos-plugin`; DevEco Studio
  wires this at runtime, and `with-harmony-env.mjs` replicates it via NODE_PATH.
  If builds fail with `MODULE_NOT_FOUND @ohos/hvigor`, check
  `<DevEco>/Contents/tools/hvigor/node_modules/@ohos` symlinks exist.
