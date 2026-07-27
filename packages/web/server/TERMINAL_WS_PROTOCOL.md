# Terminal WebSocket Protocol (v3)

Authoritative ownership lives in [`lib/terminal/DOCUMENTATION.md`](lib/terminal/DOCUMENTATION.md).

## Transport

- Single data plane: WebSocket `GET /api/terminal/ws`
- Binary JSON control frames (`0x01` + UTF-8 JSON)
- Protocol version: **v3** (`capabilities.ws.v === 3` on create/restart)
- No SSE output (`/api/terminal/:sessionId/stream`) and no HTTP input (`POST .../input`)

## Control messages

Client → server:

| `t` | Purpose |
|---|---|
| `hello` | Optional handshake ack |
| `ping` | Keepalive |
| `attach` `{s}` | Attach socket to a terminal session |
| `detach` `{s}` | Detach one session |
| `write` `{s,d}` | Write input to a specific session |

Server → client:

| `t` | Purpose |
|---|---|
| `hello` | Socket ready |
| `pong` | Keepalive reply |
| `snapshot` `{s,q,history,status,...}` | Authoritative late-attach state |
| `output` `{s,q,d,r?}` | Live output (`r` = replay-safe sanitized bytes) |
| `exit` `{s,q,exitCode,signal}` | Process exited |
| `restarted` `{s,q,history}` | Same id, new process |
| `error` `{s?,code,message,fatal}` | Scoped or global error |

## HTTP command plane (still used)

- `POST /api/terminal/create`
- `GET /api/terminal/shells`
- `POST /api/terminal/:sessionId/resize`
- `POST /api/terminal/:sessionId/appearance`
- `POST /api/terminal/:sessionId/restart`
- `DELETE /api/terminal/:sessionId`
- `POST /api/terminal/force-kill`

## Fork notes

OpenChamber keeps multi-instance UI keys (`serverId:directory`) and per-`baseUrl` client transports. Protocol framing matches upstream v3; do not reintroduce v2 `b`/`bok` bind or chunk-cursor replay.
