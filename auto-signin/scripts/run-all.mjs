import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PLATFORM_NAMES = {
  cordcloud: 'CordCloud',
  jd: '京东',
  taobao: '淘宝',
  wps: 'WPS'
};

const REAL_PLATFORMS = Object.entries(PLATFORM_NAMES).map(([id, name]) => ({ id, name }));
const SAFE_CHILD_ENV = new Set([
  'HOME', 'HERMES_HOME', 'LANG', 'LC_ALL', 'PATH', 'TEMP', 'TMP', 'TMPDIR', 'TZ',
  'USERPROFILE', 'XDG_RUNTIME_DIR', 'DISPLAY'
]);

function safeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

function rewardFrom(result) {
  const structured = Array.isArray(result.rewards)
    ? result.rewards
      .filter((reward) => reward?.confidence === 'explicit' &&
        Number.isFinite(reward.amount) && reward.amount > 0 &&
        typeof reward.unit === 'string' && reward.unit.trim() !== '')
      .map((reward) => `+${reward.amount} ${reward.unit.trim()}`)
    : [];
  if (structured.length > 0) return structured.join('、');

  const text = `${result.evidence ?? ''} ${result.message ?? ''}`;
  const patterns = {
    cordcloud: [
      { regex: /(?:\+|获得|奖励)\s*(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i, unitGroup: 2 }
    ],
    jd: [
      { regex: /京豆\s*\+\s*(\d+(?:\.\d+)?)/, unit: '京豆' },
      { regex: /\+\s*(\d+(?:\.\d+)?)\s*京豆/, unit: '京豆' }
    ],
    taobao: [
      { regex: /\+\s*(\d+(?:\.\d+)?)\s*(?:淘金币|金币)?/, unit: '淘金币' }
    ]
  }[result.platform] ?? [];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) return `+${match[1]} ${pattern.unit ?? match[pattern.unitGroup]}`;
  }
  return null;
}

function noteFor(result) {
  if (result.status === 'success') return rewardFrom(result) ?? '签到成功；奖励未捕获';
  if (result.status === 'already_done') return rewardFrom(result) ?? '今日已签到；奖励未捕获';
  if (result.status === 'needs_input') {
    return `需要人工验证：${result.challenge?.prompt ?? result.message ?? '未提供验证说明'}`;
  }
  const code = result.code ? `${result.code}：` : '';
  return `${code}${result.message ?? '未知失败'}`;
}

export function formatReport(results, timestamp) {
  const rows = results.map((result) => {
    const name = result.name ?? PLATFORM_NAMES[result.platform] ?? result.platform;
    const status = ['success', 'already_done'].includes(result.status) ? '成功' : '失败';
    return `| ${safeCell(name)} | ${status} | ${safeCell(noteFor(result))} |`;
  });
  return [
    `## 每日签到报告（${timestamp}）`,
    '',
    '| 平台 | 状态 | 备注 |',
    '|---|---|---|',
    ...rows
  ].join('\n');
}

export async function runAll(platforms, execute) {
  const results = [];
  for (const platform of platforms) {
    try {
      const result = await execute(platform);
      results.push({ ...result, platform: platform.id, name: platform.name });
    } catch (error) {
      results.push({
        platform: platform.id,
        name: platform.name,
        status: 'failed',
        code: 'runner_error',
        message: error.message
      });
    }
  }
  return results;
}

async function platformCredentials(platformId, path) {
  let document;
  try {
    document = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`credentials file is invalid: ${error.message}`);
  }
  const selected = document?.[platformId];
  if (selected === undefined) return {};
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
    throw new Error(`credentials for ${platformId} must be an object`);
  }
  for (const [key, value] of Object.entries(selected)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.length === 0) {
      throw new Error(`credentials for ${platformId} contain an invalid entry`);
    }
  }
  return selected;
}

export function resolveBrowserPath(options = {}) {
  const baseEnv = options.baseEnv ?? process.env;
  const browserType = options.browserType ?? chromium;
  return options.browserPath ?? baseEnv.AUTO_SIGNIN_BROWSER_PATH ?? browserType.executablePath();
}

export function resolveExecutionTimeoutMs(platform, options = {}) {
  if (options.timeoutMs !== undefined) return options.timeoutMs;
  return platform.id === 'cordcloud' ? 90_000 : 45_000;
}

export async function executePlatform(platform, options = {}) {
  const cliPath = options.cliPath ?? resolve(SKILL_ROOT, 'scripts', 'auto-signin.mjs');
  const stateDir = options.stateDir ?? '/opt/data/home/.local/state/auto-signin';
  const credentialsPath = options.credentialsPath ?? resolve(stateDir, 'credentials.json');
  const timeoutMs = resolveExecutionTimeoutMs(platform, options);
  const killGraceMs = options.killGraceMs ?? 2_000;
  const baseEnv = options.baseEnv ?? process.env;
  const browserPath = resolveBrowserPath({ ...options, baseEnv });
  const safeEnvironment = Object.fromEntries(
    Object.entries(baseEnv).filter(([key, value]) => SAFE_CHILD_ENV.has(key) && typeof value === 'string')
  );
  const credentials = await platformCredentials(platform.id, credentialsPath);
  let bindings = {};
  try { bindings = JSON.parse(await readFile(resolve(stateDir, 'vault-bindings.json'), 'utf8')); }
  catch (error) { if (error?.code !== 'ENOENT') throw new Error('Invalid vault binding configuration'); }
  const binding = bindings[platform.id];
  const args = [cliPath, 'run', '--platform', platform.id, '--state-dir', stateDir,
    ...(platform.id === 'cordcloud' ? ['--headed'] : [])];
  const executable = binding ? (options.vaultPython ?? '/opt/hermes/.venv/bin/python') : process.execPath;
  const launchArgs = binding ? [
    options.vaultLauncher ?? resolve(SKILL_ROOT, 'scripts', 'vault-launcher.py'),
    '--handle', binding.handle, '--platform', platform.id,
    '--', process.execPath, ...args
  ] : args;

  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, launchArgs, {
      cwd: SKILL_ROOT,
      env: { ...safeEnvironment, ...credentials, AUTO_SIGNIN_BROWSER_PATH: browserPath,
        ...(options.loginDiagnostics ? {AUTO_SIGNIN_LOGIN_DIAGNOSTICS: '1'} : {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKillTimer;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      if (timedOut) {
        reject(new Error(`execution timed out after ${timeoutMs / 1000} seconds`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim()));
      } catch {
        const detail = stderr.trim() || `child exited with code ${code}`;
        reject(new Error(`invalid auto-signin output: ${detail}`));
      }
    });
  });
}

function shanghaiTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export async function buildDailyReport(options = {}) {
  const results = await runAll(REAL_PLATFORMS, options.execute ?? executePlatform);
  return formatReport(results, options.timestamp ?? shanghaiTimestamp());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.stdout.write(`${await buildDailyReport()}\n`);
}
