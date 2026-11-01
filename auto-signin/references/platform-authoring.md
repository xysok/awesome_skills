# Platform adapter authoring

Use this reference when adding or repairing a platform. Keep platform-specific knowledge in `platforms/<id>.json`; do not modify the engine unless the adapter vocabulary cannot express a required behavior.

## Information to collect

Ask for or inspect these facts without collecting secrets:

1. Entry URL and every expected top-level redirect origin.
2. Positive logged-in evidence and explicit logged-out evidence.
3. Username/password controls and login submit control from F12.
4. Challenge page URL/text, answer input, submit control, expiration time, whether a screenshot helps, and whether the page is safe to reload in a fresh browser context.
5. Sign-in control, already-signed evidence, fresh-success evidence, and optional reward text.

Never paste passwords, cookies, tokens, or OTP values into an adapter. Login fields reference uppercase environment-variable names.

## Locator priority

Use an ordered array, stable first:

1. `role` + accessible `name` for a uniquely named button/link.
2. `label` for form controls.
3. `testId` when the site intentionally exposes one.
4. Narrow `css` based on stable id/name/data attributes.
5. `image` with `alt`, `title`, or `srcIncludes`; the runner clicks the nearest button/link ancestor.
6. `text` when wording is stable.
7. `point` with `xRatio` and `yRatio` only for canvas-only controls whose layout is fixed.

Never add arbitrary JavaScript. Never use dynamic hashed CSS classes when a stable attribute exists. If multiple visible elements match, add a narrower fallback or an explicit zero-based `index` after confirming it is stable.

Action locators may set `"clickMode": "dom"` only when an authorized live check proves Playwright's native click cannot pass actionability checks (for example, a continuously animated control). This invokes the fixed operation `HTMLElement.click()`; adapters still cannot supply JavaScript. It is allowed only on sign-in, login-submit, and challenge-submit locator chains, never on condition/input/point locators. Constrain the same locator to its pre-action state (for example `#step1:text-is("立即签到")`) so an already-completed control cannot become an unrelated follow-up action.

## Conditions

Condition arrays use OR semantics. Supported kinds:

- `url`: compares the current URL using explicit `match: "equals"` or `match: "includes"`.
- `text`: compares page or selected-element text using explicit `match: "equals"` or `match: "includes"`.
- `visible`: at least one locator resolves to a visible element.
- `hidden`: at least one matching element exists and is hidden; absence is not hidden.
- `value`: reads an input's current value (including hidden fields) and compares against `minLength` or `matches`/`match`.
- `class`: requires a located element to contain one complete class token; it is intended for readiness/state checks, not positive outcome evidence.

`session.validWhen`, `signin.alreadyWhen`, and `signin.successWhen` cannot use `hidden` or `value`. Text outcome evidence must use a scoped locator. URL outcome evidence must use `match: "equals"`. In addition, a `successWhen` condition must be false before the click and true afterward. Unknown or conflicting session evidence fails closed.

Initial session evidence is polled for up to 5 seconds to accommodate asynchronously rendered SPAs. Prefer stable, scoped logged-in evidence that covers both unsigned and already-signed states; do not broaden it to generic page chrome merely to avoid `session_unknown`.

After the sign-in action, the runner polls for a newly matched `successWhen` condition. Set optional `signin.successTimeoutSeconds` to an integer from 1 to 60 when a platform needs a timeout other than the 5-second default. This is a bounded evidence wait, not an action retry: the sign-in control is clicked only once.

## Reward capture

Declare optional `signin.rewards` only after identifying explicit daily reward evidence. The engine reads rewards after `successWhen` or `alreadyWhen` has positively established the current-day sign-in state. Missing reward evidence does not change a successful sign-in into a failure.

```json
"rewards": [{
  "id": "daily-points",
  "type": "points",
  "unit": "积分",
  "sources": [{
    "id": "today-node",
    "locator": [{ "by": "css", "value": ".today .reward" }],
    "pattern": "积分\\s*\\+\\s*(\\d+)",
    "amountGroup": 1
  }]
}]
```

Each reward can contain ordered fallback `sources`; the first source producing a valid positive amount wins, so a success popup and a persistent ledger do not double-count the same reward. A reward uses either a static `unit` or a source `unitGroup`. A dated ledger source can set `todayGroup`; that capture must equal today's `Asia/Shanghai` date in `YYYY-MM-DD` format.

Keep source locators narrow and evidence-specific:

- Accept: a success message populated from the sign-in response, today's signed calendar node, or a dated daily-sign-in ledger row.
- Reject: total balance, remaining traffic, future calendar rewards, “最多可赚”, unrelated task rewards, yesterday's transaction, or a generic page-wide number.
- Preserve platform syntax differences in the adapter `pattern`; do not add website-specific parsing branches to the engine.
- Add a Playwright fixture that executes the real configured locator. Parsing a sample string alone does not prove the locator syntax works.

## Challenge resume boundary

Every challenge must declare a `resume.mode` of either `"reload"` or `"inline"`.

- `"reload"` checkpoints the challenge and answers it later via a separate `resume` run. Declare it only after an authorized fixture or live inspection proves the challenge URL can be reloaded in a fresh context using saved cookies/local storage and restored same-origin `sessionStorage`. Do not declare it when the transaction depends on a POST response body, an in-memory JavaScript object, a live WebSocket, a push/approval interaction, nested iframe state, multi-page SSO, or repeated challenge steps — those need an engine extension.
- `"inline"` requires the same live browser. The standalone local human CLI can read stdin, but an assistant must use protected browser-vault input or official app approval, never a code from chat. Scheduled vault launches return `needs_input` and close the browser, so the user must restart interactive login; no resumable inline checkpoint is implied.

During initial login, a challenge is recognized only when its configured evidence matches AND its answer locator resolves to a visible, enabled, editable input using the same index and ambiguity rules as filling. Do not use a callback URL as standalone proof of required OTP. On resume, valid authenticated evidence takes precedence over stale OTP controls; unavailable or changed challenges must not keep stale checkpoints blocking new runs. After submission, use authenticated evidence rather than a URL change and allow bounded asynchronous UI updates. Keep separate tests for transient redirects, unusable inputs, real OTP, stale resume pages, rejection, same-URL success and delayed success.

## Browser configuration

Add an optional top-level `browser` block only when a site needs it, for example:

```json
"browser": {
  "launchArgs": ["--no-proxy-server", "--disable-blink-features=AutomationControlled"],

  "hideAutomation": true
}
```

`launchArgs` are extra Chromium flags (each must start with `--`), `userAgent` overrides the context user agent, and `hideAutomation` injects `navigator.webdriver = undefined`. These are opt-in and only for sites that block the default headless profile.

## CAPTCHA gate

When a login form embeds a CAPTCHA whose solved token lands in a field (for example an hCaptcha-style `input[name=cap-token]`), describe it with a pre-submit `login.captcha` gate instead of a challenge:

```json
"captcha": {
  "readyWhen": [{ "kind": "value", "locator": [{ "by": "css", "value": "input[name=cap-token]" }], "minLength": 10 }],
  "timeoutSeconds": 120,
  "captureScreenshot": true
}
```

The runner polls `readyWhen` before credential fill and submission, and fails closed with `captcha_unsolved` on timeout. Observe the site's ordinary verification or hand off to protected human interaction; the gate is not a CAPTCHA solver. Do not hardcode a stale user-agent example as a universal fix without a controlled live comparison.

## Image-only buttons

Given F12 HTML such as `<button><img src="/img/checkin-active.png"></button>`, prefer:

```json
[{ "by": "image", "srcIncludes": "checkin-active.png" }]
```

If `alt` or `title` is stable, use it instead. The engine resolves the image and clicks its nearest actionable ancestor. Pure canvas controls require a confirmed relative point and still need separate textual/DOM success evidence.

## Validation

Run through `terminal`:

```text
node scripts/auto-signin.mjs check --platform platforms/<id>.json
npm test
```

A valid schema is not proof the selectors or reload strategy work. Add a local fixture or perform an authorized read-only/pre-production check before enabling a schedule.
