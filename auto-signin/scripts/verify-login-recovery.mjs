import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {executePlatform} from './run-all.mjs';import {StateStore} from './lib/state-store.mjs';
const id=process.argv[2];if(!['cordcloud','jd','taobao','wps'].includes(id))throw Error('Unsupported platform');
const production='/opt/data/home/.local/state/auto-signin';
const stateDir=await mkdtemp(join(tmpdir(),`signin-recovery-${id}-`));
const bindings=JSON.parse(await readFile(join(production,'vault-bindings.json'),'utf8'));
await writeFile(join(stateDir,'vault-bindings.json'),JSON.stringify({[id]:bindings[id]}),{mode:0o600});
const result=await executePlatform({id},{stateDir,browserPath:'/usr/bin/chromium',loginDiagnostics:true});
console.log(JSON.stringify({stage:'empty_session_login',platform:id,result}));
if(['success','already_done'].includes(result.status)){
 const newSession=await new StateStore(stateDir).loadSession(id);
 if(!newSession)throw Error('No session after verified login');
 const store=new StateStore(production);const release=await store.acquireLock(id);
 try{await store.saveSession(id,newSession);}finally{await release();}
 console.log(JSON.stringify({stage:'promoted_session',platform:id}));
}
