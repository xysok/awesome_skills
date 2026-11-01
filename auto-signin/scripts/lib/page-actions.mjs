function locatorFor(page, strategy) {
  if (strategy.frame) page = page.frameLocator(strategy.frame);
  switch (strategy.by) {
    case 'css':
      return page.locator(strategy.value);
    case 'role':
      return page.getByRole(strategy.role, { name: strategy.name, exact: strategy.exact ?? true });
    case 'label':
      return page.getByLabel(strategy.value, { exact: strategy.exact ?? true });
    case 'text':
      return page.getByText(strategy.value, { exact: strategy.exact ?? true });
    case 'testId':
      return page.getByTestId(strategy.value);
    case 'image': {
      let image = page.locator('img, input[type="image"]');
      if (strategy.alt !== undefined) image = image.locator(`xpath=self::*[@alt=${xpathLiteral(strategy.alt)}]`);
      if (strategy.title !== undefined) image = image.locator(`xpath=self::*[@title=${xpathLiteral(strategy.title)}]`);
      if (strategy.srcIncludes !== undefined) image = image.locator(`xpath=self::*[contains(@src, ${xpathLiteral(strategy.srcIncludes)})]`);
      return image.locator('xpath=ancestor-or-self::*[self::button or self::a or (self::input and @type="image") or @role="button" or @onclick][1]');
    }
    case 'point':
      return null;
    default:
      throw new Error(`unsupported locator strategy: ${strategy.by}`);
  }
}

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  const parts = value.split("'");
  return `concat(${parts.map((part, index) => `${index ? `"'",` : ''}'${part}'`).join(',')})`;
}

async function visibleCandidates(locator) {
  const candidates = [];
  for (let index = 0; index < await locator.count(); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) candidates.push(item);
  }
  return candidates;
}

async function resolveElement(page, chain) {
  for (const strategy of chain) {
    if (strategy.by === 'point') return { strategy, element: null };
    const candidates = await visibleCandidates(locatorFor(page, strategy));
    if (candidates.length === 0) continue;
    if (strategy.index !== undefined) {
      if (strategy.index >= candidates.length) continue;
      return { strategy, element: candidates[strategy.index] };
    }
    if (candidates.length > 1) {
      throw new Error(`locator is ambiguous (${candidates.length} visible matches): ${strategy.by}`);
    }
    return { strategy, element: candidates[0] };
  }
  throw new Error('no locator strategy matched a visible element');
}

export async function clickFirst(page, chain) {
  const { strategy, element } = await resolveElement(page, chain);
  if (strategy.by === 'point') {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('relative point requires a configured viewport');
    await page.mouse.click(viewport.width * strategy.xRatio, viewport.height * strategy.yRatio);
  } else if (strategy.clickMode === 'dom') {
    await element.evaluate((node) => node.click());
  } else {
    await element.click();
  }
  return strategy;
}

export async function canFillFirst(page, chain) {
  try {
    const { element } = await resolveElement(page, chain);
    return !!element && await element.isEnabled() && await element.isEditable();
  } catch {
    return false;
  }
}

export async function fillFirst(page, chain, value) {
  const { strategy, element } = await resolveElement(page, chain);
  if (!element) throw new Error('point locators cannot fill fields');
  await element.fill(value);
  return strategy;
}

export async function checkFirst(page, chain) {
  const { element } = await resolveElement(page, chain);
  if (!element) throw new Error('point locators cannot check fields');
  await element.setChecked(true);
}

export async function readFirstText(page, chain) {
  const { element } = await resolveElement(page, chain);
  if (!element) throw new Error('point locators cannot read text');
  return element.innerText();
}

async function locatorExists(page, chain, visible) {
  for (const strategy of chain) {
    if (strategy.by === 'point') continue;
    const locator = locatorFor(page, strategy);
    for (let index = 0; index < await locator.count(); index += 1) {
      if ((await locator.nth(index).isVisible()) === visible) return true;
    }
  }
  return false;
}

function matchesText(value, expected, mode) {
  return mode === 'equals' ? value === expected : value.includes(expected);
}

export async function evaluateCondition(page, condition) {
  switch (condition.kind) {
    case 'url':
      return matchesText(page.url(), condition.matches, condition.match);
    case 'text': {
      if (!condition.locator) {
        return matchesText(await page.locator('body').innerText(), condition.matches, condition.match);
      }
      for (const strategy of condition.locator) {
        if (strategy.by === 'point') continue;
        const locator = locatorFor(page, strategy);
        for (let index = 0; index < await locator.count(); index += 1) {
          const item = locator.nth(index);
          if (await item.isVisible() && matchesText(await item.innerText(), condition.matches, condition.match)) return true;
        }
      }
      return false;
    }
    case 'visible':
      return locatorExists(page, condition.locator, true);
    case 'hidden':
      return locatorExists(page, condition.locator, false);
    case 'value': {
      for (const strategy of condition.locator) {
        if (strategy.by === 'point') continue;
        const locator = locatorFor(page, strategy);
        for (let index = 0; index < await locator.count(); index += 1) {
          const value = await locator.nth(index).inputValue().catch(() => '');
          if (condition.minLength !== undefined && value.length >= condition.minLength) return true;
          if (condition.matches !== undefined && matchesText(value, condition.matches, condition.match ?? 'includes')) return true;
        }
      }
      return false;
    }
    case 'class': {
      for (const strategy of condition.locator) {
        if (strategy.by === 'point') continue;
        const locator = locatorFor(page, strategy);
        for (let index = 0; index < await locator.count(); index += 1) {
          const classAttr = (await locator.nth(index).getAttribute('class').catch(() => '')) ?? '';
          if (classAttr.split(/\s+/).includes(condition.has)) return true;
        }
      }
      return false;
    }
    default:
      throw new Error(`unsupported condition kind: ${condition.kind}`);
  }
}

export async function evaluateAny(page, conditions = []) {
  for (const condition of conditions) {
    if (await evaluateCondition(page, condition)) return true;
  }
  return false;
}
