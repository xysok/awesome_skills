import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { validatePlatform } from '../scripts/lib/platform-config.mjs';

async function loadJdPlatform() {
  return JSON.parse(await readFile(new URL('../platforms/jd.json', import.meta.url), 'utf8'));
}

test('JD adapter uses verified component state and vault-backed password login', async () => {
  const platform = validatePlatform(await loadJdPlatform());

  assert.equal(platform.id, 'jd');
  assert.equal(platform.name, '京东');
  assert.equal(platform.startUrl, 'https://bean.jd.com/myJingBean/list');
  assert.deepEqual(platform.login.fields.map(field => field.env), ['JD_USERNAME', 'JD_PASSWORD']);
  assert.deepEqual(platform.signin.action, [
    { by: 'css', value: '#bean-sign-component .btn' }
  ]);
  assert.deepEqual(platform.signin.alreadyWhen, [
    {
      kind: 'visible',
      locator: [{
        by: 'css',
        value: '#bean-sign-component:has(.node.sign-in):not(:has(.node.continuity-no-sign))'
      }]
    }
  ]);
  assert.equal(platform.signin.successTimeoutSeconds, 5);
  assert.deepEqual(platform.signin.successWhen, [
    {
      kind: 'text',
      matches: '签到成功，恭喜获得京豆',
      match: 'includes',
      locator: [{ by: 'css', value: '#bean-sign-component' }]
    },
    {
      kind: 'visible',
      locator: [{
        by: 'css',
        value: '#bean-sign-component:has(.node.sign-in):not(:has(.node.continuity-no-sign))'
      }]
    }
  ]);
});

test('JD adapter recognizes the verified login redirect without allowing password automation', async () => {
  const platform = validatePlatform(await loadJdPlatform());

  assert.ok(platform.allowedOrigins.includes('https://bean.jd.com'));
  assert.ok(platform.allowedOrigins.includes('https://passport.jd.com'));
  assert.deepEqual(platform.session.invalidWhen, [
    { kind: 'url', matches: '/new/login.aspx', match: 'includes' }
  ]);
});
