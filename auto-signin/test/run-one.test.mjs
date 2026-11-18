import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd = new URL('..', import.meta.url);

test('single-platform entry documents headed, probe and session-only options', () => {
  const result = spawnSync(process.execPath, ['scripts/run-one.mjs', '--help'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--headed/);
  assert.match(result.stdout, /--probe/);
  assert.match(result.stdout, /--session-only/);
});

test('sign-in and probe skip credential files when no session exists', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'signin-entrypoint-'));
  try {
    writeFileSync(join(stateDir, 'credentials.json'), '{invalid');
    writeFileSync(join(stateDir, 'vault-bindings.json'), '{invalid');
    for (const mode of [[], ['--probe']]) {
      const result = spawnSync(process.execPath, ['scripts/run-one.mjs', '--platform', 'jd', '--state-dir', stateDir, ...mode], { cwd, encoding: 'utf8', timeout: 8000 });
      assert.equal(result.status, 10, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).code, 'session_missing');
    }
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});

test('repeated platform flags are rejected before running a sign-in', () => {
  const result = spawnSync(process.execPath, ['scripts/run-one.mjs', '--platform', 'jd', '--platform', 'invalid'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 20);
  assert.match(JSON.parse(result.stdout).message, /duplicate/i);
});
