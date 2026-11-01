import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
test('retired legacy diagnostic cannot load credentials or dump login forms',async()=>{
 const source=await readFile(new URL('../diag-2fa.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/parseDotEnv|formHTML/,'Legacy credential reading and HTML dumping must be removed before execution');
 const result=spawnSync(process.execPath,['diag-2fa.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,20);assert.equal(JSON.parse(result.stdout).code,'legacy_diagnostic_disabled');assert.equal(result.stderr,'');
});
