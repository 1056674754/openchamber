# OpenChamber Control Module

## Purpose

This module is the policy-first control plane shared by the OpenChamber CLI and
the managed OpenCode Agent tool. It exposes projects, model preferences,
Sessions, worktrees, scheduled tasks, and brokered browser actions without coupling callers to global UI state.

## Authority

- Every action requires an explicit `serverId`.
- The current implementation accepts only the managed-local server
  (`default`). Remote instance IDs fail with HTTP 409.
- Session reads require an explicit `directory`.
- Session creation accepts one authoritative `directory` or configured
  `projectId`.
- Existing Session mutations require both `sessionId` and the authoritative
  directory.
- No action infers a directory from the globally active UI project.

These constraints preserve this fork's multi-instance `serverId + directory`
authority and prevent a CLI or Agent call from targeting a different instance
or checkout.

## Entrypoints

- `actions.js`: stable action names, titles, and descriptions.
- `service.js`: validates policy, dispatches Session/task operations, and owns
  optional wait/status/message behavior.
- `routes.js`: authenticated HTTP adapter at
  `POST /api/openchamber/control`.
- `error.js`: typed status and partial-result errors.

## Failure Semantics

Usage and authority failures return 4xx responses. Runtime failures return 5xx
responses. When a multi-step action has already created a fork or configured a
Goal before a later dispatch fails, the response reports `partial: true` plus
the surviving Session ID and directory instead of hiding the partial outcome.

Waiting is opt-in. `timeout` and `lastAssistant` require `wait`; otherwise
Session dispatches return immediately.

Browser actions validate URL/selector/value/direction/viewport here. `browser.capture` writes returned bytes under `.openchamber/screenshots/` in the explicit/context Session directory and returns a relative Markdown-ready path.
