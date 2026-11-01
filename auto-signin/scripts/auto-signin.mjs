#!/usr/bin/env node
import { checkPlatforms, exitCodeFor, loadPlatform, parseArgs, readChallengeAnswer, resolveStateDir } from './lib/cli.mjs';
import { runSignin, resumeSignin } from './lib/engine.mjs';
import { StateStore } from './lib/state-store.mjs';

const usage = {
  status: 'help',
  usage: [
    'node scripts/auto-signin.mjs check --all',
    'node scripts/auto-signin.mjs check --platform platforms/example.json',
    'node scripts/auto-signin.mjs run --platform <id|path> [--state-dir <path>] [--headed]',
    'node scripts/auto-signin.mjs resume --platform <id|path> --run-id <id> [--state-dir <path>]  # answer on stdin'
  ],
  note: 'Headless is the default. Challenge answers are accepted only from stdin and are never stored.'
};

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    if (parsed.command === 'help') return usage;
    if (parsed.command === 'check') return await checkPlatforms(parsed);

    const { platform } = await loadPlatform(parsed.platform);
    const store = new StateStore(parsed.stateDir ?? resolveStateDir());
    const options = {
      store,
      headless: parsed.headless,
      interactive: process.env.AUTO_SIGNIN_NONINTERACTIVE !== '1',
      loginDiagnostics: process.env.AUTO_SIGNIN_LOGIN_DIAGNOSTICS === '1',
      executablePath: process.env.AUTO_SIGNIN_BROWSER_PATH || undefined,
      notify: (message) => process.stderr.write(`${message}\n`),
      readAnswer: () => readChallengeAnswer()
    };
    if (parsed.command === 'run') return await runSignin(platform, options);

    const answer = await readChallengeAnswer();
    return await resumeSignin(platform, parsed.runId, answer, options);
  } catch (error) {
    return { status: 'failed', code: 'cli_error', message: error.message };
  }
}

const result = await main();
let output = JSON.stringify(result, null, 2);
for (const [key, value] of Object.entries(process.env)) {
  if (/^(CORDCLOUD|JD|TAOBAO|WPS)_PASSWORD$/.test(key) && value) {
    // JSON-escape first: a password can contain quotes or newlines.
    output = output.split(JSON.stringify(value).slice(1, -1)).join('[REDACTED]');
  }
}
process.stdout.write(`${output}\n`);
process.exitCode = result.status === 'help' ? 0 : exitCodeFor(result);
