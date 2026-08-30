import type { DesktopBootOutcome } from '@/lib/desktopBoot';

declare global {
  type OpenChamberDesktopInvoke = (
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;

  interface OpenChamberDesktopBridge {
    core?: {
      invoke?: OpenChamberDesktopInvoke;
    };
    dialog?: {
      open?: (options: Record<string, unknown>) => Promise<unknown>;
    };
    shell?: {
      open?: (url: string) => Promise<unknown>;
    };
    event?: {
      listen?: (
        event: string,
        handler: (evt: { payload?: unknown }) => void,
      ) => Promise<() => void>;
    };
  }

  interface Window {
    __OPENCHAMBER_HOME__?: string;
    __OPENCHAMBER_MACOS_MAJOR__?: number;
    __OPENCHAMBER_LOCAL_ORIGIN__?: string;
    __OPENCHAMBER_ELECTRON__?: { runtime?: string; trayEnabled?: boolean };
    __OPENCHAMBER_PLATFORM__?: string;
    __OPENCHAMBER_DESKTOP__?: OpenChamberDesktopBridge;
    __OPENCHAMBER_DESKTOP_BOOT_OUTCOME__?: DesktopBootOutcome;
  }

  interface WebviewElement extends HTMLElement {
    loadURL(url: string): void;
    goBack(): void;
    goForward(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    reload(): void;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
    getWebContentsId(): number;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<WebviewElement> & {
          src?: string;
          partition?: string;
          preload?: string;
          nodeintegration?: string;
          allowpopups?: string;
          ref?: React.Ref<WebviewElement>;
        },
        WebviewElement
      >;
    }
  }
}

export {};
