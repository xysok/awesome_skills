import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('CLI output redacts injected login passwords even inside an error path',()=>{
 const secret='fixture-password-must-not-appear';
 const child=spawnSync(process.execPath,['scripts/auto-signin.mjs','check','--platform',`/nonexistent/${secret}.json`],{cwd:new URL('..',import.meta.url),env:{...process.env,CORDCLOUD_PASSWORD:secret},encoding:'utf8'});
 assert.equal(child.status,20);assert.ok(child.stdout.includes('[REDACTED]'));assert.ok(!child.stdout.includes(secret));assert.ok(!child.stderr.includes(secret));
});
