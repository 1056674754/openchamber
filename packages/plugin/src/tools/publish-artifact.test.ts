import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"

import { createArtifactStore } from "../artifact-store.js"
import { createPublishArtifactTool } from "./publish-artifact.js"

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("publish_artifact tool", () => {
  test("returns a structured OpenChamber artifact marker", async () => {
    // Given
    const rootDirectory = await createTemporaryDirectory("openchamber-artifacts-")
    const worktree = await createTemporaryDirectory("openchamber-worktree-")
    const sourcePath = join(worktree, "result.txt")
    await writeFile(sourcePath, "done")
    const ask = mock(async () => undefined)
    const context: ToolContext = {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "build",
      directory: worktree,
      worktree,
      abort: new AbortController().signal,
      metadata: mock(() => undefined),
      ask,
    }
    const publishArtifact = createPublishArtifactTool({
      store: createArtifactStore({ rootDirectory }),
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    })

    // When
    const result = await publishArtifact.execute({ path: sourcePath, title: "Final result" }, context)

    // Then
    expect(result).toMatchObject({
      title: "Published result.txt",
      metadata: {
        openchamberArtifact: {
          version: 1,
          name: "result.txt",
          title: "Final result",
          sessionID: "session-1",
          messageID: "message-1",
        },
      },
    })
    expect(ask).not.toHaveBeenCalled()
  })

  test("requests permission before publishing a file outside the worktree", async () => {
    // Given
    const rootDirectory = await createTemporaryDirectory("openchamber-artifacts-")
    const worktree = await createTemporaryDirectory("openchamber-worktree-")
    const externalDirectory = await createTemporaryDirectory("openchamber-external-")
    const sourcePath = join(externalDirectory, "outside.txt")
    await writeFile(sourcePath, "external")
    const ask = mock(async () => undefined)
    const context: ToolContext = {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "build",
      directory: worktree,
      worktree,
      abort: new AbortController().signal,
      metadata: mock(() => undefined),
      ask,
    }
    const publishArtifact = createPublishArtifactTool({
      store: createArtifactStore({ rootDirectory }),
    })

    // When
    await publishArtifact.execute({ path: sourcePath }, context)

    // Then
    const canonicalSourcePath = await realpath(sourcePath)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({
      permission: "artifact_publish",
      patterns: [canonicalSourcePath],
      always: [canonicalSourcePath],
      metadata: {
        path: canonicalSourcePath,
        outsideWorktree: true,
      },
    })
  })
})
