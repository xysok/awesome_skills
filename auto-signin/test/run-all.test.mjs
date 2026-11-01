import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildDailyReport,
  executePlatform,
  formatReport,
  resolveExecutionTimeoutMs,
  resolveBrowserPath,
  runAll
} from '../scripts/run-all.mjs';

test('gives CordCloud enough outer execution time for its captcha flow', () => {
  assert.equal(resolveExecutionTimeoutMs({ id: 'cordcloud' }), 90_000);
  assert.equal(resolveExecutionTimeoutMs({ id: 'wps' }), 45_000);
  assert.equal(resolveExecutionTimeoutMs({ id: 'cordcloud' }, { timeoutMs: 1234 }), 1234);
});

test('resolves a persistent browser path without relying on the Hermes install tree', () => {
  assert.equal(resolveBrowserPath({
    baseEnv: { AUTO_SIGNIN_BROWSER_PATH: '/opt/data/shared/browsers/chromium' },
    browserType: { executablePath: () => '/unexpected/playwright/path' }
  }), '/opt/data/shared/browsers/chromium');

  assert.equal(resolveBrowserPath({
    baseEnv: {},
    browserType: { executablePath: () => '/opt/data/shared/browsers/ms-playwright/chromium-1234/chrome' }
  }), '/opt/data/shared/browsers/ms-playwright/chromium-1234/chrome');
});

test('formats a three-column report without inventing missing rewards', () => {
  const report = formatReport([
    { platform: 'cordcloud', name: 'CordCloud', status: 'already_done', evidence: '已签到' },
    { platform: 'jd', name: '京东', status: 'success', evidence: '签到成功，恭喜获得京豆 + 2 开心收下' },
    { platform: 'taobao', name: '淘宝', status: 'failed', code: 'session_expired', message: 'Session expired.' }
  ], '2026-09-09 06:30:00');

  assert.equal(report, [
    '## 每日签到报告（2026-09-09 06:30:00）',
    '',
    '| 平台 | 状态 | 备注 |',
    '|---|---|---|',
    '| CordCloud | 成功 | 今日已签到；奖励未捕获 |',
    '| 京东 | 成功 | +2 京豆 |',
    '| 淘宝 | 失败 | session_expired：Session expired. |'
  ].join('\n'));
});

test('formats structured rewards before legacy evidence parsing', () => {
  const report = formatReport([{
    platform: 'wps',
    name: 'WPS',
    status: 'success',
    evidence: '已签到',
    rewards: [
      { type: 'traffic', amount: 98, unit: 'MB', source: 'message', confidence: 'explicit', evidence: '获得98MB' },
      { type: 'points', amount: 1, unit: '积分', source: 'today-node', confidence: 'explicit', evidence: '积分+1' }
    ]
  }], '2026-09-09 06:30:00');

  assert.match(report, /\| WPS \| 成功 \| \+98 MB、\+1 积分 \|/);
  assert.doesNotMatch(report, /奖励未捕获/);
});

test('continues with later platforms when one execution throws', async () => {
  const calls = [];
  const platforms = [
    { id: 'cordcloud', name: 'CordCloud' },
    { id: 'jd', name: '京东京豆' },
    { id: 'taobao', name: '淘宝淘金币' }
  ];
  const results = await runAll(platforms, async ({ id }) => {
    calls.push(id);
    if (id === 'jd') throw new Error('execution timed out after 45 seconds');
    return { platform: id, status: 'already_done', evidence: '已签到' };
  });

  assert.deepEqual(calls, ['cordcloud', 'jd', 'taobao']);
  assert.equal(results.length, 3);
  assert.deepEqual(results[1], {
    platform: 'jd',
    name: '京东京豆',
    status: 'failed',
    code: 'runner_error',
    message: 'execution timed out after 45 seconds'
  });
  assert.equal(results[2].status, 'already_done');
});

test('uses headed mode for CordCloud CAPTCHA recovery only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-headed-'));
  const fixture = join(root, 'fixture.mjs');
  await writeFile(fixture, `
    process.stdout.write(JSON.stringify({ headed: process.argv.includes('--headed') }));
  `);

  const result = await executePlatform({ id: 'cordcloud', name: 'CordCloud' }, {
    cliPath: fixture,
    stateDir: root,
    timeoutMs: 1000
  });

  assert.equal(result.headed, true);
});

test('preserves structured CLI failure from a nonzero child exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-run-all-'));
  const fixture = join(root, 'fixture.mjs');
  await writeFile(fixture, `
    process.stdout.write(JSON.stringify({ status: 'failed', platform: 'jd', code: 'session_expired', message: 'Session expired.' }));
    process.exitCode = 20;
  `);

  const result = await executePlatform({ id: 'jd', name: '京东京豆' }, {
    cliPath: fixture,
    stateDir: root,
    timeoutMs: 1000
  });

  assert.deepEqual(result, {
    status: 'failed',
    platform: 'jd',
    code: 'session_expired',
    message: 'Session expired.'
  });
});

test('force-kills a child that ignores the platform timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-run-all-timeout-'));
  const fixture = join(root, 'fixture.mjs');
  await writeFile(fixture, `
    process.on('SIGTERM', () => {});
    setTimeout(() => process.exit(0), 500);
  `);
  const started = Date.now();

  await assert.rejects(
    executePlatform({ id: 'jd', name: '京东京豆' }, {
      cliPath: fixture,
      stateDir: root,
      timeoutMs: 50,
      killGraceMs: 50
    }),
    /timed out after 0.05 seconds/
  );
  assert.ok(Date.now() - started < 250, 'child was not force-killed promptly');
});

test('builds the daily report for every configured real platform', async () => {
  const calls = [];
  const report = await buildDailyReport({
    timestamp: '2026-09-09 06:30:00',
    execute: async ({ id }) => {
      calls.push(id);
      return { platform: id, status: 'already_done', evidence: '已签到' };
    }
  });

  assert.deepEqual(calls, ['cordcloud', 'jd', 'taobao', 'wps']);
  assert.match(report, /^## 每日签到报告（2026-09-09 06:30:00）/);
  assert.equal(report.split('\n').filter((line) => line.includes('| 成功 |')).length, 4);
  assert.match(report, /\| 京东 \| 成功 \|/);
  assert.match(report, /\| 淘宝 \| 成功 \|/);
  assert.match(report, /\| WPS \| 成功 \|/);
  assert.doesNotMatch(report, /京东京豆|淘宝淘金币|WPS 签到/);
});

test('injects only the selected platform credentials into its child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-credentials-'));
  const fixture = join(root, 'fixture.mjs');
  const credentialsPath = join(root, 'credentials.json');
  await writeFile(credentialsPath, JSON.stringify({
    cordcloud: {
      CORDCLOUD_EMAIL: 'demo@example.test',
      CORDCLOUD_PASSWORD: 'demo-password'
    },
    jd: { JD_TOKEN: 'must-not-leak' }
  }));
  await writeFile(fixture, `
    process.stdout.write(JSON.stringify({
      status: 'success',
      platform: 'cordcloud',
      credentialProbe: {
        email: process.env.CORDCLOUD_EMAIL ?? null,
        password: process.env.CORDCLOUD_PASSWORD ?? null,
        jdToken: process.env.JD_TOKEN ?? null
      }
    }));
  `);

  const result = await executePlatform({ id: 'cordcloud', name: 'CordCloud' }, {
    cliPath: fixture,
    stateDir: root,
    credentialsPath,
    baseEnv: { PATH: process.env.PATH },
    timeoutMs: 1000
  });

  assert.deepEqual(result.credentialProbe, {
    email: 'demo@example.test',
    password: 'demo-password',
    jdToken: null
  });
});
