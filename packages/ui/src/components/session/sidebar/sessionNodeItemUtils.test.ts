import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionNode } from "./types"
import {
  buildSessionNodeRenderExtras,
  canShowSessionWorktreeMenu,
  collectSubtreeContainingId,
  computeNodeStructureKey,
  getSessionWorktreeMenuDisabled,
  resolveMenuOpenSessionId,
} from "./sessionNodeItemUtils"

const session = (id: string, title = id): Session =>
  ({
    id,
    title,
    time: { created: 1, updated: 1 },
  }) as Session

const node = (id: string, children: SessionNode[] = []): SessionNode => ({
  session: session(id),
  children,
  worktree: null,
})

describe("sessionNodeItemUtils", () => {
  test("marks every ancestor when a descendant is active", () => {
    const tree = [node("root", [node("mid", [node("leaf")])])]
    const result = new Set<string>()
    collectSubtreeContainingId(tree, "leaf", result)
    expect([...result].sort()).toEqual(["leaf", "mid", "root"])
  })

  test("builds a stable structure key for nested children", () => {
    const tree = node("root", [node("a"), node("b", [node("c")])])
    expect(computeNodeStructureKey(tree)).toBe("a|b:c")
  })

  test("resolves the open menu session for multi-instance render contexts", () => {
    const roots = [node("s1"), node("s2")]
    expect(resolveMenuOpenSessionId(roots, "global-pinned:active:s2", "global-pinned", false)).toBe("s2")
    expect(resolveMenuOpenSessionId(roots, "project:archived:s1", "project", true)).toBe("s1")
    expect(resolveMenuOpenSessionId(roots, "project:active:s1", "project", true)).toBeNull()
  })

  test("precomputes per-child extras without sharing the parent structure key", () => {
    const roots = [node("parent", [node("child")])]
    const extras = buildSessionNodeRenderExtras(roots, "child", null, null, "project", false)
    expect(extras.subtreeContainsActive.has("parent")).toBe(true)
    expect(extras.subtreeContainsActive.has("child")).toBe(true)

    const childExtras = extras.childRenderExtrasFor?.(roots[0]!.children[0]!)
    expect(childExtras?.nodeStructureKey).toBe("")
    expect(childExtras?.subtreeContainsActive.has("child")).toBe(true)

    const parentExtras = extras.childRenderExtrasFor?.(roots[0]!)
    expect(parentExtras?.nodeStructureKey).toBe("child")
  })
})

describe("canShowSessionWorktreeMenu", () => {
  const baseArgs = {
    isSubtaskSession: false,
    archivedBucket: false,
    isVSCode: false,
    sessionDirectory: "/work/project",
  }

  test("shows the menu for a regular idle project session", () => {
    expect(canShowSessionWorktreeMenu(baseArgs)).toBe(true)
  })

  test("hides the menu for subagents, archived buckets, VS Code, and managed chats", () => {
    expect(canShowSessionWorktreeMenu({ ...baseArgs, isSubtaskSession: true })).toBe(false)
    expect(canShowSessionWorktreeMenu({ ...baseArgs, archivedBucket: true })).toBe(false)
    expect(canShowSessionWorktreeMenu({ ...baseArgs, isVSCode: true })).toBe(false)
    expect(
      canShowSessionWorktreeMenu({
        ...baseArgs,
        sessionDirectory: "/root/.config/openchamber/chats/some-chat",
      }),
    ).toBe(false)
  })
})

describe("getSessionWorktreeMenuDisabled", () => {
  test("requires a directory and an idle, non-moving session", () => {
    expect(getSessionWorktreeMenuDisabled({ sessionDirectory: "/repo", isStreaming: false, isMovingToWorktree: false })).toBe(false)
    expect(getSessionWorktreeMenuDisabled({ sessionDirectory: null, isStreaming: false, isMovingToWorktree: false })).toBe(true)
    expect(getSessionWorktreeMenuDisabled({ sessionDirectory: "/repo", isStreaming: true, isMovingToWorktree: false })).toBe(true)
    expect(getSessionWorktreeMenuDisabled({ sessionDirectory: "/repo", isStreaming: false, isMovingToWorktree: true })).toBe(true)
  })
})
