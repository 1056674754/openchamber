# Managed Agent Tool Module

## Purpose

This module injects an `openchamber` tool into the OpenCode process managed by
OpenChamber. The tool calls the same policy-first control service as the CLI.

## Startup

The OpenChamber HTTP listener starts before managed OpenCode. Once the listener
port is known, `prepareManagedOpenCodeEnv()`:

1. writes the generated plugin under `OPENCHAMBER_DATA_DIR/agent-tool`;
2. appends its file URL to `OPENCODE_CONFIG_CONTENT`;
3. generates an ephemeral bearer token;
4. injects a loopback control endpoint and token into managed OpenCode.

The tool is disabled when `agentControlToolEnabled` is false or OpenChamber is
attached to an external OpenCode server.

The same managed-only bridge exposes the runtime fallback approval channel.
OMO sends a candidate model over the authenticated loopback endpoint. The
server checks tracked quota first, broadcasts a pending request to connected UI
clients, and waits up to 30 seconds for approve/reject. A timeout authorizes the
fallback; a UI rejection or request cancellation does not.

## Security

- The Agent endpoint accepts only loopback connections.
- It requires the ephemeral bearer token using timing-safe comparison.
- The bridge always injects the managed-local `serverId`.
- The current OpenCode Session directory is used only when the action does not
  already specify a directory or project.

## Result Contract

Tool calls return a versioned structured result with action metadata. Invalid
bridge responses and transport failures are reported as runtime failures.
Abort signals propagate without being converted into ordinary tool errors.
