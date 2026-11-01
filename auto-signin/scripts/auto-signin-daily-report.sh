#!/usr/bin/env bash
set -u

# Reuse the installed browser instead of a version-specific Playwright cache.
export AUTO_SIGNIN_BROWSER_PATH="${AUTO_SIGNIN_BROWSER_PATH:-/usr/bin/chromium}"

# CordCloud requires headed Chromium; provide a virtual display if needed.
XVFB_PID=""
XVFB_BIN="${AUTO_SIGNIN_XVFB_PATH:-/usr/bin/Xvfb}"
if [[ ! -x "$XVFB_BIN" && -z "${AUTO_SIGNIN_XVFB_PATH:-}" ]]; then
  XVFB_BIN=/opt/data/shared/xvfb/usr/bin/Xvfb
fi
if [[ -z "${DISPLAY:-}" && -x "$XVFB_BIN" ]]; then
  export DISPLAY="${AUTO_SIGNIN_DISPLAY:-:99}"
  "$XVFB_BIN" "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp -ac >/opt/data/cache/scratch/auto-signin-xvfb.log 2>&1 &
  XVFB_PID=$!
  cleanup() {
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  }
  trap cleanup EXIT
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/run-all.mjs"
