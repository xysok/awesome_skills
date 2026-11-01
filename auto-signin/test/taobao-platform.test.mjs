import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

import { evaluateAny } from '../scripts/lib/page-actions.mjs';
import { validatePlatform } from '../scripts/lib/platform-config.mjs';

async function loadTaobaoPlatform() {
  return JSON.parse(await readFile(new URL('../platforms/taobao.json', import.meta.url), 'utf8'));
}

async function withPage(html, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await run(page);
  } finally {
    await browser.close();
  }
}

test('Taobao adapter accepts only the verified current-day claimed state', async () => {
  const platform = validatePlatform(await loadTaobaoPlatform());

  assert.equal(platform.id, 'taobao');
  assert.equal(platform.name, '淘宝');
  assert.equal(platform.startUrl, 'https://huodong.taobao.com/wow/z/tbhome/pc-growth/tao-coin');
  assert.equal(platform.login?.fields?.[0]?.env, 'TAOBAO_USERNAME');
  assert.deepEqual(platform.signin.action, [
    { by: 'css', value: '#step1:text-is("立即签到")', clickMode: 'dom' }
  ]);
  assert.equal(platform.signin.successTimeoutSeconds, 5);
  assert.deepEqual(platform.signin.alreadyWhen, platform.signin.successWhen);

  await withPage(`
    <div class="gold-sign-wrapper">
      <p>已连签152天</p>
      <div class="sign-today sign-item sign_2"><p>今日可领</p><p class="sign-desc">今天 +120</p></div>
      <div id="step1" class="sign-btn btn-move">立即签到</div>
      <span class="task-reward-num">今日最多可赚100金币</span>
    </div>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.signin.alreadyWhen), false);
    assert.equal(await evaluateAny(page, platform.signin.successWhen), false);
  });

  await withPage(`
    <div class="gold-sign-wrapper">
      <p>已连签153天</p>
      <div class="sign-signed sign-item sign_2"><p>已领取</p><p class="sign-desc">今天 +120</p></div>
      <div id="step1" class="sign-btn btn-move">逛3个商品得 +15</div>
      <span class="task-reward-num">今日最多可赚100金币</span>
    </div>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.signin.alreadyWhen), true);
    assert.equal(await evaluateAny(page, platform.signin.successWhen), true);
  });
});

test('Taobao adapter fails closed on login evidence and declares vault-backed password login', async () => {
  const platform = validatePlatform(await loadTaobaoPlatform());

  assert.ok(platform.allowedOrigins.includes('https://huodong.taobao.com'));
  assert.ok(platform.allowedOrigins.includes('https://h5api.m.taobao.com'));
  assert.ok(platform.allowedOrigins.includes('https://main.m.tmall.com'));
  assert.ok(platform.allowedOrigins.includes('https://www.taobao.com'));
  assert.ok(platform.allowedOrigins.includes('https://login.taobao.com'));
  assert.deepEqual(platform.session.validWhen, [
    {
      kind: 'text',
      matches: '立即签到',
      match: 'equals',
      locator: [{ by: 'css', value: '#step1' }]
    },
    {
      kind: 'text',
      matches: '逛3个商品得',
      match: 'includes',
      locator: [{ by: 'css', value: '#step1' }]
    }
  ]);
  assert.deepEqual(platform.session.invalidWhen, [
    { kind: 'url', matches: 'https://login.taobao.com/', match: 'includes' },
    { kind: 'url', matches: 'punish', match: 'includes' },
    { kind: 'url', matches: 'captcha', match: 'includes' },
    { kind: 'text', matches: '亲，请登录', match: 'includes' }
  ]);
});
