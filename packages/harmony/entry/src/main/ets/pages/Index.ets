import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { OpenchamberBridge } from '../bridge/OpenchamberBridge';
import { interceptLocalAsset } from '../bridge/LocalAssetServer';
import { PortRpc } from '../bridge/PortRpc';
import { ShellHooks } from '../bridge/ShellHooks';

const TAG = 'OpenchamberPage';
const DOMAIN = 0x0000;
const PORT_INIT_NAME = '__init_port__';
// Virtual origin the shell serves the bundled web build from. The `.localhost`
// TLD is the whole trick: per the Secure Contexts spec (and Chromium's
// implementation, which ArkWeb embeds) http://*.localhost is a potentially
// trustworthy origin, so crypto.subtle exists (relay E2EE needs it) — but the
// document itself is plain http, so fetching http://LAN-IP servers is NOT mixed
// content. The previous https://app.openchamber.local origin had crypto.subtle
// but ArkWeb hard-blocks http fetch() from https documents regardless of
// .mixedMode() — every LAN candidate fetch died in ~5ms and the app could only
// ever ride the relay. Origin is allowlisted server-side
// (request-security.js packagedClientOrigins).
const VIRTUAL_ORIGIN = 'http://app.openchamber.localhost';

// Strong module-level anchor so the bridge object outlives any GC cycle.
let gBridge: OpenchamberBridge | null = null;

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: OpenchamberBridge | null = null;

  aboutToAppear(): void {
    webview.WebviewController.initializeWebEngine();
    // Dev aid: expose the page over CDP (hdc fport + chrome devtools protocol)
    // for live inspection. Harmless in debug builds; gate for release.
    try {
      webview.WebviewController.setWebDebuggingAccess(true);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'setWebDebuggingAccess failed: %{public}s', String(error));
    }
    gBridge = new OpenchamberBridge(getContext(this) as common.UIAbilityContext);
    this.bridge = gBridge;
    this.registerAbilityHooks();
  }

  // EntryAbility drives foreground/back/deep-link events through these hooks.
  private registerAbilityHooks(): void {
    ShellHooks.emitShellEvent = (name: string, detailJson: string): void => {
      PortRpc.sendEvent(name, detailJson);
    };
    ShellHooks.dispatchLaunchUrl = (url: string): void => {
      PortRpc.sendEvent('launchurl', JSON.stringify({ url: url }));
    };
    ShellHooks.handleBackPress = (): boolean => {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
      return false;
    };
  }

  private drainPendingLaunchUrl(): void {
    const pending = AppStorage.get<string>('openchamber.pendingLaunchUrl') ?? '';
    if (!pending) return;
    AppStorage.setOrCreate('openchamber.pendingLaunchUrl', '');
    PortRpc.sendEvent('launchurl', JSON.stringify({ url: pending }));
  }

  build() {
    Column() {
      Web({ src: `${VIRTUAL_ORIGIN}/index.html`, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .zoomAccess(false)
        .fileAccess(false)
        // Kill the elastic overscroll bounce ( Capacitor-like: the SPA handles
        // its own scrolling; the top blank-area stretch is ArkWeb's default).
        .overScrollMode(OverScrollMode.NEVER)
        // The interceptor answers every virtual-origin request with explicit
        // cache headers now, but during development a poisoned HTTP cache (from
        // builds before headers existed) shadows the interceptor entirely —
        // bypass it. Revisit for release (immutable /assets/ caching is safe).
        .cacheMode(CacheMode.None)
        .mixedMode(MixedMode.Compatible)
        .onInterceptRequest((event) => {
          return interceptLocalAsset(event.request);
        })
        .onPageEnd(() => {
          PortRpc.attach(this.controller, gBridge!);
          this.controller.runJavaScript(
            "console.error('[oc-metrics] scrollH=' + document.documentElement.scrollHeight + ' innerH=' + window.innerHeight + ' st=' + document.scrollingElement.scrollTop + ' bodyH=' + document.body.scrollHeight + ' dvh=' + getComputedStyle(document.documentElement).height)");
          this.drainPendingLaunchUrl();
        })
    }
    .width('100%')
    .height('100%')
  }
}
