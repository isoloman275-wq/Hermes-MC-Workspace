#!/usr/bin/env bash
# Standalone Mission Control launcher (manual use or non-systemd fallback).
# Idempotent: if port 8777 is already bound, do nothing.
set -euo pipefail
PORT=8777
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
LOG="$DIR/mc.log"
ENVFILE="$HOME/.hermes/.env"

if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "[$(date)] MC already listening on :$PORT - skipping" >>"$LOG"
  exit 0
fi

if [ -f "$ENVFILE" ]; then
  set -a; . "$ENVFILE"; set +a
fi

cd "$DIR"
echo "[$(date)] start-mc.sh launching mission-control" >>"$LOG"
exec nohup "$PY" server.py >>"$LOG" 2>&1
