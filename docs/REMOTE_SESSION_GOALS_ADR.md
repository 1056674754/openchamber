# ADR — Remote Session Goals

Status: **Accepted** (implemented — #35)
Date: 2026-07-24
Accepted: 2026-07-25
Work Item: [#35](https://coding.s-s.city/songsong/openchamber/-/work_items/35)
Related: [#29](https://coding.s-s.city/songsong/openchamber/-/work_items/29) v1 local-only (done), [#33](https://coding.s-s.city/songsong/openchamber/-/work_items/33), [#34](https://coding.s-s.city/songsong/openchamber/-/work_items/34)
Non-goals: do **not** merge with [#6](https://coding.s-s.city/songsong/openchamber/-/work_items/6) auto-review.

## Context

Session Goals v1 runs entirely against the **local** OpenCode instance (`serverId === default`):

- Host OpenChamber owns the goal loop (audit / continue / settle).
- Small Model audit uses **host** `auth.json` / preferred provider.
- SSE is subscribed on the local event hub with a concrete `directory`.
- UI and scheduled-task entry points hard-gate remote projects.

This fork routinely attaches **multiple OpenCode versions** as remotes. Shipping “UI unlocked + host audit + remote `prompt_async`” without a credential/compat model is unsafe: audit credentials and execution authority split across machines/versions, and failures can look like silent stalls.

## Decision drivers

1. Audit must not silently use the wrong credential plane.
2. Continue / settle must target the same OpenCode that owns the session.
3. Unsupported remotes must fail **explicitly** (toast / statusReason), never half-armed.
4. Event subscriptions must key by `serverId + directory`, not only the local hub.
5. Keep Goals separate from auto-review (#6).

## Options

### Option A — Remote credential plane (audit on remote OpenChamber / same auth)

Run Small Model audit (or an equivalent auditor) **on the remote OpenChamber host** that owns that OpenCode, using that host’s credentials. Local UI only arms/displays; continue stays on the remote runtime.

- Pros: credential/execution co-located; multi-version remotes possible if each remote OC has Goals runtime.
- Cons: requires remote OpenChamber feature parity + auth transport; larger product surface.

### Option B — Compatibility probe (disable + reason)

Before arming, probe whether the remote OpenCode accepts / preserves goal metadata and whether a Goals-capable runtime is reachable. If the probe fails (old kernel swallows metadata, no remote Goals route), **disable** entry points and surface a reason.

- Pros: safer than silent failure; works with mixed fleet.
- Cons: still needs a place to run audit/continue when probe passes (does not by itself solve credential split).

### Option C — Same-version remote OpenChamber only

Allow remote Goals only when the remote endpoint is an OpenChamber of a **compatible Goals version** (capability flag / version matrix), not a bare foreign OpenCode URL.

- Pros: clearest support boundary; reuses host runtime design on the remote OC process.
- Cons: excludes “raw OpenCode URL” remotes; needs version/capability advertising.

## Recommendation (pending acceptance)

**Adopt C as the enablement gate, with B as the probe mechanism, and A as the runtime placement.**

| Layer | Choice |
|---|---|
| Who may enable Goals UI | Option C: remote must advertise OpenChamber Goals capability / compatible version |
| How we detect support | Option B: capability probe + explicit unsupported reason |
| Where audit/continue run | Option A: on the remote OpenChamber that owns that OpenCode |

Local (`default`) keeps today’s host runtime unchanged.

## Unsupported matrix (must stay explicit)

| Setup | Goals |
|---|---|
| Local OpenCode via OpenChamber host | ✅ |
| Remote OpenChamber, compatible Goals capability (`GET /api/goals/capability`) | ✅ (#35) |
| Remote OpenChamber, incompatible / older | ❌ disabled + reason |
| Bare remote OpenCode URL (no OpenChamber Goals runtime) | ❌ disabled + reason |
| VS Code webview-only (no host loop) | ❌ entry points hidden (already) |
| Host Small Model + remote-only `prompt_async` without remote runtime | ❌ forbidden (no steal-ship) |

## Implementation constraints (when unblocked)

1. Arm / stamp / continue / settle must all resolve `serverId` and refuse non-capable remotes.
2. SSE / status hub subscription: `serverId + directory` (no local-hub-only shortcut).
3. Failure paths: toast + `statusReason` / structured error; never leave `armed` without a stamped goal.
4. Scheduled `goalEnabled` on remote projects stays off until the remote runtime exists.
5. No UI-first unlock: entry points remain gated until the remote loop is live.

## Acceptance criteria for #35 implementation

- [x] This ADR accepted (status → Accepted) with chosen options recorded.
- [x] Capability probe + unsupported matrix reflected in UI and server gates.
- [x] Objective HTTP routed via remote baseUrl; host runtime still ignores non-default events.
- [x] Remote settle toast on local UI from metadata transitions (desktop notify stays on owning host).
- [x] Incapable remote: entry points disabled or hard-fail with visible reason.
- [x] No coupling to #6 auto-review.

## Consequences

- Capable remote OpenChamber Goals UX matches local entry points; loop stays co-located with that OpenCode.
- MERGE / #35 track implementation evidence; v1 local-only (#29) remains the local baseline.
