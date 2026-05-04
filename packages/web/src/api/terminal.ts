import {
  connectTerminalStream,
  createTerminalSession,
  resizeTerminal,
  sendTerminalInput,
  closeTerminal,
  restartTerminalSession,
  forceKillTerminal,
} from '@openchamber/ui/lib/terminalApi';
import type {
  TerminalAPI,
  TerminalHandlers,
  TerminalStreamOptions,
  CreateTerminalOptions,
  ResizeTerminalPayload,
  TerminalSession,
  ForceKillOptions,
} from '@openchamber/ui/lib/api/types';

const getRetryPolicy = (options?: TerminalStreamOptions) => {
  const retry = options?.retry;
  return {
    maxRetries: retry?.maxRetries ?? 3,
    initialRetryDelay: retry?.initialDelayMs ?? 1000,
    maxRetryDelay: retry?.maxDelayMs ?? 8000,
    connectionTimeout: options?.connectionTimeoutMs ?? 10000,
  };
};

export const createWebTerminalAPI = (): TerminalAPI => ({
  async createSession(options: CreateTerminalOptions): Promise<TerminalSession> {
    return createTerminalSession(options, options.baseUrl);
  },

  connect(sessionId: string, handlers: TerminalHandlers, options?: TerminalStreamOptions) {
    const unsubscribe = connectTerminalStream(
      sessionId,
      handlers.onEvent,
      handlers.onError,
      getRetryPolicy(options),
      options?.baseUrl
    );

    return {
      close: () => unsubscribe(),
    };
  },

  async sendInput(sessionId: string, input: string, baseUrl?: string): Promise<void> {
    await sendTerminalInput(sessionId, input, baseUrl);
  },

  async resize(payload: ResizeTerminalPayload): Promise<void> {
    await resizeTerminal(payload.sessionId, payload.cols, payload.rows, payload.baseUrl);
  },

  async close(sessionId: string, baseUrl?: string): Promise<void> {
    await closeTerminal(sessionId, baseUrl);
  },

  async restartSession(
    currentSessionId: string,
    options: CreateTerminalOptions
  ): Promise<TerminalSession> {
    return restartTerminalSession(currentSessionId, {
      cwd: options.cwd ?? '',
      cols: options.cols,
      rows: options.rows,
    }, options.baseUrl);
  },

  async forceKill(options: ForceKillOptions): Promise<void> {
    await forceKillTerminal(options, options.baseUrl);
  },
});
