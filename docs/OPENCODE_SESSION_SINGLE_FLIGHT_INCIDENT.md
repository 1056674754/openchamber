# OpenCode Session Single-Flight Incident

Date: 2026-06-11
Primary session: `ses_149d6a9aaffe8uComNOrq49VoU`

## Summary

This incident is not just a weak model prompt or an OpenChamber rendering issue. The DB timeline shows a same-session scheduling failure: an internal OMA background-completion reminder was admitted into a session while an earlier assistant turn was still active. After that, multiple assistant branches overlapped, some branches interpreted the internal reminder as an empty user message, and a later branch recreated TODOs after the user had cleared them.

The required invariant is:

```text
One session must have at most one active assistant/LLM run at any time.
```

This invariant must be enforced by OpenCode server, not only by OpenCode CLI, OpenChamber, or OMA.

## Confirmed Incident Timeline

- `18:22:03`: real user message: "不是mysql 是pg. 允许你去读取配置".
- `18:22:38` to `18:22:45`: assistant message under that real user turn is still active.
- `18:22:44`: OMA internal user-role message is inserted:

```text
<system-reminder>
[BACKGROUND TASK COMPLETED]
[ALL BACKGROUND TASKS COMPLETE]
...
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->
```

- `18:22:44` and `18:22:45`: new assistant messages start under the internal OMA reminder while the previous assistant is still active.
- `18:23:37`, `18:23:44`, `18:24:03`: assistant reasoning parts say variants of "The user sent an empty message". No real blank user message was found in the DB; this is model reasoning caused by the internal reminder shape.
- `18:24:30`: user sends "清理掉TODO".
- `18:24:33` and `18:24:35`: one branch clears TODOs.
- `18:24:59`: another concurrent branch recreates TODOs.
- `18:25:01`: OMA TODO continuation sees incomplete TODOs and injects a synthetic continuation.
- `18:25:05`: user sends stop text. The continuation is already admitted and overlaps with the stop response.

## Failure Classes

### 1. Empty Message

The "empty message" is not a stored empty user prompt. It is assistant reasoning text. The model saw an internal user-role reminder and inferred an empty or missing user turn.

### 2. TODO Continues After Stop/Clear

The TODO continuation was triggered after a concurrent assistant branch recreated TODOs. The user clear/stop did not become a durable per-session "do not reactivate" state that OMA and OpenCode both respect.

### 3. Multiple Active Parts/Runs

The earliest hard fault is before TODO continuation. Multiple assistant messages and parts overlap in one session starting around `18:22:44`.

## OpenCode CLI vs OpenCode Server/SDK Difference

OpenCode CLI and OpenCode server do not expose identical runtime safety behavior.

CLI/TUI protections observed:

- The TUI prompt component has a local `submitting` lock to prevent overlapping submit calls.
- The TUI normal prompt path uses `session.prompt`, not `promptAsync`.
- The `opencode run` interactive mode has a serial prompt queue.
- The stream transport has a `state.wait` guard that rejects a new turn while a prompt is already running.

Server/SDK path observed:

- OpenChamber normal send uses `/session/:id/prompt_async` so the UI does not block on long model work.
- OMA internal prompt dispatch also uses async prompt paths in several places.
- OpenCode server's `/prompt_async` handler currently forks `promptSvc.prompt(...)` and returns accepted immediately.
- No hard per-session admission check is visible at the `/prompt_async` handler boundary before the user message is created.

This explains why the CLI can appear healthy while SDK/HTTP clients can reproduce the bug.

## Current Suspected Root Cause

OpenCode already has `SessionRunState` and a runner, but the current prompt flow does not enforce the desired policy at the correct boundary:

- `SessionPrompt.prompt` creates the user message first.
- It then enters `loop()`.
- The runner's `ensureRunning` behavior waits for an existing run rather than rejecting at admission time.

That design may support "append while running" behavior, but it violates the stricter invariant required here.

## Required Fix Direction

### OpenCode Server

Add a server-side admission policy before `prompt_async` accepts a new run:

- If the session is already active, do not create a new user message.
- Return a deterministic busy error, likely HTTP `409`, or enqueue explicitly in a server-owned per-session queue.
- Do not rely on CLI-local queues to protect HTTP/SDK clients.

If queueing is chosen, the queue must be explicit and observable:

- FIFO per session.
- Abort cancels active and queued entries for that session.
- A manually stopped session must not auto-start queued synthetic/internal prompts unless explicitly allowed.

### OpenCode Abort Semantics

Investigate why server abort can lag or fail compared with CLI abort:

- Confirm what `/session/:id/abort` cancels: active runner, background jobs, tool calls, queued prompts, provider stream.
- Confirm whether abort waits for cancellation completion or only requests cancellation.
- Confirm whether the server records "manual user abort" as durable session state.
- Confirm whether a later `prompt_async` can immediately reactivate the session after abort.

For `send_now` / interrupt-send specifically, abort must not be treated as idempotent success. The safe contract is:

```text
abort succeeds first, then send; if abort fails or cannot prove success, do not send the next message.
```

Returning success for "already idle", "unknown", timeout, or swallowed failure would make the UI look safe while the previous turn may still be active. That is worse than failing closed.

### OMA TODO Continuation

Confirm and likely harden:

- Whether TODO continuation checks recent abort/error only via a short volatile window.
- Whether it can distinguish user/manual abort from provider/runtime abort.
- Whether stop/clear TODO cancels active countdowns.
- Whether it checks the stop state both before countdown and immediately before injection.

The desired behavior is:

```text
After a user manual stop, OMA must not reactivate the same session through TODO continuation unless the user sends a new explicit prompt.
```

### OpenChamber

OpenChamber should still defend normal sends:

- Normal send should fail closed if the session is busy.
- Interrupt send must abort successfully before sending the next message.

But OpenChamber cannot be the only enforcement layer because OMA and other SDK clients can call OpenCode server directly.

## Update Plan Before Code Changes

1. Update `/Users/song/dev_ai/opencode` from its upstream branch and re-check whether server-side `prompt_async` admission has already been fixed.
2. Update `/Users/song/dev_ai/oh-my-openagent` from its upstream branch and re-check TODO continuation/manual stop behavior.
3. Re-run the code-path comparison against the updated sources.
4. Add failing tests first:
   - OpenCode server: concurrent `prompt_async` for same session must not create two active assistant runs.
   - OpenCode server: abort must cancel or block queued synthetic prompts.
   - OMA: TODO continuation must not inject after a manual user abort/stop marker.
5. Implement the smallest fixes in the owning layer.
6. Run targeted tests and type checks from the correct package directories.

## Latest Upstream Recheck

Rechecked on 2026-06-11 after fetching latest upstreams.

### OpenCode

Repository: `/Users/song/dev_ai/opencode`

Branch created from latest `origin/dev`:

```text
codex/session-single-flight @ 318dbe93b
```

Findings:

- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` still had `promptAsync` directly forking `promptSvc.prompt(...)`.
- `promptAsync` did not check `SessionRunState.assertNotBusy(...)` before accepting.
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` did not declare `SessionBusyError` for `promptAsync`.
- `abort` still routes through `promptSvc.cancel(...) -> SessionRunState.cancel(...) -> Runner.cancel`.
- `Runner.cancel` interrupts the active fiber and waits for cooperative cancellation. This explains why server abort can feel slower or less deterministic than CLI-local abort UX.

Conclusion: latest OpenCode had not fixed the HTTP/SDK async admission hole.

### OMA / oh-my-openagent

Repository: `/Users/song/dev_ai/oh-my-openagent`

Branch created from latest `code-yeongyu/dev`:

```text
codex/session-single-flight @ 9a16b54e4
```

Findings:

- TODO continuation has a `prompt-async-gate` that checks session status and latest assistant state before internal prompt dispatch.
- That gate is plugin-side soft defense only; it cannot protect other SDK callers and can fail open when status/message inspection is unavailable.
- TODO continuation does detect `MessageAbortedError` / `AbortError` on `session.error` and sets `wasCancelled = true`.
- But `handleNonIdleEvent()` cleared `wasCancelled` on later assistant, delta, and tool events. Late events after abort could therefore re-enable TODO continuation without a new real user prompt.

Conclusion: latest OMA had a partial manual-stop guard, but it was not durable enough.

## Fixes Applied

### OpenCode server hard gate for `prompt_async`

Changed files:

- `/Users/song/dev_ai/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `/Users/song/dev_ai/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- `/Users/song/dev_ai/opencode/packages/opencode/test/server/httpapi-session.test.ts`

Behavior:

- `prompt_async` now reserves the session before forking background work.
- If the session is already busy, or already has a pending `prompt_async` reservation, it returns typed `SessionBusyError` / HTTP 409.
- The busy response happens before creating a user message, so a rejected overlapping async prompt cannot add another user turn.
- The reservation is released when the forked prompt finishes.

This is deliberately a reject-at-server-boundary fix, not a hidden server queue. A hidden queue would still be risky after user stop because queued synthetic prompts could later activate without another user decision.

### OMA durable manual-stop state

Changed files:

- `/Users/song/dev_ai/oh-my-openagent/packages/omo-opencode/src/hooks/todo-continuation-enforcer/non-idle-events.ts`
- `/Users/song/dev_ai/oh-my-openagent/packages/omo-opencode/src/hooks/todo-continuation-enforcer/non-idle-events.test.ts`
- `/Users/song/dev_ai/oh-my-openagent/packages/omo-opencode/src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts`

Behavior:

- Assistant message activity no longer clears `wasCancelled`.
- Message delta activity no longer clears `wasCancelled`.
- Tool execution activity no longer clears `wasCancelled`.
- A new real user message still clears the stop marker, preserving the intended "user explicitly resumes work" path.

## Verification

OpenCode:

```text
OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true bun test test/server/httpapi-session.test.ts --test-name-pattern "rejects prompt_async while the session already has active work"
bun run typecheck
```

Result:

- New `prompt_async` busy regression test passed.
- Package typecheck passed.

Note: without `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`, this macOS environment fails while starting the native FSEvents watcher. That is a local watcher initialization issue, not a failed `prompt_async` assertion.

OMA:

```text
bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/non-idle-events.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts --filter "abort|manual stop|assistant message activity|tool execution|message delta"
bun run typecheck:packages
```

Result:

- 70 TODO continuation / abort-related tests passed.
- Package typecheck passed.

## Local Deployment

Applied on 2026-06-11.

- Built OpenCode from `/Users/song/dev_ai/opencode` branch `codex/session-single-flight`.
- Installed the built OpenCode binary at `/Users/song/.opencode/bin/opencode`.
- Updated OpenChamber settings at `/Users/song/.config/openchamber/settings.json` so `opencodeBinary` points to `/Users/song/.opencode/bin/opencode`.
- Rebuilt OMA from `/Users/song/dev_ai/oh-my-openagent` branch `codex/session-single-flight`.
- Replaced the OpenCode plugin package path `/Users/song/.config/opencode/node_modules/oh-my-opencode` with a symlink to `/Users/song/dev_ai/oh-my-openagent`.
- Updated `/Users/song/.local/bin/omo` to run `/Users/song/dev_ai/oh-my-openagent/dist/cli/index.js`.
- Backed up the previous local runtime files under `/Users/song/.local/share/openchamber-runtime-backups/20260611-205921`.

Runtime verification:

```text
opencode -> /Users/song/.opencode/bin/opencode
opencode --version -> 0.0.0-codex/session-single-flight-202606111258
OpenChamber /api/config/opencode-resolution launchBinary -> /Users/song/.opencode/bin/opencode
active OpenChamber-managed server -> /Users/song/.opencode/bin/opencode serve
OpenCode plugin symlink -> /Users/song/dev_ai/oh-my-openagent
omo --version -> 4.8.1
```

## Remaining Work

- OpenCode/OpenChamber abort still deserves a separate follow-up: prove cancellation all the way down to provider/tool streams under slow or non-cooperative providers. The HTTP/API layer now fails closed on explicit abort errors, but a provider that takes a long time to cooperatively unwind can still make stop feel delayed.
- If OpenCode wants true server-side queueing later, queued entries must be first-class state with abort clearing queued synthetic prompts. A hidden in-memory queue would be unsafe for this incident class.

## Abort Follow-Up

Applied on 2026-06-11 after reproducing that OpenChamber could treat SDK abort failures as success and that OpenCode HTTP abort did not provide a reliable `session.error` cancellation signal for OMA hooks.

Changed files:

- `/Users/song/dev_ai/openchamber-merge-v1.11.0/packages/ui/src/sync/session-actions.ts`
- `/Users/song/dev_ai/openchamber-merge-v1.11.0/packages/ui/src/sync/session-actions.test.ts`
- `/Users/song/dev_ai/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `/Users/song/dev_ai/opencode/packages/opencode/test/server/httpapi-session.test.ts`

Behavior:

- OpenChamber `abortCurrentOperation()` now unwraps SDK responses. `{ error }`, missing data, or `{ data: false }` returns failure instead of showing successful stop feedback.
- OpenCode HTTP abort now publishes a `MessageAbortedError` session error after `promptSvc.cancel(...)`, using an async best-effort publish so the abort response is not blocked by event observers.
- OMA TODO/loop hooks already listen for `MessageAbortedError` / `AbortError`; this gives those existing guards a reliable signal when the user presses stop through OpenChamber/OpenCode HTTP.
- The existing `send_now` interrupt path remains success-gated: abort must return true before the next message is sent.

Verification:

```text
bun test packages/ui/src/sync/session-actions.test.ts
bun test test/server/httpapi-session.test.ts
```

Result:

- OpenChamber session-actions regression tests passed.
- OpenCode HTTP session regression tests passed.
