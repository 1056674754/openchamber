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
});
