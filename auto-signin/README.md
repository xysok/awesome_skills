# auto-signin

A Hermes skill and Playwright runner for evidence-verified website sign-ins.

## What is included

- `SKILL.md`: agent operating procedure.
- `scripts/auto-signin.mjs`: check, probe, run, and resume CLI.
- `scripts/onboard.mjs`: creates deliberately non-runnable adapter drafts.
- `scripts/lib/`: schema, page actions, state machine, retry, state storage, and CLI helpers.
- `platforms/`: declarative website adapters.
- `references/platform-authoring.md`: F12-to-adapter guide.
- `test/`: offline unit tests plus a local HTTP/Chromium integration test.
- `evals/evals.json`: realistic skill evaluation prompts.

## Local verification

```text
npm ci --ignore-scripts
npx playwright install chromium
npm test
node scripts/auto-signin.mjs check --all
```

Run `bash scripts/auto-signin-daily-report.sh --platform jd` for one platform or omit arguments for all platforms. Both entries only reuse saved sessions. Missing or expired sessions require explicit interactive login; these entries do not submit credentials or request a verification code. Add `--probe` to a single-platform command for read-only verification. Rewards are reported only from explicit structured evidence.

The wrapper runs system Chromium headed, with an isolated Xvfb display when no display is available. Runtime state defaults to `$XDG_STATE_HOME/auto-signin` or `~/.local/state/auto-signin` and can be overridden with `AUTO_SIGNIN_STATE_DIR` or `--state-dir`. An Xvfb display is not a user-visible login surface.

The bundled `example` adapter is illustrative and uses the reserved `.invalid` domain; replace it with a validated platform adapter before real use.
