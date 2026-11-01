import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

import { validatePlatform } from '../scripts/lib/platform-config.mjs';
import { captureRewards, parseRewardText } from '../scripts/lib/reward-capture.mjs';

async function loadPlatform(id) {
  return validatePlatform(JSON.parse(await readFile(new URL(`../platforms/${id}.json`, import.meta.url), 'utf8')));
}

const samples = {
  cordcloud: {
    source: 'checkin-message',
    text: '恭喜您获得 98MB 流量',
    expected: { type: 'traffic', amount: 98, unit: 'MB' }
  },
  jd: {
    source: 'daily-ledger',
    text: '活动奖励京豆 2026-09-09 11:11:38 +2',
    expected: { type: 'points', amount: 2, unit: '京豆' }
  },
  taobao: {
    source: 'today-node',
    text: '已领取 今天 +120',
    expected: { type: 'coins', amount: 120, unit: '淘金币' }
  },
  wps: {
    source: 'today-node',
    text: '积分+1',
    expected: { type: 'points', amount: 1, unit: '积分' }
  }
};

for (const [id, sample] of Object.entries(samples)) {
  test(`${id} adapter parses its verified daily reward evidence`, async () => {
    const platform = await loadPlatform(id);
    assert.equal(platform.signin.rewards.length, 1);
    const rewardConfig = platform.signin.rewards[0];
    const source = rewardConfig.sources.find((item) => item.id === sample.source);
    assert.ok(source, `missing source ${sample.source}`);

    const parsed = parseRewardText(rewardConfig, source, sample.text, { today: '2026-09-09' });
    assert.deepEqual(
      { type: parsed?.type, amount: parsed?.amount, unit: parsed?.unit },
      sample.expected
    );
  });
}

test('JD ledger fallback rejects a previous-day reward', async () => {
  const platform = await loadPlatform('jd');
  const rewardConfig = platform.signin.rewards[0];
  const source = rewardConfig.sources.find((item) => item.id === 'daily-ledger');
  assert.equal(
    parseRewardText(rewardConfig, source, '活动奖励京豆 2026-09-08 18:00:30 +2', { today: '2026-09-09' }),
    null
  );
});

test('all real adapter reward locators execute against representative DOM', async () => {
  const fixtures = {
    cordcloud: '<p id="checkin-msg">恭喜您获得 98MB 流量</p>',
    jd: '<div class="mybean-table"><table><tbody><tr><td>活动奖励京豆</td><td>2026-09-09 11:11:38</td><td>+2</td></tr></tbody></table></div>',
    taobao: '<div class="gold-sign-wrapper"><div class="sign-signed sign-item sign_2">已领取 今天 +120</div></div>',
    wps: '<div class="sign-in-panel__main"><div class="flex flex-col items-center relative"><span>今日</span><div class="record-item-reward-text">积分+1</div></div></div>'
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [id, html] of Object.entries(fixtures)) {
      const platform = await loadPlatform(id);
      await page.setContent(html);
      const rewards = await captureRewards(page, platform.signin.rewards, { today: '2026-09-09' });
      assert.equal(rewards.length, 1, `${id} reward locator did not produce one reward`);
    }
  } finally {
    await browser.close();
  }
});
