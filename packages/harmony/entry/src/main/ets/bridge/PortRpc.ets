import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { OpenchamberBridge, ScannedCode, BridgeHttpResponse } from './OpenchamberBridge';

const TAG = 'PortRpc';
const DOMAIN = 0x0000;
const PORT_INIT_NAME = '__init_port__';
// Handshake retries: the page attaches its `message` listener when the App
// chunk finishes async evaluation — often AFTER onPageEnd — so the first
// handshake is routinely lost. Re-post with backoff until the page answers
// {t:'ready'} through the port.
const HANDSHAKE_RETRY_DELAYS_MS: number[] = [500, 1000, 2000, 4000, 8000, 16000, 32000];

type PortEnvelope = Record<string, Object>;

// Official ArkWeb MessagePort data channel (web-app-page-data-channel guide):
//   - Index calls PortRpc.attach(controller, bridge) at every onPageEnd.
//   - Page→native: {t:'call', id, method, args}
//   - Native→page: {t:'result', id, ok, result} and {t:'event', name, detail}
// This avoids javaScriptProxy entirely (its object registry is GC-fragile —
// "native proxy object not found" / OnObjectWrapperDeleted) and the fetch-
// interception channel (page backgrounding aborts in-flight fetches, and
// intercepted responses are cached — an id collision after a reload would
// never reach native).
export class PortRpc {
  private static controller: webview.WebviewController | null = null;
  private static replyPort: webview.WebMessagePort | null = null;
  private static bridge: OpenchamberBridge | null = null;
  private static ready: boolean = false;
  private static queuedEvents: string[] = [];
  private static lastAppStateJson: string = '{"isActive":false}';

  static attach(controller: webview.WebviewController, bridge: OpenchamberBridge): void {
    PortRpc.controller = controller;
    PortRpc.bridge = bridge;
    PortRpc.ready = false;
    PortRpc.attemptHandshake(0);
  }

  private static attemptHandshake(attempt: number): void {
    if (PortRpc.ready || !PortRpc.controller) return;
    try {
      const ports = PortRpc.controller.createWebMessagePorts();
      if (ports.length < 2) {
        hilog.error(DOMAIN, TAG, 'createWebMessagePorts returned %{public}d ports', ports.length);
        return;
      }
      PortRpc.replyPort = ports[1];
      ports[1].onMessageEvent((message: webview.WebMessage) => {
        if (typeof message !== 'string') return;
        PortRpc.onMessage(message);
      });
      PortRpc.controller.postMessage(PORT_INIT_NAME, [ports[0]], '*');
      hilog.info(DOMAIN, TAG, 'handshake posted (attempt %{public}d)', attempt);
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'handshake attempt %{public}d failed: %{public}s', attempt, String(error));
      return;
    }
    const delay = HANDSHAKE_RETRY_DELAYS_MS[Math.min(attempt, HANDSHAKE_RETRY_DELAYS_MS.length - 1)];
    setTimeout(() => {
      if (!PortRpc.ready) {
        PortRpc.attemptHandshake(attempt + 1);
      }
    }, delay);
  }

  static onMessage(message: string): void {
    let envelope: Record<string, Object> = {};
    try {
      envelope = JSON.parse(message) as Record<string, Object>;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'bad port message: %{public}s', String(error));
      return;
    }
    const type = envelope.t as string;
    if (type === 'ready') {
      if (PortRpc.ready) return;
      PortRpc.ready = true;
      hilog.info(DOMAIN, TAG, 'page ready; flushing %{public}d queued events', PortRpc.queuedEvents.length);
      PortRpc.queuedEvents.splice(0).forEach((json: string) => {
        PortRpc.rawPost(json);
      });
      return;
    }
    if (type === 'call') {
      const id = Number(envelope.id);
      const method = envelope.method as string;
      const rawArgs = envelope.args as Record<string, string>;
      const args: Record<string, string> = rawArgs ?? {};
      hilog.info(DOMAIN, TAG, 'call %{public}s id=%{public}d', method, id);
      PortRpc.runNativeMethod(method, args)
        .then((result: Object | null) => {
          PortRpc.postResult(id, true, result);
        })
        .catch((error: Object) => {
          hilog.error(DOMAIN, TAG, 'call %{public}s id=%{public}d failed: %{public}s', method, id, String(error));
          PortRpc.postResult(id, false, null);
        });
    }
  }

  static sendEvent(name: string, detailJson: string): void {
    const envelope = JSON.stringify({ t: 'event', name: name, detail: JSON.parse(detailJson) });
    if (!PortRpc.ready || !PortRpc.replyPort) {
      // Page not listening yet — keep only the latest appstate, queue the rest.
      if (name === 'appstate') {
        PortRpc.lastAppStateJson = detailJson;
        PortRpc.queuedEvents = PortRpc.queuedEvents.filter((json: string) => !json.includes('"name":"appstate"'));
      }
      PortRpc.queuedEvents.push(envelope);
      return;
    }
    PortRpc.rawPost(envelope);
  }

  private static postResult(id: number, ok: boolean, result: Object | null): void {
    PortRpc.rawPost(JSON.stringify({ t: 'result', id: id, ok: ok, result: result }));
  }

  private static rawPost(json: string): void {
    const port = PortRpc.replyPort;
    if (!port) return;
    try {
      port.postMessageEvent(json);
    } catch (error) {
      hilog.error(DOMAIN, TAG, 'postMessageEvent failed: %{public}s', String(error));
    }
  }

  private static runNativeMethod(method: string, args: Record<string, string>): Promise<Object | null> {
    const bridge = PortRpc.bridge;
    if (!bridge) return Promise.resolve(null);
    if (method === 'secureStoreGet') {
      return bridge.secureStoreGet(args.key ?? '')
        .then((value: string | null) => value as Object);
    }
    if (method === 'secureStoreSet') {
      return bridge.secureStoreSet(args.key ?? '', args.value ?? '')
        .then((ok: boolean) => ok as Object);
    }
    if (method === 'secureStoreRemove') {
      return bridge.secureStoreRemove(args.key ?? '')
        .then((ok: boolean) => ok as Object);
    }
    if (method === 'requestCameraPermission') {
      return bridge.requestCameraPermission().then((ok: boolean) => ok as Object);
    }
    if (method === 'scanBarcode') {
      return bridge.scanBarcode().then((codes: Array<ScannedCode> | string) => codes as Object);
    }
    if (method === 'cancelScan') {
      return bridge.cancelScan().then((ok: boolean) => ok as Object);
    }
    if (method === 'httpRequest') {
      return bridge.httpRequest(args.payload ?? '')
        .then((response: BridgeHttpResponse | null) => response as Object);
    }
    hilog.warn(DOMAIN, TAG, 'unknown bridge method %{public}s', method);
    return Promise.resolve(null);
  }
}
