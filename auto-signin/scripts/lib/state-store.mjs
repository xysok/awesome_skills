import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function assertIdentifier(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${name} is not a safe identifier`);
  }
}

function validateSessionStorage(value) {
  if (!value || typeof value !== 'object' || typeof value.origin !== 'string' || !Array.isArray(value.entries)) {
    throw new Error('checkpoint sessionStorage is invalid');
  }
  if (!value.entries.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((item) => typeof item === 'string'))) {
    throw new Error('checkpoint sessionStorage entries are invalid');
  }
}

function validateCheckpoint(checkpoint, runId) {
  if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.runId !== runId) {
    throw new Error('checkpoint structure is invalid');
  }
  assertIdentifier(checkpoint.platformId, 'checkpoint platform identifier');
  assertIdentifier(checkpoint.challengeId, 'checkpoint challenge identifier');
  if (typeof checkpoint.currentUrl !== 'string' || !checkpoint.storageState || typeof checkpoint.storageState !== 'object') {
    throw new Error('checkpoint structure is invalid');
  }
  new URL(checkpoint.currentUrl);
  if (checkpoint.sessionStorage !== undefined) validateSessionStorage(checkpoint.sessionStorage);
  for (const key of ['createdAt', 'expiresAt']) {
    if (!Number.isFinite(new Date(checkpoint[key]).getTime())) throw new Error(`checkpoint ${key} is invalid`);
  }
  return checkpoint;
}

async function atomicPrivateJson(path, value) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
}

async function atomicPrivateBytes(path, value) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
}

async function readJson(path, { missing = null } = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return missing;
    throw error;
  }
}

export class StateStore {
  constructor(root) {
    this.root = root;
    this.sessionsDir = join(root, 'sessions');
    this.checkpointsDir = join(root, 'checkpoints');
    this.artifactsDir = join(root, 'artifacts');
    this.locksDir = join(root, 'locks');
  }

  async prepare() {
    await mkdir(this.sessionsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.checkpointsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.artifactsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.locksDir, { recursive: true, mode: 0o700 });
    await this.cleanupExpiredCheckpoints();
  }

  async cleanupExpiredCheckpoints(now = new Date()) {
    await mkdir(this.checkpointsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.artifactsDir, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.checkpointsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const runId = entry.name.slice(0, -5);
      if (!SAFE_ID.test(runId)) continue;
      const checkpoint = await readJson(join(this.checkpointsDir, entry.name))
        .then((value) => validateCheckpoint(value, runId))
        .catch(() => null);
      const expiresAt = new Date(checkpoint?.expiresAt).getTime();
      if (!checkpoint || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
        await this.deleteCheckpoint(runId);
      }
    }
  }

  async saveSession(platformId, storageState) {
    assertIdentifier(platformId, 'platform identifier');
    await this.prepare();
    await atomicPrivateJson(join(this.sessionsDir, `${platformId}.json`), storageState);
  }

  async loadSession(platformId) {
    assertIdentifier(platformId, 'platform identifier');
    return readJson(join(this.sessionsDir, `${platformId}.json`));
  }

  async saveCheckpoint(platformId, value, { now = new Date(), ttlMs = 10 * 60_000 } = {}) {
    assertIdentifier(platformId, 'platform identifier');
    if (!value || typeof value.currentUrl !== 'string' || !value.storageState || typeof value.challengeId !== 'string') {
      throw new Error('checkpoint requires currentUrl, storageState, and challengeId');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('checkpoint ttlMs must be positive');
    }
    if (value.sessionStorage !== undefined) validateSessionStorage(value.sessionStorage);

    await this.prepare();
    const runId = randomUUID();
    const checkpoint = {
      runId,
      platformId,
      challengeId: value.challengeId,
      currentUrl: value.currentUrl,
      storageState: value.storageState,
      ...(value.sessionStorage ? { sessionStorage: value.sessionStorage } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    await atomicPrivateJson(join(this.checkpointsDir, `${runId}.json`), checkpoint);
    return checkpoint;
  }

  async loadCheckpoint(runId, now = new Date()) {
    assertIdentifier(runId, 'run identifier');
    const path = join(this.checkpointsDir, `${runId}.json`);
    const value = await readJson(path);
    if (!value) throw new Error('checkpoint not found');
    const checkpoint = validateCheckpoint(value, runId);
    const expiresAt = new Date(checkpoint.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      await this.deleteCheckpoint(runId);
      throw new Error('checkpoint expired');
    }
    return checkpoint;
  }

  async findActiveCheckpoint(platformId, now = new Date()) {
    assertIdentifier(platformId, 'platform identifier');
    await this.prepare();
    for (const entry of await readdir(this.checkpointsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const runId = entry.name.slice(0, -5);
      const checkpoint = validateCheckpoint(
        await readJson(join(this.checkpointsDir, entry.name), { missing: null }),
        runId
      );
      if (checkpoint?.platformId === platformId && new Date(checkpoint.expiresAt).getTime() > now.getTime()) {
        return checkpoint;
      }
    }
    return null;
  }

  async deleteCheckpoint(runId) {
    assertIdentifier(runId, 'run identifier');
    await Promise.all([
      rm(join(this.checkpointsDir, `${runId}.json`), { force: true }),
      rm(join(this.artifactsDir, runId), { recursive: true, force: true })
    ]);
  }

  async saveArtifact(runId, name, bytes) {
    assertIdentifier(runId, 'run identifier');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) {
      throw new Error('artifact name is not a safe identifier');
    }
    const directory = join(this.artifactsDir, runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, name);
    await atomicPrivateBytes(path, bytes);
    return path;
  }

  async acquireLock(platformId) {
    assertIdentifier(platformId, 'platform identifier');
    await this.prepare();
    const path = join(this.locksDir, `${platformId}.lock`);
    const ownerId = randomUUID();
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ ownerId, pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === 'EEXIST') throw new Error(`platform is already running: ${platformId}`);
      throw error;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await handle.close();
      const current = await readJson(path, { missing: null }).catch(() => null);
      if (current?.ownerId === ownerId) await rm(path, { force: true });
    };
  }
}
