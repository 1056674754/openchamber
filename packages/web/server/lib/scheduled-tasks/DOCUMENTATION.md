# Scheduled Tasks module

Server-owned scheduled task runtime and routes for OpenChamber-only automation.

## Scope

- Per-project scheduled task persistence is owned by `packages/web/server/lib/projects/project-config.js`.
- Runtime orchestration and execution is owned by this module.
- This module is OpenChamber feature logic; it is intentionally separate from OpenCode proxy/runtime internals.

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

When `goalEnabled` is set, `createTaskGoal` writes the expanded prompt via `session-goal/objectives.js` (inline fallback if the write fails), patches `metadata.openchamber.goal`, then the host session-goal runtime continues the loop from session events. Oversized prompts may be distilled with Small Model for the auditor objective.

- `packages/web/server/lib/scheduled-tasks/routes.js`
  - Scheduled task CRUD endpoints
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
  - `POST /api/projects/:projectId/scheduled-tasks/:taskId/run`
  - `GET /api/openchamber/scheduled-tasks/status`
  - `GET /api/openchamber/events`
