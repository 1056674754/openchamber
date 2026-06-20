import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: () => ({}),
}));

const { ServerRegistry } = await import("./server-registry");

function okHealthResponse(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ServerRegistry health probes", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async () => okHealthResponse()) as unknown as typeof fetch;
  });

  test("deduplicates concurrent probes for the same server", async () => {
    let fetchCalls = 0;
    let resolveFetch: (value: Response) => void = () => {};
    globalThis.fetch = (async () => new Promise<Response>((resolve) => {
      fetchCalls += 1;
      resolveFetch = resolve;
    })) as typeof fetch;

    const registry = new ServerRegistry();
    registry.register({ id: "remote-1", label: "Remote", baseUrl: "/api", healthUrl: "/health" });

    const first = registry.probeHealth("remote-1");
    const second = registry.probeHealth("remote-1");
    resolveFetch(okHealthResponse());

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(fetchCalls).toBe(1);
  });

  test("reuses recent healthy result unless forced", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return okHealthResponse();
    }) as typeof fetch;

    const registry = new ServerRegistry();
    registry.register({ id: "remote-2", label: "Remote", baseUrl: "/api", healthUrl: "/health" });

    expect(await registry.probeHealth("remote-2")).toBe(true);
    expect(await registry.probeHealth("remote-2")).toBe(true);
    expect(fetchCalls).toBe(1);

    expect(await registry.probeHealth("remote-2", { force: true })).toBe(true);
    expect(fetchCalls).toBe(2);
  });

  test("sends bounded timeout hints for remote POST health checks", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return okHealthResponse();
    }) as unknown as typeof fetch;

    const registry = new ServerRegistry();
    registry.register({
      id: "remote-3",
      label: "Remote",
      baseUrl: "/api/remote/remote-3",
      healthUrl: "/api/remote-instances/remote-3/health",
      healthMethod: "POST",
    });

    expect(await registry.probeHealth("remote-3", { timeoutMs: 2500 })).toBe(true);
    expect(bodies).toEqual([{ timeoutSec: 3 }]);
  });

  test("keeps health listeners across unregister and re-register", () => {
    const registry = new ServerRegistry();
    const statuses: Array<"healthy" | "unhealthy" | "connecting" | null> = [];

    registry.register({ id: "remote-4", label: "Remote", baseUrl: "/api/remote/remote-4" });
    const unsubscribe = registry.onHealthChange("remote-4", (status) => {
      statuses.push(status);
    });

    registry.setHealthStatus("remote-4", "unhealthy");
    registry.unregister("remote-4");
    registry.register({ id: "remote-4", label: "Remote", baseUrl: "/api/remote/remote-4" });
    registry.setHealthStatus("remote-4", "healthy");
    unsubscribe();
    registry.setHealthStatus("remote-4", "unhealthy");

    expect(statuses).toEqual(["unhealthy", null, null, "healthy"]);
  });

  test("notifies health listeners when a watched server registers", () => {
    const registry = new ServerRegistry();
    let calls = 0;

    const unsubscribe = registry.onHealthChange("remote-late", () => {
      calls += 1;
    });

    registry.register({ id: "remote-late", label: "Late Remote", baseUrl: "/api/remote/late" });
    unsubscribe();

    expect(calls).toBe(1);
  });
});

describe("ServerRegistry session index", () => {
  test("notifies only when a session server mapping changes", () => {
    const registry = new ServerRegistry();
    let calls = 0;
    const unsubscribe = registry.onSessionServerChange("ses_1", () => {
      calls += 1;
    });

    registry.indexSession("ses_1", "remote-a");
    registry.indexSession("ses_1", "remote-a");
    registry.indexSession("ses_2", "remote-a");
    registry.indexSession("ses_1", "remote-b");
    registry.forgetSession("ses_1");
    unsubscribe();
    registry.indexSession("ses_1", "remote-c");

    expect(calls).toBe(3);
  });

  test("records session server index changes for diagnostics", () => {
    const registry = new ServerRegistry();

    registry.indexSession("ses_trace", "remote-a");
    registry.indexSession("ses_trace", "remote-a");
    registry.indexSession("ses_trace", "remote-b");
    registry.forgetSession("ses_trace");

    const entries = registry.getSessionServerIndexDebugEntries({ sessionId: "ses_trace" });
    expect(entries.length).toBe(3);
    expect(entries[0].previous).toBe(undefined);
    expect(entries[0].next).toBe("remote-a");
    expect(entries[1].previous).toBe("remote-a");
    expect(entries[1].next).toBe("remote-b");
    expect(entries[2].previous).toBe("remote-b");
    expect(entries[2].next).toBe(undefined);
    expect(registry.getSessionServerIndexSnapshot()).toEqual([]);
  });
});
