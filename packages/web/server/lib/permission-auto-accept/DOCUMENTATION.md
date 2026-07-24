# Permission Auto-Accept

## Purpose

This module owns the authoritative server-side permission auto-accept policy. Policy is persisted in OpenChamber settings so scheduled tasks can keep handling permissions while the UI is disconnected or the server restarts.

## Policy

`permissionAutoAccept.sessions` contains explicit per-session boolean policies.

Policy inheritance uses the nearest explicit session value. A child `false` overrides a parent `true`; descendants without an explicit value inherit from their nearest configured ancestor.

## Runtime

`createPermissionAutoAcceptRuntime` serializes policy writes, subscribes to the global OpenCode event hub, caches session lineage, retries transient replies, and reconciles pending permissions after startup, reconnect, and policy enablement.

Unknown lineage and failed policy loads fail closed. A failed pending-permission fetch is distinct from an empty successful response and never clears policy state.

## Routes

- `GET /api/permission-auto-accept`
- `PUT /api/permission-auto-accept/sessions/:sessionId`

These are normal authenticated OpenChamber runtime routes.

## Fork ownership

The existing client-side permission store remains active for interactive sessions. The server runtime is authoritative for server-enrolled sessions such as scheduled tasks, and notification suppression checks both policy sources.

## Tests

`runtime.test.js` covers restart persistence, revision ordering, nearest explicit subagent inheritance, missing-lineage lookup, retry/deduplication, reconnect reconciliation, and enablement reconciliation.
