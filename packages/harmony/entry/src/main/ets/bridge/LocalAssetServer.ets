import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'LocalAssetServer';

// onInterceptRequest maps every app.openchamber.localhost request onto the bundled
// web build under resources/rawfile/www (produced by scripts/prepare-web-assets.mjs
// from packages/web/dist). SPA fallback: unknown paths without a dot serve index.html.
// WebResourceRequest/WebResourceResponse are ambient ArkWeb declarations.
// Responses MUST set code+reason explicitly (kernel FAQ), and intercepted
// responses are cached — hashed assets get immutable, index gets no-cache.
export function interceptLocalAsset(request: WebResourceRequest): WebResourceResponse {
  const url: string = request.getRequestUrl();
  const rawPath: string = url
    // Strip any scheme+host: the virtual origin is owned by this shell, so
    // every intercepted URL is ours regardless of host spelling.
    .replace(/^[a-z]+:\/\/[^/?#]+/i, '')
    .split('?')[0]
    .split('#')[0];
  let path: string = rawPath;
  try {
    path = decodeURIComponent(rawPath || '/');
  } catch (error) {
    hilog.warn(0x0000, TAG, 'bad escape %{public}s', rawPath);
    path = rawPath;
  }
  if (path === '/' || path === '') {
    path = '/index.html';
  }
  if (path === '/favicon.ico') {
    // rawfile/www has no favicon.ico; fail fast and quietly instead of an
    // 'Invalid relative path' rawfile error on every load.
    return emptyResponse('image/x-icon');
  }
  let resourcePath = `www${path}`;
  if (!hasFileExtension(path)) {
    resourcePath = 'www/index.html';
  }

  const response = new WebResourceResponse();
  try {
    const content: Uint8Array = getContext().resourceManager.getRawFileContentSync(resourcePath);
    // getRawFileContentSync may hand back a VIEW over a larger buffer — slice
    // the exact range or the served bytes can be shifted/truncated.
    const exact: ArrayBuffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    response.setResponseData(exact);
    response.setResponseEncoding('utf-8');
    response.setResponseMimeType(mimeTypeFor(path));
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseHeader([
      { headerKey: 'Cache-Control', headerValue: cacheControlFor(path) },
    ]);
    response.setResponseIsReady(true);
  } catch (error) {
    hilog.warn(0x0000, TAG, 'asset miss %{public}s (%{public}s)', resourcePath, String(error));
    response.setResponseData('');
    response.setResponseMimeType('text/plain');
    // A missing chunk must fail the module load loudly, not serve empty bytes.
    response.setResponseCode(404);
    response.setReasonMessage('Not Found');
    response.setResponseIsReady(true);
  }
  return response;
}

function cacheControlFor(path: string): string {
  // Vite emits content-hashed filenames under /assets/ — cache forever.
  return path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function emptyResponse(mimeType: string): WebResourceResponse {
  const response = new WebResourceResponse();
  response.setResponseData('');
  response.setResponseMimeType(mimeType);
  response.setResponseCode(200);
  response.setReasonMessage('OK');
  response.setResponseIsReady(true);
  return response;
}

function hasFileExtension(path: string): boolean {
  const last = path.split('/').pop() ?? '';
  return last.includes('.');
}

function mimeTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'html':
      return 'text/html';
    case 'js':
    case 'mjs':
      // Kernel refuses JS served under an unexpected MIME — keep this exact.
      return 'application/javascript';
    case 'css':
      return 'text/css';
    case 'json':
      return 'application/json';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'ico':
      return 'image/x-icon';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    case 'map':
      return 'application/json';
    case 'wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}
