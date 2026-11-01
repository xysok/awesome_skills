import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executePlatform} from '../scripts/run-all.mjs';

test('CordCloud selects the configured vault launcher without exposing credentials to other platforms',async()=>{
 const root=await mkdtemp(join(tmpdir(),'signin-vault-'));
 await writeFile(join(root,'vault-bindings.json'),JSON.stringify({cordcloud:{handle:'vault_test123456',origin:'https://www.cordcloud.us'}}));
 const shim=join(root,'shim.mjs');
 await writeFile(shim,`console.log(JSON.stringify({vault:process.argv.includes('--handle'),home:process.env.HERMES_HOME}));`);
 const fixture=join(root,'cli.mjs');await writeFile(fixture,`console.log(JSON.stringify({vault:false}));`);
 const options={stateDir:root,cliPath:fixture,vaultPython:process.execPath,vaultLauncher:shim,timeoutMs:2000,baseEnv:{HERMES_HOME:'/profile-fixture'}};
 const cc=await executePlatform({id:'cordcloud'},options);assert.equal(cc.vault,true);assert.equal(cc.home,'/profile-fixture');
 const jd=await executePlatform({id:'jd'},options);assert.equal(jd.vault,false);
});
