import { readFirstText } from './page-actions.mjs';

function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cleanEvidence(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

export function parseRewardText(rewardConfig, source, rawText, options = {}) {
  const evidence = cleanEvidence(rawText);
  if (!evidence) return null;

  const flags = source.caseInsensitive ? 'iu' : 'u';
  const match = new RegExp(source.pattern, flags).exec(evidence);
  if (!match) return null;

  if (source.todayGroup !== undefined) {
    const today = options.today ?? shanghaiDate(options.now);
    if (match[source.todayGroup] !== today) return null;
  }

  const amount = Number(match[source.amountGroup]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = rewardConfig.unit ?? match[source.unitGroup];
  if (typeof unit !== 'string' || unit.trim() === '') return null;

  return {
    type: rewardConfig.type,
    amount,
    unit: unit.trim(),
    source: source.id,
    confidence: 'explicit',
    evidence
  };
}

export async function captureRewards(page, rewardConfigs = [], options = {}) {
  const rewards = [];
  for (const rewardConfig of rewardConfigs) {
    for (const source of rewardConfig.sources) {
      try {
        const text = await readFirstText(page, source.locator);
        const reward = parseRewardText(rewardConfig, source, text, options);
        if (reward) {
          rewards.push(reward);
          break;
        }
      } catch {
        // Reward evidence is optional; a missing source must not change sign-in status.
      }
    }
  }
  return rewards;
}

export { shanghaiDate };
