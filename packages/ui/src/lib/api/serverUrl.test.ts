import { describe, expect, test } from "bun:test";

import { resolveApiUrl } from "./serverUrl";

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
});
