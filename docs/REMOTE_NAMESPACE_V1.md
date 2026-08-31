# Remote Namespace v1 (VS Code "local engine, remote files" mode)

Status: v1 shipped in extension `1.18.2-sscity` (2026-08-28). Unreleased / pending
first live test in a Remote-SSH window. Owner: song.

## Purpose

Run the OpenChamber VS Code extension and its OpenCode engine entirely on the
local Mac while the workspace lives on a Remote-SSH host. Nothing (except
`sshd`) is installed or configured on the remote: OpenCode binary, auth,
`~/.config/opencode`, and models all stay local.

## Architecture (4 layers)

| Layer | Mechanism | Source |
| --- | --- | --- |
| Identity | Workspace URI `vscode-remote://ssh-remote+<label>/<path>` maps to namespace path `~/.openchamber/remote/<label>/<path>`. Sessions key on the namespace path, so local projects and different hosts can never mix (guaranteed by prefix construction, not convention). | `packages/vscode/src/remoteNamespace.ts` |
| Data plane | `rclone mount :sftp,...:` at `~/.openchamber/remote/<label>` (connection params resolved from `ssh -G <label>`). Extension checks the mount before spawning OpenCode and auto-mounts when missing. Manual fallback: `scripts/remote-mount.sh <label>`. | `src/remoteNamespace.ts`, `scripts/remote-mount.sh` |
| Execution | Plugin tool registered under the verbatim id `bash` replaces the builtin shell tool (plugin tools are appended after builtins in the registry and win the id map). Commands run via `ssh <label> 'cd <remote-cwd> && <command>'` with timeout/abort support. | `packages/vscode/remote-config/plugin/remote-namespace.ts` |
| Guard | (a) `external_directory: {"*": "deny"}` in the instance config turns any fs-tool escape outside the project into a hard `PermissionV1.DeniedError` (no prompt). (b) The plugin validates `workdir` stays inside the namespace. Both are injected only into remote instances via `OPENCODE_CONFIG_DIR` (staged at `globalStorage/remote-opencode-config`), so local sessions are untouched. | `remote-config/opencode.json`, `src/remoteNamespace.ts` |

Extension is declared `"extensionKind": ["ui"]` so it runs in the local UI
extension host even inside remote windows. Non-SSH remote authorities (WSL,
tunnels, containers) are explicitly blocked with a status message instead of
silently misbehaving.

Chip/selection pipeline (Cmd+L, Add Selection, Explain/Improve, explorer
attach, active-editor broadcast) all map URI paths through the namespace, so
file references the model receives are `~/.openchamber/remote/<label>/...` and
resolve through the mount.

## Prerequisites (local Mac only)

1. `brew install rclone` (done 2026-08-28)
2. `brew install --cask fuse-t` — needs admin password + System Settings
   approval + relogin (NOT yet done at time of writing)
3. If Homebrew's rclone build refuses `mount` with FUSE-T, fall back to the
   official rclone binary from rclone.org (bundled FUSE-T support).

Remote: nothing beyond sshd and the host being reachable via `ssh <label>`.

## Test checklist (first live run)

1. Reload window after FUSE-T install; connect Remote-SSH to a host (Dev1).
2. Open OpenChamber sidebar: expect auto-mount of `~/.openchamber/remote/Dev1`
   then status connecting -> connected.
3. Select remote code, Cmd+L: chip shows namespace path, not `vscode-remote`.
4. Ask agent to run `uname -a && pwd`: output must be the REMOTE host, cwd in
   the remote project dir.
5. Ask agent to read a path outside the project (e.g. `/etc/passwd`): expect a
   deny error in the tool result, not a permission prompt.
6. Open a purely local window afterwards: bash must still run locally (plugin
   not loaded), no deny behavior.

## Known v1 limitations

- LSP indexing and large greps go through the FUSE mount: slow first pass.
- The webview terminal panel spawns a LOCAL pty (commands typed there run on
  the Mac against mount paths). Remote execution belongs to the bash tool.
- Bash output is buffered (no live streaming in v1), capped at 512 KB.
- Non-git remote projects: OpenCode config walk-up stops at namespace root
  only for git repos (worktree stop). Non-git projects can see local `/.opencode`
  if one exists; prefer git projects or harden `containsPath` in the fork later.
- Session/history for remote projects is stored locally under the namespace
  path (by design: nothing on the remote).

## Upgrade path (v2, not built)

Replace mount-backed fs tools with proxied tools (plugin `read`/`write`/`edit`
forwarding through `vscode.workspace.fs`), keeping the mount only for config
discovery / LSP / watcher. This is the AHP-style "proxy operations, not paths"
design discussed 2026-08-28.

## Incident report (2026-08-28)

While cleaning suspected bun build artifacts, three untracked WIP files in
`packages/shared/src/` plus `flowchart-wide.png` (worktree root) were deleted
by mistake.

- `settings-lock.js`, `settings-lock.test.js` — restored byte-identical from
  `packages/electron/dist-runtime/1.18.2-sscity.20260814-102824-*/node_modules/@openchamber/shared/src/`.
  Restored copy passes `bun test` (6/6).
- `settings-lock.d.ts` — not present in any copy; reconstructed from the
  implementation JSDoc, styled after `rpc-classes.d.ts`.
- `flowchart-wide.png` — NOT recovered (absent from git objects, stashes,
  codex/claude session stores, dist trees). Regenerate if still needed.

Lesson recorded: `rm` on untracked files requires checking origin first; bun
side effects (implicit installs, lockfile writes) must be reverted with
`git checkout` only, never `rm` of `??` entries.
