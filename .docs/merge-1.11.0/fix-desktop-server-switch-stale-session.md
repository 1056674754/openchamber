# fix: clear stale session on desktop server switch

**Date**: 2026-05-16  
**Files**: `packages/ui/src/components/desktop/DesktopHostSwitcher.tsx`

## Problem

When switching from local to remote server in Electron, the UI used the stale `currentSessionId` from the previous server, causing 404 "Session not found" errors on the new server.

Root cause: `DesktopHostSwitcher.handleSwitch` called `serverRegistry.register()` to switch to the remote server, but never cleared `session-ui-store`'s `currentSessionId`. The stale session ID from the local server was then used to query sessions on the remote server.

For local switches, `window.location.assign()` does a full page reload, naturally clearing all state. But remote switches don't reload.

## Fix

Added `clearStaleSessionOnServerSwitch()` helper that calls `useSessionUIStore.getState().setCurrentSession(null)` to clear the session ID. Applied to all 4 exit points in `handleSwitch` where a remote server is registered:

1. SSH already ready (fast path)
2. SSH connect success (async path)
3. Non-SSH remote host
4. Startup SSH retry handler

The function is wrapped in try/catch with `/* non-fatal */` — stale session cleanup must never block server switching.

## Previous failed attempts

- Attempt 1 (`sync-context.tsx`): cleared `currentSessionId` after session list loads → caused session to flash and immediately close
- Attempt 2: fallback to first session → user explicitly rejected: "绝对不允许这种行为"
- Both reverted. Correct location is `DesktopHostSwitcher.tsx` where server registration happens.