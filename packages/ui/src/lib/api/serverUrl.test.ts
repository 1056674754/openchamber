import { describe, expect, test } from "bun:test";

import { resolveApiUrl, resolveOpenCodeProxyApiUrl } from "./serverUrl";

describe("resolveApiUrl", () => {
  test("joins OpenChamber remote proxy bases without duplicating /api", () => {
    expect(resolveApiUrl("/session/status", "/api/remote/ssh-1")).toBe(
      "/api/remote/ssh-1/session/status",
    );
    expect(resolveApiUrl("/api/session/status", "/api/remote/ssh-1")).toBe(
      "/api/remote/ssh-1/session/status",
    );
  });

  test("preserves absolute api bases", () => {
    expect(resolveApiUrl("/api/session/status", "http://127.0.0.1:3000/api")).toBe(
      "http://127.0.0.1:3000/api/session/status",
    );
  });

  test("preserves upstream OpenCode v2 api path through local proxy", () => {
    expect(resolveOpenCodeProxyApiUrl("/api/session/ses_1/prompt", "/api")).toBe(
      "/api/api/api/session/ses_1/prompt",
    );
    expect(resolveOpenCodeProxyApiUrl("/api/session/ses_1/prompt", "http://127.0.0.1:3000/api")).toBe(
      "http://127.0.0.1:3000/api/api/api/session/ses_1/prompt",
    );
  });

  test("preserves upstream OpenCode v2 api path through remote proxy", () => {
    expect(resolveOpenCodeProxyApiUrl("/api/session/ses_1/prompt", "/api/remote/remote-a")).toBe(
      "/api/remote/remote-a/api/api/session/ses_1/prompt",
    );
  });

  test("uses a single api prefix for direct OpenCode bases", () => {
    expect(resolveOpenCodeProxyApiUrl("/api/session/ses_1/prompt", "http://127.0.0.1:3902")).toBe(
      "http://127.0.0.1:3902/api/session/ses_1/prompt",
    );
  });
});
