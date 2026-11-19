import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('passes Xvfb authorization to xauth by stdin, not argv or environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'signin-display-test-'));
  try {
    writeFileSync(join(dir, 'xauth'), '#!/bin/sh\n[ "$#" -eq 3 ] && [ "$1" = -q ] && [ "$2" = -f ] && [ -z "${COOKIE+x}" ] || exit 19\nexec /usr/bin/xauth "$@"\n', { mode: 0o700 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, COOKIE: 'unused-fixture' };
    delete env.DISPLAY;
    const result = spawnSync('bash', ['-c', 'node() { xdpyinfo >/dev/null && ! XAUTHORITY=/dev/null xdpyinfo >/dev/null 2>&1; }; source scripts/auto-signin-daily-report.sh'], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
