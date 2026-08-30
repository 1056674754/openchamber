# FS Module Documentation

## Purpose
Own filesystem API behavior for the web server runtime, including workspace-bound file operations, directory listing, reveal, and background command execution jobs.

## Entrypoints and structure
- `packages/web/server/lib/fs/routes.js`: route registration and runtime-owned state for `/api/fs/*` endpoints.
- `packages/web/server/lib/fs/search.js`: fuzzy filesystem search runtime used by non-FS routes (for example project icon discovery).

## Public exports
- `registerFsRoutes(app, dependencies)` from `routes.js`
  - Registers all filesystem routes:
    - `GET /api/fs/home`
    - `POST /api/fs/mkdir`
    - `GET /api/fs/read`
    - `GET /api/fs/raw`
    - `POST /api/fs/write`
    - `POST /api/fs/upload?path&overwrite` (raw `application/octet-stream`, bounded and atomically committed)
    - `POST /api/fs/delete`
    - `POST /api/fs/rename`
    - `POST /api/fs/reveal`
    - `POST /api/fs/exec`
    - `GET /api/fs/exec/:jobId`
    - `GET /api/fs/list`
  - Owns exec job queue state (`execJobs`) and lifecycle/TTL pruning.
  - Enforces workspace boundary checks with an explicit request directory + worktree fallback support.
  - Supports path-bound `outsideFileGrant` tokens. Markdown galleries mint `raw`-only grants with a 10-minute lifetime; existing explicit `allowOutsideWorkspace` behavior remains for fork file-reference compatibility.
- `createFsSearchRuntime({ fsPromises, path, spawn, resolveGitBinaryForSpawn })` from `search.js`
  - Returns `{ searchFilesystemFiles(rootPath, options) }`.
  - Supports fuzzy matching, hidden-file handling, and optional `git check-ignore` filtering.

## Composition contract with `index.js`
- `index.js` provides composition-time dependencies only (platform primitives + callbacks such as `resolveRequiredExplicitProjectDirectory`, `normalizeDirectoryPath`, and `buildAugmentedPath`).
- `index.js` no longer owns FS route handlers or FS exec job state.

## Upload contract

- `POST /api/fs/upload?path=<absolute>&directory=<owner>&overwrite=true|false` accepts a raw `application/octet-stream` body.
- The request must carry its explicit owning project directory; persisted active/last-directory state is never used as authority.
- Uploads default to a 100 MiB maximum. `OPENCHAMBER_FS_UPLOAD_MAX_BYTES` may set a positive byte limit.
- Data is streamed to a same-directory temporary file. Non-overwrite commits with a hard link so a target created during the upload returns `409 already-exists`; overwrite commits with rename. Failures remove the temporary file.
- Existing symlinks and symlinked parents are canonicalized before writing and cannot escape the owning workspace.

## Notes for contributors
- Keep filesystem policy (workspace root checks, error mapping, exec timeout behavior) inside this module, not in the composition root.
- If adding new `/api/fs/*` endpoints, add them in `routes.js` and extend this document.
