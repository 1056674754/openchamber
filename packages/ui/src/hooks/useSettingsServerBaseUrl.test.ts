import { beforeEach, describe, expect, test } from "bun:test";

import { ServerRegistry } from "@/lib/opencode/server-registry";
import { resolveSettingsServerBaseUrl, type ServerBaseUrlState } from "@/hooks/useSettingsServerBaseUrl";

describe("resolveSettingsServerBaseUrl", () => {
  let registry: ServerRegistry;
  let resolve: (id: string | null | undefined) => ServerBaseUrlState;

  beforeEach(() => {
    registry = new ServerRegistry();
    resolve = (id: string | null | undefined) => resolveSettingsServerBaseUrl(id, registry);
  });

  test("default/local instance (null) returns ready with empty baseUrl", () => {
    const result = resolve(null);
    expect(result).toEqual({ status: "ready", baseUrl: "" });
  });

  test("default/local instance (undefined) returns ready with empty baseUrl", () => {
    const result = resolve(undefined);
    expect(result).toEqual({ status: "ready", baseUrl: "" });
  });

  test("registered remote instance returns ready with its baseUrl", () => {
    const remoteId = "remote-test-1";
    const baseUrl = "/api/remote/remote-test-1";
    registry.register({ id: remoteId, label: "Test Remote", baseUrl });

    const result = resolve(remoteId);
    expect(result).toEqual({ status: "ready", baseUrl });
  });

  test("unregistered remote returns loading — NOT active-session fallback", () => {
    const unknownRemoteId = "remote-nonexistent-never-registered";
    const result = resolve(unknownRemoteId);
    expect(result).toEqual({ status: "loading", baseUrl: "" });
  });

  test("unregistered remote returns a stable loading object for useSyncExternalStore snapshots", () => {
    const unknownRemoteId = "remote-nonexistent-never-registered";
    expect(resolve(unknownRemoteId)).toBe(resolve(unknownRemoteId));
  });

  test("registered remote with empty baseUrl returns ready with empty string", () => {
    const remoteId = "remote-empty-base";
    registry.register({ id: remoteId, label: "Empty Base", baseUrl: "" });

    const result = resolve(remoteId);
    expect(result).toEqual({ status: "ready", baseUrl: "" });
  });

  test("status is 'ready' for registered remote regardless of health status", () => {
    const remoteId = "remote-unhealthy";
    const baseUrl = "/api/remote/remote-unhealthy";
    registry.register({ id: remoteId, label: "Unhealthy Remote", baseUrl });
    registry.setHealthStatus(remoteId, "unhealthy");

    const result = resolve(remoteId);
    expect(result.status).toBe("ready");
    expect(result.baseUrl).toBe(baseUrl);
  });

  test("registered remote returns a stable ready object for useSyncExternalStore snapshots", () => {
    const remoteId = "remote-stable";
    registry.register({ id: remoteId, label: "Stable Remote", baseUrl: "/api/remote/stable" });

    expect(resolve(remoteId)).toBe(resolve(remoteId));
  });
});
