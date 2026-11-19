---
name: auto-signin
description: Verify or perform authorized daily website check-ins using saved sessions.
version: 0.4.1
author: 轩哥, Hermes Agent
license: MIT
required_commands: [node, npm]
---

# Auto Sign-in

Use for authorized CordCloud, 京东, 淘宝, and WPS daily check-ins. The production wrapper only reuses existing sessions; it does not read credentials, start a password login, or send verification codes. Do not bypass CAPTCHA, access controls, or authorization. A request to check status does not authorize a sign-in.

## Setup and preflight

Use the actual installed skill directory as the working directory. Require Node.js 20+, npm, and a working system Chromium. If project dependencies are missing, restore the pinned packages from `package-lock.json` with `npm ci --ignore-scripts --no-audit --no-fund` when authorized. Do not download another browser merely to populate the Playwright cache. Run `npm run check` and verify the wrapper's `--help` before a real run.

The wrapper uses headed Chromium (`AUTO_SIGNIN_BROWSER_PATH`, default `/usr/bin/chromium`). Without a display it uses an isolated, authenticated Xvfb; `AUTO_SIGNIN_XVFB_PATH` can select the installed executable. Xvfb alone is not a private, user-visible login surface. Do not launch a real platform if these prerequisites are missing.

## Usage

- Read-only: `bash scripts/auto-signin-daily-report.sh --platform jd --probe`.
- One platform: `bash scripts/auto-signin-daily-report.sh --platform jd`.
- Four platforms, only when authorized: `bash scripts/auto-signin-daily-report.sh`.
- Valid platform IDs: `cordcloud`, `jd`, `taobao`, `wps`.
- A single-platform invocation accepts `--state-dir <path>`. Batch can use `AUTO_SIGNIN_STATE_DIR`. Otherwise use `$XDG_STATE_HOME/auto-signin` or `~/.local/state/auto-signin`. Do not relocate or copy session secrets without explicit authorization and a supported secure path.

## Evidence and authentication

- `success` requires positive new evidence after a single click; `already_done` means a repeat click was skipped. Only report demonstrably current-day structured rewards. If absent, say “奖励未捕获”; do not infer from balances, task text, or yesterday’s records.
- `--probe` does not click or write back state. `valid` means logged in, not necessarily signed in; read `checkin` separately. No positive evidence is “未核实”, not proof of no check-in.
- `session_missing` and `session_expired` mean “需要登录”, not success. Use a supported official interactive login only when authorized. Do not forward passwords or verification codes through chat or terminal. Use protected browser vault input or official app approval. The managed browser and runner have separate sessions; a successful login in one does not prove the other can reuse it. Do not export cookies between them.
- A process exit alone does not verify a check-in. Report platform name, status, and independently observed reward or blocker. Keep run IDs/expiry only when actually returned. Preserve site-specific evidence and exact origin checks in the adapters.

## Release and verification

Publish the production allowlist in `xysok/awesome_skills/auto-signin` only after testing it in the development checkout. Do not include tests, diagnostics, dependency trees, credentials, or session state in the installable subtree. Use the official Hermes installer or updater with security scanning enabled. Confirm the installed files match the upstream commit, dependencies resolve, `npm run check` passes, and the wrapper and a local-fixture smoke test work from the installed copy. Offline verification does not establish live or cross-day reuse.
