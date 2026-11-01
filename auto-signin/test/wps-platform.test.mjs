import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

import { clickFirst, evaluateAny } from '../scripts/lib/page-actions.mjs';
import { validatePlatform } from '../scripts/lib/platform-config.mjs';

async function loadWpsPlatform() {
  return JSON.parse(await readFile(new URL('../platforms/wps.json', import.meta.url), 'utf8'));
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

test('WPS adapter preserves verified task-center controls and declares vault-backed password login', async () => {
  const platform = validatePlatform(await loadWpsPlatform());

  assert.equal(platform.id, 'wps');
  assert.equal(platform.name, 'WPS');
  assert.equal(
    platform.startUrl,
    'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025041617143388'
  );
  assert.equal(platform.login?.fields?.[0]?.env, 'WPS_USERNAME');
  assert.deepEqual(platform.signin.action, [
    { by: 'css', value: '.sign-opera-btn:has-text("点击签到")', clickMode: 'dom' }
  ]);
  assert.equal(platform.signin.successTimeoutSeconds, 5);
  assert.deepEqual(platform.signin.alreadyWhen, platform.signin.successWhen);

  await withPage(`
    <main class="sign-in-panel__main">
      <p>已连续签到153天</p>
      <div class="sign-opera-btn"><span>点击签到</span></div>
    </main>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.signin.alreadyWhen), false);
    assert.equal(await evaluateAny(page, platform.signin.successWhen), false);
    await page.locator('.sign-opera-btn').evaluate((element) => {
      element.addEventListener('click', () => { element.dataset.clicked = 'yes'; });
    });
    await clickFirst(page, platform.signin.action);
    assert.equal(await page.locator('.sign-opera-btn').getAttribute('data-clicked'), 'yes');
  });

  await withPage(`
    <main class="sign-in-panel__main">
      <p>已连续签到154天</p>
      <div class="sign-opera-btn">已签到</div>
    </main>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.signin.alreadyWhen), true);
    assert.equal(await evaluateAny(page, platform.signin.successWhen), true);
  });
});

test('WPS adapter distinguishes the login shell from an authenticated task center', async () => {
  const platform = validatePlatform(await loadWpsPlatform());

  await withPage(`
    <button class="username">请登录</button>
    <main class="sign-in-panel__main"><div class="sign-opera-btn">点击签到</div></main>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.session.validWhen), false);
    assert.equal(await evaluateAny(page, platform.session.invalidWhen), true);
  });

  await withPage(`
    <button class="username">User</button>
    <button class="logout">退出</button>
    <main class="sign-in-panel__main"><div class="sign-opera-btn">点击签到</div></main>
  `, async (page) => {
    assert.equal(await evaluateAny(page, platform.session.validWhen), true);
    assert.equal(await evaluateAny(page, platform.session.invalidWhen), false);
  });
});
