import { resolveApiUrl } from './api/serverUrl';
import type {
  CreateTerminalOptions,
  TerminalError,
  TerminalHandlers,
  TerminalSession,
  TerminalShellOption,
  TerminalStreamEvent,
  TerminalStreamOptions,
} from './api/types';
import type { TerminalChunkSize } from '@/stores/useTerminalStore';
import { openRuntimeWebSocket } from './relay/runtime-socket';
import { getRuntimeUrlResolver } from './runtime-url';
import { spaceApiPath, spaceIdOfDirectory } from './spaces/space-route';
import { isTerminalShell } from './terminalShell';

type Message = Record<string, unknown> & { t: string; s?: string; q?: number };
type Subscriber = { handlers: TerminalHandlers; lastSequence: number };
type TerminalProjection = {
  sequence: number;
  history: string;
  /** Current PTY size: what the server reported at attach, updated by every accepted resize. */
  cols?: number;
  rows?: number;
  status: TerminalStreamEvent['status'];
  exitCode?: number;
  signal?: number | null;
  runtime?: TerminalStreamEvent['runtime'];
  ptyBackend?: string;
};

const TAG = 1;
const MAX_PROJECTION_BYTES = 512 * 1024;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const IDLE_SOCKET_GRACE_MS = 15_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const GLOBAL_KEY = '__openchamberTerminalTransportStateV3';

const encode = (message: Message): Uint8Array => {
  const payload = encoder.encode(JSON.stringify(message));
  const frame = new Uint8Array(payload.length + 1);
  frame[0] = TAG;
  frame.set(payload, 1);
  return frame;
};

const decode = async (data: unknown): Promise<Message | null> => {
  let bytes: Uint8Array;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (data instanceof Uint8Array) bytes = data;
  else if (typeof Blob !== 'undefined' && data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
  else if (typeof data === 'string') bytes = encoder.encode(data);
  else return null;
  if (bytes[0] === TAG) bytes = bytes.subarray(1);
  try {
    return JSON.parse(decoder.decode(bytes)) as Message;
  } catch {
    return null;
  }
};

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(typeof body?.error === 'string' ? body.error : fallback);
};

const trimProjection = (value: string): string => {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= MAX_PROJECTION_BYTES) return value;
  let start = bytes.byteLength - MAX_PROJECTION_BYTES;
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
  return decoder.decode(bytes.subarray(start));
};

export const isRemoteTerminalProxyBaseUrl = (baseUrl?: string): boolean => {
  const candidate = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!candidate) {
    return false;
  }

  let pathname = candidate;
  try {
    pathname = new URL(candidate, 'http://openchamber.local').pathname;
  } catch {
    pathname = candidate;
  }

  const normalizedPathname = pathname.replace(/\/+$/, '');
  return /(?:^|\/)api\/remote\/[^/]+$/.test(normalizedPathname);
};

// A space's requests ride the current host's `/api/spaces/<id>/` prefix — never a remote
// server's base, whose path rewriting would mangle the prefix and whose server holds no
// spaces. A host directory resolves exactly as before.
const terminalApiUrl = (path: string, baseUrl?: string, directory?: string | null): string => {
  const prefixed = spaceApiPath(path, directory);
  if (prefixed !== path) return prefixed;
  return resolveApiUrl(path, baseUrl);
};

/** The PTY size a snapshot event's history was drawn for, when the server reported one. */
export const terminalSnapshotSize = (event: Pick<TerminalStreamEvent, 'cols' | 'rows'>): TerminalChunkSize | undefined =>
  event.cols !== undefined && event.rows !== undefined ? { cols: event.cols, rows: event.rows } : undefined;

const toWebSocketUrl = (httpUrl: string): string => {
  if (/^wss?:\/\//i.test(httpUrl)) return httpUrl;
  if (typeof window === 'undefined') {
    return httpUrl.replace(/^http/, 'ws');
  }
  const url = new URL(httpUrl, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

/**
 * HTTP terminal calls ride the patched window.fetch bridge (runtime base).
 * WebSocket does not — without an explicit baseUrl we must use the runtime
 * URL resolver, or Capacitor ends up on wss://localhost and stays blank.
 * A terminal of an isolated space rides the space's prefix on this host's
 * runtime resolver, never a remote server's base.
 */
const resolveTerminalWebSocketUrl = (baseUrl?: string, directory?: string | null): string => {
  const prefixed = spaceApiPath('/api/terminal/ws', directory);
  if (prefixed !== '/api/terminal/ws') {
    return toWebSocketUrl(prefixed);
  }
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (trimmed) {
    return toWebSocketUrl(terminalApiUrl('/api/terminal/ws', trimmed));
  }
  return getRuntimeUrlResolver().websocket('/api/terminal/ws');
};

export class TerminalTransport {
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private openingGeneration: number | null = null;
  private subscribers = new Map<string, Set<Subscriber>>();
  private projections = new Map<string, TerminalProjection>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private wakeCleanup: (() => void) | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly baseUrl?: string,
    private readonly openSocket: (url: string) => WebSocket = (url) => (
      openRuntimeWebSocket(url) as unknown as WebSocket
    ),
    private readonly directory?: string | null,
  ) {}

  subscribe(sessionId: string, handlers: TerminalHandlers): () => void {
    this.cancelIdleClose();
    const subscriber: Subscriber = { handlers, lastSequence: -1 };
    const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    const first = set.size === 0;
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    const projection = this.projections.get(sessionId);
    if (projection) {
      subscriber.lastSequence = projection.sequence;
      handlers.onEvent({
        type: 'snapshot',
        sequence: projection.sequence,
        data: projection.history,
        cols: projection.cols,
        rows: projection.rows,
        status: projection.status,
        exitCode: projection.exitCode,
        signal: projection.signal,
        runtime: projection.runtime,
        ptyBackend: projection.ptyBackend,
      });
    }
    const socketWasOpen = this.socket?.readyState === SOCKET_OPEN;
    void this.ensureConnected()
      .then(() => {
        if (first && socketWasOpen && set.has(subscriber)) {
          this.send({ t: 'attach', v: 3, s: sessionId });
        }
      })
      .catch((error) => {
        if (!set.has(subscriber)) return;
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)), false);
        this.scheduleReconnect();
      });
    return () => {
      const current = this.subscribers.get(sessionId);
      current?.delete(subscriber);
      if (current?.size === 0) {
        this.subscribers.delete(sessionId);
        this.projections.delete(sessionId);
        this.send({ t: 'detach', v: 3, s: sessionId });
      }
      if (this.subscribers.size === 0) {
        this.cancelReconnect();
        this.failures = 0;
        if (this.socket?.readyState === SOCKET_OPEN) {
          this.scheduleIdleClose();
          return;
        }
        // Nothing to reuse, so abandon any dial that is still in flight.
        this.generation += 1;
        this.opening = null;
        this.closeSocket();
      }
    };
  }

  async write(sessionId: string, data: string): Promise<void> {
    if (!data) return;
    await this.ensureConnected();
    if (this.send({ t: 'write', v: 3, s: sessionId, d: data })) return;
    this.closeSocket();
    await this.ensureConnected();
    if (!this.send({ t: 'write', v: 3, s: sessionId, d: data })) {
      throw new Error('Terminal connection is unavailable');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.opening = null;
    this.subscribers.clear();
    this.projections.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.cancelIdleClose();
    this.wakeCleanup?.();
    this.wakeCleanup = null;
    this.closeSocket();
  }

  forget(sessionId: string): void {
    this.projections.delete(sessionId);
  }

  /**
   * Records a resize the server accepted, so a projection snapshot replayed to
   * a later subscriber (tab switch, remount) still names the size the
   * terminal's current screen is drawn for.
   */
  noteResize(sessionId: string, cols: number, rows: number): void {
    const projection = this.projections.get(sessionId);
    if (!projection) return;
    this.projections.set(sessionId, { ...projection, cols, rows });
  }

  private async ensureConnected(): Promise<void> {
    if (this.disposed) throw new Error('Terminal runtime changed');
    if (this.socket?.readyState === SOCKET_OPEN) return;
    if (this.opening && this.openingGeneration === this.generation) {
      await this.opening;
      if (this.socket?.readyState === SOCKET_OPEN) return;
      return this.ensureConnected();
    }
    if (this.openingGeneration !== this.generation) {
      this.opening = null;
      this.openingGeneration = null;
    }
    const generation = this.generation;
    const opening = (async () => {
      if (generation !== this.generation || this.disposed) throw new Error('Terminal runtime changed');
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let pendingSocket: WebSocket | null = null;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(() => {
          pendingSocket?.close();
          finish(new Error('Terminal connection timed out'));
        }, 10_000);
        try {
          const socketUrl = resolveTerminalWebSocketUrl(this.baseUrl, this.directory);
          const socket = this.openSocket(socketUrl);
          pendingSocket = socket;
          socket.binaryType = 'arraybuffer';
          this.socket = socket;
          socket.onopen = () => {
            if (generation !== this.generation || this.disposed) {
              socket.close();
              finish(new Error('Terminal runtime changed'));
              return;
            }
            this.failures = 0;
            this.send({ t: 'hello', v: 3 });
            for (const sessionId of this.subscribers.keys()) {
              this.send({ t: 'attach', v: 3, s: sessionId });
            }
            this.startKeepalive();
            finish();
          };
          socket.onmessage = (event) => {
            void this.handleMessage(event.data);
          };
          socket.onerror = () => {
            finish(new Error('Terminal WebSocket failed'));
            if (!this.disposed && this.subscribers.size > 0) this.scheduleReconnect();
          };
          socket.onclose = () => {
            if (this.socket === socket) this.socket = null;
            this.stopKeepalive();
            finish(new Error('Terminal WebSocket closed'));
            if (!this.disposed && this.subscribers.size > 0) this.scheduleReconnect();
          };
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Terminal WebSocket failed'));
          if (!this.disposed && this.subscribers.size > 0) this.scheduleReconnect();
        }
      });
    })();
    this.opening = opening;
    this.openingGeneration = generation;
    try {
      await opening;
    } finally {
      if (this.opening === opening) {
        this.opening = null;
        this.openingGeneration = null;
      }
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = await decode(raw);
    if (!message || message.t === 'hello' || message.t === 'pong') return;
    if (message.t === 'error') {
      const error = new Error(typeof message.message === 'string' ? message.message : 'Terminal error') as TerminalError;
      if (typeof message.code === 'string') error.code = message.code;
      const targets = typeof message.s === 'string' ? [message.s] : [...this.subscribers.keys()];
      for (const id of targets) {
        for (const sub of this.subscribers.get(id) ?? []) {
          sub.handlers.onError?.(error, message.fatal === true);
        }
      }
      return;
    }
    if (typeof message.s !== 'string') return;
    const subscribers = this.subscribers.get(message.s);
    if (!subscribers) return;
    if (message.t === 'snapshot') {
      const projection: TerminalProjection = {
        sequence: typeof message.q === 'number' ? message.q : 0,
        history: typeof message.history === 'string' ? message.history : '',
        cols: typeof message.cols === 'number' ? message.cols : undefined,
        rows: typeof message.rows === 'number' ? message.rows : undefined,
        status: message.status as TerminalStreamEvent['status'],
        exitCode: typeof message.exitCode === 'number' ? message.exitCode : undefined,
        signal: typeof message.signal === 'number' ? message.signal : null,
        runtime: message.runtime as TerminalStreamEvent['runtime'],
        ptyBackend: typeof message.ptyBackend === 'string' ? message.ptyBackend : undefined,
      };
      this.projections.set(message.s, projection);
      for (const sub of subscribers) {
        sub.lastSequence = projection.sequence;
        sub.handlers.onEvent({
          type: 'snapshot',
          sequence: projection.sequence,
          data: projection.history,
          cols: projection.cols,
          rows: projection.rows,
          status: projection.status,
          exitCode: projection.exitCode,
          signal: projection.signal,
          runtime: projection.runtime,
          ptyBackend: projection.ptyBackend,
        });
      }
      return;
    }
    if (typeof message.q !== 'number') return;
    const previous = this.projections.get(message.s);
    if (previous && message.q > previous.sequence) {
      if (message.t === 'output') {
        this.projections.set(message.s, {
          ...previous,
          sequence: message.q,
          history: trimProjection(
            previous.history + (typeof message.r === 'string' ? message.r : (typeof message.d === 'string' ? message.d : '')),
          ),
        });
      } else if (message.t === 'exit') {
        this.projections.set(message.s, {
          ...previous,
          sequence: message.q,
          status: 'exited',
          exitCode: typeof message.exitCode === 'number' ? message.exitCode : undefined,
          signal: typeof message.signal === 'number' ? message.signal : null,
        });
      } else if (message.t === 'restarted') {
        this.projections.set(message.s, {
          ...previous,
          sequence: message.q,
          history: typeof message.history === 'string' ? message.history : '',
          status: 'running',
          exitCode: undefined,
          signal: null,
        });
      }
    }
    for (const sub of subscribers) {
      if (message.q <= sub.lastSequence) continue;
      sub.lastSequence = message.q;
      if (message.t === 'output') {
        sub.handlers.onEvent({
          type: 'data',
          sequence: message.q,
          data: typeof message.d === 'string' ? message.d : '',
          replayData: typeof message.r === 'string' ? message.r : undefined,
        });
      } else if (message.t === 'exit') {
        sub.handlers.onEvent({
          type: 'exit',
          sequence: message.q,
          exitCode: typeof message.exitCode === 'number' ? message.exitCode : undefined,
          signal: typeof message.signal === 'number' ? message.signal : null,
        });
      } else if (message.t === 'restarted') {
        const projection = this.projections.get(message.s);
        sub.handlers.onEvent({
          type: 'snapshot',
          sequence: message.q,
          data: typeof message.history === 'string' ? message.history : '',
          cols: projection?.cols,
          rows: projection?.rows,
          status: 'running',
        });
      }
    }
  }

  private send(message: Message): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    try {
      this.socket.send(encode(message));
      return true;
    } catch {
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed || this.subscribers.size === 0) return;
    this.failures += 1;
    const slow = (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      || (typeof navigator !== 'undefined' && !navigator.onLine);
    const delay = slow ? 60_000 : Math.min(500 * 2 ** Math.min(this.failures - 1, 10), 8_000);
    for (const set of this.subscribers.values()) {
      for (const sub of set) {
        sub.handlers.onEvent({ type: 'reconnecting', attempt: this.failures, maxAttempts: Number.POSITIVE_INFINITY });
      }
    }
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.wakeCleanup?.();
      this.wakeCleanup = null;
      void this.ensureConnected().catch(() => this.scheduleReconnect());
    };
    if (typeof window !== 'undefined') window.addEventListener('online', wake);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
    this.wakeCleanup = () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', wake);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
    };
    this.reconnectTimer = setTimeout(wake, delay);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => this.send({ t: 'ping', v: 3 }), 45_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.wakeCleanup?.();
    this.wakeCleanup = null;
  }

  private scheduleIdleClose(): void {
    if (this.idleCloseTimer || this.disposed) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.disposed || this.subscribers.size > 0) return;
      this.generation += 1;
      this.opening = null;
      this.closeSocket();
    }, IDLE_SOCKET_GRACE_MS);
  }

  private cancelIdleClose(): void {
    if (!this.idleCloseTimer) return;
    clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = null;
  }

  private closeSocket(): void {
    this.stopKeepalive();
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      socket.close();
    }
  }
}

type GlobalTransportState = {
  entries: Map<string, TerminalTransport>;
};

const getGlobalState = (): GlobalTransportState => {
  const root = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GlobalTransportState };
  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = { entries: new Map() };
  }
  return root[GLOBAL_KEY];
};

// One socket per target: a server (the fork's per-baseUrl lanes), or one isolated space on
// that server, whose terminals live behind `/api/spaces/<id>/terminal/ws`. The target is the
// terminal's working directory, so every call names it; a call without a space directory is
// the server's own (upstream 1290fd121, re-keyed over the fork's baseUrl map).
const transportKey = (baseUrl?: string, directory?: string | null): string => (
  `${baseUrl && baseUrl.trim() ? baseUrl.trim() : '__default__'}\u0000${spaceIdOfDirectory(directory) ?? ''}`
);

const getTransport = (baseUrl?: string, directory?: string | null): TerminalTransport => {
  const state = getGlobalState();
  const key = transportKey(baseUrl, directory);
  let transport = state.entries.get(key);
  if (!transport) {
    transport = new TerminalTransport(baseUrl, undefined, directory);
    state.entries.set(key, transport);
  }
  return transport;
};

export async function createTerminalSession(options: CreateTerminalOptions, baseUrl?: string): Promise<TerminalSession> {
  const response = await fetch(terminalApiUrl('/api/terminal/create', baseUrl ?? options.baseUrl, options.cwd), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: options.cwd,
      sessionId: options.sessionId,
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      themeMode: options.themeMode,
      terminalBackground: options.terminalBackground,
      terminalForeground: options.terminalForeground,
      shell: options.shell,
      loginShell: options.loginShell,
    }),
  });
  if (!response.ok) throw await responseError(response, 'Failed to create terminal session');
  return response.json() as Promise<TerminalSession>;
}

export async function listTerminalShells(baseUrl?: string): Promise<TerminalShellOption[]> {
  const response = await fetch(terminalApiUrl('/api/terminal/shells', baseUrl));
  if (!response.ok) throw await responseError(response, 'Failed to list terminal shells');
  const payload = await response.json().catch(() => []);
  return Array.isArray(payload)
    ? payload.filter((entry): entry is TerminalShellOption => (
      Boolean(entry)
      && typeof entry === 'object'
      && isTerminalShell((entry as TerminalShellOption).id)
      && typeof (entry as TerminalShellOption).name === 'string'
      && typeof (entry as TerminalShellOption).supportsLogin === 'boolean'
    ))
    : [];
}

export type ConnectStreamOptions = {
  maxRetries?: number;
  initialRetryDelay?: number;
  maxRetryDelay?: number;
  connectionTimeout?: number;
};

export function connectTerminalStream(
  sessionId: string,
  onEvent: TerminalHandlers['onEvent'],
  onError?: TerminalHandlers['onError'],
  options: ConnectStreamOptions = {},
  baseUrl?: string,
  directory?: string | null,
): () => void {
  void options;
  return getTransport(baseUrl, directory).subscribe(sessionId, { onEvent, onError });
}

export async function sendTerminalInput(sessionId: string, data: string, baseUrl?: string, directory?: string | null): Promise<void> {
  await getTransport(baseUrl, directory).write(sessionId, data);
}

async function command(path: string, method: string, body?: unknown, baseUrl?: string, directory?: string | null): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(terminalApiUrl(path, baseUrl, directory), init);
  if (!response.ok) throw await responseError(response, 'Terminal command failed');
  return response;
}

export async function resizeTerminal(sessionId: string, cols: number, rows: number, baseUrl?: string, directory?: string | null): Promise<void> {
  await command(`/api/terminal/${sessionId}/resize`, 'POST', { cols, rows }, baseUrl, directory);
  getTransport(baseUrl, directory).noteResize(sessionId, cols, rows);
}

export async function updateTerminalAppearance(
  sessionId: string,
  appearance: Pick<CreateTerminalOptions, 'themeMode' | 'terminalBackground' | 'terminalForeground'>,
  baseUrl?: string,
  directory?: string | null,
): Promise<void> {
  await command(`/api/terminal/${sessionId}/appearance`, 'POST', appearance, baseUrl, directory);
}

export async function closeTerminal(sessionId: string, baseUrl?: string, directory?: string | null): Promise<void> {
  await command(`/api/terminal/${sessionId}`, 'DELETE', undefined, baseUrl, directory);
  getTransport(baseUrl, directory).forget(sessionId);
}

export async function restartTerminalSession(
  currentSessionId: string,
  options: CreateTerminalOptions,
  baseUrl?: string,
): Promise<TerminalSession> {
  const response = await command(`/api/terminal/${currentSessionId}/restart`, 'POST', options, baseUrl ?? options.baseUrl, options.cwd);
  return response.json() as Promise<TerminalSession>;
}

export async function forceKillTerminal(
  options: { sessionId?: string; cwd?: string },
  baseUrl?: string,
): Promise<void> {
  const response = await command('/api/terminal/force-kill', 'POST', options, baseUrl, options.cwd);
  const result = await response.json().catch(() => null) as { killedSessionIds?: unknown } | null;
  const transport = getTransport(baseUrl, options.cwd);
  if (Array.isArray(result?.killedSessionIds)) {
    for (const sessionId of result.killedSessionIds) {
      if (typeof sessionId === 'string') transport.forget(sessionId);
    }
  } else if (options.sessionId) {
    transport.forget(options.sessionId);
  }
}

export function disposeTerminalInputTransport(baseUrl?: string): void {
  const state = getGlobalState();
  if (baseUrl === undefined) {
    for (const [key, transport] of state.entries) {
      transport.dispose();
      state.entries.delete(key);
    }
    return;
  }
  // Every space of this server goes with it.
  const prefix = transportKey(baseUrl);
  for (const [key, transport] of state.entries) {
    if (!key.startsWith(prefix)) continue;
    transport.dispose();
    state.entries.delete(key);
  }
}

/** Ensure a per-target transport entry exists (connection opens on first subscribe). */
export function primeTerminalInputTransport(baseUrl?: string, directory?: string | null): void {
  getTransport(baseUrl, directory);
}

// Compatibility no-ops for callers that still pass stream options shapes.
export type { TerminalStreamOptions };
