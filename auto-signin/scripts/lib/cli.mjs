import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { validatePlatform } from './platform-config.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!['run', 'resume', 'check', 'help'].includes(command)) {
    throw new Error(`unknown command: ${command ?? '(missing)'}`);
  }
  const parsed = { command };
  if (command === 'run' || command === 'resume') parsed.headless = true;

  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    switch (option) {
      case '--platform':
        parsed.platform = takeValue(argv, index, option);
        index += 1;
        break;
      case '--run-id':
        parsed.runId = takeValue(argv, index, option);
        index += 1;
        break;
      case '--state-dir':
        parsed.stateDir = takeValue(argv, index, option);
        index += 1;
        break;
      case '--headed':
        parsed.headless = false;
        break;
      case '--all':
        parsed.all = true;
        break;
      default:
        throw new Error(`unknown option: ${option}`);
    }
  }

  if (['run', 'resume'].includes(command) && !parsed.platform) {
    throw new Error('--platform is required');
  }
  if (command === 'resume' && !parsed.runId) throw new Error('--run-id is required');
  if (command === 'check' && !parsed.platform && !parsed.all) {
    throw new Error('check requires --platform or --all');
  }
  return parsed;
}

export function resolveStateDir(env = process.env) {
  if (env.AUTO_SIGNIN_STATE_DIR) return env.AUTO_SIGNIN_STATE_DIR;
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, 'auto-signin');
  return join(homedir(), '.local', 'state', 'auto-signin');
}

export function exitCodeFor(result) {
  if (result.status === 'success' || result.status === 'already_done' || result.status === 'valid') return 0;
  if (result.status === 'needs_input') return 10;
  return 20;
}

export function platformPath(value, cwd = process.cwd()) {
  if (value.endsWith('.json') || value.includes('/') || value.includes('\\')) {
    return isAbsolute(value) ? value : resolve(cwd, value);
  }
  return join(SKILL_ROOT, 'platforms', `${value}.json`);
}

export async function loadPlatform(value, cwd = process.cwd()) {
  const path = platformPath(value, cwd);
  const platform = JSON.parse(await readFile(path, 'utf8'));
  validatePlatform(platform);
  return { path, platform };
}

export async function checkPlatforms(parsed, cwd = process.cwd()) {
  const paths = parsed.all
    ? (await readdir(join(SKILL_ROOT, 'platforms'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(SKILL_ROOT, 'platforms', entry.name))
    : [platformPath(parsed.platform, cwd)];

  const checked = [];
  for (const path of paths) {
    const platform = JSON.parse(await readFile(path, 'utf8'));
    validatePlatform(platform);
    checked.push({ id: platform.id, path });
  }
  return { status: 'valid', checked };
}

export async function readChallengeAnswer(stream = process.stdin) {
  const rawMode = stream.isTTY === true && typeof stream.setRawMode === 'function';
  if (rawMode) stream.setRawMode(true);
  const input = createInterface({ input: stream, terminal: false });
  return new Promise((resolve, reject) => {
    let settled = false;
    let restored = false;
    const restore = () => {
      if (!rawMode || restored) return;
      restored = true;
      stream.setRawMode(false);
    };
    input.once('line', (line) => {
      settled = true;
      restore();
      input.close();
      if (!line) reject(new Error('challenge answer must be provided on stdin'));
      else resolve(line);
    });
    input.once('close', () => {
      restore();
      if (!settled) reject(new Error('challenge answer must be provided on stdin'));
    });
    input.once('error', (error) => {
      restore();
      reject(error);
    });
  });
}

export { SKILL_ROOT };
