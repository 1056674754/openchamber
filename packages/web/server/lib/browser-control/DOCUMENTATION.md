# Browser Control Broker

Carries agent browser actions from the server to the connected desktop renderer that owns the in-app browser, then correlates its result.

## Invariants

- Capability belongs to one live global event-stream connection (`browser=1`), not a persisted setting. The legacy OpenChamber SSE remains compatible but is not the fork's primary event path.
- `browser.open` may reach any client; all other actions require a browser-capable client.
- Requests are broadcast but exactly one client acts: first `/claim` wins.
- No capable client fails immediately with 503; claimed requests time out rather than assuming success.
- Late/unknown results return `matched: false`.
- Inputs are validated in `openchamber-control/service.js` before a renderer is woken.
- Captured bytes are written server-side under the authoritative project directory.
- Renderer controllers are scoped to the event envelope's `serverId`; a page open for one instance cannot claim another instance's action.
- The selected primary Browser tab owns control. A visible split Browser does not silently replace it.

Routes: `POST /api/browser-control/claim` and `POST /api/browser-control/result`.

The fork's global WebSocket event pipeline carries requests to the renderer. Electron advertises `browser=1` in the connection URL; the broker sends only to capable global sockets. The current fork Browser pane implements open/snapshot/click/type/scroll/back/forward/inspect/capture/resize. Named viewport modes lay the page out at real CSS dimensions and only scale presentation down to fit the panel.

Remote-instance fan-in currently carries OpenCode events only; an aggregated remote does not claim Browser capability until its OpenChamber event channel is bridged explicitly.
