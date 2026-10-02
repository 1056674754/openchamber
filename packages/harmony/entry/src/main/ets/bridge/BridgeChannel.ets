import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { OpenchamberBridge, ScannedCode } from './OpenchamberBridge';

const TAG = 'BridgeChannel';
const BRIDGE_MARKER = '/__bridge__/';

// Web→native bridge over the URL-interception channel:
//   fetch('/__bridge__/<method>?id=<n>&args=<json>')  → onInterceptRequest →
//   dispatchBridgeCall runs the async native work and delivers the result via
//   runJavaScript("window.__ocShell.__bridgeResult(id, json)"). Chosen over
//   javaScriptProxy: proxy invocation fails with "native proxy object not
// found" on current ArkWeb regardless of registration form.
export function isBridgeRequest(url: string): boolean {
  return url.includes(BRIDGE_MARKER);
}

export function bridgeAckResponse(): WebResourceResponse {
  const response = new WebResourceResponse();
  response.setResponseData('{}');
  response.setResponseMimeType('application/json');
  response.setResponseIsReady(true);
  return response;
}

export function dispatchBridgeCall(web: webview.WebviewController, url: string, bridge: OpenchamberBridge): void {
  const pathAndQuery = url.split(BRIDGE_MARKER)[1] ?? '';
  const queryStart = pathAndQuery.indexOf('?');
  const method = queryStart >= 0 ? pathAndQuery.slice(0, queryStart) : pathAndQuery;
  const query = queryStart >= 0 ? pathAndQuery.slice(queryStart + 1) : '';

  let id = 0;
  const args: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : '';
    if (key === 'id') {
      id = Number.parseInt(decodeURIComponent(value), 10);
    } else {
      args[key] = decodeURIComponent(value);
    }
  }
  hilog.info(0x0000, TAG, 'dispatch %{public}s id=%{public}d', method, id);

  runNativeMethod(bridge, method, args)
    .then((result: string) => {
      hilog.info(0x0000, TAG, 'result %{public}s id=%{public}d len=%{public}d', method, id, result.length);
      web.runJavaScript(
        `(function(){try{return ['hub='+typeof window.__ocShell,'br='+String(typeof (window.__ocShell||{}).__bridgeResult),'url='+location.href,'rs='+document.readyState].join(' ')}catch(e){return 'PROBE-ERR '+e.message}})()`,
      ).then((state: string) => {
        hilog.info(0x0000, TAG, 'probe: %{public}s', state);
        return web.runJavaScript(`window.__ocShell.__bridgeResult(${id}, ${result})`);
      }).then(() => {
        hilog.info(0x0000, TAG, 'delivered %{public}s id=%{public}d', method, id);
      }).catch((error: Object) => {
        hilog.error(0x0000, TAG, 'runJavaScript %{public}s id=%{public}d failed: %{public}s', method, id, String(error));
      });
    })
    .catch((error: Object) => {
      hilog.error(0x0000, TAG, 'bridge %{public}s failed: %{public}s', method, String(error));
      web.runJavaScript(`window.__ocShell.__bridgeResult(${id}, null)`);
    });
}

function runNativeMethod(bridge: OpenchamberBridge, method: string, args: Record<string, string>): Promise<string> {
  if (method === 'secureStoreGet') {
    return bridge.secureStoreGet(args.key ?? '').then((value: string | null) => JSON.stringify(value ?? null));
  }
  if (method === 'secureStoreSet') {
    return bridge.secureStoreSet(args.key ?? '', args.value ?? '').then((ok: boolean) => JSON.stringify(ok));
  }
  if (method === 'secureStoreRemove') {
    return bridge.secureStoreRemove(args.key ?? '').then((ok: boolean) => JSON.stringify(ok));
  }
  if (method === 'requestCameraPermission') {
    return bridge.requestCameraPermission().then((ok: boolean) => JSON.stringify(ok));
  }
  if (method === 'scanBarcode') {
    return bridge.scanBarcode().then((codes: Array<ScannedCode> | null) => JSON.stringify(codes ?? null));
  }
  if (method === 'cancelScan') {
    return bridge.cancelScan().then((ok: boolean) => JSON.stringify(ok));
  }
  hilog.warn(0x0000, TAG, 'unknown bridge method %{public}s', method);
  return Promise.resolve('null');
}
