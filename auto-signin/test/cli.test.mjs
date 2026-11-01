import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { exitCodeFor, parseArgs, readChallengeAnswer, resolveStateDir } from '../scripts/lib/cli.mjs';

test('parses headless run by default and headed only when explicitly requested', () => {
  assert.deepEqual(parseArgs(['run', '--platform', 'platforms/demo.json']), {
    command: 'run',
    platform: 'platforms/demo.json',
    headless: true
  });
  assert.equal(parseArgs(['run', '--platform', 'demo', '--headed']).headless, false);
});

test('resume accepts a run id but never accepts a challenge answer argument', () => {
  assert.equal(parseArgs(['resume', '--platform', 'demo', '--run-id', 'abc']).runId, 'abc');
  assert.throws(
    () => parseArgs(['resume', '--platform', 'demo', '--run-id', 'abc', '--answer', '123456']),
    /unknown option/
  );
});

test('uses explicit state directory before portable environment defaults', () => {
  assert.equal(resolveStateDir({ AUTO_SIGNIN_STATE_DIR: '/safe/state' }), '/safe/state');
  assert.equal(resolveStateDir({ XDG_STATE_HOME: '/xdg' }), join('/xdg', 'auto-signin'));
});

test('maps completed, interactive, and failed results to stable exit codes', () => {
  assert.equal(exitCodeFor({ status: 'success' }), 0);
  assert.equal(exitCodeFor({ status: 'already_done' }), 0);
  assert.equal(exitCodeFor({ status: 'needs_input' }), 10);
  assert.equal(exitCodeFor({ status: 'failed' }), 20);
});

test('reads one challenge-answer line without waiting for stdin to close', async () => {
  const stream = new Readable({ read() {} });
  const answerPromise = readChallengeAnswer(stream);
  stream.push('246810\n');

  try {
    assert.equal(await Promise.race([
      answerPromise,
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50))
    ]), '246810');
  } finally {
    stream.destroy();
  }
});

test('disables and restores terminal echo while reading a challenge answer', async () => {
  const stream = new Readable({ read() {} });
  const rawModes = [];
  Object.defineProperty(stream, 'isTTY', { value: true });
  stream.setRawMode = (value) => rawModes.push(value);
  const answerPromise = readChallengeAnswer(stream);
  stream.push('864200\r');
  assert.equal(await answerPromise, '864200');
  assert.deepEqual(rawModes, [true, false]);
  stream.destroy();
});

test('reports invalid adapter checks as structured JSON without a stack trace', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-signin-cli-'));
  const adapterPath = join(directory, 'draft.json');
  writeFileSync(adapterPath, JSON.stringify({ _draft: true }));
  const result = spawnSync(process.execPath, [
    'scripts/auto-signin.mjs', 'check', '--platform', adapterPath
  ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

  assert.equal(result.status, 20);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).status, 'failed');
});
