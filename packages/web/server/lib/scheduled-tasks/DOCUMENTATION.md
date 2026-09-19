# Scheduled Tasks module

Server-owned scheduled task runtime and routes for OpenChamber-only automation.

## Scope

- Per-project scheduled task persistence is owned by `packages/web/server/lib/projects/project-config.js`.
- Markdown loop discovery and parsing is owned by `loops.js`.
- Runtime orchestration and execution is owned by this module.
- This module is OpenChamber feature logic; it is intentionally separate from OpenCode proxy/runtime internals.

## Cross-instance occurrence claiming

Multiple OpenChamber processes can share one project config while keeping
independent timers. Before a scheduled run creates a session, the runtime
claims its exact `nextRunAt` occurrence under the project write lock and stores
it as `state.lastScheduledFor`.

- The project lock combines the in-process promise chain with a cross-process
  `<project>.json.lock` file.
- The winner advances `nextRunAt`; another process seeing the same claimed
  occurrence skips session creation and rearms from persisted state.
- Manual `runNow` does not claim a scheduled occurrence. It also runs paused
  (`enabled: false`) tasks — that is the point of the button — while scheduled
  dispatches still skip disabled tasks, and completion never re-arms a paused task.
- Lock, claim, and completion-write failures always release the running slot.
- Only future timestamps are armed, preventing consumed once tasks from
  spinning delay-zero retries.
- A run that completed but could not persist terminal state remains a successful
  dispatch and returns `persistError`, which the UI surfaces as a warning.

## Files

- `packages/web/server/lib/scheduled-tasks/runtime.js`
  - Next-run computation (daily/weekly/cron compatibility)
  - Timer scheduling and queueing
  - Concurrency controls
  - Session create + prompt_async execution
  - Optional permission auto-accept enrollment before the first prompt
  - Optional `execution.goalEnabled`: write objective file + stamp session metadata goal, and attach a synthetic goal-intro part on `prompt_async` (local OpenCode / host session-goal runtime only)
  - Emits OpenChamber task-run events

Permission auto-accept enrollment is delegated to `packages/web/server/lib/permission-auto-accept/runtime.js`. Enrollment failure is reported but does not prevent the scheduled task from running; the task then waits for normal user approval.

Loop-driven runs wait for an active worktree bootstrap before creating their session. Discovery is server-local: the local server reads local loop files, while remote instances expose loops through their own scheduled-task routes.

When `goalEnabled` is set, `createTaskGoal` writes the expanded prompt via `session-goal/objectives.js` (inline fallback if the write fails), patches `metadata.openchamber.goal`, then the host session-goal runtime continues the loop from session events. Oversized prompts may be distilled with Small Model for the auditor objective.

- `packages/web/server/lib/scheduled-tasks/routes.js`
  - Scheduled task CRUD endpoints
  - Listing reconciles loop additions, edits, and removals without restart
  - Loop-file endpoints update `enabled` frontmatter or delete the authoritative file
  - Manual run endpoint
  - OpenChamber events SSE stream endpoint

## Public exports (runtime.js)

- `createScheduledTasksRuntime(dependencies)`
- Returned API:
  - `start()`
  - `stop()`
  - `syncAllProjects()`
  - `syncProject(projectId)`
  - `runNow(projectId, taskId)`

## Public exports (routes.js)

- `registerScheduledTaskRoutes(app, dependencies)`
- Registers:
  - `GET /api/projects/:projectId/scheduled-tasks`
  - `PUT /api/projects/:projectId/scheduled-tasks`
  - `DELETE /api/projects/:projectId/scheduled-tasks/:taskId`
  - `PATCH /api/projects/:projectId/scheduled-tasks/:taskId/loop-file`
  - `DELETE /api/projects/:projectId/scheduled-tasks/:taskId/loop-file`
  - `POST /api/projects/:projectId/scheduled-tasks/:taskId/run`
  - `GET /api/openchamber/scheduled-tasks/status`
  - `GET /api/openchamber/events`

## Markdown loop format

```markdown
---
name: daily-digest
schedule: "0 9 * * *"
enabled: true
model: anthropic/claude-sonnet-4-5
agent: plan
timezone: Europe/Kyiv
---
Summarize repository changes since yesterday.
```

Loops are discovered from `.agents/loops/*.md` in the project and its ancestors up to the worktree root, plus `~/.agents/loops/*.md`. Project scope shadows user scope by name. New loops default to disabled unless `enabled: true` is explicit.

Reconciliation runs under the existing per-project write lock on the server that owns the project. Loop-owned tasks adopt by file path, JSON tasks by name; IDs, runtime state, and UI-only execution fields survive adoption. Malformed existing files retain their last good task, removed files unschedule their tasks, and runtime state is never written to markdown.
