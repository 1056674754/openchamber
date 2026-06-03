import { describe, expect, test } from "bun:test";
import type { ProjectEntry } from "@/lib/api/types";
import type { WorktreeMetadata } from "@/types/worktree";

import { buildRemoteBootstrapDirectoryMap } from "./remote-bootstrap-directories";

const remoteProject = (path: string, serverId = "remote-a"): ProjectEntry => ({
  id: `project:${serverId}:${path}`,
  path,
  serverId,
});

const worktree = (
  path: string,
  overrides: Partial<WorktreeMetadata> = {},
): WorktreeMetadata => ({
  path,
  projectDirectory: "/repo",
  serverId: "remote-a",
  branch: "",
  label: path.split("/").filter(Boolean).pop() ?? path,
  ...overrides,
});

describe("buildRemoteBootstrapDirectoryMap", () => {
  test("includes discovered remote worktree directories without registering them as projects", () => {
    const worktreesByProject = new Map<string, WorktreeMetadata[]>([
      [
        "remote-a::/repo",
        [
          worktree("/repo/wvh"),
          worktree("/repo/wvh/", { branch: "wvh" }),
          worktree("/repo/feature"),
        ],
      ],
    ]);

    const result = buildRemoteBootstrapDirectoryMap(
      [remoteProject("/repo")],
      worktreesByProject,
      new Set(["remote-a"]),
    );

    expect(result.get("remote-a")).toEqual(["/repo", "/repo/wvh", "/repo/feature"]);
  });

  test("uses worktree server ids even when their parent project is not registered yet", () => {
    const worktreesByProject = new Map<string, WorktreeMetadata[]>([
      [
        "remote-a::/repo",
        [
          worktree("/repo/wvh"),
        ],
      ],
    ]);

    const result = buildRemoteBootstrapDirectoryMap(
      [],
      worktreesByProject,
      new Set(["remote-a"]),
    );

    expect(result.get("remote-a")).toEqual(["/repo/wvh"]);
  });

  test("ignores unhealthy servers and root directories", () => {
    const worktreesByProject = new Map<string, WorktreeMetadata[]>([
      ["remote-a::/repo", [worktree("/")]],
      ["remote-b::/repo", [worktree("/repo/wvh", { serverId: "remote-b" })]],
    ]);

    const result = buildRemoteBootstrapDirectoryMap(
      [remoteProject("/repo"), remoteProject("/", "remote-a"), remoteProject("/repo", "remote-b")],
      worktreesByProject,
      new Set(["remote-a"]),
    );

    expect(result.get("remote-a")).toEqual(["/repo"]);
    expect(result.has("remote-b")).toBe(false);
  });
});
