// Connection payload parsing + native QR scanning for the dedicated mobile app.
//
// Pairing v2 links (openchamber://connect?v=2&p=<base64url>) carry a one-time
// secret and a list of transport candidates (lan / tunnel / relay); they are
// redeemed server-side over whichever candidate connects first. We also accept a
// bare http(s) URL so a QR encoding only the server address works.
//
// Scan strategy (in order):
// 1. Capawesome startScan (CameraX behind WebView). Patched to emit on the first
//    ML Kit decode (upstream default is 10 consistent votes).
// 2. HarmonyOS shell: HMS Scan Kit default UI (one-shot) via the ArkTS bridge —
//    the ArkWeb http origin has no getUserMedia, so web fallbacks cannot work.
// 3. Web BarcodeDetector + getUserMedia when Capawesome is unavailable.
// 4. Capawesome scan() Google Code Scanner — often unavailable without GMS module.

import { getOhosScannerPlugin } from '@/apps/nativeShell';
import { parsePairingConnectionPayload, type PairingConnectionPayload } from '@/lib/connectionPayload';
import { isOhosApp } from '@/lib/platform';

export type MobileConnectionPayload = {
  url: string;
  clientToken?: string;
  label?: string;
};

export type MobilePairingPayload = {
  pairing: PairingConnectionPayload;
};

export type QrScanResult =
  | ({ status: 'ok' } & MobileConnectionPayload)
  | ({ status: 'pairing' } & MobilePairingPayload)
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'permission-denied' }
  | { status: 'invalid' }
  | { status: 'failed' };

type ScannedBarcode = { rawValue?: string; displayValue?: string };

type ListenerHandle = { remove: () => void | Promise<void> };

type BarcodeScannerPlugin = {
  requestPermissions?: () => Promise<{ camera?: string } | undefined>;
  startScan?: (options?: {
    formats?: string[];
    lensFacing?: 'BACK' | 'FRONT';
    /** Capawesome Resolution enum: 0=640x480, 1=1280x720, 2=1920x1080, 3=3840x2160 */
    resolution?: number;
  }) => Promise<void>;
  stopScan?: () => Promise<void>;
  setZoomRatio?: (options: { zoomRatio: number }) => Promise<void>;
  getMaxZoomRatio?: () => Promise<{ zoomRatio?: number } | undefined>;
  getMinZoomRatio?: () => Promise<{ zoomRatio?: number } | undefined>;
  scan?: (options?: { formats?: string[] }) => Promise<{ barcodes?: ScannedBarcode[] } | undefined>;
  isSupported?: () => Promise<{ supported?: boolean } | undefined>;
  addListener?: (
    event: 'barcodeScanned' | 'barcodesScanned' | 'scanError',
    cb: (info: { barcode?: ScannedBarcode; barcodes?: ScannedBarcode[]; message?: string }) => void,
  ) => Promise<ListenerHandle> | ListenerHandle;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const SCANNER_ACTIVE_CLASS = 'barcode-scanner-active';
const SCAN_VIDEO_ID = 'oc-barcode-scan-video';

/** Set while a scan is waiting for a barcode / cancel. */
let activeScanCancel: (() => void) | null = null;

const getScannerPlugin = (): BarcodeScannerPlugin | null => {
  if (typeof window === 'undefined') return null;
  const ohosPlugin = getOhosScannerPlugin();
  if (ohosPlugin) return ohosPlugin;
  const capacitor = (window as typeof window & {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  const plugin = capacitor?.Plugins?.BarcodeScanner as BarcodeScannerPlugin | undefined;
  if (!plugin) return null;
  if (typeof plugin.startScan === 'function' || typeof plugin.scan === 'function') return plugin;
  return null;
};

const getBarcodeDetectorCtor = (): BarcodeDetectorCtor | null => {
  if (typeof window === 'undefined') return null;
  const ctor = (window as typeof window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
};

export const parseConnectionPayload = (raw: string): MobileConnectionPayload | MobilePairingPayload | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^openchamber:\/\//i.test(trimmed)) {
    const pairing = parsePairingConnectionPayload(trimmed);
    return pairing ? { pairing } : null;
  }

  if (/^https?:\/\//i.test(trimmed)) return { url: trimmed };
  return null;
};

const logScan = (event: string, detail: Record<string, unknown>): void => {
  // Visible in `adb logcat` via Chromium console (Console / chromium).
  console.info(`[oc-qr-scan] ${event}`, JSON.stringify(detail));
};

const payloadFromRaw = (raw: string): QrScanResult => {
  const trimmed = raw.trim();
  if (!trimmed) return { status: 'cancelled' };
  const payload = parseConnectionPayload(trimmed);
  if (!payload) {
    logScan('invalid', {
      rawLen: trimmed.length,
      prefix: trimmed.slice(0, 120),
      suffix: trimmed.slice(-40),
    });
    return { status: 'invalid' };
  }
  if ('pairing' in payload) {
    logScan('ok-pairing', {
      rawLen: trimmed.length,
      pairingId: payload.pairing.pairingId,
      candidates: payload.pairing.candidates.map((c) => c.type),
      expiresAt: payload.pairing.expiresAt ?? null,
    });
    return { status: 'pairing', ...payload };
  }
  logScan('ok-url', { rawLen: trimmed.length, url: payload.url });
  return { status: 'ok', ...payload };
};

const setScannerUiActive = (active: boolean): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(SCANNER_ACTIVE_CLASS, active);
  document.body.classList.toggle(SCANNER_ACTIVE_CLASS, active);
};

const removeListener = async (handle: ListenerHandle | undefined): Promise<void> => {
  if (!handle) return;
  try {
    await handle.remove();
  } catch {
    // ignore
  }
};

const ensureScanVideo = (): HTMLVideoElement => {
  let video = document.getElementById(SCAN_VIDEO_ID) as HTMLVideoElement | null;
  if (!video) {
    video = document.createElement('video');
    video.id = SCAN_VIDEO_ID;
    video.className = 'barcode-scanner-video';
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    document.body.appendChild(video);
  }
  return video;
};

const removeScanVideo = (): void => {
  const video = document.getElementById(SCAN_VIDEO_ID) as HTMLVideoElement | null;
  if (!video) return;
  try {
    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  } catch {
    // ignore
  }
  video.srcObject = null;
  video.remove();
};

/**
 * Chromium BarcodeDetector path — decode on the first successful frame.
 * Matches the "easy scan" feel of system / WeChat scanners.
 */
const scanWithBarcodeDetector = async (Detector: BarcodeDetectorCtor): Promise<QrScanResult> => {
  setScannerUiActive(true);
  let settled = false;
  let rafId = 0;
  let stream: MediaStream | null = null;
  const video = ensureScanVideo();

  const cleanup = () => {
    activeScanCancel = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    try {
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // ignore
    }
    stream = null;
    removeScanVideo();
    setScannerUiActive(false);
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (err) {
    cleanup();
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { status: 'permission-denied' };
    }
    return { status: 'failed' };
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    cleanup();
    return { status: 'failed' };
  }

  const detector = new Detector({ formats: ['qr_code'] });

  return await new Promise<QrScanResult>((resolve) => {
    const finish = (value: QrScanResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    activeScanCancel = () => finish({ status: 'cancelled' });

    let detecting = false;
    const tick = () => {
      if (settled) return;
      rafId = requestAnimationFrame(() => {
        void (async () => {
          if (settled) return;
          if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            detecting = true;
            try {
              const codes = await detector.detect(video);
              const raw = (codes[0]?.rawValue ?? '').trim();
              if (raw) {
                finish(payloadFromRaw(raw));
                return;
              }
            } catch {
              // Transient detect errors — keep trying until cancel.
            } finally {
              detecting = false;
            }
          }
          if (!settled) tick();
        })();
      });
    };
    tick();
  });
};

/**
 * Capawesome camera-behind-WebView path (patched to emit on first decode).
 */
const scanWithCameraPreview = async (plugin: BarcodeScannerPlugin): Promise<QrScanResult> => {
  if (!plugin.startScan || !plugin.addListener) return { status: 'unsupported' };

  setScannerUiActive(true);
  let settled = false;
  let barcodeHandle: ListenerHandle | undefined;
  let barcodesHandle: ListenerHandle | undefined;
  let errorHandle: ListenerHandle | undefined;

  const cleanup = async () => {
    activeScanCancel = null;
    setScannerUiActive(false);
    await removeListener(barcodeHandle);
    await removeListener(barcodesHandle);
    await removeListener(errorHandle);
    await plugin.stopScan?.().catch(() => undefined);
  };

  try {
    const result = await new Promise<QrScanResult>((resolve, reject) => {
      const finish = (value: QrScanResult) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const onRaw = (raw: string) => {
        finish(payloadFromRaw(raw));
      };

      activeScanCancel = () => finish({ status: 'cancelled' });

      void (async () => {
        try {
          barcodeHandle = await Promise.resolve(
            plugin.addListener!('barcodeScanned', (event) => {
              const raw = (event?.barcode?.rawValue ?? event?.barcode?.displayValue ?? '').trim();
              logScan('native-barcode', { rawLen: raw.length, prefix: raw.slice(0, 120) });
              if (raw) onRaw(raw);
            }),
          );
          barcodesHandle = await Promise.resolve(
            plugin.addListener!('barcodesScanned', (event) => {
              const first = event?.barcodes?.[0];
              const raw = (first?.rawValue ?? first?.displayValue ?? '').trim();
              if (raw) onRaw(raw);
            }),
          ).catch(() => undefined);
          errorHandle = await Promise.resolve(
            plugin.addListener!('scanError', () => {
              finish({ status: 'failed' });
            }),
          ).catch(() => undefined);

          await plugin.startScan!({
            formats: ['QR_CODE'],
            lensFacing: 'BACK',
          });
        } catch {
          finish({ status: 'failed' });
        }
      })().catch(reject);
    });

    await cleanup();
    return result;
  } catch {
    await cleanup();
    return { status: 'failed' };
  }
};

/** Stop an in-progress scan (e.g. user tapped Cancel). */
export const cancelActiveQrScan = async (): Promise<void> => {
  const cancel = activeScanCancel;
  if (cancel) {
    cancel();
    return;
  }
  removeScanVideo();
  setScannerUiActive(false);
  await getScannerPlugin()?.stopScan?.().catch(() => undefined);
};

export const isQrScanSupported = (): boolean => getBarcodeDetectorCtor() !== null || getScannerPlugin() !== null;

const isCapacitorNative = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
};

export const scanConnectionQr = async (): Promise<QrScanResult> => {
  const plugin = getScannerPlugin();
  const Detector = getBarcodeDetectorCtor();

  if (!plugin && !Detector) return { status: 'unsupported' };

  try {
    if (plugin?.requestPermissions) {
      const permission = await plugin.requestPermissions();
      const camera = permission?.camera;
      if (camera && camera !== 'granted' && camera !== 'limited') {
        return { status: 'permission-denied' };
      }
    }

    if (plugin?.isSupported) {
      const support = await plugin.isSupported().catch(() => undefined);
      if (support && support.supported === false && !Detector) return { status: 'unsupported' };
    }

    // Native Capacitor: Capawesome CameraX first (real preview + patched first-decode).
    if (plugin && typeof plugin.startScan === 'function') {
      return await scanWithCameraPreview(plugin);
    }

    // HarmonyOS shell: HMS Scan Kit system UI before any web fallback — the
    // ArkWeb page runs on an insecure (intercepted http) origin, so getUserMedia
    // and BarcodeDetector are unavailable there.
    if (plugin && isOhosApp() && typeof plugin.scan === 'function') {
      const result = await plugin.scan({ formats: ['QR_CODE'] });
      logScan('ohos-result', { hasResult: Boolean(result), count: result?.barcodes?.length ?? -1 });
      // undefined = bridge error/timeout (never maps to 'cancelled').
      if (!result) return { status: 'failed' };
      const barcode = result.barcodes?.[0];
      const raw = (barcode?.rawValue ?? barcode?.displayValue ?? '').trim();
      // Empty = the scan UI closed without a decode — a genuine cancel.
      if (!raw) return { status: 'cancelled' };
      return payloadFromRaw(raw);
    }

    // Browser / fallback only — skip on native when Capawesome exists (handled above).
    if (Detector && !isCapacitorNative()) {
      return await scanWithBarcodeDetector(Detector);
    }

    if (Detector) {
      // Capawesome missing but native — last resort (may be black frames on Huawei).
      return await scanWithBarcodeDetector(Detector);
    }

    if (!plugin || typeof plugin.scan !== 'function') return { status: 'unsupported' };
    const result = await plugin.scan({ formats: ['QR_CODE'] });
    const barcode = result?.barcodes?.[0];
    const raw = (barcode?.rawValue ?? barcode?.displayValue ?? '').trim();
    return payloadFromRaw(raw);
  } catch {
    removeScanVideo();
    setScannerUiActive(false);
    await plugin?.stopScan?.().catch(() => undefined);
    return { status: 'failed' };
  }
};
