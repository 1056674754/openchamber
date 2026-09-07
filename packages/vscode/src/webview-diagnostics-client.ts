import type * as vscode from 'vscode';

export type WebviewDiagnosticsResponse = {
  type: 'webview:diagnostics';
  requestId: string;
  payload: unknown;
};

export const isWebviewDiagnosticsResponse = (message: unknown): message is WebviewDiagnosticsResponse => {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<WebviewDiagnosticsResponse>;
  return value.type === 'webview:diagnostics' && typeof value.requestId === 'string';
};

export class WebviewDiagnosticsClient {
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  public request(
    webview: vscode.Webview | undefined,
    metadata: Record<string, unknown>,
    timeoutMs = 3000,
  ): Promise<unknown> {
    if (!webview) {
      return Promise.resolve({ ...metadata, available: false, reason: 'webview_not_resolved' });
    }

    const requestId = `webview_diagnostics_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const resolveWithMetadata = (value: unknown) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          resolve({ ...metadata, ...(value as Record<string, unknown>) });
          return;
        }
        resolve({ ...metadata, available: false, reason: 'invalid_webview_diagnostics' });
      };
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolveWithMetadata({ available: false, reason: 'webview_diagnostics_timeout' });
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolveWithMetadata, timeout });

      void webview.postMessage({
        type: 'command',
        command: 'collectWebviewDiagnostics',
        payload: { requestId },
      }).then((delivered) => {
        if (delivered) return;
        this.resolve(requestId, { available: false, reason: 'webview_message_not_delivered' });
      }, () => {
        this.resolve(requestId, { available: false, reason: 'webview_message_failed' });
      });
    });
  }

  public handle(message: unknown): boolean {
    if (!isWebviewDiagnosticsResponse(message)) return false;
    this.resolve(message.requestId, message.payload);
    return true;
  }

  public dispose(): void {
    for (const [requestId] of this.pending) {
      this.resolve(requestId, { available: false, reason: 'webview_disposed' });
    }
  }

  private resolve(requestId: string, value: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(value);
  }
}