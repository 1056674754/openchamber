# Browser Control Broker

Carries agent browser actions from the server to the connected desktop renderer that owns the in-app browser, then correlates its result.

## Invariants

- Capability belongs to one live SSE connection (`browser=1`), not a persisted setting.
- `browser.open` may reach any client; all other actions require a browser-capable client.
- Requests are broadcast but exactly one client acts: first `/claim` wins.
- No capable client fails immediately with 503; claimed requests time out rather than assuming success.
- Late/unknown results return `matched: false`.
- Inputs are validated in `openchamber-control/service.js` before a renderer is woken.
- Captured bytes are written server-side under the authoritative project directory.

Routes: `POST /api/browser-control/claim` and `POST /api/browser-control/result`.

The renderer half is deferred until the real Chromium Browser pane is ported; until then non-open actions fail fast because no connection advertises capability.
