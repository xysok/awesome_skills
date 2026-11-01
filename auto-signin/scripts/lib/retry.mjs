import { setTimeout as sleep } from 'node:timers/promises';

export async function withRetry(operation, { attempts = 2, delayMs = 250 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}
