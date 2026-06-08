#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILDER_IMAGE="${OPENCHAMBER_LINUX_BUILDER_IMAGE:-openchamber-linux-builder:bun-1.3.14}"
WORKSPACE_VOLUME="${OPENCHAMBER_LINUX_BUILD_VOLUME:-openchamber-linux-build-workspace}"
BUN_CACHE_DIR="${OPENCHAMBER_LINUX_BUN_CACHE:-$HOME/.cache/openchamber/bun-linux-cache}"
OUT_DIR="${OPENCHAMBER_LINUX_OUT_DIR:-$ROOT_DIR/artifacts/linux-docker}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  exit 1
fi

if ! docker image inspect "$BUILDER_IMAGE" >/dev/null 2>&1; then
  docker build \
    --platform linux/amd64 \
    -t "$BUILDER_IMAGE" \
    -f "$ROOT_DIR/scripts/docker/linux-builder.Dockerfile" \
    "$ROOT_DIR"
fi

mkdir -p "$BUN_CACHE_DIR" "$OUT_DIR"

if ! docker volume inspect "$WORKSPACE_VOLUME" >/dev/null 2>&1; then
  docker volume create "$WORKSPACE_VOLUME" >/dev/null
fi

bun run --cwd "$ROOT_DIR/packages/ui" build
bun run --cwd "$ROOT_DIR/packages/web" build
bun run "$ROOT_DIR/scripts/embed-assets.mjs"

docker run --rm --platform linux/amd64 \
  -v "$ROOT_DIR":/src:ro \
  -v "$WORKSPACE_VOLUME":/work \
  -v "$BUN_CACHE_DIR":/root/.bun \
  -v "$OUT_DIR":/out \
  -w /work \
  "$BUILDER_IMAGE" \
  bash -lc 'set -euo pipefail
    mkdir -p /work
    preserve_dir=/tmp/openchamber-preserve
    rm -rf "$preserve_dir"
    mkdir -p "$preserve_dir"
    if [ -d /work/node_modules ]; then
      mv /work/node_modules "$preserve_dir/node_modules"
    fi
    find /work -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -C /src \
      --exclude .git \
      --exclude .DS_Store \
      --exclude node_modules \
      --exclude "packages/*/node_modules" \
      --exclude artifacts \
      --exclude openchamber-linux \
      --exclude ".*.bun-build" \
      -cf - . | tar -C /work -xf -
    if [ -d "$preserve_dir/node_modules" ]; then
      rm -rf /work/node_modules
      mv "$preserve_dir/node_modules" /work/node_modules
    fi
    bun install --no-save --filter @openchamber/web --filter @openchamber/ui --network-concurrency 8 --concurrent-scripts 2
    rm -f /tmp/openchamber-linux /out/openchamber-linux
    bun build --compile packages/web/bin/cli-standalone.mjs --outfile /tmp/openchamber-linux --target bun-linux-x64
    cp /tmp/openchamber-linux /out/openchamber-linux
    chmod +x /out/openchamber-linux
    file /out/openchamber-linux
    ls -lh /out/openchamber-linux
  '

file "$OUT_DIR/openchamber-linux"
ls -lh "$OUT_DIR/openchamber-linux"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUT_DIR/openchamber-linux"
else
  shasum -a 256 "$OUT_DIR/openchamber-linux"
fi
