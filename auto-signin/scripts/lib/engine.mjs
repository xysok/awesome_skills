import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';

import { validatePlatform } from './platform-config.mjs';
import { canFillFirst, checkFirst, clickFirst, evaluateAny, evaluateCondition, fillFirst } from './page-actions.mjs';
import { captureRewards } from './reward-capture.mjs';
import { withRetry } from './retry.mjs';

const SAFE_BROWSER_ENV = new Set([
  'DISPLAY', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH', 'SystemRoot',
  'TEMP', 'TMP', 'TMPDIR', 'TZ', 'USERPROFILE', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'
]);

function headlessValue(options) {
  return options.headless ?? true;
}

function failure(platform, code, message, options) {
  return { status: 'failed', platform: platform.id, code, message, headless: headlessValue(options) };
}

function sanitizedBrowserEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => SAFE_BROWSER_ENV.has(key) && typeof value === 'string')
  );
}

function assertAllowedOrigin(platform, url) {
  const origin = new URL(url).origin;
  if (!platform.allowedOrigins.includes(origin)) {
    throw new Error(`navigation left allowed origins: ${origin}`);
  }
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 1_000 }).catch(() => {});
}

async function gotoWithRetry(page, url) {
  return withRetry(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }), {
    attempts: 2,
    delayMs: 300
  });
}

async function matchingEvidence(page, conditions, previousMatches = null) {
  for (let index = 0; index < (conditions ?? []).length; index += 1) {
    const condition = conditions[index];
    if (await evaluateCondition(page, condition)) {
      if (previousMatches?.[index]) continue;
      if (condition.matches) return condition.matches;
      return `${condition.kind} condition`;
    }
  }
  return null;
}

async function waitForNewSuccessEvidence(page, platform, previousMatches) {
  const timeoutMs = (platform.signin.successTimeoutSeconds ?? 5) * 1_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evidence = await matchingEvidence(page, platform.signin.successWhen, previousMatches);
    if (evidence) return evidence;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function sessionClassification(page, platform) {
  const [valid, invalid] = await Promise.all([
    evaluateAny(page, platform.session.validWhen),
    evaluateAny(page, platform.session.invalidWhen)
  ]);
  if (valid && invalid) return 'conflict';
  if (valid) return 'valid';
  if (invalid) return 'invalid';
  return 'unknown';
}

async function waitForSessionClassification(page, platform, timeoutMs = 5_000, validOnly = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const classification = await sessionClassification(page, platform);
    if (classification === 'valid' || classification === 'conflict' ||
        (!validOnly && classification !== 'unknown')) return classification;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return 'unknown';
}

async function waitForLoginOutcome(page, platform, timeoutMs = 15_000) {
  const challenges = platform.login?.challenges ?? [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const classification = await sessionClassification(page, platform);
    if (classification === 'valid') return {type: 'valid'};
    if (classification === 'conflict') return {type: 'conflict'};
    if (await evaluateAny(page, platform.login?.manualWhen ?? [])) return {type: 'manual'};
    for (const challenge of challenges) {
      if (await evaluateAny(page, challenge.when) &&
          await canFillFirst(page, challenge.input)) {
        return { type: 'challenge', challenge };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { type: 'timeout' };
}

async function waitBeforeSigninAfterLogin(platform) {
  const delayMs = (platform.signin.actionDelaySeconds ?? 0) * 1_000;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function performSignin(page, context, platform, store, options) {
  const alreadyEvidence = await matchingEvidence(page, platform.signin.alreadyWhen);
  if (alreadyEvidence) {
    const rewards = platform.signin.rewards
      ? await captureRewards(page, platform.signin.rewards, { now: options.now })
      : null;
    await store.saveSession(platform.id, await context.storageState());
    return {
      status: 'already_done',
      platform: platform.id,
      evidence: alreadyEvidence,
      ...(rewards ? { rewards } : {}),
      headless: headlessValue(options)
    };
  }

  const previousSuccessMatches = await Promise.all(
    platform.signin.successWhen.map((condition) => evaluateCondition(page, condition))
  );
  await clickFirst(page, platform.signin.action);
  await settle(page);
  assertAllowedOrigin(platform, page.url());
  const successEvidence = await waitForNewSuccessEvidence(page, platform, previousSuccessMatches);
  if (!successEvidence) {
    return failure(platform, 'success_not_verified', 'Signin action completed without new positive success evidence.', options);
  }
  const rewards = platform.signin.rewards
    ? await captureRewards(page, platform.signin.rewards, { now: options.now })
    : null;
  await store.saveSession(platform.id, await context.storageState());
  return {
    status: 'success',
    platform: platform.id,
    evidence: successEvidence,
    ...(rewards ? { rewards } : {}),
    headless: headlessValue(options)
  };
}

export function isAllowedProtectedRequest(platform, origin, isNavigation) {
  return platform.allowedOrigins.includes(origin) ||
    (!isNavigation && (platform.allowedResourceOrigins ?? []).includes(origin));
}

async function openBrowser(platform, storageState, options, operation) {
  const browserType = options.browserType ?? chromium;
  const launchOptions = {
    headless: headlessValue(options),
    env: sanitizedBrowserEnvironment(options.browserEnvSource ?? process.env),
    ...(platform.browser?.launchArgs?.length ? { args: platform.browser.launchArgs } : {}),
    ...(platform.browser?.ignoreDefaultArgs?.length ? { ignoreDefaultArgs: platform.browser.ignoreDefaultArgs } : {}),
    ...(options.executablePath ? { executablePath: options.executablePath } : {})
  };
  const browser = await browserType.launch(launchOptions);
  try {
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      ...(platform.browser?.userAgent ? { userAgent: platform.browser.userAgent } : {}),
      viewport: { width: 1280, height: 900 }
    });
    if (platform.browser?.hideAutomation) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
    }
    const page = await context.newPage();
    let protectedSecrets = false;
    const blockedResourceOrigins = new Set();
    let blockedOrigin;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      if (isAllowedProtectedRequest(platform, origin, request.isNavigationRequest())) {
        await route.continue();
        return;
      }
      if (request.isNavigationRequest()) {
        blockedOrigin = origin;
        await route.abort('blockedbyclient');
        return;
      }
      if (protectedSecrets) {
        blockedResourceOrigins.add(origin);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const allowedHosts = new Set(platform.allowedOrigins.map((origin) => new URL(origin).host));
    await context.routeWebSocket(() => true, async (ws) => {
      const host = new URL(ws.url()).host;
      if (allowedHosts.has(host)) {
        ws.connectToServer();
        return;
      }
      await ws.close({ code: 1008, reason: 'blocked outside allowed origins' });
    });
    const guard = { protectSecrets: () => { protectedSecrets = true; } };
    try {
      const result = await operation(page, context, guard);
      if (options.loginDiagnostics && result.status === 'failed') result.blockedResourceOrigins = [...blockedResourceOrigins].sort();
      if (blockedOrigin) throw new Error(`request blocked outside allowed origins: ${blockedOrigin}`);
      return result;
    } catch (error) {
      if (blockedOrigin) throw new Error(`request blocked outside allowed origins: ${blockedOrigin}`);
      throw error;
    }
  } finally {
    await browser.close();
  }
}

async function captureSessionStorage(page) {
  return page.evaluate(() => ({
    origin: window.location.origin,
    entries: Object.entries(window.sessionStorage)
  }));
}

async function handleChallenge(page, context, platform, challenge, store, options) {
  const checkpoint = await store.saveCheckpoint(platform.id, {
    currentUrl: page.url(),
    storageState: await context.storageState(),
    sessionStorage: await captureSessionStorage(page),
    challengeId: challenge.id
  }, { ttlMs: (challenge.ttlSeconds ?? 600) * 1_000 });

  let screenshotPath;
  if (challenge.captureScreenshot) {
    const screenshot = await page.screenshot({ fullPage: true });
    screenshotPath = await store.saveArtifact(checkpoint.runId, 'challenge.png', screenshot);
  }

  return {
    status: 'needs_input',
    platform: platform.id,
    runId: checkpoint.runId,
    expiresAt: checkpoint.expiresAt,
    challenge: {
      id: challenge.id,
      type: challenge.type,
      prompt: challenge.prompt,
      ...(screenshotPath ? { screenshotPath } : {})
    },
    headless: headlessValue(options)
  };
}

export async function runSignin(platformValue, options) {
  const platform = validatePlatform(platformValue);
  const { store, env = process.env, readAnswer, notify } = options;
  const answerReader = readAnswer ?? (async () => { throw new Error('inline challenge requires an answer reader'); });
  const notifier = notify ?? (() => {});
  let stage = 'load_session';
  let releaseLock;
  try {
    releaseLock = await store.acquireLock(platform.id);
    const pending = await store.findActiveCheckpoint(platform.id);
    if (pending) {
      return failure(platform, 'challenge_pending', `A challenge is already pending until ${pending.expiresAt}.`, options);
    }
    const session = await store.loadSession(platform.id);
    return await openBrowser(platform, session, options, async (page, context, guard) => {
      stage = 'open_start_url';
      await gotoWithRetry(page, platform.startUrl);
      await settle(page);
      assertAllowedOrigin(platform, page.url());

      const classification = await waitForSessionClassification(page, platform);
      if (classification === 'conflict') {
        return failure(platform, 'session_evidence_conflict', 'Both valid and invalid session evidence matched.', options);
      }
      if (classification === 'unknown') {
        return failure(platform, 'session_unknown', 'Neither valid nor invalid session evidence matched.', options);
      }
      if (classification === 'valid') {
        return performSignin(page, context, platform, store, options);
      }
      if (!platform.login) {
        return failure(platform, 'session_expired', 'Session is invalid and no login flow is configured.', options);
      }

      stage = 'prepare_login';
      for (const step of platform.login.prepare ?? []) {
        if (step.action === 'navigate') {
          assertAllowedOrigin(platform, step.url);
          await gotoWithRetry(page, step.url);
        } else if (step.action === 'click') await clickFirst(page, step.locator);
        else if (step.action === 'check') await checkFirst(page, step.locator);
        else if (step.action === 'wait') {
          const deadline = Date.now() + (step.timeoutSeconds ?? 10) * 1000;
          while (!(await evaluateAny(page, step.when))) {
            if (Date.now() >= deadline) throw new Error('Login preparation did not become ready');
            await page.waitForTimeout(200);
          }
        }
        await settle(page);
        assertAllowedOrigin(platform, page.url());
      }

      if (platform.login.captcha) {
        stage = 'captcha';
        const timeoutMs = (platform.login.captcha.timeoutSeconds ?? 120) * 1_000;
        let ready = false;
        const maxAttempts = platform.login.captcha.maxAttempts ?? 1;
        for (let attempt = 1; attempt <= maxAttempts && !ready; attempt += 1) {
          const deadline = Date.now() + timeoutMs;
          let explicitlyFailed = false;
          while (Date.now() < deadline) {
            if (await evaluateAny(page, platform.login.captcha.readyWhen)) { ready = true; break; }
            if (platform.login.captcha.failureWhen && await evaluateAny(page, platform.login.captcha.failureWhen)) {
              explicitlyFailed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!ready && explicitlyFailed && attempt < maxAttempts) {
            stage = `captcha_retry:${attempt + 1}`;
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
            await settle(page);
            assertAllowedOrigin(platform, page.url());
            // Reload discards form state. Reapply only idempotent checkbox steps;
            // replaying navigation or clicks here could reset CAPTCHA indefinitely.
            for (const step of platform.login.prepare ?? []) {
              if (step.action === 'check') await checkFirst(page, step.locator);
            }
          }
        }
        if (!ready) {
          let screenshotPath;
          if (platform.login.captcha.captureScreenshot) {
            screenshotPath = await store.saveArtifact(randomUUID(), 'captcha.png', await page.screenshot({ fullPage: true }));
          }
          const detail = screenshotPath ? ` Screenshot: ${screenshotPath}` : '';
          return failure(platform, 'captcha_unsolved', `Captcha did not become ready within ${timeoutMs} ms.${detail}`, options);
        }
      }

      guard.protectSecrets();
      for (const field of platform.login.fields) {
        stage = `fill_login_field:${field.env}`;
        const value = env[field.env];
        if (!value) {
          return failure(platform, 'missing_secret', `Required environment variable is missing: ${field.env}`, options);
        }
        await fillFirst(page, field.locator, value);
      }

      stage = 'submit_login';
      await clickFirst(page, platform.login.submit);
      await settle(page);
      assertAllowedOrigin(platform, page.url());

      while (true) {
        const outcome = await waitForLoginOutcome(page, platform, options.loginOutcomeTimeoutMs ?? 15_000);
        if (outcome.type === 'manual') {
          return {status: 'needs_input', platform: platform.id, code: 'manual_verification_required',
            challenge: {type: 'captcha', prompt: '账号密码已提交，网站要求人工安全验证；请启动交互登录完成验证。'},
            message: '本次浏览器会关闭，交互登录需重新开始；不能使用旧二维码或提交旧验证码。',
            headless: headlessValue(options)};
        }
        if (outcome.type !== 'challenge') break;
        const challenge = outcome.challenge;
        stage = `challenge:${challenge.id}`;
        if (challenge.resume.mode === 'inline') {
          if (options.interactive === false) {
            return { status: 'needs_input', platform: platform.id,
              code: 'interactive_login_required',
              message: '需要重新启动交互登录，通过受保护输入完成验证；本次浏览器已关闭，不能直接提交验证码。',
              challenge: { id: challenge.id, type: challenge.type,
                prompt: '需要人工验证；请启动交互登录后通过受保护输入完成，不要在聊天中发送验证码。' },
              headless: headlessValue(options) };
          }
          notifier(challenge.prompt ?? `Challenge "${challenge.id}" requires input.`);
          const answer = await answerReader();
          await fillFirst(page, challenge.input, answer);
          await clickFirst(page, challenge.submit);
          const deadline = Date.now() + 10_000;
          let rejected = true;
          while (Date.now() < deadline) {
            await settle(page);
            assertAllowedOrigin(platform, page.url());
            if ((await sessionClassification(page, platform)) === 'valid') { rejected = false; break; }
            if (!(await evaluateAny(page, challenge.when))) { rejected = false; break; }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (rejected) {
            return failure(platform, 'challenge_rejected', `Challenge "${challenge.id}" answer was not accepted.`, options);
          }
          continue;
        }
        return handleChallenge(page, context, platform, challenge, store, options);
      }

      if ((await sessionClassification(page, platform)) !== 'valid') {
        const result = failure(platform, 'login_not_verified', 'Login completed without positive valid-session evidence.', options);
        if (options.loginDiagnostics) result.screenshotPath = await store.saveArtifact(randomUUID(), 'login.png', await page.screenshot({fullPage: true}));
        return result;
      }
      await store.saveSession(platform.id, await context.storageState());
      stage = 'perform_signin';
      await waitBeforeSigninAfterLogin(platform);
      return performSignin(page, context, platform, store, options);
    });
  } catch (error) {
    return failure(platform, 'runtime_error', `${stage}: ${error.message}`, options);
  } finally {
    await releaseLock?.().catch(() => {});
  }
}

export async function resumeSignin(platformValue, runId, answer, options) {
  const platform = validatePlatform(platformValue);
  const { store } = options;
  if (typeof answer !== 'string' || answer.length === 0) {
    return failure(platform, 'missing_challenge_answer', 'A non-empty challenge answer is required.', options);
  }

  let releaseLock;
  let consumeCheckpoint = false;
  try {
    releaseLock = await store.acquireLock(platform.id);
    const checkpoint = await store.loadCheckpoint(runId);
    if (checkpoint.platformId !== platform.id) {
      return failure(platform, 'checkpoint_platform_mismatch', 'Checkpoint belongs to a different platform.', options);
    }
    const challenge = platform.login?.challenges?.find((item) => item.id === checkpoint.challengeId);
    if (!challenge) {
      return failure(platform, 'challenge_not_configured', 'Checkpoint challenge is not present in the platform adapter.', options);
    }

    const result = await openBrowser(platform, checkpoint.storageState, options, async (page, context, guard) => {
      if (checkpoint.sessionStorage) {
        const expectedOrigin = new URL(checkpoint.currentUrl).origin;
        if (checkpoint.sessionStorage.origin !== expectedOrigin || !Array.isArray(checkpoint.sessionStorage.entries)) {
          throw new Error('checkpoint sessionStorage is invalid');
        }
        await context.addInitScript(({ origin, entries }) => {
          if (window.location.origin !== origin) return;
          for (const [key, value] of entries) window.sessionStorage.setItem(key, value);
        }, checkpoint.sessionStorage);
      }
      await gotoWithRetry(page, checkpoint.currentUrl);
      await settle(page);
      assertAllowedOrigin(platform, page.url());
      const resumedOutcome = await waitForLoginOutcome(page, platform, options.loginOutcomeTimeoutMs ?? 15_000);
      if (resumedOutcome.type === 'valid') {
        consumeCheckpoint = true;
        return performSignin(page, context, platform, store, options);
      }
      if (resumedOutcome.type !== 'challenge' || resumedOutcome.challenge.id !== challenge.id) {
        consumeCheckpoint = true;
        return failure(platform, 'challenge_not_present', 'The saved challenge is no longer actionable; start a fresh login.', options);
      }
      guard.protectSecrets();
      consumeCheckpoint = true;
      await fillFirst(page, challenge.input, answer);
      await clickFirst(page, challenge.submit);
      await settle(page);
      assertAllowedOrigin(platform, page.url());
      if ((await waitForSessionClassification(page, platform, options.loginOutcomeTimeoutMs ?? 15_000, true)) !== 'valid') {
        return failure(platform, 'challenge_rejected', 'Challenge answer was not accepted or login was not verified.', options);
      }
      await store.saveSession(platform.id, await context.storageState());
      await waitBeforeSigninAfterLogin(platform);
      return performSignin(page, context, platform, store, options);
    });
    if (consumeCheckpoint) await store.deleteCheckpoint(runId);
    return result;
  } catch (error) {
    if (consumeCheckpoint) await store.deleteCheckpoint(runId).catch(() => {});
    return failure(platform, 'runtime_error', error.message, options);
  } finally {
    await releaseLock?.().catch(() => {});
  }
}
