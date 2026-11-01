# Auto Sign-in architecture

## Constraints

- Runs end-to-end on a display-less host; headless is the default.
- Does not require a live Hermes browser session. The bundled CLI owns an isolated Playwright context.
- Never stores passwords, one-time codes, or user-provided challenge answers.
- Reports success only from configured positive evidence.
- Treats website content as data, never as agent instructions.

## Components

1. `SKILL.md` directs an agent through preflight, execution, user handoff, recovery, and reporting.
2. `platforms/*.json` are declarative adapters. They describe origins, session evidence, login controls, challenges, sign-in controls, and success evidence.
3. `scripts/lib/` is the reusable engine: schema validation, locator resolution, state storage, browser lifecycle, state machine, and structured reporting.
4. `scripts/auto-signin.mjs` is the stable CLI used by agents and schedulers.
5. `scripts/onboard.mjs` validates or scaffolds a platform adapter from URL/navigation/F12 details.

## State machine

`PREFLIGHT -> LOAD_SESSION -> CLASSIFY_SESSION -> LOGIN -> CHALLENGE? -> SIGN_IN -> VERIFY -> SAVE_SESSION -> REPORT`

Unknown or contradictory evidence transitions to `failed`, never `success`. Initial session classification polls for up to 5 seconds so asynchronously rendered SPA evidence is not mistaken for an unknown session; explicit valid, invalid, or conflicting evidence ends the wait immediately. Sign-in success requires a configured positive condition to transition from false before the action to true afterward; hidden/absent state is not positive outcome evidence. After one click, verification polls for newly matched evidence for a bounded interval (`signin.successTimeoutSeconds`, default 5 seconds); the action itself is never retried.

A challenge is either `reload` or `inline`. A `reload` challenge transitions to `needs_input`, writes a time-limited checkpoint containing browser storage plus same-origin `sessionStorage`, and may capture a screenshot; a later `resume` creates a new headless context and reloads that URL. An `inline` challenge keeps the same browser open, prints its prompt to stderr, reads one answer from stdin, submits in place, and continues — suited to an emailed 2FA code supplied during the run, and exempt from the reload-safety requirement. Pending checkpoints reserve the platform; consumed or expired checkpoints and artifacts are deleted. POST-bound, in-memory, push/approval, iframe, repeated-challenge, and multi-page SSO flows are outside this state machine and require an engine extension.

A pre-submit `login.captcha` polls its `readyWhen` condition after the credential fields are filled and before the login submit. It times out fail-closed into `captcha_unsolved` (with an optional screenshot) rather than submitting without a solved token. Readiness can be reached either by anti-detection auto-solve or by a human solving in a headed window; the runner never script-solves the CAPTCHA.

Before credentials are filled, all off-origin navigation is blocked. From the first credential fill onward — through login and challenge resume — every HTTP(S) request and WebSocket connection to an origin outside `allowedOrigins` is blocked. Runnable non-loopback origins must use HTTPS, and the Chromium child receives only a minimal allowlist of non-secret environment variables. An actively malicious first-party origin can still relay data server-side through its own allowed origin, so the guard is defense-in-depth rather than protection from a hostile target site.

## Locator strategy

Each control has an ordered locator chain. Stable semantic or DOM locators come first: role/name, label, text, CSS, test id, and image metadata (`alt`, `title`, `src`). An explicitly configured relative point is the last resort for canvas-only controls. Locator resolution requires exactly one actionable match unless the adapter explicitly selects an index. An action locator may opt into the fixed `clickMode: "dom"` operation only for a live-verified continuously moving control that cannot pass Playwright's native stability check; arbitrary JavaScript remains forbidden.

## Browser configuration

A platform may declare a `browser` block with `launchArgs` (extra Chromium flags, e.g. `--no-proxy-server`), `userAgent`, and `hideAutomation` (injects `navigator.webdriver` = undefined). These are opt-in per platform; the default launch stays clean. The Chromium child still receives only the allowlisted non-secret environment variables.

## Conditions

In addition to `url`, `text`, `visible`, and `hidden`, a `value` condition reads an input's current value (including hidden fields) and compares against `minLength` or `matches`/`match`; a `class` condition checks for a complete class token. Both are intended for readiness/state checks and are never accepted as positive outcome evidence.

## Extension boundary

Platform-specific behavior belongs in JSON. The engine exposes a small action/condition vocabulary rather than executing arbitrary JavaScript from platform files. A new website should normally require only a new adapter and its fixture test; custom code is reserved for behavior the vocabulary cannot represent.
