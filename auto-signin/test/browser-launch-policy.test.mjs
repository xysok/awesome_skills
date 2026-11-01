import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {validatePlatform} from '../scripts/lib/platform-config.mjs';import {runSignin} from '../scripts/lib/engine.mjs';import {StateStore} from '../scripts/lib/state-store.mjs';
const adapter=JSON.parse(await readFile(new URL('../platforms/cordcloud.json',import.meta.url),'utf8'));
test('CordCloud retains the native browser software-rendering policy across recovery and cron',()=>{
 assert.deepEqual(adapter.browser.ignoreDefaultArgs,['--enable-unsafe-swiftshader']);
});
test('browser launch policy never permits disabling all default arguments',()=>{
 for(const invalid of [true,false,'--flag',[true],['not-a-flag'],['--flag\n--another']]){
  const p=structuredClone(adapter);p.browser.ignoreDefaultArgs=invalid;assert.throws(()=>validatePlatform(p),/ignoreDefaultArgs/);
 }
});

test('selected native browser defaults are forwarded without dropping unrelated defaults',async()=>{
 const p=structuredClone(adapter);p.browser.ignoreDefaultArgs=['--enable-unsafe-swiftshader'];let received;
 const result=await runSignin(p,{store:new StateStore(await mkdtemp(join(tmpdir(),'signin-browser-policy-'))),headless:false,browserType:{launch:async options=>{received=options;throw Error('fixture launch capture');}}});
 assert.equal(result.code,'runtime_error');assert.deepEqual(received.ignoreDefaultArgs,['--enable-unsafe-swiftshader']);assert.deepEqual(received.args,p.browser.launchArgs);
});
