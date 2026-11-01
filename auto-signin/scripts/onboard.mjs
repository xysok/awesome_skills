#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPlatformDraft } from './lib/onboard.mjs';

function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--id', '--name', '--start-url', '--output'].includes(option) || !value) {
      throw new Error('usage: node scripts/onboard.mjs --id <id> --name <name> --start-url <url> --output <file>');
    }
    values[option.slice(2)] = value;
  }
  for (const key of ['id', 'name', 'start-url', 'output']) {
    if (!values[key]) throw new Error(`--${key} is required`);
  }
  return values;
}

try {
  const values = parse(process.argv.slice(2));
  const draft = createPlatformDraft({ id: values.id, name: values.name, startUrl: values['start-url'] });
  const output = resolve(values.output);
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  process.stdout.write(`${JSON.stringify({ status: 'draft_created', output, next: 'Replace every TODO value, remove _draft, then run check.' })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', message: error.message })}\n`);
  process.exitCode = 20;
}
