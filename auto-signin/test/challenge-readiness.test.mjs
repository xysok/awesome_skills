import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runSignin,resumeSignin} from '../scripts/lib/engine.mjs';import {StateStore} from '../scripts/lib/state-store.mjs';
async function fixture({input='normal',resumeState='challenge',sameUrl=false,delayed=false}={}){
 let codePosts=0;
 const account='<div id="account">Account</div><p id="signed">Already signed</p>';
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.url==='/account'){res.writeHead(302,{location:'/login'});return res.end();}
  if(req.url==='/login'&&req.method==='POST'){res.writeHead(302,{location:'/otp'});return res.end();}
  if(req.url==='/login')return res.end('<form method="post"><input name="user"><input name="password" type="password"><button id="login">Login</button></form>');
  if(req.url==='/otp'&&req.method==='POST'){
   codePosts++;for await(const _chunk of req){}
   if(delayed)return res.end(`<p>Loading</p><script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(account)},1600)</script>`);
   if(sameUrl)return res.end(account);
   res.writeHead(302,{location:'/done'});return res.end();
  }
  if(req.url==='/done')return res.end(account);
  if(req.url==='/otp'){
   if(resumeState==='valid')return res.end(account+'<form method="post"><input id="code" name="code"><button id="verify">Stale verify</button></form>');
   if(resumeState==='expired')return res.end('<p>Verification expired</p>');
   const attrs=input==='disabled'?'disabled':input==='readonly'?'readonly':'';
   const fields=input==='ambiguous'?'<input id="code"><input id="code">':`<input id="code" name="code" ${attrs}>`;
   return res.end(`<form method="post">${fields}<button id="verify">Verify</button></form>`);
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const adapter={schemaVersion:1,id:'challenge-readiness',name:'Fixture',startUrl:origin+'/account',allowedOrigins:[origin],session:{validWhen:[{kind:'visible',locator:[{by:'css',value:'#account'}]}],invalidWhen:[{kind:'url',matches:'/login',match:'includes'}]},login:{fields:[{env:'TEST_USER',locator:[{by:'css',value:'input[name=user]'}]},{env:'TEST_PASS',locator:[{by:'css',value:'input[name=password]'}]}],submit:[{by:'css',value:'#login'}],challenges:[{id:'otp',type:'otp',prompt:'Use protected input',when:[{kind:'url',matches:'/otp',match:'includes'}],input:[{by:'css',value:'#code',...(input==='bad-index'?{index:2}:{})}],submit:[{by:'css',value:'#verify'}],resume:{mode:'reload'},ttlSeconds:60}]},signin:{action:[{by:'css',value:'#signin'}],alreadyWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}],successWhen:[{kind:'visible',locator:[{by:'css',value:'#signed'}]}]}};
 return {origin,adapter,posts:()=>codePosts,close:()=>new Promise(r=>server.close(r))};
}
const opts=store=>({store,executablePath:'/usr/bin/chromium',env:{TEST_USER:'fixture',TEST_PASS:'fixture-password'},interactive:false,loginOutcomeTimeoutMs:300});
async function newStore(){return new StateStore(await mkdtemp(join(tmpdir(),'signin-challenge-review-')));}

test('unusable OTP input never creates a pending handoff',async t=>{
 for(const input of ['disabled','readonly','ambiguous','bad-index'])await t.test(input,async()=>{
  const f=await fixture({input});const store=await newStore();
  try{const result=await runSignin(f.adapter,opts(store));assert.notEqual(result.status,'needs_input',JSON.stringify(result));assert.equal(await store.findActiveCheckpoint(f.adapter.id),null);assert.equal(f.posts(),0);}finally{await f.close();}
 });
});

test('resume ignores stale OTP form when authenticated evidence already exists',async()=>{
 const f=await fixture({resumeState:'valid'});const store=await newStore();
 const cp=await store.saveCheckpoint(f.adapter.id,{currentUrl:f.origin+'/otp',storageState:{cookies:[],origins:[]},challengeId:'otp'},{ttlMs:60000});
 try{const result=await resumeSignin(f.adapter,cp.runId,'fixture-code',opts(store));assert.equal(result.status,'already_done',JSON.stringify(result));assert.equal(f.posts(),0);assert.equal(await store.findActiveCheckpoint(f.adapter.id),null);}finally{await f.close();}
});

test('resume discards an expired challenge without keeping the platform blocked',async()=>{
 const f=await fixture({resumeState:'expired'});const store=await newStore();
 const cp=await store.saveCheckpoint(f.adapter.id,{currentUrl:f.origin+'/otp',storageState:{cookies:[],origins:[]},challengeId:'otp'},{ttlMs:60000});
 try{const result=await resumeSignin(f.adapter,cp.runId,'fixture-code',opts(store));assert.equal(result.code,'challenge_not_present',JSON.stringify(result));assert.equal(f.posts(),0);assert.equal(await store.findActiveCheckpoint(f.adapter.id),null);}finally{await f.close();}
});

test('inline OTP can authenticate without changing the URL',async()=>{
 const f=await fixture({sameUrl:true});const store=await newStore();f.adapter.login.challenges[0].resume={mode:'inline'};
 try{const result=await runSignin(f.adapter,{...opts(store),interactive:true,readAnswer:async()=>'fixture-code'});assert.equal(result.status,'already_done',JSON.stringify(result));assert.equal(f.posts(),1);}finally{await f.close();}
});

test('resume waits for delayed authenticated evidence after submitting OTP',async()=>{
 const f=await fixture({delayed:true});const store=await newStore();
 const cp=await store.saveCheckpoint(f.adapter.id,{currentUrl:f.origin+'/otp',storageState:{cookies:[],origins:[]},challengeId:'otp'},{ttlMs:60000});
 try{const result=await resumeSignin(f.adapter,cp.runId,'fixture-code',{...opts(store),loginOutcomeTimeoutMs:3000});assert.equal(result.status,'already_done',JSON.stringify(result));assert.equal(f.posts(),1);}finally{await f.close();}
});
