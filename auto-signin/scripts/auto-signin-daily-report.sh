#!/usr/bin/env bash
set -u
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1

# Reuse the installed browser instead of a version-specific Playwright cache.
export AUTO_SIGNIN_BROWSER_PATH="${AUTO_SIGNIN_BROWSER_PATH:-/usr/bin/chromium}"

# Arguments select the single-platform CLI; no arguments retain daily reporting.
# All real platforms use headed execution. Help needs no display.
NEEDS_DISPLAY=1
if [[ $# == 1 && "$1" == --help ]]; then
  NEEDS_DISPLAY=0
fi

# Provide an authenticated virtual display for headed Chromium if needed.
XVFB_PID=""
XVFB_BIN="${AUTO_SIGNIN_XVFB_PATH:-/usr/bin/Xvfb}"
if [[ ! -x "$XVFB_BIN" && -z "${AUTO_SIGNIN_XVFB_PATH:-}" ]]; then
  XVFB_BIN=/opt/data/shared/xvfb/usr/bin/Xvfb
fi
if [[ "$NEEDS_DISPLAY" == 1 && -z "${DISPLAY:-}" && ! -x "$XVFB_BIN" ]]; then
  printf 'Error: Xvfb is required for headed Chromium but was not found: %s\n' "$XVFB_BIN" >&2
  exit 1
fi
if [[ "$NEEDS_DISPLAY" == 1 && -z "${DISPLAY:-}" ]]; then
  if ! command -v xauth >/dev/null || ! command -v xdpyinfo >/dev/null; then
    printf 'Error: xauth and xdpyinfo are required for a secure virtual display\n' >&2
    exit 1
  fi
  XVFB_DIR=$(mktemp -d "${TMPDIR:-/tmp}/auto-signin-xvfb.XXXXXXXX") || exit 1
  cleanup() {
    if [[ -n "$XVFB_PID" ]]; then
      kill "$XVFB_PID" 2>/dev/null || true
      wait "$XVFB_PID" 2>/dev/null || true
    fi
    rm -rf -- "$XVFB_DIR"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export XAUTHORITY="$XVFB_DIR/Xauthority"
  touch "$XAUTHORITY" || exit 1
  unset COOKIE
  COOKIE=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  if [[ ! "$COOKIE" =~ ^[[:xdigit:]]{32}$ ]] || ! printf 'add :0 MIT-MAGIC-COOKIE-1 %s\n' "$COOKIE" | xauth -q -f "$XAUTHORITY"; then
    printf 'Error: unable to create Xvfb authorization\n' >&2
    exit 1
  fi
  mkfifo "$XVFB_DIR/display" || exit 1
  exec 3<>"$XVFB_DIR/display"
  "$XVFB_BIN" -displayfd 3 -screen 0 1280x900x24 -nolisten tcp -auth "$XAUTHORITY" 3>"$XVFB_DIR/display" >"$XVFB_DIR/xvfb.log" 2>&1 &
  XVFB_PID=$!
  if ! read -r -t 10 DISPLAY_NUMBER <&3 || [[ ! "$DISPLAY_NUMBER" =~ ^[0-9]+$ ]]; then
    printf 'Error: Xvfb failed to start or report a display\n' >&2
    cat "$XVFB_DIR/xvfb.log" >&2
    exit 1
  fi
  exec 3>&-
  export DISPLAY=":$DISPLAY_NUMBER"
  if ! printf 'add %s MIT-MAGIC-COOKIE-1 %s\n' "$DISPLAY" "$COOKIE" | xauth -q -f "$XAUTHORITY" || ! xdpyinfo >/dev/null 2>&1; then
    printf 'Error: Xvfb display %s is not ready\n' "$DISPLAY" >&2
    exit 1
  fi
  unset COOKIE
fi

if [[ $# -gt 0 ]]; then
  node "$SCRIPT_DIR/run-one.mjs" "$@"
else
  node "$SCRIPT_DIR/run-all.mjs"
fi
