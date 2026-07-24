import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createArtifactStore } from "./artifact-store.js"

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("artifact store", () => {
  test("keeps published content after the source file is deleted", async () => {
    // Given
    const rootDirectory = await createTemporaryDirectory("openchamber-artifacts-")
    const worktree = await createTemporaryDirectory("openchamber-worktree-")
    const sourceDirectory = join(worktree, ".tmp", "review-screenshots")
    const sourcePath = join(sourceDirectory, "queue.png")
    await mkdir(sourceDirectory, { recursive: true })
    await writeFile(sourcePath, Buffer.from("persistent screenshot"))
    const store = createArtifactStore({ rootDirectory })

    // When
    const artifact = await store.publish({
      sourcePath,
      sessionID: "session-1",
      messageID: "message-1",
      createdAt: new Date("2026-07-23T10:00:00.000Z"),
    })
    await unlink(sourcePath)

    // Then
    expect(artifact.name).toBe("queue.png")
    expect(artifact.mime).toBe("image/png")
    expect(artifact.sessionID).toBe("session-1")
    expect(artifact.messageID).toBe("message-1")
    expect(artifact.id).toMatch(/^[a-f0-9]{64}$/)
    expect(await readFile(store.getContentPath(artifact.id), "utf8")).toBe("persistent screenshot")
    expect(JSON.parse(await readFile(store.getManifestPath(artifact.id), "utf8"))).toEqual(artifact)
  })

  test("deduplicates the same publication identity", async () => {
    // Given
    const rootDirectory = await createTemporaryDirectory("openchamber-artifacts-")
    const worktree = await createTemporaryDirectory("openchamber-worktree-")
    const sourcePath = join(worktree, "report.md")
    await writeFile(sourcePath, "# Report")
    const store = createArtifactStore({ rootDirectory })
    const input = {
      sourcePath,
      sessionID: "session-1",
      messageID: "message-1",
      createdAt: new Date("2026-07-23T10:00:00.000Z"),
    }

    // When
    const first = await store.publish(input)
    const second = await store.publish(input)

    // Then
    expect(second.id).toBe(first.id)
    expect(second.sha256).toBe(first.sha256)
  })
})
