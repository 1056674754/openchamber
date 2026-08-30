# Dev Server Tunnel

Carries raw TCP bytes between a desktop client and a development server running on the selected OpenChamber host. The client binds a real loopback origin, preserving absolute URLs, cookies, HMR sockets, and DevTools without rewriting the page.

- `runtime.js` accepts `/api/dev-tunnel?port=<port>` WebSocket upgrades and pipes them to `127.0.0.1:<port>`.
- `client.js` binds a random local loopback port and carries each local TCP connection over one authenticated WebSocket.
- Reachability is restricted to the same authoritative listener list returned by `/api/dev-servers`; this is never a general loopback proxy.
- Browser-originated upgrades retain the normal Origin check. Origin-less callers must authenticate as a paired client, not merely as a UI session.
- Each side caps pending work and tears down its peer on close or error. The host caps concurrent sockets at 64.
- Invalid/non-HTTP base URLs fail before a listener is exposed, so custom runtime schemes cannot crash the process on first connection.

The desktop shell and Browser surface decide when to open a tunnel. This module does not infer the active instance or directory.
