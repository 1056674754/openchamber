import { Database } from "bun:sqlite"
import { dirname, join } from "node:path"
import { mkdirSync } from "node:fs"
import { homedir, platform } from "node:os"

export type ImageRow = {
  sha256: string
  phash: string | null
  file_path: string
  original_filename: string | null
  mime: string
  width: number | null
  height: number | null
  size_bytes: number
  time_saved: number
}

export type ImageSessionRow = {
  image_sha256: string
  session_id: string
  time_first_seen: number
}

export type ImageAnalysisRow = {
  image_sha256: string
  backend: string
  goal: string | null
  result: string
  summary: string | null
  time_analyzed: number
}

export type CacheDb = {
  getImage(sha256: string): ImageRow | null
  upsertImage(row: Omit<ImageRow, "time_saved"> & { time_saved?: number }): void
  linkSession(sha256: string, sessionId: string): void
  getAnalysis(sha256: string, backend?: string): ImageAnalysisRow | null
  getAnalyses(sha256: string): ImageAnalysisRow[]
  saveAnalysis(row: Omit<ImageAnalysisRow, "time_analyzed" | "id" | "summary"> & { time_analyzed?: number }): number
  updateSummary(id: number, summary: string): void
  searchImages(query: {
    filename?: string
    sessionId?: string
    limit?: number
  }): Array<ImageRow & { session_ids?: string }>
  close(): void
}

function resolveDataDir(): string {
  const home = homedir()
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "openchamber")
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "openchamber")
    default:
      return join(home, ".local", "share", "openchamber")
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  sha256 TEXT PRIMARY KEY,
  phash TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER NOT NULL,
  time_saved INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS image_sessions (
  image_sha256 TEXT NOT NULL,
  session_id TEXT NOT NULL,
  time_first_seen INTEGER NOT NULL,
  PRIMARY KEY (image_sha256, session_id)
);

CREATE TABLE IF NOT EXISTS image_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_sha256 TEXT NOT NULL,
  backend TEXT NOT NULL,
  goal TEXT,
  result TEXT NOT NULL,
  summary TEXT,
  time_analyzed INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_sessions_session
  ON image_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_image_analyses_sha
  ON image_analyses(image_sha256);
CREATE INDEX IF NOT EXISTS idx_images_filename
  ON images(original_filename);
`

export function openCacheDb(dbPath?: string): CacheDb {
  const filePath = dbPath ?? join(resolveDataDir(), "openchamber.db")
  mkdirSync(dirname(filePath), { recursive: true })

  const db = new Database(filePath, { create: true })
  db.exec(SCHEMA)

  return {
    getImage(sha256: string): ImageRow | null {
      return db.prepare<ImageRow>("SELECT * FROM images WHERE sha256 = ?").get(sha256) ?? null
    },

    upsertImage(row): void {
      db.prepare(
        `INSERT INTO images (sha256, phash, file_path, original_filename, mime, width, height, size_bytes, time_saved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha256) DO UPDATE SET
           phash = COALESCE(excluded.phash, images.phash),
           file_path = excluded.file_path,
           original_filename = COALESCE(excluded.original_filename, images.original_filename),
           width = COALESCE(excluded.width, images.width),
           height = COALESCE(excluded.height, images.height)`,
      ).run(
        row.sha256,
        row.phash ?? null,
        row.file_path,
        row.original_filename ?? null,
        row.mime,
        row.width ?? null,
        row.height ?? null,
        row.size_bytes,
        row.time_saved ?? Date.now(),
      )
    },

    linkSession(sha256, sessionId): void {
      db.prepare(
        `INSERT OR IGNORE INTO image_sessions (image_sha256, session_id, time_first_seen)
         VALUES (?, ?, ?)`,
      ).run(sha256, sessionId, Date.now())
    },

    getAnalysis(sha256, backend): ImageAnalysisRow | null {
      const stmt = backend
        ? db.prepare<ImageAnalysisRow>(
            "SELECT * FROM image_analyses WHERE image_sha256 = ? AND backend = ? ORDER BY time_analyzed DESC LIMIT 1",
          )
        : db.prepare<ImageAnalysisRow>(
            "SELECT * FROM image_analyses WHERE image_sha256 = ? ORDER BY time_analyzed DESC LIMIT 1",
          )
      return backend ? stmt.get(sha256, backend) : stmt.get(sha256)
    },

    getAnalyses(sha256): ImageAnalysisRow[] {
      return db.prepare<ImageAnalysisRow>(
        "SELECT * FROM image_analyses WHERE image_sha256 = ? ORDER BY time_analyzed DESC",
      ).all(sha256)
    },

    saveAnalysis(row): number {
      const info = db.prepare(
        `INSERT INTO image_analyses (image_sha256, backend, goal, result, summary, time_analyzed)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        row.image_sha256,
        row.backend,
        row.goal ?? null,
        row.result,
        null,
        row.time_analyzed ?? Date.now(),
      )
      return Number(info.lastInsertRowid)
    },

    updateSummary(id, summary): void {
      db.prepare("UPDATE image_analyses SET summary = ? WHERE id = ?").run(summary, id)
    },

    searchImages(query): Array<ImageRow & { session_ids?: string }> {
      const conditions: string[] = []
      const params: unknown[] = []

      if (query.filename) {
        conditions.push("i.original_filename LIKE ?")
        params.push(`%${query.filename}%`)
      }
      if (query.sessionId) {
        conditions.push("EXISTS (SELECT 1 FROM image_sessions s WHERE s.image_sha256 = i.sha256 AND s.session_id = ?)")
        params.push(query.sessionId)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
      const limit = query.limit ?? 20
      const sql = `SELECT i.* FROM images i ${where} ORDER BY i.time_saved DESC LIMIT ?`
      return db.prepare<ImageRow>(sql).all(...params, limit)
    },

    close(): void {
      db.close()
    },
  }
}
