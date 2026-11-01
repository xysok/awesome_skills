import test from 'node:test';
import assert from 'node:assert/strict';

import { withRetry } from '../scripts/lib/retry.mjs';

test('retries a transient operation once and returns the successful result', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary');
    return 'ok';
  }, { attempts: 2, delayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('stops after the configured attempt budget', async () => {
  let attempts = 0;
  await assert.rejects(withRetry(async () => {
    attempts += 1;
    throw new Error('still broken');
  }, { attempts: 2, delayMs: 0 }), /still broken/);
  assert.equal(attempts, 2);
});
