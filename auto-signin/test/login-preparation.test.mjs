import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runSignin} from '../scripts/lib/engine.mjs';import {StateStore} from '../scripts/lib/state-store.mjs';

test('login preparation handles navigation, asynchronous mode switch, iframe fields and remember checkbox',async()=>{
 let submitted=false;
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.url==='/account'){if((req.headers.cookie??'').includes('auth=1'))return res.end('<div id="account">Account</div><div id="signed">Signed today</div>');res.writeHead(302,{location:'/login'});return res.end();}
  if(req.url==='/entry')return res.end('<button id="show" onclick="setTimeout(()=>{document.body.innerHTML=\'<iframe id=loginframe src=/form></iframe>\'},100)">Password</button>');
  if(req.url==='/login')return res.end('<p>Logged out</p>');
  if(req.url==='/form')return res.end('<form action="/submit" method="post" target="_top"><input name="user"><input name="password" type="password"><input type="checkbox" name="remember" value="yes"><button>Login</button></form>');
  if(req.url==='/submit'){let data='';for await(const chunk of req)data+=chunk;const form=new URLSearchParams(data);submitted=form.get('remember')==='yes'&&form.get('user')==='fixture'&&form.get('password')==='fixture-pass';if(submitted){res.writeHead(302,{location:'/account','set-cookie':'auth=1; Path=/; HttpOnly'});return res.end();}res.writeHead(401);return res.end('Rejected');}
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const adapter={schemaVersion:1,id:'iframe-login',name:'Fixture',startUrl:origin+'/account',allowedOrigins:[origin],session:{validWhen:[{kind:'visible',locator:[{by:'css',value:'#account'}]}],invalidWhen:[{kind:'url',matches:'/login',match:'includes'}]},login:{prepare:[{action:'navigate',url:origin+'/entry'},{action:'click',locator:[{by:'css',value:'#show'}]},{action:'wait',when:[{kind:'visible',locator:[{by:'css',value:'input[name=user]',frame:'#loginframe'}]}]},{action:'check',locator:[{by:'css',value:'input[name=remember]',frame:'#loginframe'}]}],fields:[{env:'TEST_USER',locator:[{by:'css',value:'input[name=user]',frame:'#loginframe'}]},{env:'TEST_PASS',locator:[{by:'css',value:'input[name=password]',frame:'#loginframe'}]}],submit:[{by:'css',value:'button',frame:'#loginframe'}]},signin:{action:[{by:'css',value:'#sign'}],alreadyWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}],successWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}]}};
 try{const result=await runSignin(adapter,{store:new StateStore(await mkdtemp(join(tmpdir(),'signin-iframe-'))),executablePath:'/usr/bin/chromium',env:{TEST_USER:'fixture',TEST_PASS:'fixture-pass'}});assert.equal(result.status,'already_done',JSON.stringify(result));assert.equal(submitted,true);
 const rejected=await runSignin(adapter,{store:new StateStore(await mkdtemp(join(tmpdir(),'signin-rejected-'))),executablePath:'/usr/bin/chromium',loginDiagnostics:true,env:{TEST_USER:'fixture',TEST_PASS:'wrong-fixture-pass'}});
 assert.equal(rejected.code,'login_not_verified');assert.ok(rejected.screenshotPath,'failed login should have a private diagnostic screenshot');assert.deepEqual(rejected.blockedResourceOrigins,[]);
 adapter.login.manualWhen=[{kind:'text',matches:'Rejected',match:'equals',locator:[{by:'text',value:'Rejected'}]}];
 const manual=await runSignin(adapter,{store:new StateStore(await mkdtemp(join(tmpdir(),'signin-manual-'))),executablePath:'/usr/bin/chromium',interactive:false,env:{TEST_USER:'fixture',TEST_PASS:'wrong-fixture-pass'}});
 assert.equal(manual.status,'needs_input',JSON.stringify(manual));assert.equal(manual.code,'manual_verification_required');
 }finally{await new Promise(r=>server.close(r));}
});
