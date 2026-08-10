# OpenCode Lifecycle Incident Runbook

## Purpose

Use this runbook when managed OpenCode becomes unreachable, repeatedly reports
`upstream_stalled` / `health_check_unhealthy`, or restarts without an obvious
cause.

The goal is to determine which of these actually happened:

1. OpenCode exited by itself.
2. OpenCode was terminated by OpenChamber.
3. OpenCode was terminated by the OS, the user, or another process.
4. OpenCode stayed alive and kept the listening port, but its health endpoint
   stopped responding.
5. OpenChamber lost its own process before it could finish recording the child
   lifecycle.

Do not infer a cause from a new PID, a stopped application log, or a failed
health request alone. Correlate the lifecycle journal, listener ownership,
OpenCode logs, and OS evidence.

## Evidence sources

### OpenChamber lifecycle journal

Default paths:

```text
~/.config/openchamber/logs/opencode-lifecycle.jsonl
~/.config/openchamber/logs/opencode-lifecycle.jsonl.1
```

When `OPENCHAMBER_DATA_DIR` is set, replace `~/.config/openchamber` with that
directory. The journal rotates at 2 MB and retains one previous generation.

The journal intentionally excludes prompts, message content, credentials,
request headers, and the spawned environment.

### OpenCode application logs

The normal local data directory is:

```text
~/.local/share/opencode/log/
```

Common files include `opencode.log` and timestamp-named `.log` files. Treat
these as potentially sensitive: inspect before sharing because upstream or
plugin logs may contain local paths or request details.

### macOS crash and system evidence

Crash reports:

```text
~/Library/Logs/DiagnosticReports/opencode-*.ips
~/Library/Logs/DiagnosticReports/.opencode-*.ips
```

Unified logging can show process termination, memory pressure, and surrounding
OpenChamber/OpenCode activity even when no `.ips` report was written.

## First-response rule

When the process is still present, collect evidence before restarting it.
Aim to finish the non-destructive capture within two minutes. If the user
explicitly prioritizes immediate restoration, record the current timestamp,
PID, port, and listener ownership first, then restore service.

Do not package, replace the app, kill OpenCode, delete logs, or clear the data
directory before capture. Those actions can erase the only evidence that
distinguishes a crash from a hang.

## 1. Establish the incident window

Record both local time and UTC:

```bash
date '+local=%Y-%m-%dT%H:%M:%S%z'
date -u '+utc=%Y-%m-%dT%H:%M:%SZ'
```

Use the first visible connection error as the start. Extend the window at least
five minutes before that time and five minutes after recovery.

Create a case directory:

```bash
CASE_DIR="$HOME/Desktop/openchamber-opencode-incident-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$CASE_DIR"
OC_DATA_DIR="${OPENCHAMBER_DATA_DIR:-$HOME/.config/openchamber}"
```

## 2. Preserve the lifecycle journal

```bash
for file in \
  "$OC_DATA_DIR/logs/opencode-lifecycle.jsonl.1" \
  "$OC_DATA_DIR/logs/opencode-lifecycle.jsonl"
do
  if [ -f "$file" ]; then
    cp -p "$file" "$CASE_DIR/"
  fi
done
```

Build one timestamp-ordered timeline. Compact output keeps the result valid
JSONL:

```bash
for file in \
  "$OC_DATA_DIR/logs/opencode-lifecycle.jsonl.1" \
  "$OC_DATA_DIR/logs/opencode-lifecycle.jsonl"
do
  if [ -f "$file" ]; then
    cat "$file"
  fi
done | jq -cs 'sort_by(.timestamp)[]' > "$CASE_DIR/lifecycle-timeline.jsonl"
```

Produce a compact view:

```bash
jq -r '
  [
    .timestamp,
    .event,
    (.details.pid // .details.managedPid // ""),
    (.details.port // ""),
    (.details.reason // ""),
    (.details.code // ""),
    (.details.signal // ""),
    (.details.consecutiveFailures // ""),
    ((.details.listeningProcessIds // []) | join(","))
  ] | @tsv
' "$CASE_DIR/lifecycle-timeline.jsonl"
```

## 3. Capture live process and listener state

Read the last managed port:

```bash
PORT="$(cat "$OC_DATA_DIR/last-opencode-port" 2>/dev/null || true)"
printf 'managed_port=%s\n' "$PORT" | tee "$CASE_DIR/managed-port.txt"
```

If the port is available, capture every listener:

```bash
if [ -n "$PORT" ]; then
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN \
    | tee "$CASE_DIR/listeners.txt"

  for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null); do
    ps -o pid=,ppid=,pgid=,state=,etime=,rss=,command= -p "$pid" \
      | tee -a "$CASE_DIR/processes.txt"
  done
fi
```

Compare the listener PID with:

- `process_spawn.details.pid`
- `process_ready.details.pid`
- `health_failure.details.managedPid`
- `health_failure.details.listeningProcessIds`

A listener PID different from the managed PID indicates stale/orphan ownership
or another process occupying the port.

## 4. Sample a process that is alive but unhealthy

Only do this while the suspect PID still exists. `sample` is non-destructive
and is much more useful before a restart:

```bash
PID="<suspect-pid>"
sample "$PID" 10 1 -file "$CASE_DIR/opencode-$PID.sample.txt"
vmmap -summary "$PID" > "$CASE_DIR/opencode-$PID.vmmap.txt"
lsof -nP -p "$PID" > "$CASE_DIR/opencode-$PID.lsof.txt"
```

Interpretation:

- Repeated identical stacks in networking, plugin hooks, database locks, or
  event dispatch suggest a hang rather than process exit.
- Very high RSS plus macOS memory-pressure evidence raises the likelihood of
  an OS memory termination.
- A sample cannot identify the initiator of a later signal; use the lifecycle
  and unified logs for that.

## 4A. Distinguish restart incidents from resource saturation

OpenCode can remain healthy and keep its listener while consuming enough CPU
or memory to make the OpenChamber renderer lag. In that case, a lifecycle
restart investigation alone is insufficient.

Capture the whole process tree without stopping it:

```bash
ps -axo pid=,ppid=,pgid=,%cpu=,rss=,etime=,command= \
  | tee "$CASE_DIR/process-tree.txt"
```

Inspect the OpenCode sample for repeated filesystem-index work:

```bash
rg -n 'fff_search|walk_filesystem|find_file_index|getdirentries|open|stat' \
  "$CASE_DIR/opencode-$PID.sample.txt"
```

Then record:

- How many distinct project directories the current OpenCode process has
  initialized.
- How many direct and descendant MCP/plugin processes it owns.
- Whether the sampled hot path is filesystem indexing, MCP/plugin work,
  database work, or request/event dispatch.
- Whether CPU remains high while `/global/health` continues to succeed.

Many retained directory contexts plus many MCP children and
`fff_search::FileSync::walk_filesystem` / `find_file_index` stacks indicate
resource saturation, not proof of a crash or health-loop restart. A directory
instance may own MCP connections and file indexes, so removing it from a UI
list does not prove its backend resources were disposed.

Do not kill individual MCP children or evict directory instances during active
work. The durable fix belongs at the OpenCode instance-lifecycle boundary:
idle eviction must dispose the entire directory instance before removing it,
must exclude busy sessions, and must preserve the selected directory. On the
OpenChamber side, avoid eagerly initializing MCP/config state for directories
that are not part of the authoritative active bootstrap set. Keep the
`serverId + directory` pair intact when narrowing that set.

## 5. Correlate OpenCode logs

Create local-time boundary files using macOS `touch`. Replace the example
timestamps with the incident window:

```bash
touch -t 202607280005.00 "$CASE_DIR/window-start"
touch -t 202607280025.00 "$CASE_DIR/window-end"
```

List logs around that window:

```bash
find "$HOME/.local/share/opencode/log" -maxdepth 1 -type f \
  -newer "$CASE_DIR/window-start" ! -newer "$CASE_DIR/window-end" \
  -print
```

Search relevant files without assuming every error is fatal:

```bash
rg -n -i 'fatal|panic|uncaught|unhandled|segfault|abort|out of memory|error' \
  "$HOME/.local/share/opencode/log"
```

An abruptly ending log is not proof of a crash. It is only supporting evidence
when paired with `process_exit`, a crash report, or OS termination evidence.

## 6. Check macOS crash reports

Find reports in the incident window:

```bash
find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f \
  -iname '*opencode*.ips' \
  -newer "$CASE_DIR/window-start" ! -newer "$CASE_DIR/window-end" \
  -print
```

Inspect the report header and termination section:

```bash
REPORT="<path-to-opencode.ips>"
sed -n '1,180p' "$REPORT"
```

Match `captureTime`, PID, executable path, exception type, termination reason,
and signal against the lifecycle journal. Do not match only by filename.

## 7. Check macOS unified logs

Use local-time values accepted by `/usr/bin/log`, for example
`2026-07-28 00:05:00`:

```bash
START="<incident-start-local>"
END="<incident-end-local>"

/usr/bin/log show \
  --start "$START" \
  --end "$END" \
  --style compact \
  --predicate '
    process == "OpenChamber" OR
    process == "opencode" OR
    process == "OpenCode"
  ' > "$CASE_DIR/macos-process.log"
```

Check memory-pressure and forced-termination signals separately:

```bash
/usr/bin/log show \
  --start "$START" \
  --end "$END" \
  --style compact \
  --predicate '
    process == "kernel" AND (
      eventMessage CONTAINS[c] "memorystatus" OR
      eventMessage CONTAINS[c] "jetsam" OR
      eventMessage CONTAINS[c] "out of memory" OR
      eventMessage CONTAINS[c] "killed"
    )
  ' > "$CASE_DIR/macos-memory-pressure.log"
```

Absence of a matching unified-log line does not prove that the OS was not the
initiator. Record it as missing evidence, not as a negative fact.

## Lifecycle event reference

| Event | Meaning | Important fields |
|---|---|---|
| `process_spawn` | OpenChamber created a managed child | `pid`, `port`, `binary`, `wrapperType` |
| `process_ready` | The child served and passed readiness | `pid`, `port` |
| `process_error` | Node reported a child-process/spawn error | `pid`, `code`, `message` |
| `process_exit` | The child emitted an exit event | `pid`, `code`, `signal`, `expected`, `stopReason`, `served`, `uptimeMs` |
| `stop_requested` | OpenChamber is about to stop the child | `pid`, `port`, `reason` |
| `stop_completed` | Managed stop finished | `pid`, `code`, `signal`, `reason` |
| `health_failure` | `/global/health` failed | `source`, `consecutiveFailures`, `failureThreshold`, `managedProcessAlive`, `managedPid`, `port`, `listeningProcessIds`, `activeSessionCount` |
| `health_recovered` | Health recovered after failures | `source`, `consecutiveFailures`, `pid`, `port` |
| `restart_deferred_busy` | Restart threshold was reached but active work delayed it | `source`, `consecutiveFailures`, `activeSessionCount` |
| `restart_started` | A restart operation began | `reason`, `previousPid`, `previousPort`, `activeSessionCount` |
| `restart_joined` | Another request joined an existing restart | `reason` |
| `restart_completed` | Replacement became ready | `reason`, `previousPid`, `previousPort`, `pid`, `port` |
| `restart_failed` | Replacement did not become ready | `reason`, `message` |
| `port_release_timeout` | Port not released after SIGKILL escalation during restart | `port`, `reason`, `listeningProcessIds` |

Known restart reasons:

- `config_change`
- `health_immediate_listener_missing`
- `health_periodic_listener_missing`
- `health_immediate_threshold`
- `health_periodic_threshold`
- `requested`

Known stop reasons include `restart:<restart-reason>`, `app_shutdown`,
`startup_health_timeout`, and `managed_close`.

## Decision table

| Evidence | Classification |
|---|---|
| `stop_requested` precedes `process_exit`, and `expected: true` | OpenChamber initiated the stop. Use `reason` to identify config, health, shutdown, or manual restart. |
| `process_exit` has `expected: false`, non-zero `code`, and no signal | OpenCode exited with an application failure. Correlate OpenCode logs and `.ips`. |
| `process_exit` has `expected: false` and `signal: SIGTERM` | Something outside the managed stop path sent SIGTERM. The signal alone cannot identify the sender. |
| `process_exit` has `expected: false` and `signal: SIGKILL` | The process was forcibly killed. Use unified logs for memory pressure; otherwise the sender remains unknown. |
| Repeated `health_failure`, `managedProcessAlive: true`, and listener PID equals managed PID, with no `process_exit` | OpenCode stayed alive but stopped serving health: treat as a hang/stall. Inspect `sample`, OpenCode logs, plugins, DB locks, and network waits. |
| `managedProcessAlive: false` and `listeningProcessIds: []` | Managed process and listener are gone. A `process_exit` event should normally explain code/signal. |
| Managed PID differs from `listeningProcessIds` | Stale/orphan listener or port collision. Identify both PIDs before terminating either. |
| New `process_spawn` exists but no preceding `restart_started` in the retained window | Earlier journal generation may have rotated, OpenChamber itself restarted, or the build predates lifecycle logging. Do not assign an initiator without more evidence. |
| OpenCode log stops but no lifecycle exit, crash report, or OS evidence exists | Inconclusive. A stopped log alone does not distinguish crash, hang, blocked logging, or host loss. |

## Incident conclusion template

```markdown
# OpenCode lifecycle incident

- Incident window (UTC):
- Incident window (local):
- OpenChamber PID:
- Managed OpenCode PID / port:
- Listener PID(s):
- Classification:
- Confidence: confirmed / high / medium / inconclusive

## Timeline

- <timestamp> <event and evidence>

## Initiator

- OpenChamber / OpenCode self-exit / OS-or-external / unknown
- Evidence:

## Exit or hang evidence

- Exit code:
- Signal:
- `expected` / `stopReason`:
- Last successful `process_ready`:
- Health failure count:
- Listener ownership:
- Process sample:

## Correlated evidence

- OpenCode log:
- macOS crash report:
- macOS unified log:

## Remaining unknowns

- <state exactly what the evidence cannot distinguish>

## Next action

- <specific code, plugin, network, database, or OS investigation>
```

## Limitations

- Incidents that happened before this lifecycle journal was deployed cannot be
  reconstructed from it.
- The lifecycle journal does not persist raw child stderr because that stream
  can contain sensitive third-party or plugin output. Use OpenCode's own logs
  and macOS crash reports for internal stack/error details.
- `SIGTERM` and `SIGKILL` identify the signal, not its sender.
- A simultaneous OpenChamber crash can lose the final asynchronous child-exit
  event. Normal managed shutdowns await `stop_completed`.
- Rotation retains about 4 MB total across current and `.1`; copy both files as
  soon as possible after an incident.
