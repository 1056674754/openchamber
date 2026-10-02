// HarmonyOS (ArkWeb) shell bridge + unified native-shell app-state / launch-URL sources.
//
// Transport = the official ArkWeb MessagePort data channel:
//   - The ArkTS shell creates a port pair in onControllerAttached and hands port[0]
//     to the page via `controller.postMessage('__init_port__', [port0], '*')` on
//     every page load (onPageEnd).
//   - The page attaches a `message` listener at module init, answers with
//     `{t:'ready'}`, and then exchanges JSON envelopes:
//       page→native: {t:'call', id, method, args}
//       native→page: {t:'result', id, ok, result?}   |   {t:'event', name, detail}
//   - Pending resolvers + listeners live ON `window.__ocShell` (window-scoped), so
//     vite chunk duplication or page reloads can never split state across module
//     copies. The port is re-handed on every load; a reload drops pending calls,
//     which time out and resolve null (callers tolerate null).
//
// Everything here degrades to no-ops outside the ohos shell, so shared UI can call
// the unified helpers unconditionally.

import { App } from '@capacitor/app';

import { isCapacitorApp, isOhosApp } from '@/lib/platform';

export type OhosScannedBarcode = { text?: string };

export type OhosBridgeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
};

export type OhosBridgeHttpRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number;
};

type OhosBridge = {
  secureStoreGet: (key: string) => Promise<string | null>;
  secureStoreSet: (key: string, value: string) => Promise<boolean>;
  secureStoreRemove: (key: string) => Promise<boolean>;
  requestCameraPermission: () => Promise<boolean>;
  scanBarcode: () => Promise<OhosScannedBarcode[] | null>;
  cancelScan: () => Promise<boolean>;
  httpRequest: (payloadJson: string) => Promise<OhosBridgeHttpResponse | null>;
};

type OhosShellState = {
  port: MessagePort | null;
  ready: boolean;
  seq: number;
  pending: Map<number, (value: unknown) => void>;
  listeners: Record<string, Array<(detail: unknown) => void>>;
  queue: Array<string>;
};

type BridgeArgs = Record<string, unknown>;

// Per-method safety timeouts (ms). The page-side timers are a last resort —
// callers (mobileConnections) already bound secure-store ops to 3s.
const BRIDGE_TIMEOUT_SCAN_MS = 240_000;
const BRIDGE_TIMEOUT_HTTP_MS = 90_000;
const BRIDGE_TIMEOUT_DEFAULT_MS = 15_000;

const shellState = (): OhosShellState | null => {
  if (typeof window === 'undefined' || !isOhosApp()) return null;
  const w = window as typeof window & { __ocShell?: Partial<OhosShellState> };
  if (!w.__ocShell || !(w.__ocShell.pending instanceof Map)) {
    w.__ocShell = {
      port: null,
      ready: false,
      seq: 0,
      pending: new Map(),
      listeners: {},
      queue: [],
    };
  }
  return w.__ocShell as OhosShellState;
};

const portTimeoutMs = (method: string): number => {
  if (method === 'scanBarcode') return BRIDGE_TIMEOUT_SCAN_MS;
  if (method === 'httpRequest') return BRIDGE_TIMEOUT_HTTP_MS;
  return BRIDGE_TIMEOUT_DEFAULT_MS;
};

const bridgeCall = <T>(method: string, args: BridgeArgs): Promise<T> => {
  return new Promise<T>((resolve) => {
    const state = shellState();
    if (!state) return;
    const id = ++state.seq;
    const timer = window.setTimeout(() => {
      if (state.pending.delete(id)) {
        console.warn(`[oc-shell] bridge ${method} id=${id} timed out`);
        resolve(null as T);
      }
    }, portTimeoutMs(method));
    state.pending.set(id, (value: unknown) => {
      window.clearTimeout(timer);
      resolve(value as T);
    });
    const envelope = JSON.stringify({ t: 'call', id, method, args });
    if (state.ready && state.port) {
      state.port.postMessage(envelope);
    } else {
      // Port handshake not finished yet — the shell flushes this after 'ready'.
      state.queue.push(envelope);
    }
  });
};

const readOhosBridge = (): OhosBridge | null => {
  if (typeof window === 'undefined' || !isOhosApp()) return null;
  const w = window as typeof window & { openchamberBridge?: Partial<OhosBridge> };
  if (w.openchamberBridge && typeof w.openchamberBridge.secureStoreGet === 'function') {
    return w.openchamberBridge as OhosBridge;
  }
  const bridge: OhosBridge = {
    secureStoreGet: (key: string) => bridgeCall<string | null>('secureStoreGet', { key }),
    secureStoreSet: (key: string, value: string) => bridgeCall<boolean>('secureStoreSet', { key, value }),
    secureStoreRemove: (key: string) => bridgeCall<boolean>('secureStoreRemove', { key }),
    requestCameraPermission: () => bridgeCall<boolean>('requestCameraPermission', {}),
    scanBarcode: () => bridgeCall<OhosScannedBarcode[] | null>('scanBarcode', {}),
    cancelScan: () => bridgeCall<boolean>('cancelScan', {}),
    httpRequest: (payloadJson: string) => bridgeCall<OhosBridgeHttpResponse | null>('httpRequest', { payload: payloadJson }),
  };
  w.openchamberBridge = bridge;
  return bridge;
};

// ---------------------------------------------------------------------------
// Secure token storage (ohos). Keys use the same prefixed format as the
// Capacitor path in mobileConnections.ts so key semantics stay portable.
// ---------------------------------------------------------------------------

export const ohosSecureGet = async (key: string): Promise<string | null> => {
  const bridge = readOhosBridge();
  if (!bridge) return null;
  try {
    return await bridge.secureStoreGet(key);
  } catch {
    return null;
  }
};

export const ohosSecureSet = async (key: string, value: string): Promise<boolean> => {
  const bridge = readOhosBridge();
  if (!bridge) return false;
  try {
    return (await bridge.secureStoreSet(key, value)) === true;
  } catch {
    return false;
  }
};

export const ohosSecureRemove = async (key: string): Promise<boolean> => {
  const bridge = readOhosBridge();
  if (!bridge) return false;
  try {
    return (await bridge.secureStoreRemove(key)) === true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Native HTTP (ohos). ArkWeb blocks cors-mode cross-origin fetches to LAN IPs
// inside the renderer (Chromium Local Network Access), so the packaged shell
// routes them through ArkTS @ohos.net.http — the CapacitorHttp equivalent.
// Returns null on transport failure; the caller falls back to browser fetch.
// ---------------------------------------------------------------------------

export const ohosHttpRequest = async (request: OhosBridgeHttpRequest): Promise<OhosBridgeHttpResponse | null> => {
  const bridge = readOhosBridge();
  if (!bridge || typeof bridge.httpRequest !== 'function') return null;
  try {
    return await bridge.httpRequest(JSON.stringify(request));
  } catch {
    return null;
  }
};

// Create the fetch-channel-free bridge eagerly so it exists before any UI (or
// the shell's onPageEnd self-test) touches it.
if (typeof window !== 'undefined' && isOhosApp()) {
  readOhosBridge();

  // Port handshake: the shell posts `__init_port__` with the port on every page
  // load; the port's messages drive both RPC results and shell events.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data !== '__init_port__') return;
    const state = shellState();
    if (!state) return;
    const [incoming] = event.ports ?? [];
    if (!incoming) return;
    state.port = incoming;
    state.ready = false;
    incoming.onmessage = (ev: MessageEvent) => {
      let parsed: { t?: string; id?: number; ok?: boolean; result?: unknown; name?: string; detail?: unknown };
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (parsed.t === 'result' && typeof parsed.id === 'number') {
        const resolver = state.pending.get(parsed.id);
        if (!resolver) {
          console.warn(`[oc-shell] result for unknown id ${parsed.id}`);
          return;
        }
        state.pending.delete(parsed.id);
        if (parsed.ok === false) {
          resolver(null);
        } else {
          resolver(parsed.result);
        }
        return;
      }
      if (parsed.t === 'event' && typeof parsed.name === 'string') {
        const list = (state.listeners[parsed.name] || []).slice();
        for (const handler of list) {
          try {
            handler(parsed.detail);
          } catch {
            // keep dispatching
          }
        }
      }
    };
    // Tell the shell this document is listening; it flushes queued events.
    incoming.postMessage(JSON.stringify({ t: 'ready' }));
    state.ready = true;
    void runBridgeSelfTest();
  }, { once: false });
}

// One-shot end-to-end check of the port RPC loop (set/get/remove a probe
// token). Logs at error level so it always shows in hilog; remove after the
// scan/pairing flow is verified on device.
let selfTestRan = false;
const runBridgeSelfTest = async (): Promise<void> => {
  if (selfTestRan) return;
  selfTestRan = true;
  try {
    const bridge = readOhosBridge();
    if (!bridge) {
      console.error('[oc-selftest] FAIL no bridge');
      return;
    }
    const set = await bridge.secureStoreSet('selftest.probe', 'v1');
    console.error(`[oc-selftest] set=${set}`);
    const get = await bridge.secureStoreGet('selftest.probe');
    console.error(`[oc-selftest] get=${get}`);
    const del = await bridge.secureStoreRemove('selftest.probe');
    console.error(`[oc-selftest] remove=${del}`);
    const gone = await bridge.secureStoreGet('selftest.probe');
    console.error(`[oc-selftest] afterRemove=${gone}`);
  } catch (error) {
    console.error(`[oc-selftest] EXCEPTION ${(error as Error)?.message ?? String(error)}`);
  }
};

// ---------------------------------------------------------------------------
// Unified app-state (foreground/resume) subscription across shells.
// ---------------------------------------------------------------------------

export type ShellAppState = { isActive: boolean };
type ShellStateHandler = (state: ShellAppState) => void;

export const subscribeShellAppState = (handler: ShellStateHandler): (() => void) => {
  if (isCapacitorApp()) {
    let disposed = false;
    let remove = (): void => {};
    void App.addListener('appStateChange', (state) => {
      handler({ isActive: state.isActive });
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };
    }).catch(() => {
      // App plugin unavailable in some shells.
    });
    return () => {
      disposed = true;
      remove();
    };
  }
  if (isOhosApp()) {
    const state = shellState();
    if (!state) return () => {};
    const list = (state.listeners.appstate = state.listeners.appstate || []);
    const wrapped = (detail: unknown) => {
      handler({ isActive: (detail as { isActive?: unknown } | undefined)?.isActive === true });
    };
    list.push(wrapped);
    return () => {
      const index = list.indexOf(wrapped);
      if (index >= 0) list.splice(index, 1);
    };
  }
  return () => {};
};

// ---------------------------------------------------------------------------
// Unified launch-URL (deep link) subscription across shells.
// ---------------------------------------------------------------------------

type ShellLaunchHandler = (url: string) => void;

export const subscribeShellLaunchUrls = (handler: ShellLaunchHandler): (() => void) => {
  if (isCapacitorApp()) {
    let disposed = false;
    let remove = (): void => {};
    void App.getLaunchUrl().then((result) => {
      if (!disposed && result?.url) handler(result.url);
    }).catch(() => undefined);
    void App.addListener('appUrlOpen', (event) => {
      handler(event.url);
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };
    }).catch(() => undefined);
    return () => {
      disposed = true;
      remove();
    };
  }
  if (isOhosApp()) {
    const state = shellState();
    if (!state) return () => {};
    const list = (state.listeners.launchurl = state.listeners.launchurl || []);
    const wrapped = (detail: unknown) => {
      const url = (detail as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string' && url) handler(url);
    };
    list.push(wrapped);
    return () => {
      const index = list.indexOf(wrapped);
      if (index >= 0) list.splice(index, 1);
    };
  }
  return () => {};
};

// ---------------------------------------------------------------------------
// QR scan adapter — same `scan()` contract shape as the Capawesome plugin's
// one-shot Google-Code-Scanner path (mobileQrScan.ts). The ArkTS side runs the
// HMS Scan Kit default UI; there is no live preview behind the WebView.
// ---------------------------------------------------------------------------

export type OhosScannerPlugin = {
  requestPermissions: () => Promise<{ camera?: string } | undefined>;
  isSupported: () => Promise<{ supported?: boolean } | undefined>;
  scan: (options?: { formats?: string[] }) => Promise<{ barcodes?: Array<{ rawValue?: string; displayValue?: string }> } | undefined>;
  stopScan: () => Promise<void>;
};

export const getOhosScannerPlugin = (): OhosScannerPlugin | null => {
  const bridge = readOhosBridge();
  if (!bridge || typeof bridge.scanBarcode !== 'function') return null;
  return {
    requestPermissions: async () => {
      let granted = false;
      try {
        granted = (await bridge.requestCameraPermission()) === true;
      } catch {
        granted = false;
      }
      return { camera: granted ? 'granted' : 'denied' };
    },
    isSupported: async () => ({ supported: true }),
    scan: async () => {
      const barcodes = await bridge.scanBarcode();
      const scanned = Array.isArray(barcodes) ? barcodes : [];
      return { barcodes: scanned.map((entry) => ({ rawValue: entry?.text ?? '' })) };
    },
    stopScan: async () => {
      try {
        await bridge.cancelScan();
      } catch {
        // The HMS scan UI dismisses itself; a failed cancel is harmless.
      }
    },
  };
};
