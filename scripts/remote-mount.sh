#!/usr/bin/env bash
# Mount a remote host's filesystem into the OpenChamber local namespace.
# Usage: ./scripts/remote-mount.sh <ssh-host-label> [mount-root]
#   ssh-host-label : Host alias from ~/.ssh/config (same label VS Code Remote-SSH uses)
#   mount-root     : optional, defaults to ~/.openchamber/remote
#
# The mount powers the OpenChamber "local engine, remote files" mode:
# ~/.openchamber/remote/<label>/  ->  <label>'s filesystem over SFTP (rclone)
set -euo pipefail

LABEL="${1:?usage: remote-mount.sh <ssh-host-label> [mount-root]}"
ROOT="${2:-$HOME/.openchamber/remote}"
MOUNTPOINT="$ROOT/$LABEL"

if ! LABEL_RE='^[A-Za-z0-9._-]+$' && [[ ! "$LABEL" =~ $LABEL_RE ]]; then
  echo "invalid label: $LABEL" >&2
  exit 1
fi

if mount | grep -q " on $MOUNTPOINT ("; then
  echo "already mounted: $MOUNTPOINT"
  exit 0
fi

if [ ! -d /Library/Filesystems/FUSE-T.fs ] && [ ! -d /Library/Filesystems/macfuse.fs ]; then
  echo "missing FUSE. Install once:" >&2
  echo "  brew install --cask fuse-t" >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "missing rclone. Install once:" >&2
  echo "  brew install rclone" >&2
  exit 1
fi

# Resolve the ssh-config alias into concrete connection parameters.
SSHDUMP="$(ssh -G "$LABEL")"
pick() { grep -m1 "^$1 " <<<"$SSHDUMP" | cut -d' ' -f2- | tr -d '\r'; }
HOSTNAME="$(pick hostname)"
[ -n "$HOSTNAME" ] || { echo "ssh -G $LABEL returned no hostname" >&2; exit 1; }
USER_NAME="$(pick user)"
PORT="$(pick port)"
IDENTITY="$(pick identityfile)"

PARTS=("host=$HOSTNAME")
[ -n "$USER_NAME" ] && PARTS+=("user=$USER_NAME")
[ -n "$PORT" ] && [ "$PORT" != "22" ] && PARTS+=("port=$PORT")
[ -n "$IDENTITY" ] && [ "$IDENTITY" != "none" ] && [[ "$IDENTITY" != ~* ]] && [ -f "$IDENTITY" ] && PARTS+=("key_file=$IDENTITY")

REMOTE=":sftp,$(IFS=,; echo "${PARTS[*]}"):"

mkdir -p "$MOUNTPOINT"
echo "mounting $REMOTE -> $MOUNTPOINT"
rclone mount "$REMOTE" "$MOUNTPOINT" \
  --daemon \
  --vfs-cache-mode writes \
  --dir-cache-time 10s \
  --sftp-idle-timeout 0

for _ in $(seq 1 20); do
  if mount | grep -q " on $MOUNTPOINT ("; then
    echo "mounted: $MOUNTPOINT"
    exit 0
  fi
  sleep 0.5
done
echo "mount did not come up; inspect with: rclone ls \"$REMOTE\"" >&2
exit 1
