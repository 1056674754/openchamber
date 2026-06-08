import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const { DEFAULT_SERVER_ID, serverRegistry } = await import("@/lib/opencode/server-registry");
const { ChildStoreManager } = await import("./child-store");
const { registerSyncStores } = await import("./multi-server-registry");
const { resolveSdkForDirectory, setSessionRoutingContextGetters } = await import("./session-routing");

describe("resolveSdkForDirectory", () => {
  beforeEach(() => {
    serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" });
    serverRegistry.clearSessionServerIndexDebugEntries();
    setSessionRoutingContextGetters({
      getProjects: () => [],
      getAvailableWorktreesByProject: () => new Map(),
    });
  });

  test("does not route an unindexed session request through a remote child store directory match", () => {
    const serverId = "remote-routing-test";
    serverRegistry.register({ id: serverId, label: "Remote", baseUrl: "/api/remote/remote-routing-test" });
    const remoteStores = new ChildStoreManager();
    remoteStores.ensureChild("/shared/path", { bootstrap: false });
    const unregisterStores = registerSyncStores(serverId, remoteStores, () => undefined);

    try {
      const defaultClient = serverRegistry.get(DEFAULT_SERVER_ID)?.client;
      const remoteClient = serverRegistry.get(serverId)?.client;

      expect(resolveSdkForDirectory("/shared/path")).toBe(remoteClient);
      expect(resolveSdkForDirectory("/shared/path", "ses_unindexed")).toBe(defaultClient);

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
});
