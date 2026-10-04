# Embedded OpenCode Packaging and Signing Runbook

This document is the source of truth for building the custom OpenCode fallback,
packaging the stable Electron shell, installing mutable runtime releases,
signing both executable layers, notarizing shell artifacts, and verifying the
live runtime.

Read this document before any of the following:

- rebuilding OpenCode for use by OpenChamber;
- replacing `~/.openchamber/bin/opencode` before an OpenChamber package build;
- running an OpenChamber Electron packaging or release command;
- changing embedded OpenCode resolution, signing, upgrade, or notarization behavior;
- distributing a macOS OpenChamber build.

## Non-negotiable invariants

1. OpenChamber embeds the custom merged OpenCode build, not an official release substituted for convenience.
2. A custom OpenCode build intended to preserve the shared history database must use `OPENCODE_CHANNEL=latest`.
3. The OpenCode version string must identify the custom build with the `-sscity` suffix, for example `1.18.4-sscity`.
4. The notarized shell must contain a signed fallback at
   `OpenChamber.app/Contents/Resources/opencode/opencode` and a signed Bun
   engine at `OpenChamber.app/Contents/Resources/engine/bun`.
5. The fallback OpenCode, Bun engine, native modules, and containing app must be
   signed by the same signing identity and Team ID.
6. Never modify the app bundle after signing. Replacing OpenCode, metadata, `app.asar`, or any other bundled file invalidates the outer signature.
7. Daily OpenChamber and OpenCode source changes deploy through the external
   runtime. Never upgrade the fallback executable in place.
8. A new or changed Mach-O, native `.node`, `.dylib`, Electron version, Bun
   engine, entitlement, or shell loader requires a new notarized shell.

## Repository roles

- OpenCode source: `/Users/song/dev_ai/opencode`
- OpenChamber source: `/Users/song/dev_ai/openchamber-merge-v1.11.0`
- CLI OpenCode installation: `~/.opencode/bin/opencode`
- Default OpenChamber packaging staging source: `~/.openchamber/bin/opencode`
- Packaged OpenCode destination: `OpenChamber.app/Contents/Resources/opencode/opencode`
- Packaged Bun engine: `OpenChamber.app/Contents/Resources/engine/bun`
- Mutable runtime root: `~/Library/Application Support/OpenChamber/runtime`
- Shared OpenCode database for the `latest` channel: `~/.local/share/opencode/opencode.db`

OpenChamber's `packages/electron/scripts/after-pack.cjs` calls `embedded-opencode.cjs` during packaging. The hook copies the selected OpenCode binary into the app bundle, assigns executable permissions, signs it, verifies it, runs `--version`, and writes `Resources/opencode/metadata.json`. Electron Builder then performs the final recursive application signing pass.

The same hook stages and signs Bun through `embedded-bun.cjs`. The stable shell
uses that Bun executable to run the mutable OpenCode TypeScript source, while
the compiled OpenCode binary remains an offline recovery path.

OpenChamber's source version is `1.18.1-sscity` after the v1.18.0 + v1.18.1 migration audit and validation closed (Oracle review: SHIP, 7/7 PASS). Every Electron package appends its Asia/Shanghai build time and emits `1.18.1-sscity.YYYYMMDD-HHMMSS` (hyphen before time so early-morning `0HHMMSS` stays valid semver for electron-updater). This generated value is the package metadata and About-dialog version. Do not advance the baseline again until the migration table records the next upstream baseline as fully audited.

## 1. Build the custom OpenCode binary

Run from the OpenCode package directory:

```bash
cd /Users/song/dev_ai/opencode/packages/opencode
OPENCODE_CHANNEL=latest \
OPENCODE_VERSION=1.18.4-sscity \
bun run script/build.ts --single
```

The native Apple Silicon output is:

```text
/Users/song/dev_ai/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode
```

Why `OPENCODE_CHANNEL=latest` is mandatory:

- `latest`, `beta`, and `prod` use the shared `~/.local/share/opencode/opencode.db`.
- A branch-derived/custom channel uses `opencode-<channel>.db` and can make existing history appear to be missing.

Verify the build before staging it:

```bash
/Users/song/dev_ai/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode --version
```

The output must equal the intended custom version. Do not continue if it reports an official version or an unexpected channel-derived version.

Stage the verified custom binary for the default OpenChamber-only packaging path:

```bash
mkdir -p /Users/song/.openchamber/bin
cp /Users/song/dev_ai/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode \
  /Users/song/.openchamber/bin/opencode
chmod 755 /Users/song/.openchamber/bin/opencode
/Users/song/.openchamber/bin/opencode --version
```

This staging file is intentionally separate from the CLI installation at
`~/.opencode/bin/opencode`. Updating or packaging OpenChamber must not replace
the CLI binary.

Alternatively, leave both staging installations untouched and set this only for the packaging command:

```bash
export OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE=/absolute/path/to/opencode
```

## 2. Select the correct OpenChamber packaging mode

### Local app-only build

```bash
cd /Users/song/dev_ai/openchamber-merge-v1.11.0
bun run electron:build
```

This produces `packages/electron/dist/mac-arm64/OpenChamber.app`. The signing identity prefers the team `Developer ID Application` certificate so local QA shares the release Team ID; it falls back to `Apple Development` only when Developer ID is absent from the keychain (for example, a contributor machine). Keeping Team ID stable across rebuilds prevents macOS TCC prompts (microphone, folders, automation, iCloud) from resetting on every switch. Local `--dir` builds disable signing timestamps; they are intended for runtime QA only and are not evidence of notarization readiness.

This is the default mode when the user asks to build, install, replace, or open
OpenChamber on this Mac. Do not invoke the Developer ID release workflow or
submit a notarization job unless the user explicitly requests a distributable
artifact such as a DMG/ZIP or a build for an internal download site.

### Candidate safety and `/Applications` promotion (mandatory)

Packaging and QA must not terminate or overwrite the OpenChamber instance the
user is actively using.

1. Inspect the running executable path before building. Never send `TERM`,
   `KILL`, `pkill`, or `killall` to the active stable app or its managed
   OpenCode process merely to make a build or candidate launch succeed.
2. Never build into the app bundle that is currently executing. If the active
   executable is under `packages/electron/dist`, use a unique Electron Builder
   output directory instead of the default `dist` directory.
3. While the stable app remains open, verify the candidate's web assets on a
   separate port with Playwright and run static packaged checks (`codesign`,
   embedded OpenCode version, and Gatekeeper where applicable). Do not treat a
   successful build as functional verification.
4. Packaged OpenChamber currently enforces a single-instance lock. When final
   desktop-shell smoke testing is required, wait for the user to quit the
   stable app voluntarily. Do not close it on the user's behalf. Launch the
   candidate directly from its isolated build directory and complete the
   requested runtime checks there.
5. Only after candidate QA passes may it be promoted to `/Applications`.
   Stage it as a separate `OpenChamber.next.app`, verify that staged bundle,
   then swap it into place while no OpenChamber process is running. Keep the
   previous bundle until the newly installed app has passed a post-install
   smoke test.
6. If candidate or post-install verification fails, leave or restore the
   previous `/Applications/OpenChamber.app` and report the failure explicitly.

The existing `electron:install` command removes `/Applications/OpenChamber.app`
before copying. Do not run it as an initial build or QA command, and do not run
it while the stable app is open. Installation is the final promotion step, not
part of candidate discovery.

### Developer ID release build

First verify that the release identity is installed and usable:

```bash
security find-identity -p codesigning -v
node packages/electron/scripts/electron-builder-local-sign.mjs --check-release-signing
```

The preflight must select a `Developer ID Application:` identity. The currently configured certificate is:

```text
Developer ID Application: Shanghai Chengcheng Software Technology Co., Ltd. (MB4JP6WR3G)
```

Its current expiry date is 2027-02-01. Always re-check validity at build time instead of trusting this recorded date.

Run the release packaging workflow only after notarization credentials are available to Electron Builder:

```bash
cd /Users/song/dev_ai/openchamber-merge-v1.11.0/packages/electron
bun run package
```

Do not disable timestamps for a release build. Do not use `Apple Development`, ad-hoc signing, or a local trust rule as a replacement for Developer ID signing and notarization.

### Stable shell and runtime-only releases

The packaged app entrypoint is `dist-bundle/shell.mjs`. It is intentionally
small and must remain stable. It verifies
`~/Library/Application Support/OpenChamber/runtime/current/runtime-manifest.json`
and loads the selected runtime. Missing, incompatible, or corrupted runtimes
fall back to the runtime sealed into `app.asar`.

For normal OpenChamber UI/server/preload changes and OpenCode TypeScript
changes, build and activate only a runtime:

```bash
cd /Users/song/dev_ai/openchamber-merge-v1.11.0
bun run electron:runtime:install
```

This command builds an isolated local candidate, extracts its JavaScript
runtime, validates the OpenCode source launcher, checks the server import, and
atomically switches `runtime/current`. It does not replace or modify
`/Applications/OpenChamber.app`.

The runtime's OpenCode source root defaults to the current fork sibling
`../opencode-v2` (logged as `default(opencode-v2)`); override with
`OPENCHAMBER_OPENCODE_SOURCE_ROOT` when staging a different fork. The build log
always prints the resolved source and its origin — read it before treating the
runtime as activated. A bare run must never resolve to the v1 sibling
`../opencode`: doing so once (2026-10-03) packaged the v1 source and displaced
an activated v2 runtime.

The runtime builder first verifies every unpacked Mach-O signature, then
compares it with the installed notarized shell by CodeDirectory hash. If a
native executable changed or its signature is invalid, the runtime build must
fail. Rebuild and notarize the shell instead of weakening that check.

Rollback is also atomic:

```bash
bun run electron:runtime:rollback
```

The running process resolves `current` to one immutable version directory.
Activating another runtime therefore takes effect on the next OpenChamber
launch and cannot mutate a currently executing runtime.

## 3. Runtime authority

The embedded fallback and the external runtime launcher both set
`OPENCHAMBER_BUNDLED_OPENCODE_BINARY` before importing the web server. This
policy-controlled path takes precedence over a persisted
`settings.opencodeBinary` value such as `~/.opencode/bin/opencode`.

For an external runtime, the resolved path ends in
`runtime/versions/<runtime-id>/opencode/opencode`. That launcher `exec`s the
signed Bun engine from `OpenChamber.app/Contents/Resources/engine/bun` and
imports `/Users/song/dev_ai/opencode/packages/opencode/src/index.ts`.
`OPENCODE_CHANNEL=latest` preserves the shared database.

The troubleshooting-only escape hatch is:

```bash
OPENCHAMBER_USE_EXTERNAL_OPENCODE=true
```

Do not enable it in normal packaged builds or release artifacts.

`POST /api/opencode/upgrade` intentionally returns HTTP 409 when the active source is `bundled`. This protects the signed bundle. Treat this as expected policy, not a bug to bypass.

## 4. Static signature verification

Set paths for the produced app and embedded binary:

```bash
APP=/Users/song/dev_ai/openchamber-merge-v1.11.0/packages/electron/dist/mac-arm64/OpenChamber.app
BIN="$APP/Contents/Resources/opencode/opencode"
```

Verify the nested binary identity:

```bash
codesign -dvvv "$BIN" 2>&1
codesign -dr - "$BIN" 2>&1
```

Expected properties:

- stable executable identifier `opencode`;
- a non-empty Team ID matching the containing app;
- `Apple Development` only for local builds;
- `Developer ID Application` for release builds.

Electron Builder normalizes the bare Mach-O identifier to its executable basename, `opencode`, during its final recursive signing pass. Do not require a different identifier unless the complete final signing pipeline is intentionally redesigned and reverified.

Verify the complete bundle:

```bash
codesign --verify --deep --strict --verbose=4 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
test -f "$APP/Contents/Resources/legal/OpenChamber-LICENSE.txt"
test -f "$APP/Contents/Resources/legal/THIRD-PARTY-NOTICES.md"
```

These commands answer different questions:

- `codesign --verify` proves that signatures and sealed resources are internally valid.
- `spctl --assess` proves that current Gatekeeper policy accepts the artifact.

A successful build or successful `codesign --verify` does not replace Gatekeeper verification. A local Apple Development build may verify on disk while Gatekeeper still rejects it.

For notarized release artifacts, also run the appropriate stapler/notary validation against the final distributed app, DMG, or ZIP.

## 5. Live runtime verification

Static signatures are insufficient. Start the packaged app and verify the actual managed process.

Check health and resolution:

```bash
curl --noproxy '*' -sS http://127.0.0.1:57123/health
curl --noproxy '*' -sS http://127.0.0.1:57123/api/config/opencode-resolution
```

Required runtime evidence for the stable-shell architecture:

- `isOpenCodeReady` is `true`;
- `opencodeBinarySource` or resolution `source` is `bundled`;
- resolved and launch paths end in
  `runtime/versions/<runtime-id>/opencode/opencode`;
- the live process command starts with
  `OpenChamber.app/Contents/Resources/engine/bun` and includes
  `opencode/bootstrap.mjs`;
- `runtime/current` resolves to the manifest version reported during build.

If OpenChamber reused a previously preserved managed process and the health snapshot has empty resolution fields, trigger the normal configuration reload, wait for readiness, and check again:

```bash
curl --noproxy '*' -sS -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:57123/api/config/reload
```

Confirm process ownership and path:

```bash
ps -axo pid,ppid,command | \
  rg 'OpenChamber.app/Contents/MacOS/OpenChamber|OpenChamber.app/Contents/Resources/engine/bun'
```

Verify the protected iCloud workspace through the real API:

```bash
curl --noproxy '*' -sS -o /dev/null -w 'path=%{http_code}\n' -G \
  --data-urlencode 'directory=/Users/song/Library/Mobile Documents/com~apple~CloudDocs/ops' \
  http://127.0.0.1:57123/api/path

curl --noproxy '*' -sS -o /dev/null -w 'session=%{http_code}\n' -G \
  --data-urlencode 'directory=/Users/song/Library/Mobile Documents/com~apple~CloudDocs/ops' \
  --data-urlencode 'limit=1' \
  http://127.0.0.1:57123/api/session
```

Both must return HTTP 200. A 500 with `EPERM: operation not permitted, lstat .../Mobile Documents/...` means the runtime is not benefiting from the intended stable application signing/authorization chain.

Verify the OpenChamber plugin after the runtime settles:

```bash
curl --noproxy '*' -sS http://127.0.0.1:57123/api/openchamber/plugin-status
```

## 6. Required validation before handoff

From the OpenChamber root:

```bash
bun run type-check
bun run lint
```

Run focused tests for the embedded packaging and resolution policy:

```bash
bunx vitest run \
  packages/web/server/lib/opencode/env-runtime.test.js \
  packages/electron/scripts/embedded-opencode.test.js

bun test \
  packages/web/server/lib/opencode/routes.test.js \
  packages/web/server/lib/opencode/opencode-upgrade-runtime.test.js
```

The handoff must report separately:

1. custom OpenCode build/version status;
2. OpenChamber package build status;
3. nested and outer signature status;
4. notarization and Gatekeeper status;
5. live shell/runtime/OpenCode engine status;
6. protected-directory API status;
7. plugin status.

Never collapse these into a single statement such as “the build passed.”

## 7. Common failure modes

- **History appears empty:** the custom binary was built with a branch-derived channel instead of `latest`.
- **Official OpenCode replaces the custom build:** the packaging source was not verified before embedding.
- **Authorization keeps returning:** the installed shell is not notarized, or a
  new native executable bypassed the runtime CodeDirectory gate.
- **Bundle signature becomes invalid:** a nested file was modified after the app was signed.
- **Gatekeeper rejects an otherwise valid app:** the build used Apple Development or was not notarized; inspect the exact signing identity and notarization result.
- **Upgrade endpoint returns 409:** expected for bundled OpenCode; rebuild and re-sign instead of bypassing the guard.
- **Health reports a preserved process but no resolution:** query the resolution endpoint or perform a controlled configuration reload, then verify the new launch path.
- **Runtime build reports a native mismatch:** dependency or engine native code
  changed. Refresh and notarize the stable shell; do not copy the candidate
  native binary into the active runtime.
