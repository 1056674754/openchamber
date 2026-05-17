# fix: prevent infinite re-render loops in SessionSidebar

**Date**: 2026-05-16  
**Files**:
- `packages/ui/src/components/session/SessionSidebar.tsx`
- `packages/ui/src/sync/multi-server-hooks.ts`

## Problem 1: Worktree discovery setState always creates new Map

In `SessionSidebar.tsx`'s `discoverWorktrees()` async function, `useSessionUIStore.setState()` was called unconditionally with new `Map` objects for `availableWorktreesByProject`. Even when worktree content was identical, the new `Map` reference triggered re-renders of all subscribers (SessionSidebar subscribes at line 397), which could cascade into `syncSessionStructureSignature` changes, re-triggering the effect, creating a potential infinite loop.

## Fix 1

Added content comparison before `setState`. If new `worktreesByProject` has same keys, same worktree count per key, and same `path`/`branch` for each worktree, skip the `setState` call entirely. Same identity check for `availableWorktrees` array length.

## Problem 2: Rapid re-renders during OpenCode reload / session reset

`useAllServersLiveSessions` subscribed to all sync child stores. During OpenCode reload (triggered from Settings), multiple child stores were recreated simultaneously, each triggering `setDefaultSessions()` which creates a new array via `aggregateLiveSessions()`. In React StrictMode (dev), effects fire twice, amplifying the cascade. With 25+ store updates during reload, this exceeded React's 50-update limit.

## Fix 2

In `multi-server-hooks.ts`, added `sessionsStableSignature()` helper that computes a stable identity string from session IDs and update timestamps. Both `updateDefault` and `updateExtra` callbacks now:
1. Compute the new session array
2. Compare its signature against the previous signature stored in a `useRef`
3. Only call `setState` if the signature changed

Additionally, `updateDefault` uses `queueMicrotask` to coalesce multiple rapid-fire updates within the same frame.