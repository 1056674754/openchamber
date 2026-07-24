import { createHash } from "node:crypto"
import { constants, createReadStream } from "node:fs"
import { copyFile, mkdir, realpath, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"

const ARTIFACT_STORE_VERSION = 1 as const
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip",
}

export type ArtifactKind = "archive" | "document" | "file" | "image"

export type PublishedArtifact = {
  readonly version: typeof ARTIFACT_STORE_VERSION
  readonly id: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mime: string
  readonly size: number
  readonly sha256: string
  readonly kind: ArtifactKind
  readonly sessionID: string
  readonly messageID: string
  readonly createdAt: string
}

export type PublishArtifactInput = {
  readonly sourcePath: string
  readonly title?: string
  readonly description?: string
  readonly sessionID: string
  readonly messageID: string
  readonly createdAt?: Date
}

export type ArtifactStore = {
  readonly publish: (input: PublishArtifactInput) => Promise<PublishedArtifact>
  readonly getContentPath: (artifactID: string) => string
  readonly getManifestPath: (artifactID: string) => string
  readonly getDirectory: () => string
}

type ArtifactStoreOptions = {
  readonly rootDirectory?: string
}

export class ArtifactStoreError extends Error {
  readonly code: "file_too_large" | "not_a_file"

  constructor(code: ArtifactStoreError["code"], message: string) {
    super(message)
    this.name = "ArtifactStoreError"
    this.code = code
  }
}

function resolveArtifactDirectory(): string {
  const dataDirectory = process.env.OPENCHAMBER_DATA_DIR
    ? resolve(process.env.OPENCHAMBER_DATA_DIR)
    : join(homedir(), ".config", "openchamber")
  return join(dataDirectory, "artifacts")
}

function resolveMime(fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream"
}

function resolveArtifactKind(mime: string): ArtifactKind {
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/zip") return "archive"
  if (mime.startsWith("text/") || mime === "application/pdf" || mime === "application/json") return "document"
  return "file"
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

async function copyOnce(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  } catch (error) {
    if (!isAlreadyPresent(error)) throw error
  }
}

async function writeOnce(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if (!isAlreadyPresent(error)) throw error
  }
}

function publicationID(input: {
  readonly sha256: string
  readonly sessionID: string
  readonly messageID: string
  readonly name: string
}): string {
  return createHash("sha256")
    .update(input.sha256)
    .update("\0")
    .update(input.sessionID)
    .update("\0")
    .update(input.messageID)
    .update("\0")
    .update(input.name)
    .digest("hex")
}

export function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, filePath)
  return relativePath === ""
    || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

export async function resolvePublishSourcePath(sourcePath: string, directory: string): Promise<string> {
  return realpath(isAbsolute(sourcePath) ? sourcePath : resolve(directory, sourcePath))
}

export function createArtifactStore(options: ArtifactStoreOptions = {}): ArtifactStore {
  const rootDirectory = options.rootDirectory ?? resolveArtifactDirectory()

  const getArtifactDirectory = (artifactID: string): string => join(rootDirectory, artifactID)
  const getContentPath = (artifactID: string): string => join(getArtifactDirectory(artifactID), "content")
  const getManifestPath = (artifactID: string): string => join(getArtifactDirectory(artifactID), "manifest.json")

  return {
    getContentPath,
    getManifestPath,
    getDirectory: () => rootDirectory,

    publish: async (input): Promise<PublishedArtifact> => {
      const canonicalSourcePath = await realpath(input.sourcePath)
      const sourceStats = await stat(canonicalSourcePath)
      if (!sourceStats.isFile()) {
        throw new ArtifactStoreError("not_a_file", "Only regular files can be published as artifacts")
      }
      if (sourceStats.size > MAX_ARTIFACT_BYTES) {
        throw new ArtifactStoreError(
          "file_too_large",
          `Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte publishing limit`,
        )
      }

      const name = basename(canonicalSourcePath)
      const sha256 = await hashFile(canonicalSourcePath)
      const id = publicationID({
        sha256,
        sessionID: input.sessionID,
        messageID: input.messageID,
        name,
      })
      const mime = resolveMime(name)
      const artifact: PublishedArtifact = {
        version: ARTIFACT_STORE_VERSION,
        id,
        name,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        mime,
        size: sourceStats.size,
        sha256,
        kind: resolveArtifactKind(mime),
        sessionID: input.sessionID,
        messageID: input.messageID,
        createdAt: (input.createdAt ?? new Date()).toISOString(),
      }

      const artifactDirectory = getArtifactDirectory(id)
      await mkdir(artifactDirectory, { recursive: true })
      await copyOnce(canonicalSourcePath, getContentPath(id))
      await writeOnce(getManifestPath(id), JSON.stringify(artifact, null, 2))
      return artifact
    },
  }
}
