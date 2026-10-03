# OpenChamber Sessions Module

## Purpose

This module creates, sends to, and forks managed-local OpenCode Sessions for
the OpenChamber control plane.

## Selection Rules

- A caller-supplied model, Agent, or variant wins.
- Existing Session sends and forks restore missing selection fields from the
  latest user message in that Session.
- New Sessions fall back to OpenChamber/OpenCode defaults and available
  providers only when the caller omitted a selection.
- The resolved selection is captured before dispatch; it is not read from
  mutable composer state.

## Directory and Worktree Rules

- Every operation validates an explicit directory or configured project.
- `serverId` must identify the managed-local server.
- A requested worktree is created before the Session. The resulting worktree
  directory becomes the Session directory.
- Session-created events include the authoritative server and directory so the
  sidebar can merge the new Session without relying on the active project.

## Partial Failure

If a fork or Goal has already been created and prompt dispatch then fails, the
service throws a structured partial-result error containing the surviving
Session ID and directory.

## Prompt dispatch

`runPromptAsync` keeps building the v1 `prompt_async` payload (the
`resolvePromptBody` hook contract) and branches on the recorded protocol mode:
v1 posts it unchanged to `POST /session/:id/prompt_async`; v2 maps the
rewritten payload through `postV2PromptDispatch`
(`../opencode/v2-prompt-dispatch.js`) — selection switches
(`/api/session/:id/model|agent`, variant on the model ref), then the flat
`POST /api/session/:id/prompt`, all scoped by the `x-opencode-directory`
header.

## OpenChamber-owned Session State (OC2 spine S4, upstream 654705f7d)

OpenCode 2.x accepts `metadata` only at session create time and has no route
that sets `time.archived`, so the per-session state four features kept on the
v1 record — goal mode, session assist, obligatory context, pinned notes/plans —
and the archive flag move into OpenChamber-owned stores under the data dir:

- `session-metadata-store.js` — `{ [sessionID]: metadata }` in
  `sessions-metadata.json`. Writes are RFC 7386 merge patches (nested objects
  merge key by key, `null` deletes), so two features writing the same
  `openchamber` namespace never erase each other. On first access a session is
  seeded from the OpenCode record inside the same transaction as the read or
  write that needed it ("single owner + same-transaction seed"); an explicit
  empty object survives restarts and is not re-seeded. A file that cannot be
  read disables writes rather than risking overwrites; a malformed file is
  backed up, not silently reset.
- `archive-store.js` — `{ [sessionID]: archivedAt | null }` in
  `sessions-archive.json`. A number archives, `null` is an explicit unarchive,
  an absent session keeps whatever OpenCode says. Not wired into the v1
  archive route (below).
- `opencode-client.js` — directory-scoped `@opencode/client` for the v2-track
  seeding reader.

Dual track: the v1 archive route still archives through OpenCode's
`session.update` batch, unchanged. The seeding reader follows the recorded
protocol mode — the v1 SDK record (`createV1UpstreamSessionMetadataReader`)
by default, `@opencode/client` (`createUpstreamSessionMetadataReader`) once
the managed instance speaks v2. The stores expose `getMetadata`/`setMetadata`
through the service (GET/POST
`/api/openchamber/sessions/:sessionId/metadata`) so there is one owner of
every metadata write; the server can inject `persistSessionMetadata` to add
broadcast + goal-loop notification on the same path (index.js wiring, S8).
