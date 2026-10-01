import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROTOCOL_MODE,
  DEFAULT_PROTOCOL_MODE_SERVER_ID,
  getProtocolMode,
  normalizeProtocolMode,
  resetProtocolModes,
  setProtocolMode,
  snapshotProtocolModes,
} from "./protocolMode";

describe("UI protocol-mode registry (per serverId, default v1)", () => {
  test("defaults every server to the v1 mode", () => {
    expect(DEFAULT_PROTOCOL_MODE).toBe("v1");
    expect(getProtocolMode("default")).toBe("v1");
    expect(getProtocolMode("remote-1")).toBe("v1");
  });

  test("stores modes independently per server instance", () => {
    setProtocolMode("default", "v2");
    setProtocolMode("remote-1", "v1");
    expect(getProtocolMode("default")).toBe("v2");
    expect(getProtocolMode("remote-1")).toBe("v1");
    expect(getProtocolMode("remote-2")).toBe("v1");
  });

  test("normalizes unknown values back to the v1 default", () => {
    expect(normalizeProtocolMode("v2")).toBe("v2");
    expect(normalizeProtocolMode("v1")).toBe("v1");
    expect(normalizeProtocolMode("v3")).toBe("v1");
    expect(normalizeProtocolMode(null)).toBe("v1");
    expect(normalizeProtocolMode(undefined)).toBe("v1");
    setProtocolMode("default", "v3" as never);
    expect(getProtocolMode("default")).toBe("v1");
  });

  test("blank server ids land on the managed default instance", () => {
    expect(DEFAULT_PROTOCOL_MODE_SERVER_ID).toBe("default");
    setProtocolMode("", "v2");
    expect(getProtocolMode("default")).toBe("v2");
    setProtocolMode("  ", "v1");
    expect(getProtocolMode("default")).toBe("v1");
  });

  test("snapshot is a copy and reset clears everything", () => {
    setProtocolMode("default", "v2");
    setProtocolMode("remote-1", "v1");
    const snapshot = snapshotProtocolModes();
    expect(snapshot).toEqual({ default: "v2", "remote-1": "v1" });
    snapshot.default = "v1";
    expect(getProtocolMode("default")).toBe("v2");

    resetProtocolModes();
    expect(snapshotProtocolModes()).toEqual({});
    expect(getProtocolMode("default")).toBe("v1");
  });
});
