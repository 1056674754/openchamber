import { describe, expect, test } from "bun:test";

import { isRemoteTerminalProxyBaseUrl } from "./terminalApi";

describe("isRemoteTerminalProxyBaseUrl", () => {
  test("detects local remote proxy API bases", () => {
    expect(isRemoteTerminalProxyBaseUrl("/api/remote/ssh-1")).toBe(true);
    expect(isRemoteTerminalProxyBaseUrl("/api/remote/ssh-1/")).toBe(true);
    expect(isRemoteTerminalProxyBaseUrl("http://127.0.0.1:45173/api/remote/ssh-1")).toBe(true);
  });

  test("does not treat direct API bases as remote proxy bases", () => {
    expect(isRemoteTerminalProxyBaseUrl(undefined)).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("/api")).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("http://127.0.0.1:3000/api")).toBe(false);
    expect(isRemoteTerminalProxyBaseUrl("http://remote-host:3000")).toBe(false);
  });
});
