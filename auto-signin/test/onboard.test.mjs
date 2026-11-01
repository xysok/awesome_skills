import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlatformDraft } from '../scripts/lib/onboard.mjs';
import { validatePlatform } from '../scripts/lib/platform-config.mjs';

test('creates a safe, origin-scoped draft that cannot run before selectors are confirmed', () => {
  const draft = createPlatformDraft({
    id: 'new-site',
    name: 'New Site',
    startUrl: 'https://signin.example.test/account'
  });

  assert.equal(draft.id, 'new-site');
  assert.deepEqual(draft.allowedOrigins, ['https://signin.example.test']);
  assert.equal(draft._draft, true);
  assert.doesNotMatch(JSON.stringify(draft), /password\s*:/i);
  assert.throws(() => validatePlatform(draft), /draft/i);
});

test('rejects non-http entry URLs during draft creation', () => {
  assert.throws(
    () => createPlatformDraft({ id: 'bad', name: 'Bad', startUrl: 'file:///tmp/page.html' }),
    /http/i
  );
});
