import type { BridgeContext, BridgeResponse } from './bridge';
import { waitForApiUrl } from './opencode-ready';

type BridgeMessageInput = {
  id: string;
  type: string;
  payload?: unknown;
};

type ApiProxyRequestPayload = {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
};

type ApiSessionMessageRequestPayload = {
  path?: string;
  headers?: Record<string, string>;
  bodyText?: string;
};

type ApiProxyResponsePayload = {
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
  bodyText?: string;
};

const DECODED_PAYLOAD_LENGTH_HEADER = 'x-openchamber-decoded-content-length';
const MAX_MESSAGE_HISTORY_DIFFS = 500;
const MAX_MESSAGE_HISTORY_PATCH_LENGTH = 100_000;
// The webview bridge disables its own timeout for api:proxy ("let the extension
// host control timeout"), so this fetch is the only bound on the request. Without
// it, a hung upstream request pends forever and webview bootstraps that depend on
// it (providers/agents) never complete.
const API_PROXY_TIMEOUT_MS = 60_000;

export function projectMessageHistoryResponseText(bodyText: string): string {
  try {
    const payload: unknown = JSON.parse(bodyText);
    if (!Array.isArray(payload)) {
      return bodyText;
    }

    return JSON.stringify(payload.map((record: unknown) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return record;
      }
      const typedRecord = record as Record<string, unknown>;
      const info = typedRecord.info;
      if (!info || typeof info !== 'object' || Array.isArray(info)) {
        return record;
      }
      const typedInfo = info as Record<string, unknown>;
      const summary = typedInfo.summary;
      if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        return record;
      }
      const typedSummary = summary as Record<string, unknown>;
      if (!Array.isArray(typedSummary.diffs)) {
        return record;
      }

      const diffs = typedSummary.diffs.slice(0, MAX_MESSAGE_HISTORY_DIFFS).map((diff: unknown) => {
        if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
          return diff;
        }
        const typedDiff = diff as Record<string, unknown>;
        const projected = Object.fromEntries(
          Object.entries(typedDiff).filter(([key]) => !['before', 'after', 'from', 'to'].includes(key)),
        );
        if (typeof projected.patch === 'string' && projected.patch.length > MAX_MESSAGE_HISTORY_PATCH_LENGTH) {
          projected.patch = projected.patch.slice(0, MAX_MESSAGE_HISTORY_PATCH_LENGTH);
        }
        return projected;
      });

      return {
        ...typedRecord,
        info: {
          ...typedInfo,
          summary: {
            ...typedSummary,
            diffs,
          },
        },
      };
    }));
  } catch {
    return bodyText;
  }
}

export function setDecodedPayloadLengthHeader(headers: Record<string, string>, payloadBytes: number): void {
  delete headers[DECODED_PAYLOAD_LENGTH_HEADER];
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) return;
  headers[DECODED_PAYLOAD_LENGTH_HEADER] = String(payloadBytes);
}

const shouldReturnTextBody = (headers: Headers): boolean => {
  const contentType = headers.get('content-type')?.toLowerCase() || '';
  return contentType.startsWith('application/json')
    || contentType.startsWith('text/')
    || contentType.includes('+json');
};

const collectProxyResponseHeaders = (headers: Headers, deps: Pick<ProxyRuntimeDeps, 'collectHeaders'>): Record<string, string> => {
  const result = deps.collectHeaders(headers);
  delete result['content-length'];
  delete result['content-encoding'];
  delete result['transfer-encoding'];
  return result;
};

type ProxyRuntimeDeps = {
  tryHandleLocalFsProxy: (method: string, requestPath: string) => Promise<ApiProxyResponsePayload | null>;
  buildUnavailableApiResponse: () => ApiProxyResponsePayload;
  sanitizeForwardHeaders: (input: Record<string, string> | undefined) => Record<string, string>;
  collectHeaders: (headers: Headers) => Record<string, string>;
  base64EncodeUtf8: (text: string) => string;
};

export async function handleProxyBridgeMessage(
  message: BridgeMessageInput,
  ctx: BridgeContext | undefined,
  deps: ProxyRuntimeDeps,
): Promise<BridgeResponse | null> {
  const { id, type, payload } = message;

  switch (type) {
    case 'api:proxy': {
      const { method, path: requestPath, headers, bodyBase64 } = (payload || {}) as ApiProxyRequestPayload;
      const normalizedMethod = typeof method === 'string' && method.trim() ? method.trim().toUpperCase() : 'GET';
      const normalizedPath =
        typeof requestPath === 'string' && requestPath.trim().length > 0
          ? requestPath.trim().startsWith('/')
            ? requestPath.trim()
            : `/${requestPath.trim()}`
          : '/';

      const localFsResponse = await deps.tryHandleLocalFsProxy(normalizedMethod, normalizedPath);
      if (localFsResponse) {
        return { id, type, success: true, data: localFsResponse };
      }

      const apiUrl = await waitForApiUrl(ctx?.manager);
      if (!apiUrl) {
        const data = deps.buildUnavailableApiResponse();
        return { id, type, success: true, data };
      }

      const base = `${apiUrl.replace(/\/+$/, '')}/`;
      const targetUrl = new URL(normalizedPath.replace(/^\/+/, ''), base).toString();
      const requestHeaders: Record<string, string> = {
        ...deps.sanitizeForwardHeaders(headers),
        ...ctx?.manager?.getOpenCodeAuthHeaders(),
      };

      if (normalizedPath === '/event' || normalizedPath === '/global/event') {
        if (!requestHeaders.Accept) {
          requestHeaders.Accept = 'text/event-stream';
        }
        requestHeaders['Cache-Control'] = requestHeaders['Cache-Control'] || 'no-cache';
        requestHeaders.Connection = requestHeaders.Connection || 'keep-alive';
      }

      try {
        const response = await fetch(targetUrl, {
          method: normalizedMethod,
          headers: requestHeaders,
          body:
            typeof bodyBase64 === 'string' && bodyBase64.length > 0 && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD'
              ? Buffer.from(bodyBase64, 'base64')
              : undefined,
          signal: AbortSignal.timeout(API_PROXY_TIMEOUT_MS),
        });

        const responseHeaders = collectProxyResponseHeaders(response.headers, deps);
        if (shouldReturnTextBody(response.headers)) {
          const upstreamBodyText = await response.text();
          const isMessageHistoryRequest = normalizedMethod === 'GET'
            && /^\/session\/[^/]+\/message(?:\?.*)?$/.test(normalizedPath);
          const bodyText = response.ok && isMessageHistoryRequest
            ? projectMessageHistoryResponseText(upstreamBodyText)
            : upstreamBodyText;
          setDecodedPayloadLengthHeader(responseHeaders, Buffer.byteLength(bodyText));
          const data: ApiProxyResponsePayload = {
            status: response.status,
            headers: responseHeaders,
            bodyText,
          };

          return { id, type, success: true, data };
        }

        const arrayBuffer = await response.arrayBuffer();
        setDecodedPayloadLengthHeader(responseHeaders, arrayBuffer.byteLength);
        const data: ApiProxyResponsePayload = {
          status: response.status,
          headers: responseHeaders,
          bodyBase64: Buffer.from(arrayBuffer).toString('base64'),
        };

        return { id, type, success: true, data };
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          ((error as Error & { name?: string }).name === 'TimeoutError' ||
            (error as Error & { name?: string }).name === 'AbortError');
        const body = JSON.stringify({
          error: isTimeout
            ? `OpenCode API request timed out after ${Math.round(API_PROXY_TIMEOUT_MS / 1000)}s: ${normalizedMethod} ${normalizedPath}`
            : error instanceof Error ? error.message : 'Failed to reach OpenCode API',
        });
        const data: ApiProxyResponsePayload = {
          status: isTimeout ? 504 : 502,
          headers: { 'content-type': 'application/json' },
          bodyText: body,
        };
        return { id, type, success: true, data };
      }
    }

    case 'api:session:message': {
      const apiUrl = await waitForApiUrl(ctx?.manager);
      if (!apiUrl) {
        const data = deps.buildUnavailableApiResponse();
        return { id, type, success: true, data };
      }

      const { path: requestPath, headers, bodyText } = (payload || {}) as ApiSessionMessageRequestPayload;
      const normalizedPath =
        typeof requestPath === 'string' && requestPath.trim().length > 0
          ? requestPath.trim().startsWith('/')
            ? requestPath.trim()
            : `/${requestPath.trim()}`
          : '/';

      if (!/^\/session\/[^/]+\/message(?:\?.*)?$/.test(normalizedPath)) {
        const body = JSON.stringify({ error: 'Invalid session message proxy path' });
        const data: ApiProxyResponsePayload = {
          status: 400,
          headers: { 'content-type': 'application/json' },
          bodyBase64: deps.base64EncodeUtf8(body),
        };
        return { id, type, success: true, data };
      }

      const base = `${apiUrl.replace(/\/+$/, '')}/`;
      const targetUrl = new URL(normalizedPath.replace(/^\/+/, ''), base).toString();
      const requestHeaders: Record<string, string> = {
        ...deps.sanitizeForwardHeaders(headers),
        ...ctx?.manager?.getOpenCodeAuthHeaders(),
      };

      try {
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: typeof bodyText === 'string' ? bodyText : '',
          signal: AbortSignal.timeout(45000),
        });

        const responseHeaders = collectProxyResponseHeaders(response.headers, deps);
        if (shouldReturnTextBody(response.headers)) {
          const bodyText = await response.text();
          setDecodedPayloadLengthHeader(responseHeaders, Buffer.byteLength(bodyText));
          const data: ApiProxyResponsePayload = {
            status: response.status,
            headers: responseHeaders,
            bodyText,
          };

          return { id, type, success: true, data };
        }

        const arrayBuffer = await response.arrayBuffer();
        setDecodedPayloadLengthHeader(responseHeaders, arrayBuffer.byteLength);
        const data: ApiProxyResponsePayload = {
          status: response.status,
          headers: responseHeaders,
          bodyBase64: Buffer.from(arrayBuffer).toString('base64'),
        };

        return { id, type, success: true, data };
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          ((error as Error & { name?: string }).name === 'TimeoutError' ||
            (error as Error & { name?: string }).name === 'AbortError');
        const body = JSON.stringify({
          error: isTimeout ? 'OpenCode message forward timed out' : error instanceof Error ? error.message : 'OpenCode message forward failed',
        });
        const data: ApiProxyResponsePayload = {
          status: isTimeout ? 504 : 503,
          headers: { 'content-type': 'application/json' },
          bodyText: body,
        };
        return { id, type, success: true, data };
      }
    }

    default:
      return null;
  }
}
