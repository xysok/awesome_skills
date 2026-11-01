import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePlatform } from '../scripts/lib/platform-config.mjs';

const validPlatform = {
  schemaVersion: 1,
  id: 'demo',
  name: 'Demo',
  startUrl: 'https://example.test/account',
  allowedOrigins: ['https://example.test'],
  session: {
    validWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#account' }] }],
    invalidWhen: [{ kind: 'url', matches: '/login', match: 'includes' }]
  },
  signin: {
    action: [{ by: 'role', role: 'button', name: 'Sign in' }],
    successWhen: [{ kind: 'text', matches: 'Signed today', match: 'equals', locator: [{ by: 'css', value: '#status' }] }],
    alreadyWhen: [{ kind: 'text', matches: 'Already signed', match: 'equals', locator: [{ by: 'css', value: '#status' }] }]
  }
};

test('accepts a minimal platform with positive session and signin evidence', () => {
  assert.deepEqual(validatePlatform(validPlatform), validPlatform);
});

test('validates the bounded signin success timeout', () => {
  const value = structuredClone(validPlatform);
  value.signin.successTimeoutSeconds = 5;
  assert.deepEqual(validatePlatform(value), value);

  for (const invalid of [0, 61, 1.5, '5']) {
    value.signin.successTimeoutSeconds = invalid;
    assert.throws(() => validatePlatform(value), /successTimeoutSeconds/);
  }
});

test('accepts declarative reward sources with static or captured units', () => {
  const value = structuredClone(validPlatform);
  value.signin.rewards = [
    {
      id: 'daily-points',
      type: 'points',
      unit: '京豆',
      sources: [{
        id: 'ledger',
        locator: [{ by: 'css', value: 'table tbody tr', index: 0 }],
        pattern: '活动奖励京豆\\s+(\\d{4}-\\d{2}-\\d{2}).*?\\+(\\d+)',
        todayGroup: 1,
        amountGroup: 2
      }]
    },
    {
      id: 'daily-traffic',
      type: 'traffic',
      sources: [{
        id: 'message',
        locator: [{ by: 'css', value: '#checkin-msg' }],
        pattern: '(\\d+(?:\\.\\d+)?)\\s*(GB|MB|TB)',
        amountGroup: 1,
        unitGroup: 2,
        caseInsensitive: true
      }]
    }
  ];

  assert.deepEqual(validatePlatform(value), value);
});

test('rejects unsafe or incomplete reward source declarations', () => {
  const invalidValues = [];

  const noUnit = structuredClone(validPlatform);
  noUnit.signin.rewards = [{
    id: 'daily', type: 'points',
    sources: [{ id: 'message', locator: [{ by: 'css', value: '#msg' }], pattern: '(\\d+)', amountGroup: 1 }]
  }];
  invalidValues.push(noUnit);

  const badPattern = structuredClone(validPlatform);
  badPattern.signin.rewards = [{
    id: 'daily', type: 'points', unit: '积分',
    sources: [{ id: 'message', locator: [{ by: 'css', value: '#msg' }], pattern: '(', amountGroup: 1 }]
  }];
  invalidValues.push(badPattern);

  const badGroup = structuredClone(validPlatform);
  badGroup.signin.rewards = [{
    id: 'daily', type: 'points', unit: '积分',
    sources: [{ id: 'message', locator: [{ by: 'css', value: '#msg' }], pattern: '(\\d+)', amountGroup: 0 }]
  }];
  invalidValues.push(badGroup);

  const duplicateSource = structuredClone(validPlatform);
  const source = { id: 'message', locator: [{ by: 'css', value: '#msg' }], pattern: '(\\d+)', amountGroup: 1 };
  duplicateSource.signin.rewards = [{ id: 'daily', type: 'points', unit: '积分', sources: [source, structuredClone(source)] }];
  invalidValues.push(duplicateSource);

  for (const value of invalidValues) {
    assert.throws(() => validatePlatform(value), /reward/i);
  }
});

test('rejects adapters without allowed origins', () => {
  const value = structuredClone(validPlatform);
  value.allowedOrigins = [];
  assert.throws(() => validatePlatform(value), /allowedOrigins/);
});

test('rejects signin flows without positive success evidence', () => {
  const value = structuredClone(validPlatform);
  value.signin.successWhen = [];
  assert.throws(() => validatePlatform(value), /successWhen/);
});

test('rejects arbitrary javascript locator strategies', () => {
  const value = structuredClone(validPlatform);
  value.signin.action = [{ by: 'javascript', value: 'document.body.click()' }];
  assert.throws(() => validatePlatform(value), /locator strategy/);
});

test('validates the constrained DOM click mode', () => {
  const value = structuredClone(validPlatform);
  value.signin.action = [{ by: 'css', value: '#moving', clickMode: 'dom' }];
  assert.deepEqual(validatePlatform(value), value);

  value.signin.action[0].clickMode = 'javascript';
  assert.throws(() => validatePlatform(value), /clickMode/);

  value.signin.action = [{ by: 'point', xRatio: 0.5, yRatio: 0.5, clickMode: 'dom' }];
  assert.throws(() => validatePlatform(value), /clickMode/);
});

test('validates login fields and challenge controls', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    challenges: [{
      id: 'otp',
      type: 'otp',
      prompt: 'Enter the code.',
      when: [{ kind: 'url', matches: '/otp', match: 'includes' }],
      input: [{ by: 'css', value: '#code' }],
      submit: [{ by: 'css', value: '#verify' }],
      resume: { mode: 'reload' },
      ttlSeconds: 120
    }]
  };
  assert.deepEqual(validatePlatform(value), value);

  value.login.challenges[0].input = [];
  assert.throws(() => validatePlatform(value), /challenge.*input/i);
});

test('rejects credentials embedded directly in a platform adapter', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ value: 'secret', locator: [{ by: 'css', value: '#password' }] }],
    submit: [{ by: 'css', value: '#login' }]
  };
  assert.throws(() => validatePlatform(value), /env/);
});

test('rejects plain HTTP except for loopback fixture origins', () => {
  const insecure = structuredClone(validPlatform);
  insecure.startUrl = 'http://example.test/account';
  insecure.allowedOrigins = ['http://example.test'];
  assert.throws(() => validatePlatform(insecure), /HTTPS/);

  insecure.startUrl = 'http://localhost/account';
  insecure.allowedOrigins = ['http://localhost'];
  assert.throws(() => validatePlatform(insecure), /HTTPS/);

  const loopback = structuredClone(validPlatform);
  loopback.startUrl = 'http://127.0.0.1:4321/account';
  loopback.allowedOrigins = ['http://127.0.0.1:4321'];
  assert.deepEqual(validatePlatform(loopback), loopback);
});

test('rejects weak hidden outcome evidence', () => {
  for (const target of ['validWhen', 'successWhen', 'alreadyWhen']) {
    const value = structuredClone(validPlatform);
    const owner = target === 'validWhen' ? value.session : value.signin;
    owner[target] = [{ kind: 'hidden', locator: [{ by: 'css', value: '#missing' }] }];
    assert.throws(() => validatePlatform(value), /hidden.*outcome/i);
  }
});

test('requires an explicit reload-safe challenge resume strategy and unique ids', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    challenges: [{
      id: 'otp', type: 'otp', prompt: 'Enter the code.',
      when: [{ kind: 'url', matches: '/otp', match: 'includes' }],
      input: [{ by: 'css', value: '#code' }],
      submit: [{ by: 'css', value: '#verify' }]
    }]
  };
  assert.throws(() => validatePlatform(value), /resume.*reload/i);

  value.login.challenges[0].resume = { mode: 'reload' };
  value.login.challenges.push(structuredClone(value.login.challenges[0]));
  assert.throws(() => validatePlatform(value), /duplicate challenge id/i);
});

test('accepts a per-platform browser config with launch args, user agent, and automation hiding', () => {
  const value = structuredClone(validPlatform);
  value.browser = {
    launchArgs: ['--no-proxy-server', '--disable-blink-features=AutomationControlled'],
    userAgent: 'Mozilla/5.0 (custom)',
    hideAutomation: true
  };
  assert.deepEqual(validatePlatform(value), value);
});

test('rejects malformed browser launch args and user agent', () => {
  const value = structuredClone(validPlatform);
  value.browser = { launchArgs: '--no-proxy-server' };
  assert.throws(() => validatePlatform(value), /launchArgs/);

  value.browser = { launchArgs: ['not-a-flag'] };
  assert.throws(() => validatePlatform(value), /launchArgs/);

  value.browser = { launchArgs: ['--ok\n--injected'] };
  assert.throws(() => validatePlatform(value), /launchArgs/);

  value.browser = { userAgent: '' };
  assert.throws(() => validatePlatform(value), /userAgent/);
});

test('accepts a value condition and rejects value as outcome evidence', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    captcha: {
      readyWhen: [{ kind: 'value', locator: [{ by: 'css', value: 'input[name=cap-token]' }], minLength: 10 }],
      timeoutSeconds: 60
    }
  };
  assert.deepEqual(validatePlatform(value), value);

  value.login.captcha.readyWhen = [{ kind: 'value', locator: [{ by: 'css', value: 'input[name=cap-token]' }] }];
  assert.throws(() => validatePlatform(value), /minLength or matches/);

  const outcome = structuredClone(validPlatform);
  outcome.session.validWhen = [{ kind: 'value', locator: [{ by: 'css', value: 'input' }], minLength: 1 }];
  assert.throws(() => validatePlatform(outcome), /value.*outcome/i);
});

test('validates the captcha gate and requires a ready condition', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    captcha: {}
  };
  assert.throws(() => validatePlatform(value), /captcha.*readyWhen/i);

  value.login.captcha = { readyWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#captcha-done' }] }], timeoutSeconds: 4 };
  assert.throws(() => validatePlatform(value), /timeoutSeconds/);
});

test('validates bounded captcha failure retries', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    captcha: {
      readyWhen: [{ kind: 'visible', locator: [{ by: 'css', value: '#captcha-done' }] }],
      failureWhen: [{ kind: 'text', matches: 'Verification failed', match: 'includes' }],
      timeoutSeconds: 30,
      maxAttempts: 2
    }
  };
  assert.deepEqual(validatePlatform(value), value);

  value.login.captcha.maxAttempts = 0;
  assert.throws(() => validatePlatform(value), /maxAttempts/);
  value.login.captcha.maxAttempts = 4;
  assert.throws(() => validatePlatform(value), /maxAttempts/);
});

test('validates a bounded delay before the signin action', () => {
  const value = structuredClone(validPlatform);
  value.signin.actionDelaySeconds = 2;
  assert.deepEqual(validatePlatform(value), value);

  for (const invalid of [0, 11, 1.5, '2']) {
    value.signin.actionDelaySeconds = invalid;
    assert.throws(() => validatePlatform(value), /actionDelaySeconds/);
  }
});

test('accepts an inline challenge mode alongside reload', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    challenges: [{
      id: 'twofa', type: 'otp', prompt: 'Enter the emailed code.',
      when: [{ kind: 'url', matches: '/2fa', match: 'includes' }],
      input: [{ by: 'css', value: '#code' }],
      submit: [{ by: 'css', value: '#verify' }],
      resume: { mode: 'inline' }
    }]
  };
  assert.deepEqual(validatePlatform(value), value);

  value.login.challenges[0].resume = { mode: 'rewind' };
  assert.throws(() => validatePlatform(value), /resume.*mode/);
});

test('accepts a class condition and rejects it as outcome evidence or without a class name', () => {
  const value = structuredClone(validPlatform);
  value.login = {
    fields: [{ env: 'DEMO_USER', locator: [{ by: 'css', value: '#user' }] }],
    submit: [{ by: 'css', value: '#login' }],
    captcha: {
      readyWhen: [{ kind: 'class', locator: [{ by: 'css', value: '#cap-container' }], has: 'cap-verified' }],
      timeoutSeconds: 60
    }
  };
  assert.deepEqual(validatePlatform(value), value);

  value.login.captcha.readyWhen = [{ kind: 'class', locator: [{ by: 'css', value: '#cap-container' }] }];
  assert.throws(() => validatePlatform(value), /\.has/);

  const outcome = structuredClone(validPlatform);
  outcome.session.validWhen = [{ kind: 'class', locator: [{ by: 'css', value: '#x' }], has: 'ok' }];
  assert.throws(() => validatePlatform(outcome), /class.*outcome/i);
});
