#!/usr/bin/env node
import { executePlatform } from './run-all.mjs';
import { exitCodeFor } from './lib/cli.mjs';

const usage = 'Usage: node scripts/run-one.mjs --platform <id> [--headed] [--probe | --session-only] [--state-dir <path>]';

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { status: 'help', usage };
  const options = { sessionOnly: true };
  let platform;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--headed') { options.headed = true; continue; }
    if (arg === '--session-only') { options.sessionOnly = true; continue; }
    if (arg === '--probe') { options.probeOnly = true; continue; }
    if (!['--platform', '--state-dir'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--platform') platform = value;
    if (arg === '--state-dir') options.stateDir = value;
  }
  if (!['cordcloud', 'jd', 'taobao', 'wps'].includes(platform)) throw new Error('A supported --platform is required');
  return executePlatform({ id: platform }, options);
}

let result;
try { result = await main(process.argv.slice(2)); }
catch (error) { result = { status: 'failed', code: 'runner_error', message: error.message }; }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === 'help' ? 0 : exitCodeFor(result);
