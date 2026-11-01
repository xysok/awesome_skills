import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function entryBrowser(override) {
  const env = { ...process.env, DISPLAY: ':test' };
  delete env.AUTO_SIGNIN_BROWSER_PATH;
  if (override) env.AUTO_SIGNIN_BROWSER_PATH = override;
  // Intercept only the Node invocation: exercise the real shell environment
  // without running any platform or reading credentials.
  const result = spawnSync('bash', ['-c', 'node() { printf "%s" "$AUTO_SIGNIN_BROWSER_PATH"; }; source scripts/auto-signin-daily-report.sh'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('daily entry defaults to existing system Chromium', () => {
  assert.equal(entryBrowser(), '/usr/bin/chromium');
});

test('daily entry preserves explicit browser override', () => {
  assert.equal(entryBrowser('/custom/chrome'), '/custom/chrome');
});
