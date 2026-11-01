import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { clickFirst, evaluateAny, fillFirst } from '../scripts/lib/page-actions.mjs';

async function withPage(html, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(html);
    await run(page);
  } finally {
    await browser.close();
  }
}

test('uses fallback locators and fills a labeled input headlessly', async () => {
  await withPage('<label>Email <input id="email"></label>', async (page) => {
    const used = await fillFirst(page, [
      { by: 'css', value: '#missing' },
      { by: 'label', value: 'Email' }
    ], 'user@example.test');

    assert.equal(used.by, 'label');
    assert.equal(await page.locator('#email').inputValue(), 'user@example.test');
  });
});

test('clicks an image-only control through image metadata', async () => {
  await withPage(`
    <button id="checkin" onclick="document.body.dataset.clicked='yes'">
      <img src="/assets/daily-checkin.png" alt="">
    </button>
  `, async (page) => {
    const used = await clickFirst(page, [{ by: 'image', srcIncludes: 'daily-checkin.png' }]);

    assert.equal(used.by, 'image');
    assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes');
  });
});

test('clicks a bare input image submit control', async () => {
  await withPage(`
    <form onsubmit="event.preventDefault();document.body.dataset.clicked='input-image'">
      <input type="image" src="/assets/checkin-submit.png">
    </form>
  `, async (page) => {
    await clickFirst(page, [{ by: 'image', srcIncludes: 'checkin-submit.png' }]);
    assert.equal(await page.locator('body').getAttribute('data-clicked'), 'input-image');
  });
});

test('uses explicit DOM click for a continuously moving element', async () => {
  await withPage(`
    <style>
      @keyframes move { from { transform: translateX(0); } to { transform: translateX(20px); } }
      #moving { animation: move 50ms linear infinite alternate; }
    </style>
    <div id="moving" onclick="document.body.dataset.clicked='dom'">Sign</div>
  `, async (page) => {
    page.setDefaultTimeout(500);
    const used = await clickFirst(page, [{ by: 'css', value: '#moving', clickMode: 'dom' }]);

    assert.equal(used.clickMode, 'dom');
    assert.equal(await page.locator('body').getAttribute('data-clicked'), 'dom');
  });
});

test('supports explicit relative points for canvas-only controls', async () => {
  await withPage(`
    <button style="position:fixed;left:360px;top:270px;width:80px;height:60px" onclick="document.body.dataset.clicked='point'"></button>
  `, async (page) => {
    await clickFirst(page, [{ by: 'point', xRatio: 0.5, yRatio: 0.5 }]);
    assert.equal(await page.locator('body').getAttribute('data-clicked'), 'point');
  });
});

test('evaluates URL, visibility, hidden, and text evidence without treating absence as hidden', async () => {
  await withPage('<main id="main"><div id="ok" class="cap-verified">Signed today</div><div id="hidden" hidden></div></main>', async (page) => {
    assert.equal(await evaluateAny(page, [{ kind: 'text', matches: 'Signed today', match: 'includes' }]), true);
    assert.equal(await evaluateAny(page, [{ kind: 'visible', locator: [{ by: 'css', value: '#ok' }] }]), true);
    assert.equal(await evaluateAny(page, [{ kind: 'hidden', locator: [{ by: 'css', value: '#hidden' }] }]), true);
    assert.equal(await evaluateAny(page, [{ kind: 'hidden', locator: [{ by: 'css', value: '#missing' }] }]), false);
    assert.equal(await evaluateAny(page, [{ kind: 'url', matches: 'not-present', match: 'includes' }]), false);
    assert.equal(await evaluateAny(page, [{ kind: 'class', locator: [{ by: 'css', value: '#ok' }], has: 'cap-verified' }]), true);
    assert.equal(await evaluateAny(page, [{ kind: 'class', locator: [{ by: 'css', value: '#ok' }], has: 'nope' }]), false);
    assert.equal(await evaluateAny(page, [{ kind: 'class', locator: [{ by: 'css', value: '#main' }], has: 'cap-verified' }]), false);
  });
});

test('uses locator fallbacks when evaluating scoped text evidence', async () => {
  await withPage('<div id="result">Signin succeeded</div>', async (page) => {
    assert.equal(await evaluateAny(page, [{
      kind: 'text',
      matches: 'Signin succeeded',
      match: 'equals',
      locator: [{ by: 'css', value: '#missing' }, { by: 'css', value: '#result' }]
    }]), true);
  });
});

test('does not choose an ambiguous locator without an explicit index', async () => {
  await withPage('<button>Sign</button><button>Sign</button>', async (page) => {
    await assert.rejects(
      clickFirst(page, [{ by: 'role', role: 'button', name: 'Sign' }]),
      /ambiguous/
    );
  });
});
