# Permission Auto-Accept

## Purpose

This module owns the authoritative server-side permission policy. Policy is persisted in OpenChamber settings so scheduled tasks can keep handling permissions while the UI is disconnected or the server restarts.

## Policy and modes

`permissionAutoAccept.sessions` maps a session id to a permission mode (`packages/web/server/lib/permission-auto-accept/modes.js`):

- `ask`: every request waits for the user.
- `safety`: requests are accepted only on a verdict from the safety net (Jev); when Jev cannot answer, the request waits for the user.
- `auto`: every request is accepted.

Policy inheritance uses the nearest explicit session value. A child `ask` overrides a parent `auto`; descendants without an explicit value inherit from their nearest configured ancestor. Unknown lineage fails closed to `ask`.

Entries written before the modes existed are booleans (`true`/`false`). The runtime converts them on its first read: `false` becomes `ask`, and `true` becomes the answer of the injected `resolveLegacyEnabledMode` — `safety` when the old global safety-net switch was on, else `auto` (wired to `routingRuntime.legacySafetyNetEnabled()` in `index.js`). Until that wiring is in place the default answers `auto` in memory and the booleans stay on disk, so the one-time conversion still runs correctly later.

`permissionDefaultMode` (Settings → Sessions) is written onto each new top-level session at creation, once, so changing the default never rewrites older sessions; a policy the creating flow already set wins. Subagents inherit from their parent instead.

## Runtime

`createPermissionAutoAcceptRuntime` serializes policy writes, subscribes to the global OpenCode event hub (translated intake, spine OC2-S2), caches session lineage, retries transient replies, and reconciles pending permissions after startup, reconnect, and policy enablement. A failed pending-permission fetch is distinct from an empty successful response and never clears policy state.

`safety` sessions consult the injected `evaluatePermission` (the routing runtime, `../routing/DOCUMENTATION.md`) and reply only on `accept`; anything else (`hold`, absent evaluator) leaves the request on screen. `isPermissionAutoAnswered(sessionId, directory, permissionId)` tells notifications whether a request was, or is being, answered automatically — a held request is not, so it still notifies. The `index.js` notification getter is wired to this in the same change as `resolveLegacyEnabledMode`.

## Routes

- `GET /api/permission-auto-accept`
- `PUT /api/permission-auto-accept/sessions/:sessionId` — body `{ mode }` from mode-aware clients, or `{ enabled }` (on/off) from clients and scheduled tasks that predate the modes.

The broadcast snapshot keeps the on/off `sessions` view for older clients and adds `modes`.

## Fork ownership

The client-side permission store remains active for interactive sessions (the client answers `auto` sessions itself and mirrors the policy to `/api/notifications/auto-accept`). The server runtime is authoritative for server-enrolled sessions such as scheduled tasks, and notification suppression checks both policy sources. Request paths stay on the v1 OpenCode API (`/session/:id`, `?directory=`, `reply`); the v2-track forms (`/api/session/...`, `x-opencode-directory`, `decision`) land with the S8 activation.

## Tests

`runtime.test.js` covers restart persistence, revision ordering, mode/boolean policy writes, nearest explicit subagent inheritance, missing-lineage lookup, retry/deduplication, reconnect reconciliation (waited with `vi.waitFor`, upstream segb 53795a605), safety verdicts and held-request outcome reporting, the gated legacy conversion, and the default mode applied to new top-level sessions.
