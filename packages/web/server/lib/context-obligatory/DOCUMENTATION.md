# Context Obligatory Messages

Messages explicitly pinned by the user are stored under
`session.metadata.openchamber.context_obligatory_messages` as `{ id, createdAt,
role }`. The UI uses a fresh-read metadata merge when pinning or unpinning, and
requires an authoritative session `directory` (no global current-directory
fallback). Pin controls are hidden in VS Code extension-only mode where this host
runtime is unavailable.

The server runtime listens for OpenCode's dedicated `session.compacted` event on
the local global hub and on remote-instance event fanout. Every reinject call is
scoped by `serverId + directory + sessionID`:

- Local (`serverId = default`): OpenCode HTTP via `buildOpenCodeUrl` + local auth.
- Remote: direct call to the instance OpenCode `/api/*` surface with that
  instance's auth/request headers. Goals-level remote OpenChamber parity is not
  required.

The runtime fetches every pinned message by ID, keeps non-empty text parts,
sorts them by the stored creation time, and immediately sends one synthetic user
part through `prompt_async`. OpenCode's session runner serializes this with its
own post-compaction continuation. Missing individual messages are skipped without
discarding the remaining context. Ordinary idle events perform no work and make
no requests. Child sessions (`parentID`) are skipped.

After a successful send, the runtime merge-writes
`context_obligatory_last_compaction_message_id`. This cursor prevents a replayed
compaction event from reinjecting the same summary. Inflight work is keyed by
`` `${serverId}::${sessionID}` `` so concurrent local/remote sessions do not
block each other.
