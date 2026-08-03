import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const { DEFAULT_SERVER_ID, serverRegistry } = await import("@/lib/opencode/server-registry");
const { ChildStoreManager } = await import("./child-store");
const { registerSyncStores } = await import("./multi-server-registry");
const {
  normalizeDirectoryKey,
  requireExistingSessionDirectory,
  resolveSdkForDirectory,
  setSessionRoutingContextGetters,
} = await import("./session-routing");

describe("requireExistingSessionDirectory", () => {
  test("returns the normalized authoritative directory", () => {
    expect(requireExistingSessionDirectory("ses_known", "c:\\repo\\project\\")).toBe("C:/repo/project");
  });

  test("rejects an existing session without authoritative directory context", () => {
    expect(() => requireExistingSessionDirectory("ses_unknown", null)).toThrow(
      "Directory for session ses_unknown is not available",
    );
  });
});

describe("resolveSdkForDirectory", () => {
  beforeEach(() => {
    serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" });
    serverRegistry.clearSessionServerIndexDebugEntries();
    setSessionRoutingContextGetters({
      getProjects: () => [],
      getAvailableWorktreesByProject: () => new Map(),
    });
  });

  test("routes an unindexed session request through the directory's remote store without local fallback", () => {
    const serverId = "remote-routing-test";
    serverRegistry.register({ id: serverId, label: "Remote", baseUrl: "/api/remote/remote-routing-test" });
    const remoteStores = new ChildStoreManager();
    remoteStores.ensureChild("/shared/path", { bootstrap: false });
    const unregisterStores = registerSyncStores(serverId, remoteStores, () => undefined);

    try {
      const remoteClient = serverRegistry.get(serverId)?.client;

      expect(resolveSdkForDirectory("/shared/path")).toBe(remoteClient);
      // An unindexed session-scoped request routes through the directory's
      // remote ownership instead of degrading to the default/local server
      // (regression: remote session restored on refresh was routed to local).
      expect(resolveSdkForDirectory("/shared/path", "ses_unindexed")).toBe(remoteClient);

      serverRegistry.indexSession("ses_remote", serverId);
      expect(resolveSdkForDirectory("/other/path", "ses_remote")).toBe(remoteClient);
    } finally {
      unregisterStores();
      serverRegistry.forgetSession("ses_remote");
      serverRegistry.unregister(serverId);
    }
  });

  test("explicit default routing ignores a remote fallback client", () => {
    const serverId = "remote-fallback-test";
    serverRegistry.register({ id: serverId, label: "Remote", baseUrl: "/api/remote/remote-fallback-test" });

    try {
      const defaultClient = serverRegistry.get(DEFAULT_SERVER_ID)?.client;
      const remoteClient = serverRegistry.get(serverId)?.client;

      expect(resolveSdkForDirectory("/local/path", "ses_default", DEFAULT_SERVER_ID, remoteClient)).toBe(defaultClient);
    } finally {
      serverRegistry.unregister(serverId);
    }
  });

  test("canonicalizes Windows drive letters before routing", () => {
    expect(normalizeDirectoryKey("c:\\repo\\project\\")).toBe("C:/repo/project");

    const stores = new ChildStoreManager();
    const lower = stores.ensureChild("c:\\repo\\project", { bootstrap: false });
    const upper = stores.ensureChild("C:/repo/project", { bootstrap: false });
    expect(upper).toBe(lower);
    expect(stores.children.size).toBe(1);
  });
});
