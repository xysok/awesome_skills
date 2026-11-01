import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {validatePlatform} from '../scripts/lib/platform-config.mjs';
test('every real adapter has a credential-backed login path without embedded secrets',async()=>{
 for(const id of ['cordcloud','jd','taobao','wps']){const p=validatePlatform(JSON.parse(await readFile(new URL(`../platforms/${id}.json`,import.meta.url),'utf8')));assert.ok(p.login,`${id} needs a login path`);assert.deepEqual(p.login.fields.map(f=>f.env),[id.toUpperCase()+(id==='cordcloud'?'_EMAIL':'_USERNAME'),id.toUpperCase()+'_PASSWORD']);}
});
