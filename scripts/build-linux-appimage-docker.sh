#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCODE_ROOT="${OPENCHAMBER_OPENCODE_SOURCE_ROOT:-$ROOT_DIR/../opencode}"
BUILDER_IMAGE="${OPENCHAMBER_LINUX_ELECTRON_IMAGE:-openchamber-linux-electron-builder:bun-1.3.14-v3}"
WORKSPACE_VOLUME="${OPENCHAMBER_LINUX_ELECTRON_VOLUME:-openchamber-linux-electron-workspace}"
OPENCODE_VOLUME="${OPENCHAMBER_LINUX_OPENCODE_VOLUME:-openchamber-linux-opencode-workspace}"
BUN_CACHE_DIR="${OPENCHAMBER_LINUX_BUN_CACHE:-$HOME/.cache/openchamber/bun-linux-cache}"
OUT_DIR="${OPENCHAMBER_LINUX_APPIMAGE_OUT_DIR:-$ROOT_DIR/artifacts/linux-appimage}"

if [[ ! -f "$OPENCODE_ROOT/packages/opencode/package.json" ]]; then
  echo "Custom OpenCode source not found: $OPENCODE_ROOT" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  exit 1
fi

if ! docker image inspect "$BUILDER_IMAGE" >/dev/null 2>&1; then
  docker build \
    --platform linux/amd64 \
    -t "$BUILDER_IMAGE" \
    -f "$ROOT_DIR/scripts/docker/linux-electron-builder.Dockerfile" \
    "$ROOT_DIR"
fi

mkdir -p "$BUN_CACHE_DIR" "$OUT_DIR"
docker volume inspect "$WORKSPACE_VOLUME" >/dev/null 2>&1 || docker volume create "$WORKSPACE_VOLUME" >/dev/null
docker volume inspect "$OPENCODE_VOLUME" >/dev/null 2>&1 || docker volume create "$OPENCODE_VOLUME" >/dev/null

docker run --rm \
  -v "$ROOT_DIR":/src:ro \
  -v "$OPENCODE_ROOT":/opencode-src:ro \
  -v "$WORKSPACE_VOLUME":/work \
  -v "$OPENCODE_VOLUME":/opencode-work \
  -v "$BUN_CACHE_DIR":/root/.bun \
  -v "$OUT_DIR":/out \
  -w /work \
  "$BUILDER_IMAGE" \
  bash -lc 'set -euo pipefail
    preserve_openchamber=/tmp/openchamber-preserve
    preserve_opencode=/tmp/opencode-preserve
    rm -rf "$preserve_openchamber" "$preserve_opencode"
    mkdir -p "$preserve_openchamber" "$preserve_opencode"

    if [ -d /work/node_modules ]; then
      mv /work/node_modules "$preserve_openchamber/node_modules"
    fi
    find /work -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -C /src \
      --exclude .git \
      --exclude .DS_Store \
      --exclude node_modules \
      --exclude "packages/*/node_modules" \
      --exclude "./artifacts" \
      --exclude "packages/electron/dist" \
      --exclude "packages/electron/.cache" \
      -cf - . | tar -C /work -xf -
    if [ -d "$preserve_openchamber/node_modules" ]; then
      mv "$preserve_openchamber/node_modules" /work/node_modules
    fi

    if [ -d /opencode-work/node_modules ]; then
      mv /opencode-work/node_modules "$preserve_opencode/node_modules"
    fi
    find /opencode-work -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -C /opencode-src \
      --exclude .git \
      --exclude .DS_Store \
      --exclude node_modules \
      --exclude "packages/*/node_modules" \
      --exclude "packages/opencode/dist" \
      -cf - . | tar -C /opencode-work -xf -
    if [ -d "$preserve_opencode/node_modules" ]; then
      mv "$preserve_opencode/node_modules" /opencode-work/node_modules
    fi

    cd /opencode-work
    bun install --frozen-lockfile --network-concurrency 8 --concurrent-scripts 2
    opencode_version="$(bun -e "console.log(require(\"./packages/opencode/package.json\").version)")"
    case "$opencode_version" in
      *-sscity) ;;
      *) echo "Refusing non-sscity OpenCode source version: $opencode_version" >&2; exit 1 ;;
    esac
    OPENCODE_CHANNEL=latest \
      OPENCODE_VERSION="$opencode_version" \
      bun run packages/opencode/script/build.ts --single --skip-embed-web-ui
    custom_opencode=/opencode-work/packages/opencode/dist/opencode-linux-x64/bin/opencode
    custom_version="$("$custom_opencode" --version)"
    case "$custom_version" in
      *-sscity) ;;
      *) echo "Refusing non-sscity OpenCode build: $custom_version" >&2; exit 1 ;;
    esac

    cd /work
    bun install --frozen-lockfile --network-concurrency 8 --concurrent-scripts 2
    rm -rf packages/electron/dist /out/*
    OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE="$custom_opencode" \
      NODE_OPTIONS=--max-old-space-size=6144 \
      bun run --cwd packages/electron package:linux
    appimage="$(find packages/electron/dist -maxdepth 1 -type f -name "*.AppImage" -print -quit)"
    if [ -z "$appimage" ]; then
      echo "Electron packaging did not produce an AppImage." >&2
      exit 1
    fi
    OPENCHAMBER_TARGET_ARCH=x64 node packages/electron/scripts/verify-linux-appimage.mjs "$appimage"
    OPENCHAMBER_LINUX_UNPACKED_ROOT=packages/electron/dist/linux-unpacked \
      node packages/electron/scripts/smoke-linux-appimage-ui.mjs "$appimage" /out/openchamber-linux-ui.png
    cp packages/electron/dist/*.AppImage /out/
    find packages/electron/dist -maxdepth 1 -type f \( -name "latest-linux*.yml" -o -name "*.blockmap" \) -exec cp {} /out/ \;

    updater_e2e_root=/tmp/openchamber-linux-updater-e2e
    rm -rf "$updater_e2e_root"
    mkdir -p "$updater_e2e_root"
    OPENCHAMBER_UPDATER_E2E_BUILD=1 bun run --cwd packages/electron bundle:main

    rm -rf packages/electron/dist
    cd packages/electron
    OPENCHAMBER_BUILD_VERSION=1.16.0-sscity.e2e.1 \
      OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE="$custom_opencode" \
      node ./scripts/electron-builder-local-sign.mjs --linux AppImage --publish never
    old_appimage="$(find dist -maxdepth 1 -type f -name "*.AppImage" -print -quit)"
    if [ -z "$old_appimage" ]; then
      echo "Updater E2E did not produce the old AppImage." >&2
      exit 1
    fi
    cp "$old_appimage" "$updater_e2e_root/old.AppImage"
    cp -a dist/linux-unpacked "$updater_e2e_root/old-unpacked"

    rm -rf dist
    OPENCHAMBER_BUILD_VERSION=1.17.0-sscity.e2e.2 \
      OPENCHAMBER_EMBEDDED_OPENCODE_SOURCE="$custom_opencode" \
      node ./scripts/electron-builder-local-sign.mjs --linux AppImage --publish never
    target_appimage="$(find dist -maxdepth 1 -type f -name "*.AppImage" -print -quit)"
    if [ -z "$target_appimage" ] || [ ! -f dist/latest-linux.yml ]; then
      echo "Updater E2E did not produce the target AppImage and manifest." >&2
      exit 1
    fi
    cd /work
    node packages/electron/scripts/smoke-linux-appimage-update.mjs \
      "$updater_e2e_root/old.AppImage" \
      "$updater_e2e_root/old-unpacked" \
      "packages/electron/$target_appimage" \
      packages/electron/dist/latest-linux.yml

    file /out/*.AppImage
    ls -lh /out
  '
