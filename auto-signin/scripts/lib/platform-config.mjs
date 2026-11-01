const LOCATOR_STRATEGIES = new Set([
  'css',
  'role',
  'label',
  'text',
  'testId',
  'image',
  'point'
]);

const CONDITION_KINDS = new Set(['url', 'visible', 'hidden', 'text', 'value', 'class']);
const REWARD_TYPES = new Set(['traffic', 'points', 'coins', 'cash', 'coupon', 'item', 'unknown']);

function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function validateLocator(locator, path, { allowClickMode = false } = {}) {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    throw new Error(`${path} must be an object`);
  }
  if (!LOCATOR_STRATEGIES.has(locator.by)) {
    throw new Error(`${path} uses unsupported locator strategy: ${String(locator.by)}`);
  }

  if (locator.by === 'role') {
    requireString(locator.role, `${path}.role`);
    requireString(locator.name, `${path}.name`);
  } else if (locator.by === 'image') {
    if (![locator.alt, locator.title, locator.srcIncludes].some((value) => typeof value === 'string' && value.length > 0)) {
      throw new Error(`${path} image locator requires alt, title, or srcIncludes`);
    }
  } else if (locator.by === 'point') {
    for (const key of ['xRatio', 'yRatio']) {
      if (typeof locator[key] !== 'number' || locator[key] < 0 || locator[key] > 1) {
        throw new Error(`${path}.${key} must be between 0 and 1`);
      }
    }
  } else {
    requireString(locator.value, `${path}.value`);
  }

  if (locator.frame !== undefined) {
    requireString(locator.frame, `${path}.frame`);
    if (locator.by === 'point') throw new Error(`${path}.frame cannot be used with point locators`);
  }
  if (locator.index !== undefined && (!Number.isInteger(locator.index) || locator.index < 0)) {
    throw new Error(`${path}.index must be a non-negative integer`);
  }
  if (locator.clickMode !== undefined) {
    if (!allowClickMode) throw new Error(`${path}.clickMode is allowed only for action locators`);
    if (locator.clickMode !== 'dom') throw new Error(`${path}.clickMode must be dom`);
    if (locator.by === 'point') throw new Error(`${path}.clickMode cannot be used with point locators`);
  }
}

function validateLocatorChain(value, path, options = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain at least one locator`);
  }
  value.forEach((locator, index) => validateLocator(locator, `${path}[${index}]`, options));
}

function validateConditions(value, path, { required = true, outcome = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${path} must contain${required ? ' at least one' : ''} condition`);
  }
  value.forEach((condition, index) => {
    const conditionPath = `${path}[${index}]`;
    if (!condition || typeof condition !== 'object' || !CONDITION_KINDS.has(condition.kind)) {
      throw new Error(`${conditionPath}.kind is unsupported`);
    }
    if (outcome && condition.kind === 'hidden') {
      throw new Error(`${conditionPath} cannot use hidden as positive outcome evidence`);
    }
    if (outcome && condition.kind === 'value') {
      throw new Error(`${conditionPath} cannot use value as outcome evidence`);
    }
    if (outcome && condition.kind === 'class') {
      throw new Error(`${conditionPath} cannot use class as outcome evidence`);
    }
    if (condition.kind === 'url' || condition.kind === 'text') {
      requireString(condition.matches, `${conditionPath}.matches`);
      if (!['equals', 'includes'].includes(condition.match)) {
        throw new Error(`${conditionPath}.match must be equals or includes`);
      }
    }
    if (condition.kind === 'value') {
      validateLocatorChain(condition.locator, `${conditionPath}.locator`);
      const hasMinLength = condition.minLength !== undefined;
      const hasMatches = condition.matches !== undefined;
      if (!hasMinLength && !hasMatches) {
        throw new Error(`${conditionPath} value condition requires minLength or matches`);
      }
      if (hasMinLength && (!Number.isInteger(condition.minLength) || condition.minLength < 0)) {
        throw new Error(`${conditionPath}.minLength must be a non-negative integer`);
      }
      if (hasMatches) {
        requireString(condition.matches, `${conditionPath}.matches`);
        if (!['equals', 'includes'].includes(condition.match)) {
          throw new Error(`${conditionPath}.match must be equals or includes`);
        }
      }
    }
    if (condition.kind === 'class') {
      validateLocatorChain(condition.locator, `${conditionPath}.locator`);
      requireString(condition.has, `${conditionPath}.has`);
    }
    if (outcome && condition.kind === 'text' && condition.locator === undefined) {
      throw new Error(`${conditionPath} text outcome evidence requires a scoped locator`);
    }
    if (outcome && condition.kind === 'url' && condition.match !== 'equals') {
      throw new Error(`${conditionPath} URL outcome evidence must use exact matching`);
    }
    if (condition.kind === 'visible' || condition.kind === 'hidden' || condition.locator !== undefined) {
      validateLocatorChain(condition.locator, `${conditionPath}.locator`);
    }
  });
}

function validateRewards(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain at least one reward`);
  }
  const rewardIds = new Set();
  value.forEach((reward, rewardIndex) => {
    const rewardPath = `${path}[${rewardIndex}]`;
    requireString(reward?.id, `${rewardPath}.id`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(reward.id) || rewardIds.has(reward.id)) {
      throw new Error(`${rewardPath}.id must be a unique safe reward identifier`);
    }
    rewardIds.add(reward.id);
    if (!REWARD_TYPES.has(reward.type)) throw new Error(`${rewardPath}.type is unsupported`);
    if (reward.unit !== undefined) requireString(reward.unit, `${rewardPath}.unit`);
    if (!Array.isArray(reward.sources) || reward.sources.length === 0) {
      throw new Error(`${rewardPath}.sources must contain at least one reward source`);
    }

    const sourceIds = new Set();
    reward.sources.forEach((source, sourceIndex) => {
      const sourcePath = `${rewardPath}.sources[${sourceIndex}]`;
      requireString(source?.id, `${sourcePath}.id`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id) || sourceIds.has(source.id)) {
        throw new Error(`${sourcePath}.id must be a unique safe reward source identifier`);
      }
      sourceIds.add(source.id);
      validateLocatorChain(source.locator, `${sourcePath}.locator`);
      requireString(source.pattern, `${sourcePath}.pattern`);
      if (source.pattern.length > 512 || /[\r\n]/.test(source.pattern)) {
        throw new Error(`${sourcePath}.pattern must be a single-line reward pattern of at most 512 characters`);
      }
      try {
        new RegExp(source.pattern, source.caseInsensitive ? 'iu' : 'u');
      } catch {
        throw new Error(`${sourcePath}.pattern must be a valid reward pattern`);
      }
      if (!Number.isInteger(source.amountGroup) || source.amountGroup < 1) {
        throw new Error(`${sourcePath}.amountGroup must be a positive reward capture group`);
      }
      for (const groupName of ['unitGroup', 'todayGroup']) {
        if (source[groupName] !== undefined && (!Number.isInteger(source[groupName]) || source[groupName] < 1)) {
          throw new Error(`${sourcePath}.${groupName} must be a positive reward capture group`);
        }
      }
      if (reward.unit === undefined && source.unitGroup === undefined) {
        throw new Error(`${sourcePath} requires reward.unit or unitGroup`);
      }
      if (source.caseInsensitive !== undefined && typeof source.caseInsensitive !== 'boolean') {
        throw new Error(`${sourcePath}.caseInsensitive must be boolean`);
      }
    });
  });
}

export function validatePlatform(platform) {
  if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
    throw new Error('platform must be an object');
  }
  if (platform._draft === true) {
    throw new Error('platform is still a draft; confirm selectors, remove _draft, and validate again');
  }
  if (platform.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1');
  }
  requireString(platform.id, 'id');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(platform.id)) {
    throw new Error('id must contain lowercase letters, digits, or hyphens');
  }
  requireString(platform.name, 'name');
  requireString(platform.startUrl, 'startUrl');

  if (!Array.isArray(platform.allowedOrigins) || platform.allowedOrigins.length === 0) {
    throw new Error('allowedOrigins must contain at least one origin');
  }
  if (platform.allowedResourceOrigins !== undefined && !Array.isArray(platform.allowedResourceOrigins)) throw new Error('allowedResourceOrigins must be an array');
  [...platform.allowedOrigins, ...(platform.allowedResourceOrigins ?? [])].forEach((origin, index) => {
    requireString(origin, `allowedOrigins[${index}]`);
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`allowedOrigins[${index}] must be an http(s) origin`);
    }
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new Error(`allowedOrigins[${index}] must use HTTPS (plain HTTP is allowed only for loopback fixtures)`);
    }
  });
  if (!platform.allowedOrigins.includes(new URL(platform.startUrl).origin)) {
    throw new Error('startUrl origin must be listed in allowedOrigins');
  }

  if (platform.browser !== undefined) {
    if (!platform.browser || typeof platform.browser !== 'object' || Array.isArray(platform.browser)) {
      throw new Error('browser must be an object');
    }
    if (platform.browser.launchArgs !== undefined) {
      if (!Array.isArray(platform.browser.launchArgs)) throw new Error('browser.launchArgs must be an array');
      platform.browser.launchArgs.forEach((arg, index) => {
        if (typeof arg !== 'string' || !arg.startsWith('--') || /[\r\n]/.test(arg)) {
          throw new Error(`browser.launchArgs[${index}] must be a safe --flag string`);
        }
      });
    }
    if (platform.browser.ignoreDefaultArgs !== undefined) {
      if (!Array.isArray(platform.browser.ignoreDefaultArgs)) throw new Error('browser.ignoreDefaultArgs must be a flag array, never a boolean');
      platform.browser.ignoreDefaultArgs.forEach((arg, index) => {
        if (typeof arg !== 'string' || !arg.startsWith('--') || /[\r\n]/.test(arg)) {
          throw new Error(`browser.ignoreDefaultArgs[${index}] must be a safe --flag string`);
        }
      });
    }
    if (platform.browser.userAgent !== undefined &&
        (typeof platform.browser.userAgent !== 'string' || platform.browser.userAgent.trim() === '')) {
      throw new Error('browser.userAgent must be a non-empty string');
    }
    if (platform.browser.hideAutomation !== undefined && typeof platform.browser.hideAutomation !== 'boolean') {
      throw new Error('browser.hideAutomation must be a boolean');
    }
  }

  if (!platform.session || typeof platform.session !== 'object') {
    throw new Error('session is required');
  }
  validateConditions(platform.session.validWhen, 'session.validWhen', { outcome: true });
  validateConditions(platform.session.invalidWhen, 'session.invalidWhen');

  if (platform.login !== undefined) {
    if (!platform.login || typeof platform.login !== 'object' || !Array.isArray(platform.login.fields) || platform.login.fields.length === 0) {
      throw new Error('login.fields must contain at least one field');
    }
    if (platform.login.manualWhen !== undefined) validateConditions(platform.login.manualWhen, 'login.manualWhen');
    if (platform.login.prepare !== undefined) {
      if (!Array.isArray(platform.login.prepare)) throw new Error('login.prepare must be an array');
      for (const [index, step] of platform.login.prepare.entries()) {
        const path = `login.prepare[${index}]`;
        if (!step || !['navigate', 'click', 'check', 'wait'].includes(step.action)) throw new Error(`${path} has unsupported action`);
        if (step.action === 'navigate') {
          requireString(step.url, `${path}.url`);
          if (!platform.allowedOrigins.includes(new URL(step.url).origin)) throw new Error(`${path}.url is outside allowed origins`);
        } else if (step.action === 'wait') {
          validateConditions(step.when, `${path}.when`);
          if (step.timeoutSeconds !== undefined && (!Number.isInteger(step.timeoutSeconds) || step.timeoutSeconds < 1 || step.timeoutSeconds > 30)) throw new Error(`${path}.timeoutSeconds must be 1..30`);
        } else validateLocatorChain(step.locator, `${path}.locator`, {allowClickMode: step.action === 'click'});
      }
    }
    platform.login.fields.forEach((field, index) => {
      const fieldPath = `login.fields[${index}]`;
      if (!field || typeof field !== 'object') throw new Error(`${fieldPath} must be an object`);
      requireString(field.env, `${fieldPath}.env`);
      if (!/^[A-Z_][A-Z0-9_]*$/.test(field.env)) {
        throw new Error(`${fieldPath}.env must be an uppercase environment variable name`);
      }
      validateLocatorChain(field.locator, `${fieldPath}.locator`);
    });
    validateLocatorChain(platform.login.submit, 'login.submit', { allowClickMode: true });
    if (platform.login.captcha !== undefined) {
      if (!platform.login.captcha || typeof platform.login.captcha !== 'object' || Array.isArray(platform.login.captcha)) {
        throw new Error('login.captcha must be an object');
      }
      validateConditions(platform.login.captcha.readyWhen, 'login.captcha.readyWhen');
      if (platform.login.captcha.failureWhen !== undefined) {
        validateConditions(platform.login.captcha.failureWhen, 'login.captcha.failureWhen');
      }
      const timeoutSeconds = platform.login.captcha.timeoutSeconds;
      if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 600)) {
        throw new Error('login.captcha.timeoutSeconds must be an integer from 5 to 600');
      }
      if (platform.login.captcha.captureScreenshot !== undefined && typeof platform.login.captcha.captureScreenshot !== 'boolean') {
        throw new Error('login.captcha.captureScreenshot must be a boolean');
      }
      if (platform.login.captcha.maxAttempts !== undefined &&
          (!Number.isInteger(platform.login.captcha.maxAttempts) ||
           platform.login.captcha.maxAttempts < 1 || platform.login.captcha.maxAttempts > 3)) {
        throw new Error('login.captcha.maxAttempts must be an integer from 1 to 3');
      }
    }
    if (platform.login.challenges !== undefined) {
      if (!Array.isArray(platform.login.challenges)) throw new Error('login.challenges must be an array');
      const challengeIds = new Set();
      platform.login.challenges.forEach((challenge, index) => {
        const challengePath = `login.challenges[${index}]`;
        requireString(challenge?.id, `${challengePath}.id`);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(challenge.id)) {
          throw new Error(`${challengePath}.id must be a safe identifier`);
        }
        if (challengeIds.has(challenge.id)) throw new Error(`duplicate challenge id: ${challenge.id}`);
        challengeIds.add(challenge.id);
        if (!['otp', 'captcha', 'text'].includes(challenge.type)) {
          throw new Error(`${challengePath}.type is unsupported`);
        }
        requireString(challenge.prompt, `${challengePath}.prompt`);
        validateConditions(challenge.when, `${challengePath}.when`);
        validateLocatorChain(challenge.input, `${challengePath}.input`);
        validateLocatorChain(challenge.submit, `${challengePath}.submit`, { allowClickMode: true });
        if (!challenge.resume || !['reload', 'inline'].includes(challenge.resume.mode)) {
          throw new Error(`${challengePath}.resume.mode must be reload or inline`);
        }
        if (challenge.ttlSeconds !== undefined &&
            (!Number.isInteger(challenge.ttlSeconds) || challenge.ttlSeconds < 30 || challenge.ttlSeconds > 3600)) {
          throw new Error(`${challengePath}.ttlSeconds must be an integer from 30 to 3600`);
        }
        if (challenge.captureScreenshot !== undefined && typeof challenge.captureScreenshot !== 'boolean') {
          throw new Error(`${challengePath}.captureScreenshot must be boolean`);
        }
      });
    }
  }

  if (!platform.signin || typeof platform.signin !== 'object') {
    throw new Error('signin is required');
  }
  validateLocatorChain(platform.signin.action, 'signin.action', { allowClickMode: true });
  validateConditions(platform.signin.successWhen, 'signin.successWhen', { outcome: true });
  if (platform.signin.successTimeoutSeconds !== undefined &&
      (!Number.isInteger(platform.signin.successTimeoutSeconds) ||
       platform.signin.successTimeoutSeconds < 1 || platform.signin.successTimeoutSeconds > 60)) {
    throw new Error('signin.successTimeoutSeconds must be an integer from 1 to 60');
  }
  if (platform.signin.actionDelaySeconds !== undefined &&
      (!Number.isInteger(platform.signin.actionDelaySeconds) ||
       platform.signin.actionDelaySeconds < 1 || platform.signin.actionDelaySeconds > 10)) {
    throw new Error('signin.actionDelaySeconds must be an integer from 1 to 10');
  }
  if (platform.signin.alreadyWhen !== undefined) {
    validateConditions(platform.signin.alreadyWhen, 'signin.alreadyWhen', { required: false, outcome: true });
  }
  if (platform.signin.rewards !== undefined) {
    validateRewards(platform.signin.rewards, 'signin.rewards');
  }

  return platform;
}

export { validateConditions, validateLocatorChain };
