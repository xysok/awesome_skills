# auto-signin

A Hermes skill and Playwright runner for evidence-verified website sign-ins.

## What is included

- `SKILL.md`: agent operating procedure.
- `scripts/auto-signin.mjs`: check, probe, run, and resume CLI.

- `scripts/lib/`: schema, page actions, state machine, retry, state storage, and CLI helpers.
- `platforms/`: declarative website adapters.


## Local verification

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run check
bash scripts/auto-signin-daily-report.sh --help
```

Run `bash scripts/auto-signin-daily-report.sh --platform jd` for one platform or omit arguments for all platforms. Both entries only reuse saved sessions. Missing or expired sessions require explicit interactive login; these entries do not submit credentials or request a verification code. Add `--probe` to a single-platform command for read-only verification. Rewards are reported only from explicit structured evidence.

The wrapper runs system Chromium headed, with an isolated Xvfb display when no display is available. Runtime state defaults to `$XDG_STATE_HOME/auto-signin` or `~/.local/state/auto-signin` and can be overridden with `AUTO_SIGNIN_STATE_DIR` or `--state-dir`. An Xvfb display is not a user-visible login surface.

This installable directory contains production files only. Run development regression tests from the working copy, not the installed bundle.
