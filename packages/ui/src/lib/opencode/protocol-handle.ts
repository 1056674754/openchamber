/**
 * Dual-track SDK handle resolver (OC2 spine S5, plan §2/§5).
 *
 * One resolving function answers "which SDK client talks to the server that
 * owns this directory/session", per that server's recorded protocol mode:
 *
 * - `v1` (default for every server until activation): the exact
 *   `@opencode-ai/sdk` client instance the v1 paths resolve today — same
 *   object, same routing, byte-stable behavior.
 * - `v2`: a `@opencode/client` client scoped to the same server. The v2 wire
 *   replaced `?directory=` with the `x-opencode-directory` header (J4), so the
 *   v2 client is directory-scoped at construction and cached per
 *   (serverId, directory).
 *
 * Fork invariants that hold on BOTH tracks, by construction:
 * - multi-server routing: the v2 track resolves through the very same
 *   `resolveRouteForDirectory` decision path as the v1 track (session index >
 *   project ownership > directory cache > child stores > default). There is no
 *   second routing implementation to drift.
 * - directory authority: the v2 client bakes the normalized directory into the
 *   header, mirroring what `?directory=` means on the v1 track.
 * - provider circuit breaker: sends on either track go through
 *   {@link sendWithProviderCircuit}, which wraps the same provider-tracker
 *   semantics the v1 send paths inline today. v2 send calls land in S6 and
 *   must use this guard.
 *
 * The handle carries the resolved `serverId` so S6 consumers can key
 * mode-adjacent state (coalescing, health, sync stores) without re-deriving
 * the owner. UI components must not read the mode directly (plan §2) — only
 * the sync/SDK boundary branches on it.
 *
 * Not wired yet, deliberately: nothing in the fork calls the resolver until
 * S6. The `runtimeFetch` transport hookup (read coalescing keyed on the
 * directory header, relay/Capacitor transports) touches the foreign
 * `runtime-fetch.ts` and is deferred to the S6/S8 wiring batches — the v2
 * factory below uses the platform fetch with upstream's #2470 read-timeout
 * composition until then.
 */

import { OpenCode, type OpenCodeClient } from "@opencode/client";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { getProtocolMode, type ProtocolMode } from "./protocolMode";
import { serverRegistry } from "./server-registry";
import {
  assertProviderCircuitClosed,
  recordProviderError,
  recordProviderSuccess,
} from "./provider-tracker";
import { normalizeDirectoryKey, resolveRouteForDirectory } from "@/sync/session-routing";

/** Header the OpenCode v2 server reads to resolve a Location (J4); the value is URI-encoded on both ends. */
export const OPENCODE_DIRECTORY_HEADER = "x-opencode-directory";

/** The v1 track's SDK client, exactly as `resolveSdkForDirectory` returns it. */
export type V1SdkHandle = {
  mode: "v1";
  serverId: string;
  client: OpencodeClient;
};

/** The v2 track's `@opencode/client`, scoped to the request's directory via the directory header. */
export type V2SdkHandle = {
  mode: "v2";
  serverId: string;
  client: OpenCodeClient;
};

export type ProtocolSdkHandle = V1SdkHandle | V2SdkHandle;

// ---------------------------------------------------------------------------
// v2 client factory
// ---------------------------------------------------------------------------

/** Upper bound for non-streaming OpenCode reads. Without it a half-open socket
 *  (upstream #2470) blocks bootstrap concurrency slots forever. Long-lived
 *  streams (the event SSE, session logs) and POSTs are excluded. */
const OPENCODE_REQUEST_TIMEOUT_MS = 30_000;

const isEventStreamUrl = (url: URL): boolean =>
  url.pathname.endsWith("/event") || url.pathname.endsWith("/log");

type AbortSignalConstructorWithTimeout = typeof AbortSignal & {
  timeout?: (milliseconds: number) => AbortSignal;
};

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const abortSignal = typeof AbortSignal !== "undefined" ? (AbortSignal as AbortSignalConstructorWithTimeout) : undefined;
  if (typeof abortSignal?.timeout === "function") {
    return { signal: abortSignal.timeout(timeoutMs), cleanup: () => undefined };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
};

export type DirectoryScopedClientConfig = {
  baseUrl: string;
  /** Directory resolved into the `x-opencode-directory` header; omit for unscoped/global calls. */
  directory?: string;
  /** Read-request timeout in ms. Overridable so tests can use a short value. */
  requestTimeoutMs?: number;
};

/**
 * Builds the v2 track's client the same way upstream's `createRuntimeOpencodeClient`
 * does, minus the `runtimeFetch` hookup (foreign file, deferred to S6/S8): the
 * transport is the platform fetch, reads carry the #2470 deadline, and every
 * request resolves `directory` through the header instead of a query param.
 */
export const createDirectoryScopedOpencodeClient = (config: DirectoryScopedClientConfig): OpenCodeClient => {
  const requestTimeoutMs = config.requestTimeoutMs ?? OPENCODE_REQUEST_TIMEOUT_MS;
  return OpenCode.make({
    baseUrl: config.baseUrl,
    headers: config.directory
      ? { [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(config.directory) }
      : undefined,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (isEventStreamUrl(url) || method === "POST") {
        return fetch(input, init);
      }
      const timeout = createTimeoutSignal(requestTimeoutMs);
      const callerSignal = init?.signal !== undefined
        ? init.signal
        : input instanceof Request ? input.signal : undefined;
      const supportsAny = typeof AbortSignal !== "undefined" && typeof (AbortSignal as { any?: unknown }).any === "function";
      let signal: AbortSignal;
      let detachFallback: (() => void) | null = null;
      if (callerSignal && supportsAny) {
        signal = (AbortSignal as typeof AbortSignal & { any: (signals: AbortSignal[]) => AbortSignal }).any([
          callerSignal,
          timeout.signal,
        ]);
      } else if (callerSignal) {
        // No AbortSignal.any: compose manually. Silently dropping the timeout
        // here would disable the deadline on exactly the bootstrap reads it
        // targets, since those carry a cancellation signal.
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(callerSignal.reason);
        const abortFromTimeout = () => controller.abort(timeout.signal.reason);
        if (callerSignal.aborted) {
          abortFromCaller();
        } else if (timeout.signal.aborted) {
          abortFromTimeout();
        } else {
          callerSignal.addEventListener("abort", abortFromCaller, { once: true });
          timeout.signal.addEventListener("abort", abortFromTimeout, { once: true });
          detachFallback = () => {
            callerSignal.removeEventListener("abort", abortFromCaller);
            timeout.signal.removeEventListener("abort", abortFromTimeout);
          };
        }
        signal = controller.signal;
      } else {
        signal = timeout.signal;
      }
      const cleanup = () => {
        detachFallback?.();
        timeout.cleanup();
      };
      let responseHasBody = false;
      try {
        const response = await fetch(input, { ...init, signal });
        responseHasBody = response.body !== null;
        return response;
      } catch (error) {
        if (timeout.signal.aborted && !callerSignal?.aborted) {
          throw new Error(`OpenCode request timed out after ${requestTimeoutMs}ms`);
        }
        throw error;
      } finally {
        // The SDK consumes JSON after fetch resolves. Keep cancellation and the
        // deadline alive through body delivery, including on older WebViews
        // using the manual signal composition. Retention is bounded by the
        // request deadline, just like native AbortSignal.timeout.
        if (!responseHasBody || signal.aborted) cleanup();
        else signal.addEventListener("abort", cleanup, { once: true });
      }
    },
  });
};

// ---------------------------------------------------------------------------
// v2 client cache
// ---------------------------------------------------------------------------

const v2Clients = new Map<string, OpenCodeClient>();

/**
 * Cache identity: one v2 client per server instance per scoped directory.
 * The base URL is part of the key, so re-registering a server against a new
 * endpoint invalidates its cached clients without a separate eviction hook.
 */
export const v2ClientCacheKey = (serverId: string, baseUrl: string, directory?: string | null): string =>
  `${serverId}\0${baseUrl.replace(/\/+$/, "")}\0${directory ? normalizeDirectoryKey(directory) : ""}`;

const v2ClientFor = (serverId: string, directory?: string | null): OpenCodeClient => {
  const connection = serverRegistry.get(serverId);
  if (!connection) {
    // Defensive: route resolution registers remote connections on the way
    // here, so a missing registration means the default client was absent
    // and no stale cache entry may serve the request.
    for (const key of v2Clients.keys()) {
      if (key.startsWith(`${serverId}\0`)) v2Clients.delete(key);
    }
    throw new Error(`No registered OpenChamber server connection for "${serverId}"`);
  }
  const key = v2ClientCacheKey(serverId, connection.config.baseUrl, directory);
  const cached = v2Clients.get(key);
  if (cached) return cached;
  const client = createDirectoryScopedOpencodeClient({
    baseUrl: connection.config.baseUrl,
    directory: directory ?? undefined,
  });
  v2Clients.set(key, client);
  return client;
};

/** Drops cached v2 clients (tests, server topology changes). */
export function clearV2ClientCache(): void {
  v2Clients.clear();
}

// ---------------------------------------------------------------------------
// Dual-track resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the dual-track SDK handle for a request. The v1 track returns the
 * identical client object the existing v1 call sites hold, so a server in v1
 * mode observes zero change; the v2 track resolves through the same routing
 * decision and only swaps the transport/shape.
 */
export function resolveProtocolSdkHandleForDirectory(
  directory: string,
  sessionID?: string,
  explicitServerId?: string,
  fallbackClient?: OpencodeClient | null,
): ProtocolSdkHandle {
  const route = resolveRouteForDirectory(directory, sessionID, explicitServerId, fallbackClient);
  const mode: ProtocolMode = getProtocolMode(route.serverId);
  if (mode === "v2") {
    return { mode, serverId: route.serverId, client: v2ClientFor(route.serverId, directory) };
  }
  return { mode, serverId: route.serverId, client: route.client };
}

// ---------------------------------------------------------------------------
// Provider circuit guard (shared by both tracks' send paths)
// ---------------------------------------------------------------------------

const readErrorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return undefined;
};

/**
 * Runs a send through the provider circuit breaker — the exact semantics the
 * v1 send paths inline today (assert closed, record success, record error
 * with the response status when the failure carries one). The S6 v2 send path
 * must route its prompt/command calls through this guard so a provider error
 * storm trips the same circuit regardless of track.
 */
export async function sendWithProviderCircuit<T>(providerID: string, op: () => Promise<T>): Promise<T> {
  assertProviderCircuitClosed(providerID);
  try {
    const result = await op();
    recordProviderSuccess(providerID);
    return result;
  } catch (error) {
    recordProviderError(providerID, readErrorStatus(error));
    throw error;
  }
}
