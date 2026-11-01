import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runSignin} from '../scripts/lib/engine.mjs';import {StateStore} from '../scripts/lib/state-store.mjs';
test('transient 2FA URL without an answer field must not stop a scheduled login',async()=>{
 const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html; charset=utf-8');
  if(req.url==='/account'){if((req.headers.cookie??'').includes('auth=1'))return res.end('<div id="account">Account</div><p id="signed">Already signed</p>');res.writeHead(302,{location:'/login'});return res.end();}
  if(req.url==='/login'&&req.method==='POST'){res.writeHead(302,{location:'/auth/login/2fa','set-cookie':'auth=1; Path=/; HttpOnly'});return res.end();}
  if(req.url==='/login')return res.end('<form method="post"><input id="username" name="username"><input id="password" name="password" type="password"><button id="login">Log in</button></form>');
  if(req.url==='/auth/login/2fa')return res.end('<p>Finishing login</p><script>setTimeout(()=>location.href="/account",2000)</script>');
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const adapter={schemaVersion:1,id:'transient-twofa',name:'Transient fixture',startUrl:origin+'/account',allowedOrigins:[origin],session:{validWhen:[{kind:'visible',locator:[{by:'css',value:'#account'}]}],invalidWhen:[{kind:'url',matches:'/login',match:'includes'}]},login:{fields:[{env:'TEST_USER',locator:[{by:'css',value:'#username'}]},{env:'TEST_PASS',locator:[{by:'css',value:'#password'}]}],submit:[{by:'css',value:'#login'}],challenges:[{id:'email-twofa',type:'otp',prompt:'Protected input required',when:[{kind:'url',matches:'/auth/login/2fa',match:'includes'}],input:[{by:'css',value:'#code'}],submit:[{by:'css',value:'#verify'}],resume:{mode:'inline'}}]},signin:{action:[{by:'css',value:'#sign'}],alreadyWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}],successWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}]}};
 try{const result=await runSignin(adapter,{store:new StateStore(await mkdtemp(join(tmpdir(),'signin-transient-'))),executablePath:'/usr/bin/chromium',interactive:false,env:{TEST_USER:'fixture',TEST_PASS:'fixture-password'}});assert.equal(result.status,'already_done',JSON.stringify(result));}finally{await new Promise(r=>server.close(r));}
});
