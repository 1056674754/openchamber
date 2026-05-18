# fix: proxy absolute same-origin preview requests

**Upstream**: `ba9750a3`  
**Date**: 2026-05-15  
**Files**: `packages/web/server/lib/preview/proxy-runtime.js` (+43, -3)

## What upstream did

1. Extended `proxiedUrl()` to handle absolute URLs (not just path-relative)
2. Added `proxiedWebSocketUrl()` for WebSocket URL proxying
3. Wrapped `window.WebSocket` for same-origin WS connections
4. Reorganized `EventSource` wrapping

## Merge decision: ALREADY MERGED

Our `proxy-runtime.js` matches upstream exactly.

## Verification

```
git diff v1.11.1 HEAD -- packages/web/server/lib/preview/proxy-runtime.js → MATCH
grep "proxiedWebSocketUrl" proxy-runtime.js → FOUND
```

## Status

Complete. No action needed.
