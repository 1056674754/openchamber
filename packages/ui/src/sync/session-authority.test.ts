import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const { DEFAULT_SERVER_ID, serverRegistry } = await import("@/lib/opencode/server-registry");
const {
  resolveSessionAuthority,
  requireSessionAuthority,
  UnresolvedSessionServerError,
  setSessionDirectoryGetter,
  setSessionProjectGetter,
} = await import("./session-authority");
const {
  setDirectoryServerId,
  resolveSdkForDirectory,
  setSessionRoutingContextGetters,
} = await import("./session-routing");

const REMOTE = "dev3";

describe("session-authority", () => {
  beforeEach(() => {
    serverRegistry.clearSessionServerIndexDebugEntries();
    serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" });
    serverRegistry.register({ id: REMOTE, label: "Dev3", baseUrl: "/api/remote/dev3" });
    setSessionDirectoryGetter(() => null);
    setSessionProjectGetter(() => null);
    setSessionRoutingContextGetters({
      getProjects: () => [],
      getAvailableWorktreesByProject: () => new Map(),
    });
  });

  test("resolves a remote session from the runtime server index", () => {
    serverRegistry.indexSession("ses_remote_indexed", REMOTE);
    const authority = resolveSessionAuthority("ses_remote_indexed");
    expect(authority.serverId).toBe(REMOTE);
  });

  test("keeps the runtime server index authoritative over a stale persisted project binding", () => {
    serverRegistry.indexSession("ses_runtime_wins", REMOTE);
    setSessionProjectGetter(() => ({
      id: "proj-stale",
      path: "/root/stale",
      label: "Stale",
      serverId: "stale-dev2",
    }));

    expect(resolveSessionAuthority("ses_runtime_wins").serverId).toBe(REMOTE);
  });

  test("prefers the exact session directory over its parent project root", () => {
    setSessionProjectGetter(() => ({
      id: "proj-dev3",
      path: "/root/novel_editor",
      label: "Novel Editor",
      serverId: REMOTE,
    }));
    setSessionDirectoryGetter(() => "/root/.worktrees/novel-editor-feature");

    expect(resolveSessionAuthority("ses_worktree").directory).toBe("/root/.worktrees/novel-editor-feature");
  });

  test("resolves a session from the persisted session→project binding when the runtime index is absent", () => {
    setSessionProjectGetter(() => ({
      id: "proj-1",
      path: "/root/novel_editor",
      label: "novel_editor",
      serverId: REMOTE,
    }));
    const authority = resolveSessionAuthority("ses_unindexed_but_bound");
    expect(authority.serverId).toBe(REMOTE);
    expect(authority.directory).toBe("/root/novel_editor");
  });

  test("returns unresolved (serverId null) when no binding exists — never the default/local server", () => {
    const authority = resolveSessionAuthority("ses_completely_unknown");
    expect(authority.serverId).toBeNull();
    expect(authority.directory).toBeNull();
  });

  test("requireSessionAuthority fails closed for an unbounded session", () => {
    expect(() => requireSessionAuthority("ses_completely_unknown")).toThrow(UnresolvedSessionServerError);
  });
});

describe("directory-server cache keyed by server", () => {
  beforeEach(() => {
    serverRegistry.clearSessionServerIndexDebugEntries();
    serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" });
    serverRegistry.register({ id: REMOTE, label: "Dev3", baseUrl: "/api/remote/dev3" });
    setSessionRoutingContextGetters({
      getProjects: () => [],
      getAvailableWorktreesByProject: () => new Map(),
    });
  });

  test("resolves a directory owned by one remote server", () => {
    setDirectoryServerId("/root/novel_editor", REMOTE);
    const client = resolveSdkForDirectory("/root/novel_editor/src/main.ts");
    expect(client).toBe(serverRegistry.get(REMOTE)?.client);
  });

  test("treats a directory owned by two servers as ambiguous — does not collapse to local", () => {
    setDirectoryServerId("/root/novel_editor", REMOTE);
    setDirectoryServerId("/root/novel_editor", DEFAULT_SERVER_ID);
    const client = resolveSdkForDirectory("/root/novel_editor/src/main.ts");
    expect(client).toBe(serverRegistry.get(DEFAULT_SERVER_ID)?.client);
  });
});
