# ADR — Private Relay / Pairing / Desktop Transport Compatibility

Status: **Implemented**
Date: 2026-07-26 (design); 2026-07-27 (implementation)
Work Item: [#16](https://coding.s-s.city/songsong/openchamber/-/work_items/16)
Related: [#26](https://coding.s-s.city/songsong/openchamber/-/work_items/26) remote-only desktop + Windows SSH
Non-goals: do **not** replace the fork multi-instance registry with upstream single-active-runtime assumptions; Push (#49), self-hosted relay productization, and preview/AI egress relay remain out of scope.

## Context

Upstream v1.15–v1.16 introduced private relay E2EE, pairing v2, and desktop multi-transport fallback (representative SHAs: `ab12d2234`, `0a04f849f`, `4bb1c3740`, `f931f3e51`, `0a5d23613`, `7f671f4cb`, `af34f2226`, `79e4592ca`).

This fork already runs a different remote topology:

| Fork surface | Role |
|---|---|
| Desktop hosts (`defaultHostId` / `hosts[]`) | Whole-window / runtime switch to another OpenChamber URL (LAN + optional relay) |
| Remote instances (`/api/remote/:id`) | Same-window HTTP/SSE/WS proxy to a remote OpenCode/OpenChamber |
| SSH manager | ControlMaster tunnel + managed/external remote OpenChamber |
| Reserved ids `default` / `local` | Local OpenCode vs desktop-local host identity |

Session/project/settings authority is always `serverId + directory`, never “the one current runtime.”

## Decision drivers

1. Transport endpoint identity must not be confused with session authority.
2. Failover must rebind `serverId` explicitly; never invent directory from `getDirectory()` / global current.
3. Remote-only desktop boot (#26) may skip local OpenCode while keeping the in-process UI/proxy.
4. SSRF gates on preview/proxy stay closed; relay must not become a generic open egress.
5. Mobile pairing redeem is in scope for M11 (QR / `openchamber://`), without importing the full upstream Mobile shell.

## Decision

### Implemented

1. **Keep fork primitives as the primary remote path.** Remote instances + SSH + desktop hosts remain the supported product surfaces. Official relay/pairing attach as *candidate transports* keyed by `serverId`, not replacements for the registry.

2. **Identity adapter (`packages/ui/src/lib/relay/serverIdAuthority.ts`).** Pairing / relay enrollment maps to a non-reserved `serverId`; `default` / `local` cannot be overwritten.

3. **Host outbound relay (`packages/web/server/lib/relay/*`).** Opt-in enable/status/offer/disable; default `wss://relay.openchamber.dev/ws` (`OPENCHAMBER_RELAY_URL` override). Claim lock uses the host data-dir lock (same machine identity as upstream); tunnels terminate on loopback UI/API with WS allowlists.

4. **Client E2EE tunnel (`packages/ui/src/lib/relay/*`).** `runtime-fetch` / runtime auth / `openRuntimeWebSocket` (terminal + event pipeline) route through the tunnel when relay mode is active. TS↔JS cross-compat tests green.

5. **Desktop multi-transport + pairing UI.** Saved hosts persist LAN + relay; `DesktopHostSwitcher` / `restoreDesktopRelayRuntime` prefer LAN then relay; Settings → Remote Instances → `PairingDevicesPanel` for enable/QR/Import Link → **add** desktop host (not replace local).

6. **Mobile M11.** `MobileApp` QR scan + `openchamber://connect` redeem via `mobileConnections`; Instances sheet shows transport/reachability.

7. **Remote-only boot means “no local OpenCode,” not “no local OpenChamber UI.”** Unchanged from #26.

### Explicit non-goals

- Upstream `OPENCHAMBER_SKIP_LOCAL_SERVER=1` (skip entire UI server) as the fork product path.
- AI subscription egress relay (separate ADR).
- Preview remote-host relay (`docs/PREVIEW_REMOTE_RELAY.md`).
- Central push relay / APNs productization (#49).
- Self-hosted relay Worker packaging in this repo.

## Consequences

- #16 Done when desktop Anywhere pairing + official relay chat path + multi-transport failover preserve multi-`serverId`, and Mobile QR/deep-link redeem works (evidence in MERGE).
- Future PRs that touch desktop hosts / remote-instances / SSH must cite this ADR when adding transport candidates.
