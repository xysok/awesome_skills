#!/usr/bin/env bash
set -u

exec bash "$(dirname "${BASH_SOURCE[0]}")/auto-signin-daily-report.sh" "$@"
