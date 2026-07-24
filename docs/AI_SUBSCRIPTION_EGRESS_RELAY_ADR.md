# ADR — AI Subscription Management & Egress Relay (P0 verified)

Status: P0 verification complete; P1 delivered and verified. Design accepted for P2.
Date: 2026-07-21
Audience: contributors implementing the Subscriptions feature set.

## Context

OpenChamber will gain an AI subscription management surface ("Subscriptions"
settings page) plus an optional per-provider egress mode (`direct` vs
`relayed`). Motivation and principles are in the design discussion; the three
relay-driving pains are vendor risk control on egress IP, BYOM on shared
machines (server holds zero credentials), and servers without outbound access
to overseas LLM endpoints. This ADR records the P0 verification results that
the design stands on, and the resulting decisions.

## Verified facts (target: custom opencode build `1.18.4-my`)

### V1 — Credential store & auth HTTP surface

- Storage is SQLite via drizzle (`CredentialTable`); **one credential per
  integration** — `create()` deletes existing rows for the integration before
  insert. Evidence: `packages/core/src/credential.ts:94-118`.
- HTTP API: `PUT /auth/:providerID`, `DELETE /auth/:providerID`,
  `GET /provider/auth`, `POST /provider/:providerID/oauth/authorize`,
  `POST /provider/:providerID/oauth/callback`.
  Evidence: `packages/opencode/src/server/routes/instance/httpapi/groups/control.ts:31-59`, `groups/provider.ts:38-71`.
- Consequence: OpenChamber's `lib/opencode/auth.js` (reads/writes
  `~/.local/share/opencode/auth.json`) is **incompatible with this build**.
  M2 auth adapter MUST go through the HTTP API. Confirmed, not hypothetical.

### V2 — Config update surface

- `GET /config`, `PATCH /config` (instance scope, payload `ConfigV1.Info`),
  `GET /config/providers`; global scope has `GET/PATCH config`.
  Evidence: `groups/config.ts:16-38`, `groups/global.ts:94-114`.
- Live-apply semantics of `PATCH /config` (memory vs file vs restart) remain
  an open question for P2 (see Open questions).

### V3 — Provider traffic redirect semantics

- `provider.<id>.options.baseURL` is a **typed schema field** (not just
  rest-bag) and overrides `model.api.url` at SDK resolution; the full
  `options` record flows into the bundled SDK factory
  (`createAnthropic({baseURL})`, `createOpenAICompatible({baseURL})`, ...).
  Evidence: `packages/core/src/v1/config/provider.ts:76-120`,
  `packages/opencode/src/provider/provider.ts:1668-1800`.
- `options.headers` merges with per-model headers; `apiKey` falls back to
  env/auth-sourced `provider.key`; `baseURL` supports `${ENV_VAR}` templating.
- Config providers merge with the models.dev catalog (metadata fidelity
  preserved); `disabled_providers` / `enabled_providers` exist.

### V4 — Live spike (hermetic `opencode serve` + stub relay)

Setup: `XDG_DATA_HOME`/`XDG_CONFIG_HOME` isolated, `OPENCODE_CONFIG` pointing
at an overlay declaring (a) custom provider `relaytest`
(`@ai-sdk/openai-compatible`, `baseURL=http://127.0.0.1:8399/v1`) and
(b) native override `anthropic.options.baseURL=http://127.0.0.1:8399`.

Observed:

- Both providers listed with `source: config`, `baseURL` visible, both in
  `connected`. Anthropic kept its full models.dev model catalog.
- `POST /v1/chat/completions` arrived at the stub with
  `Authorization: Bearer <config apiKey>`; assistant round trip completed.
- `POST /messages` arrived with `x-api-key`; cost computed from catalog
  metadata ($0.000039) — metadata fidelity confirmed end to end.
- Title generation also routes through the selected provider/relay.
- Path conventions differ per SDK: anthropic posts to `{baseURL}/messages`
  (no `/v1`); openai-compatible posts to `{baseURL}/chat/completions`
  (`baseURL` includes `/v1`). Relay must mirror per-SDK paths.
- Env detection works: ambient `KIMI_*` env produced
  `kimi-for-coding | source: env` — validates the data source for the M3
  conflict detector.
- Serve auth: `OPENCODE_SERVER_PASSWORD` + default username `opencode`
  (HTTP Basic). Already managed by OpenChamber's managed-server runtime.

Verification matrix:

| Item | Method | Result |
| --- | --- | --- |
| Credential store (SQLite, single-per-integration) | source read | green |
| Auth HTTP API (PUT/DELETE /auth/:id, OAuth flows) | source read | green |
| Config API (GET/PATCH /config) | source read | green |
| baseURL redirect (schema + resolveSDK) | source read | green |
| Custom provider projection | live spike | green |
| Native provider redirect (anthropic) | live spike | green |
| Catalog metadata fidelity under override | live spike | green |
| Env-source attribution (M3 input) | live spike | green |

## Decisions

- **D1 Projection**: overlay gains a `provider` section. Custom provider
  entries for relay-only IDs; native ID + `options.baseURL` override for
  catalog providers. Verified working. No opencode fork required.
- **D2 Channel**: execution-host → trust-anchor connectivity via SSH reverse
  forward, reusing `packages/ui/src/lib/desktopSsh.ts` plumbing. Channel
  semantics should borrow from `docs/PREVIEW_REMOTE_RELAY.md` (same
  remote→laptop pattern, SSRF-gate philosophy, user-run relay). Relay binds
  anchor loopback + per-instance shared secret + provider host allowlist.
- **D3 Relay path conventions**: relay implements per-SDK path mirroring
  (anthropic `/messages`, openai-compatible `/v1/*`); a conformance table is
  part of M5 and grows per provider SDK verified.
- **D4 SSE**: identity encoding, zero buffering through relay and tunnel
  (pattern already owned by `lib/opencode/proxy.js`).
- **D5 Small-model traffic**: title generation and other auxiliary calls
  follow the same provider routing — relay sees ALL provider traffic. Must be
  stated in docs and UI copy.
- **D6 Contract tests**: the spike becomes a scripted contract test
  (spawn embedded binary hermetically + stub relay + probes) guarding four
  surfaces: auth API, config API, provider listing, baseURL redirect. Runs on
  every embedded-binary upgrade.
- **D7 Persistent writes**: prefer `PATCH /config` over direct file writes in
  P2, pending live-apply probe. File writes keep diff preview + backup where
  used at all.

## Open questions

1. `PATCH /config`: live-applied? persisted to which layer? interaction with
   OpenChamber's config-file watcher. Probe in P1/P2.
   → RESOLVED (P2 probe): PATCH echoes the merged result but is NOT reflected
     in a subsequent GET /config and does NOT recompute the provider list live.
     Treat as ephemeral/unreliable for persistent writes. **D7 revised: P2 auth
     operations use the `/auth/:providerID` endpoints (already proxied by
     OpenChamber's proxy.js — `PUT /api/auth/:providerID` verified working).
     Config projection stays in OpenChamber's managed overlay (P4).**
2. OAuth subscription token local refresh (M9) — unverified by design
   (Anthropic-sensitive, P5).
3. Path conventions for remaining SDKs (google, copilot, azure) — verify per
   provider when enabled for relay.
4. Relay timeout tuning — `headerTimeout`/`chunkTimeout` provider options are
   schema-confirmed knobs; defaults TBD during M5.

## D9 — hermetic probing requires OPENCODE_CONFIG (P2 probe discovery)

Without `OPENCODE_CONFIG` set, `/provider` on a hermetic `opencode serve`
hangs (network-dependent remote-config fetch via the configured precedence
chain). Setting `OPENCODE_CONFIG` — even to an empty `{}` — makes `/provider`
respond in ~0.3s. Production OpenChamber always sets OPENCODE_CONFIG (its
managed overlay), so this only affects hermetic probes/tests. The contract
test already sets it. Any future probe must too.

## P2 probe evidence (OAuth method advertisement, GET /provider/auth)

- 10 providers advertise auth methods. Shapes confirmed:
  - `openai`: three methods — `ChatGPT Pro/Plus (browser)` oauth,
    `ChatGPT Pro/Plus (headless)` oauth, `Manually enter API Key` api.
  - `github-copilot`: oauth with interactive prompts (deploymentType select
    github.com/enterprise, ...); `authorize` with empty body → 400 (prompts
    required first).
  - `anthropic`, `google`: NOT advertised in core (confirms ADR — Anthropic
    auth is community-plugin territory).
- Write path confirmed working in P1 QA: `PUT /api/auth/:providerID` is
  proxied by OpenChamber's proxy.js to opencode's `PUT /auth/:providerID`.

## P1 delivery evidence (Docker-isolated QA + contract test)

- Contract test `scripts/test-opencode-contract.mjs`: 10/10 green against the
  embedded binary (provider projection, native override, catalog fidelity,
  auth API PUT/DELETE, config API GET/PATCH, baseURL redirect for both
  custom and native providers).
- Live endpoint matrix (Docker container, isolated volumes):
  - managed opencode: 167 providers, `degraded:false`;
  - env detection: `anthropic.auth.source='env'`, `envVars=['ANTHROPIC_API_KEY']`,
    no false-positive conflict when env is the sole credential;
  - stored credential: `PUT /auth/anthropic` + `/api/config/reload` →
    `source='api'`, `type='api'`;
  - env-override conflict fires with the correct message when both env var and
    stored credential are present;
  - DELETE rerouting: `DELETE /api/provider/anthropic/auth?scope=all` log line
    `[subscriptions] Removed provider auth via http: anthropic` — went through
    the upstream HTTP API (SQLite path), legacy auth.json fallback untouched,
    response shape unchanged;
  - degraded: `OPENCODE_SKIP_START=true OPENCODE_HOST=http://127.0.0.1:9` →
    `degraded:true, providers:0, fetchedAt present` — explicit partial-failure
    signal, not a fake empty success.

## D8 — observation: SKIP_START without OPENCODE_HOST restarts managed opencode

Discovered during P1 QA: with `OPENCODE_SKIP_START=true` alone (no
`OPENCODE_HOST`/`OPENCODE_PORT`), the bootstrap detected a persisted managed
port in the OpenChamber data volume, found it unhealthy, and **started a new
managed opencode anyway** ("Starting OpenCode on allocated port ...").
Treating SKIP_START as "connect to existing instance" requires an external
target; without one the bootstrap falls back to managed spawn. Flagged for
upstream confirmation — by design or a bug. Does not affect the Subscriptions
feature; recorded so future relay/egress work does not assume SKIP_START alone
keeps opencode down.

## References

- Design discussion: session 2026-07-21 (subscription center, trust model,
  egress-as-property).
- `docs/PREVIEW_REMOTE_RELAY.md` — analogous remote→laptop channel design.
- Spike artifacts: `/var/folders/k5/5y435lld3mjfmx69y_5l07_r0000gn/T/opencode/p0-spike/`
  (relay.mjs, overlay.json, relay.log).
