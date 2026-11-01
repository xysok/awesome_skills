import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StateStore } from '../scripts/lib/state-store.mjs';

async function temporaryStore() {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-test-'));
  return { root, store: new StateStore(root) };
}

test('saves and loads isolated browser session state with private permissions', async () => {
  const { root, store } = await temporaryStore();
  const state = { cookies: [{ name: 'session', value: 'opaque' }], origins: [] };

  await store.saveSession('demo', state);

  assert.deepEqual(await store.loadSession('demo'), state);
  assert.equal((await stat(join(root, 'sessions', 'demo.json'))).mode & 0o777, 0o600);
});

test('checkpoint excludes challenge answers and expires', async () => {
  const { root, store } = await temporaryStore();
  const now = new Date('2026-01-01T00:00:00Z');
  const checkpoint = await store.saveCheckpoint('demo', {
    currentUrl: 'https://example.test/otp',
    storageState: { cookies: [], origins: [] },
    challengeId: 'sms'
  }, { now, ttlMs: 1_000 });

  const raw = await readFile(join(root, 'checkpoints', `${checkpoint.runId}.json`), 'utf8');
  assert.doesNotMatch(raw, /123456|answer/i);
  assert.equal((await store.loadCheckpoint(checkpoint.runId, new Date(now.getTime() + 500))).platformId, 'demo');
  await assert.rejects(
    store.loadCheckpoint(checkpoint.runId, new Date(now.getTime() + 1_001)),
    /expired/
  );
});

test('rejects unsafe platform and run identifiers', async () => {
  const { store } = await temporaryStore();
  await assert.rejects(store.saveSession('../escape', {}), /identifier/);
  await assert.rejects(store.loadCheckpoint('../../secret'), /identifier/);
});

test('prevents concurrent runs for the same platform and releases the lock', async () => {
  const { store } = await temporaryStore();
  const release = await store.acquireLock('demo');
  await assert.rejects(store.acquireLock('demo'), /already running/);
  await release();

  const releaseAgain = await store.acquireLock('demo');
  await releaseAgain();
});

test('garbage-collects expired checkpoints and their artifacts', async () => {
  const { root, store } = await temporaryStore();
  const now = new Date('2026-01-01T00:00:00Z');
  const checkpoint = await store.saveCheckpoint('demo', {
    currentUrl: 'https://example.test/otp',
    storageState: { cookies: [], origins: [] },
    sessionStorage: { origin: 'https://example.test', entries: [] },
    challengeId: 'sms'
  }, { now, ttlMs: 1_000 });
  await store.saveArtifact(checkpoint.runId, 'challenge.png', Buffer.from('private'));

  await store.cleanupExpiredCheckpoints(new Date(now.getTime() + 1_001));

  await assert.rejects(stat(join(root, 'checkpoints', `${checkpoint.runId}.json`)), /ENOENT/);
  await assert.rejects(stat(join(root, 'artifacts', checkpoint.runId)), /ENOENT/);
});

test('does not remove a replacement lock owned by another process', async () => {
  const { root, store } = await temporaryStore();
  const release = await store.acquireLock('demo');
  const lockPath = join(root, 'locks', 'demo.lock');
  await rm(lockPath);
  await writeFile(lockPath, JSON.stringify({ ownerId: 'replacement' }), { mode: 0o600 });

  await release();

  assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).ownerId, 'replacement');
});
