# auto-signin

A project-local Hermes skill and headless Playwright runner for evidence-verified website sign-ins.

## What is included

- `SKILL.md`: agent operating procedure.
- `scripts/auto-signin.mjs`: check, run, and resume CLI.
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

Normal operation is headless and does not require a desktop session. Runtime state defaults to the platform's user state directory (`$XDG_STATE_HOME/auto-signin` or `~/.local/state/auto-signin`) and can be overridden with `AUTO_SIGNIN_STATE_DIR` or `--state-dir`.

The bundled `example` adapter is illustrative and uses the reserved `.invalid` domain; replace it with a validated platform adapter before real use.
