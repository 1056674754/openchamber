import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// mock.module is process-global: this file must be runnable per-file (house
// rule from composer/DOCUMENTATION.md). Both SDK entrypoints are stubbed so
// no real transport is constructed.
mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl, sdk: "v1" }),
}));

type V2ClientConfig = {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: unknown;
};

const v2ClientConfigs: V2ClientConfig[] = [];

mock.module("@opencode/client", () => ({
  OpenCode: {
    make: (config: V2ClientConfig) => {
      v2ClientConfigs.push(config);
      return { baseUrl: config.baseUrl, headers: config.headers, sdk: "v2" };
    },
  },
}));

const { DEFAULT_SERVER_ID, serverRegistry } = await import("@/lib/opencode/server-registry");
const { DEFAULT_PROTOCOL_MODE, getProtocolMode, resetProtocolModes, setProtocolMode } = await import("./protocolMode");
const {
  OPENCODE_DIRECTORY_HEADER,
  clearV2ClientCache,
  resolveProtocolSdkHandleForDirectory,
  sendWithProviderCircuit,
  v2ClientCacheKey,
} = await import("./protocol-handle");
const { resolveRouteForDirectory } = await import("@/sync/session-routing");
const { resetCircuit } = await import("./provider-tracker");

const REMOTE_SERVER_ID = "protocol-handle-remote";

const registerDefaultServer = (): void => {
  serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" });
};

beforeEach(() => {
  resetProtocolModes();
  clearV2ClientCache();
  v2ClientConfigs.length = 0;
  registerDefaultServer();
});

afterEach(() => {
  resetCircuit("protocol-handle-provider");
  serverRegistry.forgetSession("ses_handle_a");
  serverRegistry.unregister(REMOTE_SERVER_ID);
});

describe("resolveProtocolSdkHandleForDirectory (OC2 spine S5 dual-track)", () => {
  test("defaults every server to the v1 mode and returns the exact v1 routing client", () => {
    expect(DEFAULT_PROTOCOL_MODE).toBe("v1");
    const handle = resolveProtocolSdkHandleForDirectory("/tmp/proj");
    expect(handle.mode).toBe("v1");
    expect(handle.serverId).toBe(DEFAULT_SERVER_ID);
    expect(handle.client).toBe(serverRegistry.get(DEFAULT_SERVER_ID)?.client);
  });

  test("a v2-mode default server yields a directory-scoped @opencode/client with the J4 header", () => {
    setProtocolMode(DEFAULT_SERVER_ID, "v2");
    const handle = resolveProtocolSdkHandleForDirectory("/tmp/ohos proj");
    expect(handle.mode).toBe("v2");
    expect(handle.serverId).toBe(DEFAULT_SERVER_ID);
    expect(handle.client).toMatchObject({ baseUrl: "/api", sdk: "v2" });
    const config = v2ClientConfigs.at(-1);
    expect(config?.baseUrl).toBe("/api");
    expect(config?.headers?.[OPENCODE_DIRECTORY_HEADER]).toBe(encodeURIComponent("/tmp/ohos proj"));
  });

  test("both tracks resolve through the same routing decision (explicit remote server)", () => {
    serverRegistry.register({ id: REMOTE_SERVER_ID, label: "Remote", baseUrl: "/api/remote/handle" });

    const v1Route = resolveRouteForDirectory("/anywhere", undefined, REMOTE_SERVER_ID);
    const v1Handle = resolveProtocolSdkHandleForDirectory("/anywhere", undefined, REMOTE_SERVER_ID);
    expect(v1Handle.mode).toBe("v1");
    expect(v1Handle.serverId).toBe(REMOTE_SERVER_ID);
    expect(v1Handle.client).toBe(v1Route.client);
    expect(v1Handle.client).toBe(serverRegistry.get(REMOTE_SERVER_ID)?.client);

    setProtocolMode(REMOTE_SERVER_ID, "v2");
    const v2Handle = resolveProtocolSdkHandleForDirectory("/anywhere", undefined, REMOTE_SERVER_ID);
    expect(v2Handle.mode).toBe("v2");
    expect(v2Handle.serverId).toBe(REMOTE_SERVER_ID);
    expect(getProtocolMode(DEFAULT_SERVER_ID)).toBe("v1");
    expect(v2ClientConfigs.at(-1)?.baseUrl).toBe("/api/remote/handle");
  });

  test("both tracks honor the authoritative session-server index", () => {
    serverRegistry.register({ id: REMOTE_SERVER_ID, label: "Remote", baseUrl: "/api/remote/handle" });
    serverRegistry.indexSession("ses_handle_a", REMOTE_SERVER_ID);

    const v1Handle = resolveProtocolSdkHandleForDirectory("/tmp/other", "ses_handle_a");
    expect(v1Handle.mode).toBe("v1");
    expect(v1Handle.serverId).toBe(REMOTE_SERVER_ID);
    expect(v1Handle.client).toBe(serverRegistry.get(REMOTE_SERVER_ID)?.client);

    setProtocolMode(REMOTE_SERVER_ID, "v2");
    const v2Handle = resolveProtocolSdkHandleForDirectory("/tmp/other", "ses_handle_a");
    expect(v2Handle.mode).toBe("v2");
    expect(v2Handle.serverId).toBe(REMOTE_SERVER_ID);
    expect(v2ClientConfigs.at(-1)?.baseUrl).toBe("/api/remote/handle");
  });

  test("v2 clients are cached per (serverId, directory) and re-created when either changes", () => {
    setProtocolMode(DEFAULT_SERVER_ID, "v2");
    const first = resolveProtocolSdkHandleForDirectory("/tmp/proj");
    const second = resolveProtocolSdkHandleForDirectory("/tmp/proj");
    expect(second.client).toBe(first.client);
    expect(v2ClientConfigs.length).toBe(1);

    const other = resolveProtocolSdkHandleForDirectory("/tmp/other");
    expect(other.client).not.toBe(first.client);
    expect(v2ClientConfigs.length).toBe(2);
    // Directory keys canonicalize trailing slashes, matching the routing key.
    expect(v2ClientCacheKey(DEFAULT_SERVER_ID, "/api", "/tmp/proj/")).toBe(
      v2ClientCacheKey(DEFAULT_SERVER_ID, "/api", "/tmp/proj"),
    );
    expect(v2ClientCacheKey(DEFAULT_SERVER_ID, "/api/", "/tmp/proj")).toBe(
      v2ClientCacheKey(DEFAULT_SERVER_ID, "/api", "/tmp/proj"),
    );
  });

  test("re-registering a server against a new base URL invalidates its cached v2 clients", () => {
    serverRegistry.register({ id: REMOTE_SERVER_ID, label: "Remote", baseUrl: "/api/remote/handle-a" });
    setProtocolMode(REMOTE_SERVER_ID, "v2");
    const first = resolveProtocolSdkHandleForDirectory("/x", undefined, REMOTE_SERVER_ID);
    expect(first.mode).toBe("v2");

    serverRegistry.register({ id: REMOTE_SERVER_ID, label: "Remote", baseUrl: "/api/remote/handle-b" });
    const second = resolveProtocolSdkHandleForDirectory("/x", undefined, REMOTE_SERVER_ID);
    expect(second.mode).toBe("v2");
    expect(second.client).not.toBe(first.client);
    expect(v2ClientConfigs.at(-1)?.baseUrl).toBe("/api/remote/handle-b");

    // Same base URL re-registration keeps the cached client.
    serverRegistry.register({ id: REMOTE_SERVER_ID, label: "Remote renamed", baseUrl: "/api/remote/handle-b" });
    const third = resolveProtocolSdkHandleForDirectory("/x", undefined, REMOTE_SERVER_ID);
    expect(third.client).toBe(second.client);
  });
});

describe("sendWithProviderCircuit (shared breaker guard for both tracks)", () => {
  const PROVIDER = "protocol-handle-provider";

  test("records success and keeps the circuit closed", async () => {
    let calls = 0;
    const result = await sendWithProviderCircuit(PROVIDER, async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });


  test("opens after repeated retryable failures and refuses further sends without calling the op", async () => {
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("upstream busy"), { status: 503 });
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(sendWithProviderCircuit(PROVIDER, failing)).rejects.toThrow("upstream busy");
    }

    let guardedCalls = 0;
    await expect(
      sendWithProviderCircuit(PROVIDER, async () => {
        guardedCalls += 1;
        return "should not run";
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(guardedCalls).toBe(0);
  });

  test("a success resets the consecutive-error count, so the circuit never opens", async () => {
    const failing = async (): Promise<never> => {
      throw Object.assign(new Error("upstream busy"), { status: 503 });
    };
    const succeeding = async (): Promise<string> => "ok";

    await expect(sendWithProviderCircuit(PROVIDER, failing)).rejects.toThrow();
    await expect(sendWithProviderCircuit(PROVIDER, failing)).rejects.toThrow();
    expect(await sendWithProviderCircuit(PROVIDER, succeeding)).toBe("ok");
    await expect(sendWithProviderCircuit(PROVIDER, failing)).rejects.toThrow();
    await expect(sendWithProviderCircuit(PROVIDER, failing)).rejects.toThrow();

    let calls = 0;
    await sendWithProviderCircuit(PROVIDER, async () => {
      calls += 1;
      return calls;
    });
    expect(calls).toBe(1);
  });

  test("non-retryable statuses never open the circuit", async () => {
    const badRequest = async (): Promise<never> => {
      throw Object.assign(new Error("invalid"), { status: 400 });
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(sendWithProviderCircuit(PROVIDER, badRequest)).rejects.toThrow("invalid");
    }

    let calls = 0;
    await sendWithProviderCircuit(PROVIDER, async () => {
      calls += 1;
      return calls;
    });
    expect(calls).toBe(1);
  });
});
