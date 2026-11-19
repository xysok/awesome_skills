import { spawn } from 'node:child_process';

import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveStateDir } from './lib/cli.mjs';

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
  'USERPROFILE', 'XDG_RUNTIME_DIR', 'DISPLAY', 'XAUTHORITY'
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
  return structured.length > 0 ? structured.join('、') : null;
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
  const stateDir = resolve(options.stateDir ?? resolveStateDir(options.baseEnv ?? process.env));

  const timeoutMs = resolveExecutionTimeoutMs(platform, options);
  const killGraceMs = options.killGraceMs ?? 2_000;
  const baseEnv = options.baseEnv ?? process.env;
  const browserPath = resolveBrowserPath({ ...options, baseEnv });
  const safeEnvironment = Object.fromEntries(
    Object.entries(baseEnv).filter(([key, value]) => SAFE_CHILD_ENV.has(key) && typeof value === 'string')
  );
  if (options.vaultHandle !== undefined) throw new Error('Per-call vault account override is not supported');
  const args = [cliPath, options.probeOnly ? 'probe' : 'run', '--platform', platform.id, '--state-dir', stateDir,
    ...((options.headed ?? true) ? ['--headed'] : []), ...(!options.probeOnly ? ['--session-only'] : [])];

  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: SKILL_ROOT,
      env: { ...safeEnvironment, AUTO_SIGNIN_BROWSER_PATH: browserPath, AUTO_SIGNIN_NONINTERACTIVE: '1',
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
  const execute = options.execute ?? executePlatform;
  const results = await runAll(REAL_PLATFORMS, (platform) => execute(platform, { sessionOnly: true }));
  return formatReport(results, options.timestamp ?? shanghaiTimestamp());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.stdout.write(`${await buildDailyReport()}\n`);
}
