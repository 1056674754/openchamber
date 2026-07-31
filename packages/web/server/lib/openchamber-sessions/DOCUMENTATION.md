# OpenChamber Sessions Module

## Purpose

This module creates, sends to, and forks managed-local OpenCode Sessions for
the OpenChamber control plane.

## Selection Rules

- A caller-supplied model, Agent, or variant wins.
- Existing Session sends and forks restore missing selection fields from the
  latest user message in that Session.
- New Sessions fall back to OpenChamber/OpenCode defaults and available
  providers only when the caller omitted a selection.
- The resolved selection is captured before dispatch; it is not read from
  mutable composer state.

## Directory and Worktree Rules

- Every operation validates an explicit directory or configured project.
- `serverId` must identify the managed-local server.
- A requested worktree is created before the Session. The resulting worktree
  directory becomes the Session directory.
- Session-created events include the authoritative server and directory so the
  sidebar can merge the new Session without relying on the active project.

## Partial Failure

If a fork or Goal has already been created and prompt dispatch then fails, the
service throws a structured partial-result error containing the surviving
Session ID and directory.
