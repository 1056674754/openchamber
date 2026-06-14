/**
 * Content-addressed image storage.
 *
 * Saves image data URLs to disk under a platform-appropriate directory,
 * named by SHA-256 of the decoded content. This gives us:
 *   - Natural deduplication (same image = same file)
 *   - Stable paths the model can reference in `describe_image` tool calls
 *   - A foundation for Stage 2's cross-session cache (files persist)
 *
 * Directory layout:
 *   macOS:   ~/Library/Application Support/openchamber/images/
 *   Linux:   ~/.local/share/openchamber/images/
 *   Windows: %LOCALAPPDATA%\openchamber\images\
 *
 * Override with OPENCHAMBER_IMAGE_DIR env var.
 */

import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"

import { log } from "./logger.js"
import { computePHash } from "./cache/phash.js"
import type { CacheDb } from "./cache/database.js"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/x-icon": "ico",
}

export type SavedImage = {
  /** Absolute file:// path to the saved image */
  filePath: string
  /** SHA-256 hash of the decoded image content */
  hash: string
  /** Original filename from the attachment, if provided */
  originalFilename?: string
  /** MIME type */
  mime: string
}

export type ImageStore = {
  saveFromDataUrl(dataUrl: string, filename?: string): Promise<SavedImage>
  getDirectory(): string
}

export type ImageStoreDeps = {
  cacheDb?: CacheDb
  sessionId?: string
}

function resolveImageDirectory(): string {
  const envOverride = process.env.OPENCHAMBER_IMAGE_DIR
  if (envOverride && envOverride.length > 0) return envOverride

  const home = homedir()
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "openchamber", "images")
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "openchamber", "images")
    default:
      return join(home, ".local", "share", "openchamber", "images")
  }
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  // Format: data:<mime>;base64,<content>
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!match || !match[1] || !match[2]) return null
  const mime = match[1]
  const buffer = Buffer.from(match[2], "base64")
  return { mime, buffer }
}

function hashContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

function mimeToExtension(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin"
}

/**
 * Create an image store rooted at the platform-appropriate data directory.
 * The directory is created on first save, not at construction.
 */
export function createImageStore(deps?: ImageStoreDeps): ImageStore {
  const directory = resolveImageDirectory()
  let dirEnsured = false

  async function ensureDirectory(): Promise<void> {
    if (dirEnsured) return
    await mkdir(directory, { recursive: true })
    dirEnsured = true
  }

  return {
    getDirectory: () => directory,

    saveFromDataUrl: async (dataUrl: string, filename?: string): Promise<SavedImage> => {
      const parsed = parseDataUrl(dataUrl)
      if (!parsed) {
        throw new Error(`Could not parse data URL (expected data:<mime>;base64,<content>)`)
      }

      const { mime, buffer } = parsed
      const hash = hashContent(buffer)
      const ext = mimeToExtension(mime)
      const fileName = `${hash}.${ext}`
      const fullPath = join(directory, fileName)

      await ensureDirectory()

      try {
        await writeFile(fullPath, buffer, { flag: "wx" })
        log("[image-store] saved", { hash, mime, bytes: buffer.length, path: fullPath })
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }

      const saved: SavedImage = {
        filePath: fullPath,
        hash,
        originalFilename: filename,
        mime,
      }

      if (deps?.cacheDb) {
        const phash = computePHash()
        deps.cacheDb.upsertImage({
          sha256: hash,
          phash,
          file_path: fullPath,
          original_filename: filename ?? null,
          mime,
          width: null,
          height: null,
          size_bytes: buffer.length,
        })
        if (deps.sessionId) {
          deps.cacheDb.linkSession(hash, deps.sessionId)
        }
      }

      return saved
    },
  }
}
