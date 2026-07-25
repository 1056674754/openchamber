# ADR — Private Relay / Pairing / Desktop Transport Compatibility

Status: **Accepted (design only; implementation deferred)**
Date: 2026-07-26
Work Item: [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16)
Related: [#26](https://coding.s-s.city/songsong/openchamber/-/work_items/26) remote-only desktop + Windows SSH
Non-goals: do **not** replace the fork multi-instance registry with upstream single-active-runtime assumptions; do **not** ship native mobile pairing in this design phase.

## Context

Upstream v1.15–v1.16 introduced private relay E2EE, pairing v2, and desktop multi-transport fallback (representative SHAs: `ab12d2234`, `0a04f849f`, `4bb1c3740`, `f931f3e51`, `0a5d23613`, `7f671f4cb`, `af34f2226`, `79e4592ca`).

This fork already runs a different remote topology:

| Fork surface | Role |
|---|---|
| Desktop hosts (`defaultHostId` / `hosts[]`) | Whole-window navigation to another OpenChamber URL |
| Remote instances (`/api/remote/:id`) | Same-window HTTP/SSE/WS proxy to a remote OpenCode/OpenChamber |
| SSH manager | ControlMaster tunnel + managed/external remote OpenChamber |
| Reserved ids `default` / `local` | Local OpenCode vs desktop-local host identity |

Session/project/settings authority is always `serverId + directory`, never “the one current runtime.”

Official relay/pairing assumes a smaller number of host identities and often a single desktop transport candidate list. Importing it wholesale would collide with concurrent multi-server connections and reserved ids.

## Decision drivers

1. Transport endpoint identity must not be confused with session authority.
2. Failover must rebind `serverId` explicitly; never invent directory from `getDirectory()` / global current.
3. Remote-only desktop boot (#26) may skip local OpenCode while keeping the in-process UI/proxy.
4. SSRF gates on preview/proxy stay closed; relay must not become a generic open egress.
5. Native mobile pairing is out of scope until a mobile product track exists.

## Decision

### Design accepted now

1. **Keep fork primitives as the primary remote path.** Remote instances + SSH + desktop hosts remain the supported product surfaces. Official relay/pairing are *candidate transports* that may later attach to a `serverId`, not replacements for the registry.

2. **Remote-only boot means “no local OpenCode,” not “no local OpenChamber UI.”** Electron continues to spawn the in-process UI server for static UI and `/api/remote/*` proxy. Managed OpenCode start/attach is skipped via `OPENCHAMBER_SKIP_OPENCODE_START` / equivalent settings when remote-only policy is active.

3. **Boot contract carries `localOpenCodeAvailable`.** Chooser/recovery must hide “fix local OpenCode” actions when that flag is false. Failure to reach a remote must not prune or mutate unrelated `default` catalogs.

4. **Identity isolation rules for any future relay/pairing impl:**
   - A transport candidate resolves to at most one `serverId`.
   - Claim locks / host keys must not overwrite another instance’s registry entry.
   - SSE/WS fanout remains keyed by `serverId` (+ directory where applicable).
   - Pairing enrollment creates or selects a remote-instance id; it does not become the global current directory.

5. **Phased implementation backlog (later #16 code batch):**
   1. Map relay host identity → remote-instance `serverId` adapter (no UI rewrite).
   2. Optional desktop multi-transport candidate restore **without** collapsing concurrent connections.
   3. Pairing URL redeem as “add remote instance,” not “replace local runtime.”
   4. Host claim lock scoped per `serverId`.
   5. E2E: failover + identity isolation tests across two remotes + local `default`.

### Explicit non-goals (this design phase)

- Implementing `packages/*/relay/*`, pairing v2 LAN/QR, or mobile connect UI.
- Upstream `OPENCHAMBER_SKIP_LOCAL_SERVER=1` (skip entire UI server) as the fork product path.
- AI subscription egress relay (separate ADR).
- Preview remote-host relay design (`docs/PREVIEW_REMOTE_RELAY.md`) — different problem (dev-server tunnel).

## Consequences

- #26 can ship remote-only OpenCode skip + Windows SSH under these constraints.
- #16 remains open until the phased impl backlog passes end-to-end; this ADR satisfies the “written compatibility design” gate only.
- Future PRs that touch desktop hosts / remote-instances / SSH must cite this ADR when adding transport candidates.
