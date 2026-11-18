'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createRecoveryHost}=require('../package/server/recovery_host.cjs');
const {install}=require('../package/public/recovery-bootstrap.js');
const ORIGIN='https://rack-relic-git-codex-recovery-fixture-rack-relic.vercel.app';
const PROJECT='https://xkxolhgafjadpknsfqqw.supabase.co',OWNER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const PATH='/api/recovery-readonly',REV='a'.repeat(40),SECRET='sb_secret_FICTIONAL_LOCAL_ONLY_NOT_A_KEY';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(extra={}){
 const state={now:Date.now(),mono:0,calls:[],after:null,stall:null};
 const initial=state.now;
 const enrollment={version:'rr-recovery-host-enrollment-v1',projectUrl:PROJECT,ownerId:OWNER,origin:ORIGIN,branch:'codex/recovery-fixture',revision:REV,notBefore:initial-10,expiresAt:initial+60000,reviewRef:'rr-review-FICTIONAL_PACKAGE'};
 const deployment={kind:'preview',projectUrl:PROJECT,origin:ORIGIN,branch:enrollment.branch,revision:REV,protection:'vercel-authentication'};
 const claims={iss:PROJECT+'/auth/v1',sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:Math.floor(initial/1000)-1,exp:Math.floor(initial/1000)+120};
 const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.FICTIONALSIGNATURE';
 const snapshot=()=>({test:true,live:false,releaseEnabled:false,observedAt:new Date(state.now).toISOString(),counts:{orders:0,paidOrders:0,heldOrders:0,sellers:0,openCases:0,alertDeliveryGaps:0},orders:[],cases:[],hasMoreOrders:false,hasMoreCases:false,sources:{stripeObservedAt:null,sellerObservedAt:null,shippingObservedAt:null}});
 const response=(url,obj)=>{const raw=JSON.stringify(obj),r=new Response(raw,{status:200,headers:{'content-type':'application/json','cache-control':'private, no-store',date:new Date(state.now).toUTCString(),'content-length':String(Buffer.byteLength(raw))}});Object.defineProperty(r,'url',{value:url});return r;};
 const fetchImpl=async(url,init)=>{
  state.calls.push({url,init});assert.equal(new URL(url).origin,PROJECT);assert.equal(init.headers.apikey,SECRET);assert.equal(init.headers.Cookie,undefined);assert.equal(init.headers.cookie,undefined);assert.equal(init.headers['x-forwarded-host'],undefined);
  if(state.stall)await state.stall(url,init);
  let r;
  if(url.endsWith('/auth/v1/user'))r=response(url,{id:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,email:'owner@fixture.invalid'});
  else if(url.endsWith('/rr_test_command_owner_session')){const b=JSON.parse(init.body);r=response(url,{version:'rr-command-owner-session-v1',ownerId:OWNER,sessionId:SESSION,tokenExp:claims.exp,accepted:true,nonce:b.p_nonce,observedAt:state.now});}
  else {assert.equal(url,PROJECT+'/rest/v1/rpc/rr_test_admin_overview');r=response(url,snapshot());}
  state.after?.(url,r);return r;
 };
 const config={enabled:true,enrollment,deployment,serverKey:SECRET,fetchImpl,clock:()=>state.now,monotonicClock:()=>state.mono,...extra};
 return {state,config,enrollment,deployment,token,initial,host:createRecoveryHost(config)};
}
function req(token,url=PATH){return Object.assign(new EventEmitter(),{url,method:'GET',headers:{host:new URL(ORIGIN).host,authorization:'Bearer '+token,'sec-fetch-site':'same-origin',cookie:'DO_NOT_FORWARD','x-forwarded-host':'foreign.invalid'},aborted:false});}
function res(hook){return Object.assign(new EventEmitter(),{statusCode:0,headers:{},body:null,headersSent:false,writableEnded:false,destroyed:false,setHeader(k,v){hook?.(k,v);this.headers[k]=v;},end(value){this.headersSent=true;this.writableEnded=true;this.body=value;},destroy(){this.destroyed=true;}});}
const close=x=>x.host.close();

test('default entrypoint and absent binding return 404 with no network',async()=>{
 const h=require('../package/api/recovery-readonly.js');assert.equal(h.config.api.bodyParser,false);const r=res();await h(req('none'),r);assert.equal(r.statusCode,404);assert.deepEqual(JSON.parse(r.body),{error:'Not found'});
 const x=fixture({enabled:false,fetchImpl(){throw Error('No fetch expected');}});try{const r=res();await x.host.handle(req(x.token),r);assert.equal(r.statusCode,404);assert.equal(x.state.calls.length,0);}finally{close(x);}
});
test('host rejects source/production/project/branch/revision/protection/window confusion before I/O',async()=>{
 for(const mutate of [c=>c.enrollment.projectUrl='https://tzymapahsfiyhgilsmxl.supabase.co',c=>c.enrollment.origin='https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app',c=>c.enrollment.origin='https://www.rackrelic.com',c=>c.enrollment.origin='https://foreign.invalid',c=>c.enrollment.branch='codex/prelaunch-seller-protections',c=>c.deployment.kind='production',c=>c.deployment.revision='b'.repeat(40),c=>c.deployment.protection='off',c=>c.enrollment.expiresAt=c.enrollment.notBefore+900001,c=>c.enrollment.notBefore=c.enrollment.expiresAt+1,c=>c.enrollment.ownerId='00000000-0000-0000-0000-000000000000']){
  const x=fixture();close(x);mutate(x.config);const h=createRecoveryHost(x.config),r=res();await h.handle(req(x.token),r);assert.equal(h.configured,false);assert.equal(r.statusCode,404);assert.equal(x.state.calls.length,0);h.close();
 }
});
test('valid packaged host delegates five fixed reads and commits only sanitized response',async()=>{
 const x=fixture();try{const r=res();await x.host.handle(req(x.token),r);assert.equal(r.statusCode,200);assert.equal(x.state.calls.length,5);assert.equal(JSON.parse(r.body).providerWritesEnabled,false);assert.doesNotMatch(r.body,/FICTIONALSIGNATURE|sb_secret|owner@fixture/);assert.equal(r.headers['Cache-Control'],'private, no-store, max-age=0');}finally{close(x);}
});
test('raw aliases, foreign host, methods and supplied body cannot reach legacy or Auth',async()=>{
 const x=fixture();try{
  for(const path of [PATH+'?',PATH+'#x',ORIGIN+PATH,'/api/../api/recovery-readonly',PATH+'?action=orders',PATH+'/']){const r=res();await x.host.handle(req(x.token,path),r);assert.equal(r.statusCode,404);}
  for(const changes of [{method:'POST'},{headers:{host:'foreign.invalid'}},{body:{}},{headers:{host:new URL(ORIGIN).host,'transfer-encoding':'chunked'}}]){const q=Object.assign(req(x.token),changes),r=res();await x.host.handle(q,r);assert.ok([400,404,405].includes(r.statusCode));}
  assert.equal(x.state.calls.length,0);
 }finally{close(x);}
});
test('throwing parsed-body access is held before Auth',async()=>{
 const x=fixture();try{const q=req(x.token);Object.defineProperty(q,'body',{get(){throw Error('Malformed parser state');}});const r=res();await x.host.handle(q,r);assert.equal(r.statusCode,400);assert.equal(x.state.calls.length,0);}finally{close(x);}
});
test('request error cancellation stops work without exposing error text',async()=>{
 const x=fixture();let release,reached;const entered=new Promise(r=>reached=r);x.state.stall=async()=>{reached();await new Promise(r=>release=r);};const q=req(x.token),r=res(),pending=x.host.handle(q,r);await entered;q.emit('error',Error('aborted PRIVATE_MARKER'));await pending;assert.equal(r.body,null);assert.equal(q.listenerCount('error'),0);assert.equal(x.state.calls[0].init.signal.aborted,true);release();await tick();assert.equal(r.body,null);close(x);
});
test('close and cold start after finite cutoff remain held without I/O',async()=>{
 const x=fixture();x.state.now=x.enrollment.expiresAt;const r=res();await x.host.handle(req(x.token),r);assert.equal(r.statusCode,404);const cold=createRecoveryHost(x.config);assert.equal(cold.configured,false);assert.equal(x.state.calls.length,0);cold.close();close(x);
});
test('window expiry after response creation blocks further reads and private output',async()=>{
 const x=fixture();try{x.state.after=()=>{x.state.now=x.enrollment.expiresAt;};const r=res();await x.host.handle(req(x.token),r);assert.equal(r.statusCode,503);assert.equal(x.state.calls.length,1);assert.doesNotMatch(r.body,/snapshot|sessionRef/);}finally{close(x);}
});
test('advance then masked clock rollback stops before next provider call',async()=>{
 const x=fixture();try{x.state.after=()=>{x.state.now+=10;x.state.mono+=10;};const r=res(k=>{if(k==='Content-Type'){x.state.now-=5;x.state.mono-=5;}});await x.host.handle(req(x.token),r);assert.equal(r.statusCode,503);assert.doesNotMatch(r.body,/snapshot|sessionRef/);const before=x.state.calls.length,r2=res();await x.host.handle(req(x.token),r2);assert.equal(r2.statusCode,404);assert.equal(x.state.calls.length,before);}finally{close(x);}
});
test('host body reader detects masked rollback before consuming further provider data',async()=>{
 const x=fixture();try{x.state.after=(_url,r)=>{const body=r.body;Object.defineProperty(r,'body',{value:{getReader(){const reader=body.getReader();let n=0;return {async read(){const next=await reader.read();if(n++===0){x.state.now+=10;x.state.mono+=10;}else{x.state.now-=5;x.state.mono-=5;}return next;},cancel:()=>reader.cancel()};}}});};const r=res();await x.host.handle(req(x.token),r);assert.equal(r.statusCode,503);assert.equal(x.state.calls.length,1);assert.doesNotMatch(r.body,/snapshot|sessionRef/);}finally{close(x);}
});
test('request aborted during a pending read cancels upstream and cannot commit late data',async()=>{
 const x=fixture();let release,reached;const entered=new Promise(r=>reached=r);x.state.stall=async()=>{reached();await new Promise(r=>release=r);};const q=req(x.token),r=res();const pending=x.host.handle(q,r);await entered;q.aborted=true;q.emit('aborted');await pending;assert.equal(r.body,null);assert.equal(x.state.calls.length,1);assert.equal(x.state.calls[0].init.signal.aborted,true);release();await tick();assert.equal(r.body,null);close(x);
});
test('normal request close is not a disconnect and concurrent request abort is isolated',async()=>{
 const x=fixture();let release,reached;const entered=new Promise(r=>reached=r);let first=true;x.state.stall=async()=>{if(first){first=false;reached();await new Promise(r=>release=r);}};const q=req(x.token),r=res(),pending=x.host.handle(q,r);await entered;q.emit('close');const second=res();await x.host.handle(req(x.token),second);assert.equal(second.statusCode,200);q.aborted=true;q.emit('aborted');await pending;assert.equal(r.body,null);release();await tick();close(x);
});
test('response disconnect and factory stop discard pending private output',async()=>{
 for(const stop of [(_x,_q,r)=>r.emit('close'),x=>x.host.close()]){const x=fixture();let release,reached;const entered=new Promise(r=>reached=r);x.state.stall=async()=>{reached();await new Promise(r=>release=r);};const q=req(x.token),r=res(),pending=x.host.handle(q,r);await entered;stop(x,q,r);await pending;assert.ok(r.body===null||!r.body.includes('snapshot'));release();await tick();close(x);}
});
const ids=['records','observed-at','stored-orders','stored-paid','stored-held','stored-sellers','stored-open-cases','stored-delivery-gaps','orders','cases','record-limit','status','open-records','clear-records'];
function dom(){const el=()=>Object.assign(new EventTarget(),{hidden:false,disabled:false,textContent:'',children:[],replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}});const nodes=new Map(ids.map(k=>[k,el()]));const document=Object.assign(new EventTarget(),{getElementById:k=>nodes.get(k),createElement:el,hidden:false,visibilityState:'visible',hasFocus:()=>true});const window=Object.assign(new EventTarget(),{location:{origin:ORIGIN}});for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('No browser storage');}});Object.defineProperty(document,'cookie',{get(){throw Error('No cookie reads');},set(){throw Error('No cookie writes');}});return {document,window,nodes};}
function browserEnrollment(x){return {version:'rr-recovery-browser-host-v1',projectRef:'xkxolhgafjadpknsfqqw',ownerId:OWNER,origin:ORIGIN,branch:x.enrollment.branch,revision:REV,notBefore:x.enrollment.notBefore,expiresAt:x.enrollment.expiresAt};}
function browserConfig(x,d){return {...d,enabled:true,enrollment:browserEnrollment(x),clock:()=>x.state.now,monotonicClock:()=>x.state.mono,sessionProvider:async()=>({accessToken:x.token}),fetchImpl:async(url,init)=>{const r=res();await x.host.handle(Object.assign(req(x.token),{signal:init.signal}),r);const out=new Response(r.body,{status:r.statusCode,headers:{...r.headers,date:new Date(x.state.now).toUTCString()}});Object.defineProperty(out,'url',{value:url});return out;}};}
test('browser bootstrap default has no handoff/network and single installation owns listeners',async()=>{
 const d=dom();let calls=0;const a=install({...d,fetchImpl:async()=>{calls++;throw Error('No network');}});assert.equal(a.configured,false);await a.read();assert.equal(calls,0);assert.equal(d.nodes.get('open-records').disabled,true);const b=install({...d});assert.equal(b.configured,false);assert.equal(d.nodes.get('records').hidden,true);a.destroy();b.destroy();
});
test('explicit browser bootstrap reaches only packaged read and hides on finite expiry',async()=>{
 const x=fixture(),d=dom(),b=install(browserConfig(x,d));try{assert.equal(b.configured,true);assert.equal(x.state.calls.length,0);await b.read();assert.equal(d.nodes.get('records').hidden,false);x.state.now=x.enrollment.expiresAt;await b.read();assert.equal(d.nodes.get('records').hidden,true);assert.equal(x.state.calls.length,5);}finally{b.destroy();close(x);}
});
test('browser finite timer clears displayed records before longer JWT expires',async()=>{
 const x=fixture();x.enrollment.expiresAt=x.state.now+160;close(x);x.host=createRecoveryHost(x.config);const d=dom(),b=install(browserConfig(x,d));try{await b.read();assert.equal(d.nodes.get('records').hidden,false);await new Promise(r=>setTimeout(r,180));assert.equal(d.nodes.get('records').hidden,true);assert.equal(d.nodes.get('open-records').disabled,true);}finally{b.destroy();close(x);}
});
test('browser refuses a source origin and prevents retained callback reuse after destroy',async()=>{
 const x=fixture(),d=dom();let acquisitions=0;const c=browserConfig(x,d);c.sessionProvider=async()=>{acquisitions++;return {accessToken:x.token};};const b=install(c);b.destroy();await b.read();assert.equal(acquisitions,0);const bad=install({...c,enrollment:{...c.enrollment,origin:'https://rackrelic.com'}});assert.equal(bad.configured,false);await bad.read();assert.equal(x.state.calls.length,0);bad.destroy();close(x);
});
test('retained old bootstrap handle cannot clear a newly installed view',async()=>{
 const x=fixture(),d=dom(),a=install(browserConfig(x,d)),b=install(browserConfig(x,d));try{await b.read();assert.equal(d.nodes.get('records').hidden,false);a.clear();a.destroy();await a.read();assert.equal(d.nodes.get('records').hidden,false);assert.equal(x.state.calls.length,5);}finally{b.destroy();close(x);}
});
test('packaged static assets expose no secret binding and keep password input disabled by default',()=>{
 const dir=resolve(__dirname,'../package');const html=readFileSync(dir+'/public/recovery-readonly-view.html','utf8'),view=readFileSync(dir+'/public/recovery-readonly-view.js','utf8'),boot=readFileSync(dir+'/public/recovery-bootstrap.js','utf8');assert.match(html,/recovery-bootstrap\.js/);assert.doesNotMatch(html,/sb_secret_|sb_publishable_/);assert.match(html,/id="recovery-password" type="password"[^>]*disabled/);assert.doesNotMatch(view,/if\(root.document\)api.mount/);assert.doesNotMatch(boot,/serverKey|process\.env|document\.cookie|localStorage|sessionStorage/);assert.equal((html.match(/recovery-readonly-view\.js/g)||[]).length,1);
});
