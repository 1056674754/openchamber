# Embedded OpenCode Packaging and Signing Runbook

This document is the source of truth for building the custom OpenCode binary that OpenChamber embeds, packaging the Electron app, signing both code layers, notarizing release artifacts, and verifying the live runtime.

Read this document before any of the following:

- rebuilding OpenCode for use by OpenChamber;
- replacing `~/.opencode/bin/opencode` before an OpenChamber package build;
- running an OpenChamber Electron packaging or release command;
- changing embedded OpenCode resolution, signing, upgrade, or notarization behavior;
- distributing a macOS OpenChamber build.

## Non-negotiable invariants

1. OpenChamber embeds the custom merged OpenCode build, not an official release substituted for convenience.
2. A custom OpenCode build intended to preserve the shared history database must use `OPENCODE_CHANNEL=latest`.
3. The OpenCode version string must identify the custom build, for example `1.17.18-my`.
4. The macOS packaged runtime must use `OpenChamber.app/Contents/Resources/opencode/opencode`, not the external ad-hoc binary under `~/.opencode/bin`.
5. The nested OpenCode executable and the containing app must be signed by the same signing identity and Team ID.
6. Never modify the app bundle after signing. Replacing OpenCode, metadata, `app.asar`, or any other bundled file invalidates the outer signature.
7. Never upgrade bundled OpenCode in place. Rebuild OpenCode, rebuild OpenChamber, then sign and notarize the new app.

## Repository roles

- OpenCode source: `/Users/song/dev_ai/opencode`
- OpenChamber source: `/Users/song/dev_ai/openchamber-merge-v1.11.0`
- Default custom OpenCode staging source: `~/.opencode/bin/opencode`
- Packaged OpenCode destination: `OpenChamber.app/Contents/Resources/opencode/opencode`
- Shared OpenCode database for the `latest` channel: `~/.local/share/opencode/opencode.db`

OpenChamber's `packages/electron/scripts/after-pack.cjs` calls `embedded-opencode.cjs` during packaging. The hook copies the selected OpenCode binary into the app bundle, assigns executable permissions, signs it, verifies it, runs `--version`, and writes `Resources/opencode/metadata.json`. Electron Builder then performs the final recursive application signing pass.

## 1. Build the custom OpenCode binary

Run from the OpenCode package directory:

```bash
cd /Users/song/dev_ai/opencode/packages/opencode
OPENCODE_CHANNEL=latest \
OPENCODE_VERSION=1.17.18-my \
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

Stage the verified custom binary for the default OpenChamber packaging path:

```bash
cp /Users/song/dev_ai/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode \
  /Users/song/.opencode/bin/opencode
chmod 755 /Users/song/.opencode/bin/opencode
/Users/song/.opencode/bin/opencode --version
```

Alternatively, leave the external binary untouched and set this only for the packaging command:

```bash
export OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE=/absolute/path/to/opencode
```

## 2. Select the correct OpenChamber packaging mode

### Local app-only build

```bash
cd /Users/song/dev_ai/openchamber-merge-v1.11.0
bun run electron:build
```

This produces `packages/electron/dist/mac-arm64/OpenChamber.app` and uses an `Apple Development` identity when available. It is intended for local runtime QA only. It is not evidence of Developer ID distribution readiness or notarization.

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

## 3. Embedded runtime authority

Packaged desktop builds set `OPENCHAMBER_BUNDLED_OPENCODE_BINARY` before importing the web server. A valid embedded binary takes precedence over a persisted `settings.opencodeBinary` value such as `~/.opencode/bin/opencode`.

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

Required runtime evidence:

- `isOpenCodeReady` is `true`;
- `opencodeBinarySource` or resolution `source` is `bundled`;
- resolved and launch paths end in `OpenChamber.app/Contents/Resources/opencode/opencode`;
- launch diagnostics identify the embedded binary.

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
  rg 'OpenChamber.app/Contents/MacOS/OpenChamber|OpenChamber.app/Contents/Resources/opencode/opencode serve'
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
5. live embedded runtime status;
6. protected-directory API status;
7. plugin status.

Never collapse these into a single statement such as “the build passed.”

## 7. Common failure modes

- **History appears empty:** the custom binary was built with a branch-derived channel instead of `latest`.
- **Official OpenCode replaces the custom build:** the packaging source was not verified before embedding.
- **Authorization keeps returning:** OpenCode was launched from an external ad-hoc binary whose code identity changes on rebuild.
- **Bundle signature becomes invalid:** a nested file was modified after the app was signed.
- **Gatekeeper rejects an otherwise valid app:** the build used Apple Development or was not notarized; inspect the exact signing identity and notarization result.
- **Upgrade endpoint returns 409:** expected for bundled OpenCode; rebuild and re-sign instead of bypassing the guard.
- **Health reports a preserved process but no resolution:** query the resolution endpoint or perform a controlled configuration reload, then verify the new launch path.
