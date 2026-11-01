import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { captureRewards, parseRewardText } from '../scripts/lib/reward-capture.mjs';

const pointsReward = { id: 'daily', type: 'points', unit: '京豆' };

test('parses an explicit positive reward into the unified result shape', () => {
  const reward = parseRewardText(pointsReward, {
    id: 'success-popup',
    pattern: '签到成功，恭喜获得京豆\\s*\\+\\s*(\\d+)',
    amountGroup: 1
  }, '签到成功，恭喜获得京豆 + 2 开心收下', { today: '2026-09-09' });

  assert.deepEqual(reward, {
    type: 'points',
    amount: 2,
    unit: '京豆',
    source: 'success-popup',
    confidence: 'explicit',
    evidence: '签到成功，恭喜获得京豆 + 2 开心收下'
  });
});

test('extracts a dynamic traffic unit from a configured capture group', () => {
  const reward = parseRewardText({ id: 'daily', type: 'traffic' }, {
    id: 'checkin-message',
    pattern: '(\\d+(?:\\.\\d+)?)\\s*(GB|MB|TB)',
    amountGroup: 1,
    unitGroup: 2
  }, '恭喜您获得 98MB 流量', { today: '2026-09-09' });

  assert.equal(reward.amount, 98);
  assert.equal(reward.unit, 'MB');
});

test('accepts only a ledger entry whose configured date group is today', () => {
  const source = {
    id: 'daily-ledger',
    pattern: '活动奖励京豆\\s+(\\d{4}-\\d{2}-\\d{2})\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\+(\\d+)',
    todayGroup: 1,
    amountGroup: 2
  };

  assert.equal(parseRewardText(pointsReward, source, '活动奖励京豆 2026-09-08 18:00:30 +2', { today: '2026-09-09' }), null);
  assert.equal(parseRewardText(pointsReward, source, '活动奖励京豆 2026-09-09 11:11:38 +2', { today: '2026-09-09' }).amount, 2);
});

test('rejects zero, negative, and incomplete reward evidence', () => {
  const source = { id: 'message', pattern: '获得\\s*(-?\\d+)\\s*京豆', amountGroup: 1 };
  assert.equal(parseRewardText(pointsReward, source, '获得 0 京豆', { today: '2026-09-09' }), null);
  assert.equal(parseRewardText(pointsReward, source, '获得 -5 京豆', { today: '2026-09-09' }), null);
  assert.equal(parseRewardText({ id: 'daily', type: 'traffic' }, { ...source, unitGroup: 2 }, '签到成功', { today: '2026-09-09' }), null);
});

test('captures a reward from the first matching visible DOM source', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="unrelated">今日最多可赚100金币</div>
      <div id="today">已领取 今天 +120</div>
    `);
    const rewards = await captureRewards(page, [{
      id: 'daily',
      type: 'coins',
      unit: '淘金币',
      sources: [
        { id: 'popup', locator: [{ by: 'css', value: '#missing' }], pattern: '\\+(\\d+)', amountGroup: 1 },
        { id: 'today-node', locator: [{ by: 'css', value: '#today' }], pattern: '已领取\\s*今天\\s*\\+(\\d+)', amountGroup: 1 }
      ]
    }], { today: '2026-09-09' });

    assert.deepEqual(rewards, [{
      type: 'coins',
      amount: 120,
      unit: '淘金币',
      source: 'today-node',
      confidence: 'explicit',
      evidence: '已领取 今天 +120'
    }]);
  } finally {
    await browser.close();
  }
});
