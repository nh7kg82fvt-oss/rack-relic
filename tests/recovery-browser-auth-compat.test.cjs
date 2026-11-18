'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRecoverySessionProvider,PROJECT}=require('../public/recovery-session-provider.js');
const AUTH='https://xkxolhgafjadpknsfqqw.supabase.co/auth/v1';
const ORIGIN='https://rack-relic-git-codex-recovery-fixture-rack-relic.vercel.app';
const OWNER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const PUBLISHABLE='sb_publishable_FICTIONAL_LOCAL_ONLY_NOT_A_KEY',PASSWORD='FICTIONAL_PASSWORD_NOT_A_CREDENTIAL';
const START=Date.UTC(2026,10,17,20,0,0),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let now=START,mono=0,releaseToken,releaseLogout,enteredToken,enteredLogout;
 const calls=[],cancelled=[];
 const reachedToken=new Promise(resolve=>enteredToken=resolve),reachedLogout=new Promise(resolve=>enteredLogout=resolve);
 const document=Object.assign(new EventTarget(),{hidden:false,visibilityState:'visible',hasFocus:()=>true});
 const window=Object.assign(new EventTarget(),{location:{origin:ORIGIN}});
 Object.defineProperty(document,'cookie',{get(){throw Error('Cookie access forbidden');},set(){throw Error('Cookie access forbidden');}});
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('Storage access forbidden');}});
 const input={tagName:'INPUT',type:'password',ownerDocument:document,value:PASSWORD};
 const claims={iss:AUTH,sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:START/1000,exp:START/1000+3600,...options.claims};
 const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.FICTIONALSIGNATURE';
 const user={id:OWNER,email:'owner@fixture.invalid',aud:'authenticated',role:'authenticated',is_anonymous:false,email_confirmed_at:'2026-11-01T00:00:00Z',last_sign_in_at:new Date(START).toISOString()};
 const tokenBody={access_token:token,refresh_token:'FICTIONAL_REFRESH_NOT_RETAINED',token_type:'bearer',expires_at:claims.exp,expires_in:claims.exp-START/1000,user,...options.token};
 for(const name of options.omitFields||[])delete tokenBody[name];
 function response(url,value,status=200,kind){
  const headers=new Headers({'content-type':'application/json',...(options.headers?.[kind]||{})});
  // Native cross-origin fetch exposes safelisted headers plus explicitly exposed names.
  if(options.corsFiltered){const visible=new Set(['cache-control','content-language','content-length','content-type','expires','last-modified','pragma',...(options.exposed||[])]);for(const name of [...headers.keys()])if(!visible.has(name))headers.delete(name);}
  const r=new Response(status===204?null:JSON.stringify(value),{status,headers});
  Object.defineProperty(r,'url',{value:options.urls?.[kind]||url});
  Object.defineProperty(r,'type',{value:options.corsFiltered?'cors':'basic'});
  if(options.redirected?.[kind])Object.defineProperty(r,'redirected',{value:true});
  if(r.body){const body=r.body;Object.defineProperty(r,'body',{value:{getReader(){const reader=body.getReader();return {read:()=>reader.read(),cancel(){cancelled.push(kind);return reader.cancel();}};}}});}
  return r;
 }
 async function fetchImpl(url,init){
  calls.push({url,init});assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  assert.equal(init.headers.apikey,PUBLISHABLE);assert.equal(Object.hasOwn(init.headers,'Cookie'),false);assert.equal(Object.hasOwn(init.headers,'cookie'),false);
  assert.equal(Object.keys(init.headers).some(name=>/bypass/i.test(name)),false);
  if(url===AUTH+'/token?grant_type=password'){
   assert.equal(init.method,'POST');assert.equal(input.value,'');assert.deepEqual(JSON.parse(init.body),{email:user.email,password:PASSWORD});
   enteredToken();if(options.stallToken)await new Promise(resolve=>releaseToken=resolve);
   return response(url,tokenBody,options.statuses?.token||200,'token');
  }
  if(url===AUTH+'/user'){assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer '+token);return response(url,{...user,...options.user},options.statuses?.user||200,'user');}
  if(url===AUTH+'/logout?scope=local'){
   assert.equal(init.method,'POST');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer '+token);enteredLogout();
   if(options.stallLogout)await new Promise(resolve=>releaseLogout=resolve);
   return response(url,null,options.statuses?.logout||204,'logout');
  }
  throw Error('Unapproved URL');
 }
 const provider=createRecoverySessionProvider({document,window,passwordInput:input,enabled:true,enrollment:{version:'rr-recovery-session-enrollment-v1',projectRef:PROJECT,ownerId:OWNER,email:user.email,origin:ORIGIN,notBefore:START-1,expiresAt:START+60000},publishableKey:PUBLISHABLE,fetchImpl,clock:()=>now,monotonicClock:()=>mono,timeoutMs:options.timeoutMs||10000});
 assert.equal(provider.configured,true);
 return {provider,calls,cancelled,input,document,window,reachedToken,reachedLogout,token,releaseToken(){releaseToken?.();},releaseLogout(){releaseLogout?.();},setClock(value,elapsed=value-START){now=value;mono=elapsed;},async destroy(){await provider.destroy();await tick();}};
}
const count=(x,suffix)=>x.calls.filter(call=>call.url===AUTH+suffix).length;
test('CORS-filtered Date and absent response Cache-Control work through one grant, GetUser and local logout',async()=>{
 const x=fixture({corsFiltered:true,headers:{token:{date:'not browser visible'},user:{date:'not browser visible'},logout:{date:'not browser visible'}}});
 try{assert.equal(x.calls.length,0);assert.deepEqual(await x.provider.acquire(),{accessToken:x.token});assert.equal(x.input.value,'');assert.deepEqual(await x.provider.release(),{status:'confirmed'});assert.deepEqual(x.calls.map(call=>call.url),[AUTH+'/token?grant_type=password',AUTH+'/user',AUTH+'/logout?scope=local']);await assert.rejects(x.provider.acquire());await Promise.all([x.provider.release(),x.provider.release()]);assert.equal(x.calls.length,3);}finally{await x.destroy();}
});
test('already decoded browser JSON may differ from compressed wire length and encoding',async()=>{
 const x=fixture({headers:{token:{'content-encoding':'gzip','content-length':'27'},user:{'content-encoding':'br','content-length':'13'}}});
 try{assert.deepEqual(await x.provider.acquire(),{accessToken:x.token});assert.equal((await x.provider.release()).status,'confirmed');assert.deepEqual(x.cancelled,['token','user']);}finally{await x.destroy();}
});
test('visible Date still rejects invalid, stale and future values and accepts a current value',async()=>{
 for(const date of ['', 'invalid',new Date(START-31000).toUTCString(),new Date(START+31000).toUTCString()]){const x=fixture({headers:{token:{date}}});try{await assert.rejects(x.provider.acquire());assert.equal(count(x,'/user'),0);}finally{await x.destroy();}}
 const x=fixture({headers:{token:{date:new Date(START).toUTCString()},user:{date:new Date(START).toUTCString()},logout:{date:new Date(START).toUTCString()}}});try{await x.provider.acquire();assert.equal((await x.provider.release()).status,'confirmed');}finally{await x.destroy();}
});
test('grant issuance is bounded to the original request and excludes unsafe or expired epochs',async()=>{
 for(const claims of [{iat:START/1000-31},{iat:START/1000+31},{iat:0},{iat:Number.MAX_SAFE_INTEGER},{exp:START/1000},{iss:'https://other.invalid/auth/v1'},{sub:'33333333-3333-4333-8333-333333333333'},{is_anonymous:true}]){const x=fixture({claims});try{await assert.rejects(x.provider.acquire());assert.equal(count(x,'/user'),0);assert.ok(count(x,'/logout?scope=local')<=1);}finally{await x.destroy();}}
 const x=fixture({claims:{iat:START/1000-30}});try{await x.provider.acquire();assert.equal((await x.provider.release()).status,'confirmed');}finally{await x.destroy();}
});
test('optional standard expiry fields must be typed and agree with token remaining lifetime',async()=>{
 for(const token of [{expires_at:START/1000+3599},{expires_at:String(START/1000+3600)},{expires_at:null},{expires_in:0},{expires_in:-1},{expires_in:'3600'},{expires_in:NaN},{expires_in:3642},{expires_in:3558}]){const x=fixture({token});try{await assert.rejects(x.provider.acquire());assert.equal(count(x,'/user'),0);}finally{await x.destroy();}}
 for(const options of [{omitFields:['expires_at','expires_in']},{token:{expires_in:3599}},{token:{expires_in:3641}}]){const x=fixture(options);try{await x.provider.acquire();assert.equal((await x.provider.release()).status,'confirmed');}finally{await x.destroy();}}
});
test('visible cached or positively cacheable Auth responses remain held',async()=>{
 for(const bad of [{'cache-control':'public, no-store'},{'cache-control':'immutable'},{'cache-control':'stale-if-error=1'},{'cache-control':'stale-while-revalidate=1'},{'cache-control':'max-age=1'},{'cache-control':'s-maxage=1'},{age:'1'},{'x-cache':'HIT'},{'cf-cache-status':'HIT'},{'x-vercel-cache':'HIT'}]){for(const kind of ['token','user']){const x=fixture({headers:{[kind]:bad}});try{await assert.rejects(x.provider.acquire());assert.ok(count(x,'/user')<=1);}finally{await x.destroy();}}}
 for(const cc of ['private, no-store','no-cache','max-age=0, s-maxage="0"']){const x=fixture({headers:{token:{'cache-control':cc},user:{'cache-control':cc},logout:{'cache-control':cc}}});try{await x.provider.acquire();assert.equal((await x.provider.release()).status,'confirmed');}finally{await x.destroy();}}
});
test('decoded JSON cap and wire length ceiling independently reject oversized responses',async()=>{
 for(const options of [{token:{padding:'x'.repeat(65536)},headers:{token:{'content-encoding':'gzip','content-length':'20'}}},{headers:{token:{'content-length':'65537'}}},{headers:{token:{'content-length':'invalid'}}}]){const x=fixture(options);try{await assert.rejects(x.provider.acquire());assert.equal(count(x,'/user'),0);}finally{await x.destroy();}}
});
test('GetUser still rejects wrong owner, anonymous and banned identities before token handoff',async()=>{
 for(const user of [{id:'33333333-3333-4333-8333-333333333333'},{is_anonymous:true},{banned_until:new Date(START+60000).toISOString()},{email:'different@fixture.invalid'}]){const x=fixture({user});try{await assert.rejects(x.provider.acquire());assert.equal(count(x,'/user'),1);assert.equal(count(x,'/logout?scope=local'),1);}finally{await x.destroy();}}
});
test('late token after abort is never handed out and receives exactly one local cleanup',async()=>{
 const x=fixture({stallToken:true});const controller=new AbortController();let handedOut=false;
 try{const pending=x.provider.acquire({signal:controller.signal}).then(()=>{handedOut=true;},()=>{});await x.reachedToken;controller.abort();await pending;await Promise.all([x.provider.release(),x.provider.release()]);x.releaseToken();await x.reachedLogout;await tick();await tick();assert.equal(handedOut,false);assert.equal(count(x,'/user'),0);assert.equal(count(x,'/logout?scope=local'),1);assert.equal(x.input.value,'');await x.provider.release();assert.equal(count(x,'/logout?scope=local'),1);}finally{await x.destroy();}
});
test('duplicate and timed-out logout cannot retry or invent a later confirmation',async()=>{
 const x=fixture({stallLogout:true,timeoutMs:25});try{await x.provider.acquire();const pending=x.provider.release();await x.reachedLogout;const keepAlive=setTimeout(()=>{},100);try{assert.equal((await pending).status,'unconfirmed');}finally{clearTimeout(keepAlive);}x.releaseLogout();await tick();assert.equal((await x.provider.release()).status,'unconfirmed');assert.equal(count(x,'/logout?scope=local'),1);}finally{await x.destroy();}
});
test('local cleanup requires exact target, no redirect, status204 and no visible cache/date failure',async()=>{
 for(const options of [{statuses:{logout:503}},{urls:{logout:'https://other.invalid/logout'}},{redirected:{logout:true}},{headers:{logout:{'cache-control':'public'}}},{headers:{logout:{date:'invalid'}}}]){const x=fixture(options);try{await x.provider.acquire();assert.equal((await x.provider.release()).status,'unconfirmed');await x.provider.release();assert.equal(count(x,'/logout?scope=local'),1);}finally{await x.destroy();}}
});
test('foreground loss or fixed enrollment expiry cannot start a new Auth request',async()=>{
 for(const cause of ['hidden','expired']){const x=fixture();try{if(cause==='hidden'){x.document.hidden=true;x.document.visibilityState='hidden';}else x.setClock(START+60000);await assert.rejects(x.provider.acquire());assert.equal(x.calls.length,0);}finally{await x.destroy();}}
});
