# CLI modules

Focused command modules used by the OpenChamber terminal CLI live here while the
legacy command dispatcher remains in `../cli.js`.

## Settings access

`cli-settings-accessors.js` is the only settings accessor for standalone CLI
commands that may read or create relay identity state.

- Strict reads distinguish a missing file from corrupt, unreadable, or non-object
  settings. Relay keys must never be regenerated after a swallowed read failure.
- Writes use a same-directory temporary file and atomic replacement, with private
  permissions and cleanup on every failure path.
- Public writes and whole read-modify-write transactions use the shared
  cross-process settings lock from `@openchamber/shared/settings-lock`.
- Relay identity creation must run inside `withSettingsTransaction`; locking only
  the final write still allows concurrent commands to mint different server IDs.
