# Dev Server Discovery

Discovers listening loopback/wildcard TCP sockets instead of guessing from package scripts.

- macOS/Linux prefer `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`.
- Windows uses `netstat -ano -p TCP`.
- Linux/container fallback reads `/proc/net/tcp` and `/proc/net/tcp6` when `lsof` is unavailable.
- LAN-only binds are excluded because `localhost:<port>` cannot reach them.
- OpenChamber/OpenCode own ports, the scanner PID, and a short infrastructure denylist are excluded.
- The own-port set is resolved at request time, including the actual random OpenChamber port after startup.
- Successful scans cache for 3 seconds; failures are not cached and return 503 rather than an empty-success lie.
- The dev tunnel uses the same scanner result as its connection allowlist; discovery is therefore a security boundary as well as UI data.

`GET /api/dev-servers` returns `{ servers: [{ port, pid, command, url }] }`.
