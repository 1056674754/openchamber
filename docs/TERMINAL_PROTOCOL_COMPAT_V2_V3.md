# Terminal Protocol Compatibility Matrix (v2 ↔ v3)

**Issue:** [#19](https://coding.s-s.city/songsong/openchamber/-/work_items/19)  
**Upstream source:** `305c2e551` (`feat(terminal): refactor runtime and add mobile workspace`)  
**Status:** Matrix complete. Implementation is phased (see below). Do not overwrite fork terminal runtime wholesale.

## Summary

| Dimension | Fork today (v2) | Upstream `305c2e551` (v3) | Migration stance |
|---|---|---|---|
| Protocol version | `v: 2` | `v: 3` (breaking) | Dual-stack via `capabilities.ws.v`, then cut over |
| Data plane | WS `/api/terminal/ws` + SSE + HTTP input | WS only | Keep fallbacks until Phase 3 gate |
| Multiplex | One socket, one mutable bind (`b`/`bok`) | One socket, many attaches | Adapt client + server |
| Input | Text frame to bound session; HTTP `/input` | Binary `write{s,d}` | Adapt |
| Output / replay | Chunk cursor `r` + 64KB `output-replay-buffer`; live `t:d` | `snapshot{history,q}` + `output{q,d,r?}`; 512KB history | Replace semantics carefully |
| Authority keys | `serverId + directory` store; per-`baseUrl` transport | Mostly directory-only + singleton WS | **Keep fork keys** |
| UI host | Context Panel + ghostty-web | + mobile fullscreen workspace | Desktop-first; mobile deferred |
| SSH | Electron open-native + `/api/remote/:id` proxy | Relay Origin / `openRuntimeWebSocket` | Keep both paths; align auth whitelist |

Fork doc [`packages/web/server/TERMINAL_WS_PROTOCOL.md`](../packages/web/server/TERMINAL_WS_PROTOCOL.md) says live output uses text frames; **implementation sends binary `t:d`**. Treat code as source of truth until Phase 1 rewrites docs.

## Sacred cows (must not lose)

1. [`useTerminalStore`](../packages/ui/src/stores/useTerminalStore.ts) keys: `directory` or `` `${serverId}:${directory}` ``
2. [`terminalApi.ts`](../packages/ui/src/lib/terminalApi.ts) **per-baseUrl** transport managers (including `/api/remote/:id`)
3. Context Panel terminal (`openContextTerminal` / `mode: 'terminal'`)
4. Electron SSH open-in-app (`desktop_ssh_open_terminal`) — independent of in-app PTY protocol
5. ghostty-web touch/IME/viewport customizations — **no whole-file overwrite** of `TerminalViewport.tsx`
6. Project actions ↔ terminal (preview URL scan, force-kill) — fix remote `baseUrl` before remote QA

## Message inventory

### Fork v2 (client ↔ server over WS)

| `t` | Direction | Fields | Notes |
|---|---|---|---|
| `ok` | S→C | `v:2` | Socket ready; client then binds |
| `b` | C→S | `s`, `r?`, `v:2` | Bind / rebind; `r` = replay cursor |
| `bok` | S→C | `s`, `runtime`, `ptyBackend`, `v:2` | Bind ok; then replay since `r` |
| `p` / `po` | C↔S | `v:2` | App-level keepalive |
| `d` | S→C | `s`, `i`, `d` | Output with chunk id (live + replay) |
| `x` | S→C | `s`, `exitCode`, `signal` | PTY exit |
| `e` | S→C | `c`, `f?` | Error |

Text frames: client keystrokes → currently bound session.

### Upstream v3

| `t` | Direction | Fields | Notes |
|---|---|---|---|
| `hello` | both | `v:3` | Handshake |
| `ping` / `pong` | C↔S | `v:3` | Keepalive |
| `attach` | C→S | `v:3`, `s` | Subscribe one terminal; many per socket |
| `detach` | C→S | `v:3`, `s` | Drop one attachment |
| `write` | C→S | `v:3`, `s`, `d` | Input always carries session id |
| `snapshot` | S→C | `s`, `q`, `history`, `status`, … | Authoritative start after attach/reconnect |
| `output` | S→C | `s`, `q`, `d`, `r?` | Live `d`; optional sanitized `r` |
| `exit` | S→C | `s`, `q`, `exitCode`, `signal` | Ordered exit |
| `restarted` | S→C | `s`, `q`, `history` | Same id, new projection |
| `error` | S→C | `code`, `message`, `fatal?`, `s?` | May be session-scoped |

### HTTP command plane

| Endpoint | Fork v2 | Upstream v3 |
|---|---|---|
| `POST /api/terminal/create` | yes | yes (+ shell/login/appearance) |
| `POST .../resize` | yes | yes |
| `POST .../restart` | yes | yes |
| `DELETE .../:id` | yes | yes |
| `POST /api/terminal/force-kill` | yes | yes |
| `GET /api/terminal/shells` | no | yes |
| `POST .../appearance` | no | yes |
| `GET .../:id/stream` (SSE) | yes | **removed** |
| `POST .../:id/input` | yes | **removed** |

## Lifecycle differences

### v2 bind + cursor replay

1. HTTP create → capabilities advertise `ws.v: 2`
2. WS open → `ok` → client `b` with optional `r`
3. Server `bok` then replays buffered chunks with id > `r`
4. Live output continues as `d{s,i,d}`; text input hits bound session
5. Tab switch = rebind (`b`); one active bind per socket
6. Reconnect: new socket, rebind with remembered cursor; may fall back to SSE

### v3 attach + snapshot

1. HTTP create (optional client session id, shell preference)
2. WS open → `hello` → `attach` per subscribed terminal
3. Server emits `snapshot{q, history, status}` immediately
4. Concurrent events during snapshot are buffered; only `q > snapshot.q` go live
5. Live `output` / `exit` / `restarted` carry monotonic `q`
6. Reconnect: re-`attach` all subscribers; **snapshot is authority** (not old cursor)
7. No SSE/HTTP input fallback

## Replay semantics

| | Fork v2 | Upstream v3 |
|---|---|---|
| Buffer | 64KB chunk ring (`output-replay-buffer.js`) | 512KB session history |
| Purpose | Cover late-bind / startup race | Bounded scrollback + reconnect |
| Sanitization | None (raw chunks) | Strip DSR/DA/CPR/OSC10/11/Mode2031 from history; live `d` raw |
| Client buffer | 1MB tab buffer in store | `replaceBuffer(snapshot)` + sequence |

## Multi-instance / auth

Fork must keep:

- Transport entries keyed by resolved `baseUrl` (local `/api` vs `/api/remote/:id`)
- Store scopes keyed by `serverId + directory`
- Remote WS upgrade via [`proxy.js`](../packages/web/server/lib/remote-instances/proxy.js)
- `/api/terminal/ws` on URL-auth and relay allowlists when those paths exist

Upstream expects `openRuntimeWebSocket` + token refresh. Port the **auth behavior**, not the singleton manager that drops per-baseUrl isolation.

## Known debts (pre-implementation)

1. **Doc drift:** `TERMINAL_WS_PROTOCOL.md` text-output claim vs binary `t:d` in `runtime.js`
2. **ProjectActions remote gap:** fixed — `createSession` / `sendInput` / store keys pass `baseUrl` + `serverId`
3. **`SerializeAddon`:** present but unwired; not required for protocol cutover
4. **VS Code:** stub TerminalAPI — keep explicit unsupported after v3

## Implementation status (2026-07)

Hard-cut to v3 completed in-tree (capabilities always `ws.v: 3`; no dual-stack):

| Phase | Status |
|---|---|
| 0 Matrix docs | ✅ |
| 1 Server v3 (`history`/`shells`/`theme-response`/attach/snapshot) | ✅ |
| 2 Client `terminalApi` + store `replaceBuffer` + ProjectActions | ✅ |
| 3 Remove SSE/HTTP input/v2/`output-replay-buffer` | ✅ |
| 4 Deferred UX | ⏸️ documented below — not in this cut |

## QA matrix (six dimensions)

| Dimension | Pass criteria | Phase |
|---|---|---|
| Local | create / type / resize / restart / late-attach sees prompt | 1–3 |
| Context | Context Panel tabs switch without cross-wiring sessions | 2–3 |
| SSH / remote | `/api/remote/:id` in-app PTY works; Electron native SSH open unchanged | 2–3 |
| Reconnect | Drop WS, re-attach; sequence monotonic; no duplicate storm | 2–3 |
| Replay | Late attach / reconnect shows history without CSI query garbage | 1–3 |
| Mobile | Deferred — no `packages/mobile`; Web touch stays as-is until Phase 4 | 4 |

## Phased implementation

0. **This document + MERGE/#19** — no runtime change  
1. **Server v3 core** — `history` / `shells` / `theme-response` + attach/snapshot  
2. **Client + store adapt** — v3 frames, keep `serverId`/`baseUrl`; fix ProjectActions; minimal TerminalView wiring  
3. **Cut over** — delete SSE/HTTP input/v2/`output-replay-buffer`  
4. **Deferred (do not implement in #19 cut)** — `terminalContext` selection→chat attachments; shell settings UI + appearance HTTP UX; mobile fullscreen workspace / quick keys / long-press (reuse existing Web touch only; no `packages/mobile`); ghostty viewport polish via targeted diffs only

## Explicit out

- Whole-file overwrite of `TerminalViewport.tsx` / `useTerminalStore.ts` / `runtime.js`
- Cross-`serverId` terminal session moves
- Bundling #16 relay redeem UI, #24 session worktree, #32 AppImage
- Native `packages/mobile` package

## Verification commands (post-implementation)

```sh
bun test packages/web/server/lib/terminal/
bun test packages/ui/src/lib/terminalApi.test.ts packages/ui/src/stores/useTerminalStore.test.ts
bun run type-check
bun run lint
```
