# Stable macOS Shell and Mutable Runtime

OpenChamber's macOS desktop distribution has two independently updated layers.

## Stable shell

`OpenChamber.app` is the immutable, notarized host. Its entrypoint is
`dist-bundle/shell.mjs`, which performs only these duties:

1. establish the stable `OpenChamber` application and user-data identity;
2. select and verify an external runtime manifest;
3. load the verified runtime;
4. fall back to the runtime sealed inside the app if selection or import fails.

The shell also contains:

- Electron and its helper executables;
- native Node modules required by the server;
- a signed Bun executable under `Contents/Resources/engine/bun`;
- a signed compiled OpenCode fallback;
- the current embedded runtime as a recovery path.

Changing the shell loader, Electron, entitlements, Bun, a native `.node` or
`.dylib`, or any other Mach-O requires a new Developer ID build and
notarization.

## Mutable runtime

Runtime versions live under:

```text
~/Library/Application Support/OpenChamber/runtime/versions/<runtime-id>
```

`current` and `previous` are relative symlinks. Installation writes a complete
version directory, validates it, then atomically replaces `current`. A running
process resolves the symlink to an immutable version directory, so installing a
new runtime cannot change files beneath that process.

The external runtime contains:

- the Electron feature main and preload;
- `@openchamber/web` and its JavaScript dependencies;
- built web assets;
- an OpenCode launcher and bootstrap.

The OpenCode launcher runs `/Users/song/dev_ai/opencode` through the Bun engine
sealed into the shell. `OPENCODE_CHANNEL=latest` and the source package's
`-sscity` version are injected before the TypeScript entrypoint is imported.
Changing OpenCode TypeScript therefore does not introduce a new executable code
identity.

## Update commands

Build, validate, and activate a runtime without replacing the app:

```bash
bun run electron:runtime:install
```

Roll back the active runtime:

```bash
bun run electron:runtime:rollback
```

Runtime building verifies every Mach-O signature in `app.asar.unpacked`, then
compares it with the notarized shell by CodeDirectory hash. A new, changed, or
invalidly signed native binary fails the runtime build. That failure is the
signal to refresh and notarize the shell, not a check to bypass.
