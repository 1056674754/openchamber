import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import {
  subscribeOpenchamberEventEnvelopes,
  type OpenChamberEventEnvelope,
} from '@/lib/openchamberEvents';
import { runtimeFetch } from '@/lib/runtime-fetch';

type BrowserControlRequest = {
  requestId: string;
  action: string;
  parameters: Record<string, unknown>;
  serverId: string;
};

export type BrowserController = {
  run: (action: string, parameters: Record<string, unknown>) => Promise<unknown>;
};

export type BrowserOpener = (url: string) => void;

type ScopedController = { serverId: string; controller: BrowserController };
type ScopedOpener = { serverId: string; open: BrowserOpener };
type ServerFetch = (serverId: string, path: string, init: RequestInit) => Promise<Response>;
type Subscribe = (listener: (event: OpenChamberEventEnvelope) => void) => () => void;

const VIEW_ATTACH_TIMEOUT_MS = 2_000;
const VIEW_ATTACH_POLL_MS = 50;

const parseRequest = (event: OpenChamberEventEnvelope): BrowserControlRequest | null => {
  if (event.type !== 'openchamber:browser-control-request') return null;
  const properties = event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
    ? event.properties as Record<string, unknown>
    : null;
  const requestId = typeof properties?.requestId === 'string' ? properties.requestId.trim() : '';
  const action = typeof properties?.action === 'string' ? properties.action.trim() : '';
  if (!requestId || !action) return null;
  const rawParameters = properties?.parameters;
  return {
    requestId,
    action,
    parameters: rawParameters && typeof rawParameters === 'object' && !Array.isArray(rawParameters)
      ? rawParameters as Record<string, unknown>
      : {},
    serverId: typeof event.serverId === 'string' && event.serverId ? event.serverId : DEFAULT_SERVER_ID,
  };
};

const defaultServerFetch: ServerFetch = async (serverId, path, init) => {
  if (serverId !== DEFAULT_SERVER_ID) {
    throw new Error(`Browser control transport is unavailable for aggregated server '${serverId}'`);
  }
  return runtimeFetch(path, init);
};

export const createBrowserControlClient = ({
  fetchServer = defaultServerFetch,
  subscribe = subscribeOpenchamberEventEnvelopes,
  setTimer = setTimeout,
}: {
  fetchServer?: ServerFetch;
  subscribe?: Subscribe;
  setTimer?: typeof setTimeout;
} = {}) => {
  let activeController: ScopedController | null = null;
  let opener: ScopedOpener | null = null;
  let unsubscribe: (() => void) | null = null;

  const postJson = async (serverId: string, path: string, body: Record<string, unknown>): Promise<Response> => (
    fetchServer(serverId, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

  const claim = async (request: BrowserControlRequest): Promise<boolean> => {
    try {
      const response = await postJson(request.serverId, '/api/browser-control/claim', {
        requestId: request.requestId,
      });
      if (!response.ok) return false;
      const body = await response.json() as { granted?: unknown };
      return body.granted === true;
    } catch {
      return false;
    }
  };

  const postResult = async (
    request: BrowserControlRequest,
    outcome: { ok: boolean; data?: unknown; error?: string },
  ): Promise<void> => {
    try {
      const response = await postJson(request.serverId, '/api/browser-control/result', {
        requestId: request.requestId,
        ...outcome,
      });
      if (!response.ok) {
        console.warn(`[browser-control] result rejected for ${request.requestId} (HTTP ${response.status})`);
      }
    } catch (error) {
      console.warn(`[browser-control] could not deliver result for ${request.requestId}:`, error);
    }
  };

  const waitForController = async (serverId: string): Promise<BrowserController | null> => {
    const deadline = Date.now() + VIEW_ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (activeController?.serverId === serverId) return activeController.controller;
      await new Promise<void>((resolve) => setTimer(resolve, VIEW_ATTACH_POLL_MS));
    }
    return activeController?.serverId === serverId ? activeController.controller : null;
  };

  const handleRequest = async (request: BrowserControlRequest): Promise<void> => {
    const controller = activeController?.serverId === request.serverId ? activeController.controller : null;
    const matchingOpener = opener?.serverId === request.serverId ? opener.open : null;
    const isOpen = request.action === 'browser.open';
    if (!controller && !(isOpen && matchingOpener)) return;
    if (!await claim(request)) return;

    try {
      if (isOpen && !controller) {
        const url = typeof request.parameters.url === 'string' ? request.parameters.url.trim() : '';
        if (!url) throw new Error('url is required');
        matchingOpener?.(url);
        const attached = await waitForController(request.serverId);
        if (!attached) {
          await postResult(request, {
            ok: true,
            data: { url, opened: true, controllerAttached: false },
          });
          return;
        }
        const data = await attached.run(request.action, request.parameters);
        await postResult(request, { ok: true, data });
        return;
      }

      const data = await controller!.run(request.action, request.parameters);
      await postResult(request, { ok: true, data });
    } catch (error) {
      await postResult(request, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const ensureSubscribed = () => {
    if (unsubscribe) return;
    unsubscribe = subscribe((event) => {
      const request = parseRequest(event);
      if (request) void handleRequest(request);
    });
  };

  const releaseIfIdle = () => {
    if (activeController || opener || !unsubscribe) return;
    unsubscribe();
    unsubscribe = null;
  };

  return {
    registerController(serverId: string, controller: BrowserController): () => void {
      const scoped = { serverId, controller };
      activeController = scoped;
      ensureSubscribed();
      return () => {
        if (activeController === scoped) activeController = null;
        releaseIfIdle();
      };
    },

    registerOpener(serverId: string, open: BrowserOpener): () => void {
      const scoped = { serverId, open };
      opener = scoped;
      ensureSubscribed();
      return () => {
        if (opener === scoped) opener = null;
        releaseIfIdle();
      };
    },

    dispose() {
      activeController = null;
      opener = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
};

const browserControlClient = createBrowserControlClient();

export const registerBrowserController = (
  serverId: string,
  controller: BrowserController,
): (() => void) => browserControlClient.registerController(serverId, controller);

export const registerBrowserOpener = (
  serverId: string,
  open: BrowserOpener,
): (() => void) => browserControlClient.registerOpener(serverId, open);
