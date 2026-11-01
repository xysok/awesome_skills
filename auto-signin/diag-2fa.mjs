// Retired: this ad-hoc diagnostic is intentionally non-runnable.
// Production recovery must use the origin-bound vault runner and protected input.
process.stdout.write(JSON.stringify({
  status: 'failed',
  code: 'legacy_diagnostic_disabled',
  message: 'Use scripts/run-all.mjs executePlatform for production, or the authorized isolated verifier scripts/verify-login-recovery.mjs. Complete human verification only through protected official-browser input.'
}) + '\n');
process.exitCode = 20;
