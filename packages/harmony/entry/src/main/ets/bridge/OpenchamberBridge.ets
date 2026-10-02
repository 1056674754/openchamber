import asset from '@ohos.security.asset';
import util from '@ohos.util';
import { webview } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { bundleManager, common } from '@kit.AbilityKit';
import { abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'OpenchamberBridge';
const SECURE_PREFIX = 'openchamber.mobile.';

// Serialized shape returned to the web bridge (matches nativeShell.ts's
// OhosScannedBarcode: `{ text }`).
export interface ScannedCode {
  text?: string;
}

// Response shape for the bridge HTTP channel (nativeShell.ts's ohosHttpRequest).
export interface BridgeHttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

function secureKeyOf(key: string): string {
  return key.startsWith(SECURE_PREFIX) ? key : SECURE_PREFIX + key;
}

/**
 * Native methods driven over the ArkWeb MessagePort RPC channel (see PortRpc):
 *  - secure store: asset store (HarmonyOS Keychain equivalent), one alias per key
 *  - QR: HMS Scan Kit default scan UI (one-shot), CAMERA permission gated
 * Results are JSON-serialized once by PortRpc; string sentinels ('__cancelled__' /
 * '__denied__' / '__error__:<code>') carry scan outcomes the web side must
 * distinguish instead of collapsing to 'cancelled'.
 */
export class OpenchamberBridge {
  private context: common.UIAbilityContext;
  private scanWaiting: boolean = false;
  private cameraPermissionInFlight: Promise<boolean> | null = null;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async secureStoreGet(key: string): Promise<string | null> {
    const query = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, stringToBytes(secureKeyOf(key)));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const results = await asset.query(query);
      for (const item of results) {
        const secret = item.get(asset.Tag.SECRET);
        if (secret instanceof Uint8Array) {
          return bytesToString(secret);
        }
      }
      return null;
    } catch (error) {
      hilog.error(0x0000, TAG, 'secureStoreGet failed: %{public}s', String(error));
      return null;
    }
  }

  async secureStoreSet(key: string, value: string): Promise<boolean> {
    const alias = stringToBytes(secureKeyOf(key));
    // asset.add rejects duplicates: remove any previous value first. The first
    // write has no previous value — remove failing with "not found" is fine.
    const removeQuery = new Map<asset.Tag, asset.Value>();
    removeQuery.set(asset.Tag.ALIAS, alias);
    try {
      await asset.remove(removeQuery);
    } catch {
      // alias absent — nothing to remove.
    }
    try {
      const attributes = new Map<asset.Tag, asset.Value>();
      attributes.set(asset.Tag.ALIAS, alias);
      attributes.set(asset.Tag.SECRET, stringToBytes(value));
      attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
      await asset.add(attributes);
      return true;
    } catch (error) {
      hilog.error(0x0000, TAG, 'secureStoreSet failed: %{public}s', String(error));
      return false;
    }
  }

  async secureStoreRemove(key: string): Promise<boolean> {
    const query = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, stringToBytes(secureKeyOf(key)));
    try {
      await asset.remove(query);
      return true;
    } catch (error) {
      hilog.error(0x0000, TAG, 'secureStoreRemove failed: %{public}s', String(error));
      return false;
    }
  }

  async requestCameraPermission(): Promise<boolean> {
    if (this.cameraPermissionInFlight !== null) {
      return this.cameraPermissionInFlight;
    }
    const task: Promise<boolean> = (async (): Promise<boolean> => {
      const permission = 'ohos.permission.CAMERA' as Permissions;
      try {
        const bundleFlags = bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION;
        const bundleInfo = bundleManager.getBundleInfoForSelfSync(bundleFlags);
        const tokenID = bundleInfo.appInfo.accessTokenId;
        const atManager = abilityAccessCtrl.createAtManager();
        const state = atManager.checkAccessTokenSync(tokenID, permission);
        if (state === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
          return true;
        }
        const result = await atManager.requestPermissionsFromUser(this.context, [permission]);
        const auth = result.authResults.length > 0 ? result.authResults[0] : -1;
        return auth === 0;
      } catch (error) {
        hilog.error(0x0000, TAG, 'requestCameraPermission failed: %{public}s', String(error));
        return false;
      }
    })();
    // Deduplicate overlapping calls (the web adapter asks, then scanBarcode asks
    // again — two concurrent system dialogs would make the second return denied).
    const settle = (granted: boolean): boolean => {
      if (this.cameraPermissionInFlight === task) {
        this.cameraPermissionInFlight = null;
      }
      return granted;
    };
    this.cameraPermissionInFlight = task;
    return task.then((granted: boolean) => settle(granted));
  }

  async scanBarcode(): Promise<Array<ScannedCode> | string> {
    if (this.scanWaiting) {
      return '__busy__';
    }
    this.scanWaiting = true;
    const options: scanBarcode.ScanOptions = {
      scanTypes: [scanCore.ScanType.QR_CODE],
      enableMultiMode: false,
      // The album entry (screenshot → still-image decode) is the reliable path
      // for dense on-screen QR codes the camera struggles with.
      enableAlbum: true,
    };
    try {
      const granted = await this.requestCameraPermission();
      if (!granted) {
        return '__denied__';
      }
      const result = await scanBarcode.startScanForResult(this.context, options);
      const codes: ScannedCode[] = [];
      if (result && result.originalValue) {
        codes.push({ text: result.originalValue });
      }
      return codes;
    } catch (error) {
      // 1000500002 = the user closed the scan UI without a decode (also fired
      // for a duplicate request that lost ownership of the scan page).
      // Anything else is a real scan failure and must NOT read as 'cancelled'.
      const code = (error as BusinessError).code;
      if (String(code) === '1000500002') {
        hilog.info(0x0000, TAG, 'scanBarcode cancelled by user');
        return '__cancelled__';
      }
      hilog.error(0x0000, TAG, 'scanBarcode failed: %{public}s code=%{public}d', String(error), Number((error as BusinessError).code));
      return `__error__:${code}`;
    } finally {
      this.scanWaiting = false;
    }
  }

  async cancelScan(): Promise<boolean> {
    // The HMS default scan UI dismisses itself; a web-side cancel is a no-op here.
    return true;
  }

  /**
   * Native HTTP for the web app. ArkWeb (Chromium LNA enforcement) blocks every
   * cors-mode cross-origin request a packaged page makes to LAN IPs — the
   * request never leaves the renderer, so no server-side CORS tweak can fix it.
   * iOS/Android solve the same problem with CapacitorHttp (all fetch → native);
   * this is that equivalent. Cookies for the target URL are copied from the
   * ArkWeb cookie jar (httpOnly included) so cookie-based auth keeps working,
   * and Set-Cookie responses are written back.
   * Payload: {url, method, headers?, body?, timeoutMs?} — returns null on
   * transport failure (the web side falls back to browser fetch for public URLs).
   */
  async httpRequest(payloadJson: string): Promise<BridgeHttpResponse | null> {
    let url = '';
    let method = http.RequestMethod.GET;
    let header: Record<string, string> = {};
    let extraData: string | undefined = undefined;
    let timeoutMs = 60_000;
    try {
      const payload = JSON.parse(payloadJson) as Record<string, Object>;
      url = payload.url as string;
      const rawMethod = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET';
      const mapped = HTTP_METHODS[rawMethod];
      if (!mapped) {
        hilog.error(0x0000, TAG, 'httpRequest unsupported method %{public}s', rawMethod);
        return null;
      }
      method = mapped;
      const rawHeaders = payload.headers as Record<string, string>;
      if (rawHeaders) {
        for (const key of Object.keys(rawHeaders)) {
          const value = rawHeaders[key];
          if (typeof value === 'string') {
            header[key.toLowerCase()] = value;
          }
        }
      }
      if (typeof payload.body === 'string' && payload.body.length > 0) {
        extraData = payload.body;
      }
      if (typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0) {
        timeoutMs = payload.timeoutMs;
      }
    } catch (error) {
      hilog.error(0x0000, TAG, 'httpRequest bad payload: %{public}s', String(error));
      return null;
    }

    // Forward the webview's cookies for the target origin (auth cookie is
    // httpOnly — the page cannot pass it through JSON).
    try {
      const cookie = webview.WebCookieManager.fetchCookieSync(url);
      if (cookie && cookie.length > 0) {
        header['cookie'] = header['cookie'] ? `${header['cookie']}; ${cookie}` : cookie;
      }
    } catch {
      // No cookies for this URL — proceed without.
    }

    const client = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: method,
        header: header,
        extraData: extraData,
        usingCache: false,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      };
      const response = await client.request(url, options);
      const headers = normalizeResponseHeaders(response.header);
      const setCookie = headers['set-cookie'];
      if (setCookie) {
        this.persistResponseCookies(url, setCookie);
      }
      let text = '';
      if (typeof response.result === 'string') {
        text = response.result;
      } else if (response.result instanceof ArrayBuffer) {
        text = utf8Decode(new Uint8Array(response.result as ArrayBuffer));
      } else {
        text = JSON.stringify(response.result);
      }
      hilog.info(0x0000, TAG, 'httpRequest %{public}s %{public}s -> %{public}d', method, url, response.responseCode);
      const out: BridgeHttpResponse = { status: response.responseCode, headers: headers, text: text };
      return out;
    } catch (error) {
      hilog.error(0x0000, TAG, 'httpRequest %{public}s %{public}s failed: %{public}s', method, url, String(error));
      return null;
    } finally {
      client.destroy();
    }
  }

  // Mirror Set-Cookie into the webview cookie jar so the page's own (same-origin
  // / relay) requests see the same session state.
  private persistResponseCookies(url: string, setCookieValue: string): void {
    const parts = setCookieValue.split(/,(?=[^;]+?=)/);
    for (const part of parts) {
      const cookie = part.trim();
      if (!cookie) continue;
      try {
        webview.WebCookieManager.configCookieSync(url, cookie);
      } catch (error) {
        hilog.warn(0x0000, TAG, 'configCookieSync failed: %{public}s', String(error));
      }
    }
  }
}

// The proxy bridge only carries plain JSON-safe values, so the asset store's
// byte-array ALIAS/SECRET need explicit conversions.
function stringToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff;
  }
  return out;
}

function bytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

const HTTP_METHODS: Record<string, http.RequestMethod> = {
  'GET': http.RequestMethod.GET,
  'POST': http.RequestMethod.POST,
  'PUT': http.RequestMethod.PUT,
  'DELETE': http.RequestMethod.DELETE,
  'PATCH': 'PATCH' as http.RequestMethod,
  'HEAD': http.RequestMethod.HEAD,
  'OPTIONS': http.RequestMethod.OPTIONS,
};

// @ohos.net.http returns headers as either a plain record or a (rare) array of
// {key,value} pairs; normalize to a lowercase-keyed record (set-cookie joined).
interface RawHttpHeader {
  key?: string;
  value?: string;
}

function normalizeResponseHeaders(raw: Object): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw as Array<RawHttpHeader>) {
      const key = typeof entry?.key === 'string' ? entry.key.toLowerCase() : '';
      if (!key) continue;
      const value = typeof entry.value === 'string' ? entry.value : '';
      out[key] = out[key] !== undefined ? `${out[key]}, ${value}` : value;
    }
    return out;
  }
  const record = raw as Record<string, string>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

// Proper UTF-8 for response bodies (bytesToString is latin-1 and would mangle
// every non-ASCII character in JSON payloads).
function utf8Decode(bytes: Uint8Array): string {
  try {
    const decoder = util.TextDecoder.create('utf-8');
    return decoder.decodeToString(bytes);
  } catch {
    return bytesToString(bytes);
  }
}
