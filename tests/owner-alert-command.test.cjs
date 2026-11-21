'use strict';
const{test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const F=require('./command-owner-fixture.cjs');
const{createOwnerAlertRehearsalRuntime,FACTS,RECEIVER_SOURCE_SHA256}=require('../server/owner_alert_rehearsal_runtime.cjs');
const{WORKER_ID,CASE_ID,ORDER_ID}=require('../server/owner_alert_rehearsal_repository.cjs');
const{projectAlert}=require('../server/case_alert_worker.cjs');
const{createOwnerAlertCommand}=require('../owner-alert-command.js');
const ORIGIN='https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app',OWNER='wayne@rackrelic.com',SENDER='alerts@alerts.rackrelic.com';
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
let f;before(async()=>{f=await F.create();});after(async()=>f?.db.close());beforeEach(async()=>{f.hook=null;f.userPatch={email:OWNER,email_confirmed_at:new Date().toISOString()};f.clearCalls();await f.reset();});
const env=()=>({...F.env(),RACK_RELIC_TEST_OWNER_ALERT_REHEARSAL_ENABLED:'true',RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_RESEND_API_KEY:'re_FICTIONAL_ONLY_NOT_A_PROVIDER_KEY'});
const review=()=>({version:'rr-owner-alert-action-review-v1',team:'rackrelic',domainId:'f4adcee8-bc22-4597-9aae-6d9cd6780e6a',receiverSource:RECEIVER_SOURCE_SHA256,receiverRevision:'v4',checkedAt:Date.now(),expiresAt:Date.now()+240000,evidenceReference:'owner_review_FICTIONAL_ONLY',facts:FACTS.slice()});
function fixture({fresh=false,onJournalClaim,onContext}={}){
 const calls=[],lease='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',attempt='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const alert={alertId:1,deliveryKey:'rr_test_case_alert_1',leaseToken:lease,leasedUntil:new Date(Date.now()+(fresh?60000:-60000)).toISOString(),attempt:1,kind:'case_changed',severity:1,case:{test:true,releaseEnabled:false,holdRequired:true,caseId:CASE_ID,orderId:ORDER_ID,kind:'early_fraud_warning',status:'warning_received',requiresResponse:false,dueBy:null,providerDueBy:null,deadlineReviewRequired:true,evidenceConflict:false}};
 const p=projectAlert(alert,Date.now(),{historical:true}),body={from:SENDER,to:[OWNER],subject:'Rack Relic TEST case alert',text:'TEST ONLY. Financial hold remains.\n'+JSON.stringify(p.message),tags:[{name:'rr_delivery_key',value:p.deliveryKey},{name:'rr_payload_sha256',value:p.payloadHash}]};
 const original={test:true,transportId:'resend_rack_owner_v1',destinationId:'rack_owner_wayne_v1',deliveryKey:p.deliveryKey,payloadHash:p.payloadHash,requestHash:sha(body),policyHash:sha({transportId:'resend_rack_owner_v1',destinationId:'rack_owner_wayne_v1',sender:SENDER,recipient:OWNER}),attemptId:attempt,providerEmailId:fresh?null:email,sendAllowed:false,delivered:!fresh,adverseSeen:false,state:fresh?'unknown':'delivered',releaseEnabled:false};
 const snapshot=JSON.stringify({alert,original});
 async function fetchImpl(url,o){calls.push({url,o});
  if(url.includes('/functions/v1/rack-alert-receipts')){const status=url.includes('?')?404:o.method==='GET'?405:o.headers['svix-signature']?503:400;const r=new Response(null,{status,headers:{'cache-control':'no-store'}});Object.defineProperty(r,'url',{value:url});return r;}
  if(url.endsWith('/rr_test_owner_alert_rehearsal')){assert.equal(o.headers.Authorization,undefined);const a=JSON.parse(o.body);let v;
   if(a.p_action==='context'){await onContext?.();v={test:true,releaseEnabled:false,cloudReady:false,workerId:WORKER_ID,state:fresh?'unknown':'delivered',alert};}
   else if(a.p_action==='claim')v={test:true,releaseEnabled:false,cloudReady:false,alerts:fresh?[alert]:[]};
   else if(a.p_action==='authority')v={test:true,releaseEnabled:false,allowed:true};
   else if(a.p_action==='finish')v={test:true,releaseEnabled:false,state:fresh?'unknown':'delivered'};
   else throw Error('Unexpected fixture RPC');return F.response(url,v);
  }
  if(url.endsWith('/rr_test_resend_owner_read'))return F.response(url,original);
  if(url.endsWith('/rr_test_resend_owner_claim')){await onJournalClaim?.();const a=JSON.parse(o.body);return F.response(url,{...original,requestHash:a.p_request,sendAllowed:true});}
  if(url.startsWith('https://api.resend.com/'))throw Error('No provider email call allowed in this fixture');
  return f.fetchImpl(url,o);
 }
 const runtime=createOwnerAlertRehearsalRuntime({env:env(),fetchImpl});
 async function call({method='GET',url='/api/test-owner-alert',cookie=F.cookie(),headers={},body}={}){const r=F.res();await runtime({method,url,headers:{host:new URL(ORIGIN).host,origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body})},r);return r;}
 return{call,calls,original,assertPreserved(){assert.equal(JSON.stringify({alert,original}),snapshot);},mailCalls:()=>calls.filter(c=>c.url.startsWith('https://api.resend.com/')),alertCalls:()=>calls.filter(c=>c.url.endsWith('/rr_test_owner_alert_rehearsal'))};
}
test('disabled/foreign/checkout-open routes stay404 and do no authentication or provider work',async()=>{
 for(const patch of[{RACK_RELIC_TEST_OWNER_ALERT_REHEARSAL_ENABLED:'false'},{VERCEL_ENV:'production'},{RACK_RELIC_TEST_CHECKOUT_ENABLED:'true'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_wrong'}]){let calls=0;const h=createOwnerAlertRehearsalRuntime({env:{...env(),...patch},fetchImpl:async()=>{calls++;throw Error();}}),r=F.res();await h({method:'GET',url:'/api/test-owner-alert',headers:{}},r);assert.equal(r.statusCode,404);assert.equal(calls,0);}
});
test('canonical owner cookie opens page/session without OTP, publishable-key config or browser token storage',async()=>{
 const x=fixture(),page=await x.call();assert.equal(page.statusCode,200);assert.match(page.body,/existing Rack Command sign-in/);assert.doesNotMatch(page.body,/OWNER_SIGNIN_MODULE|sessionStorage|localStorage|Email owner sign-in link|id="send"/);assert.match(page.headers['content-security-policy'],/script-src 'self'/);
 const s=await x.call({url:'/api/test-owner-alert?action=session'});assert.deepEqual(s.data,{signedIn:true,sessionRef:F.S});assert.equal(s.headers['x-rack-command-session'],F.S);assert.equal(x.mailCalls().length,0);assert.equal(x.alertCalls().length,0);assert.ok(f.calls.every(c=>!c.url.includes('/otp')&&!c.url.includes('/token?')));
 for(const url of['/api/test-owner-alert?action=config','/api/test-owner-alert?code=old_link','/api/test-owner-alert?return_to=https://other.invalid'])assert.equal((await x.call({url})).statusCode,404);
});
test('browser bearer-only, support cookie and revoked session never authorize alert operations',async()=>{
 const x=fixture();for(const options of[{cookie:null,headers:{authorization:'Bearer '+F.token()}},{cookie:'__Host-rr-command-current='+F.S+'; __Host-rr-command-access.'+F.S+'='+F.token({sub:F.B})}]){const r=await x.call(options);assert.equal(r.statusCode,303);assert.equal(r.headers.location,'/api/command-center');}
 await f.db.query('DELETE FROM auth.sessions WHERE id=$1',[F.S]);assert.deepEqual((await x.call({url:'/api/test-owner-alert?action=session'})).data,{signedIn:false});const post=await x.call({method:'POST',body:{action:'reconcile',review:review()}});assert.equal(post.statusCode,401);assert.equal(x.alertCalls().length,0);assert.equal(x.mailCalls().length,0);
});
test('missing helper, cached session evidence and mismatched host fail closed without clearing newer cookies',async()=>{
 const x=fixture();f.hook=async(c,phase)=>phase==='before'&&c.url.endsWith('/'+F.RPC)?F.response(c.url,{error:'not installed'},{status:404}):null;const missing=await x.call();assert.equal(missing.statusCode,503);assert.equal(missing.headers['set-cookie'],undefined);assert.equal(x.alertCalls().length,0);
 f.hook=async(c,phase)=>phase==='after'&&c.url.endsWith('/'+F.RPC)?F.response(c.url,c.data,{headers:{'x-cache':'HIT'}}):null;assert.equal((await x.call()).statusCode,503);assert.equal((await x.call({headers:{host:'foreign.invalid'}})).statusCode,404);
});
test('original delivered fixture reconciles with same transport body/journal identity and zero email or claim calls',async()=>{
 const x=fixture();for(let n=0;n<2;n++){const r=await x.call({method:'POST',body:{action:'reconcile',review:review()}});assert.equal(r.statusCode,200);assert.equal(r.data.state,'delivered');assert.equal(r.data.ownerRead,false);assert.equal(r.data.cloudReady,false);assert.equal(r.data.releaseEnabled,false);}
 x.assertPreserved();assert.equal(x.mailCalls().length,0);assert.equal(x.calls.filter(c=>c.url.endsWith('/rr_test_resend_owner_claim')).length,0);assert.equal(x.alertCalls().filter(c=>JSON.parse(c.o.body).p_action==='claim').length,0);
});
test('expired remembered cookie refreshes once, then private renewed JWT checks protect the whole reconciliation',async()=>{
 const x=fixture();const r=await x.call({method:'POST',cookie:F.cookie(F.token({exp:Math.floor(Date.now()/1000)-1})),body:{action:'reconcile',review:review()}});assert.equal(r.statusCode,200);assert.equal(r.data.state,'delivered');assert.equal(f.calls.filter(c=>c.url.includes('/auth/v1/token?grant_type=refresh_token')).length,1);assert.ok(f.calls.filter(c=>c.url.endsWith('/'+F.RPC)).length>=3);assert.equal(x.mailCalls().length,0);x.assertPreserved();
});
test('revocation during original-context read withholds delivery result and prevents further transport work',async()=>{
 let removed=false;const x=fixture({onContext:async()=>{if(!removed){removed=true;await f.db.query('DELETE FROM auth.sessions WHERE id=$1',[F.S]);}}});const r=await x.call({method:'POST',body:{action:'reconcile',review:review()}});assert.equal(r.statusCode,503);assert.equal(r.data.state,undefined);assert.equal(x.mailCalls().length,0);x.assertPreserved();
});
test('fresh synthetic claim followed by session revocation cannot reach an email POST',async()=>{
 const x=fixture({fresh:true,onJournalClaim:()=>f.db.query('DELETE FROM auth.sessions WHERE id=$1',[F.S])});const r=await x.call({method:'POST',body:{action:'send-one',review:review()}});assert.equal(r.statusCode,503);assert.equal(x.calls.filter(c=>c.url.endsWith('/rr_test_resend_owner_claim')).length,1);assert.equal(x.mailCalls().length,0);x.assertPreserved();
});
function browser({onFetch,timeoutMs=1000,listeners=true,storageAvailable=true,initialHidden=false,initialFocused=true}={}){
 const nodes=new Map(),calls=[],boxes=FACTS.map(name=>({name,checked:false}));for(const id of['review','review-fields','reconcile','status','command-link','revision','reference'])nodes.set(id,{textContent:'',disabled:false,value:'',events:{},addEventListener(k,fn){this.events[k]=fn;},removeEventListener(k){delete this.events[k];}});
 const form=nodes.get('review');form.reportValidity=()=>true;form.querySelectorAll=()=>boxes;form.reset=()=>{for(const b of boxes)b.checked=false;nodes.get('revision').value='';nodes.get('reference').value='';};
 let focused=initialFocused,readable=storageAvailable;const saved=new Map(),document=new EventTarget(),window=new EventTarget();Object.assign(document,{hidden:initialHidden,visibilityState:initialHidden?'hidden':'visible',hasFocus:()=>focused,getElementById:id=>nodes.get(id)});window.localStorage={getItem:key=>{if(!readable)throw Error('storage unavailable');return saved.get(key)??null;}};if(!listeners)window.addEventListener=undefined;
 const fire=(target,type,props={})=>{const event=new Event(type);for(const [key,value]of Object.entries(props))Object.defineProperty(event,key,{value});target.dispatchEvent(event);};
 const windowEvent=(type,props)=>{if(type==='blur')focused=false;if(type==='focus')focused=true;fire(window,type,props);};
 const visibility=hidden=>{document.hidden=hidden;document.visibilityState=hidden?'hidden':'visible';fire(document,'visibilitychange');};
 const fillReview=()=>{for(const b of boxes)b.checked=true;nodes.get('revision').value='v4';nodes.get('reference').value='owner_review_FICTIONAL_ONLY';};
 const session=(ref=F.S)=>Response.json({signedIn:true,sessionRef:ref},{headers:{'x-rack-command-session':ref}});
 const result=()=>Response.json({test:true,cloudReady:false,releaseEnabled:false,state:'delivered',readinessEvidence:'authenticated_owner_review_and_live_boundary_probes',signedDeliveryRequired:true,ownerRead:false},{headers:{'x-rack-command-session':F.S}});
 const fetchImpl=async(url,o)=>{calls.push({url,o});return onFetch?onFetch(url,o,{session,result,calls}):o.method==='GET'?session():result();};
 const client=createOwnerAlertCommand({document,window,fetchImpl,timeoutMs});return{client,calls,nodes,boxes,session,result,document,window,windowEvent,visibility,fillReview,setStorageAvailable:value=>readable=value};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('browser construction performs one cookie GET only; explicit check uses only reconcile and never exposes credentials',async()=>{
 const x=browser();await tick();assert.equal(x.calls.length,1);assert.equal(x.calls[0].o.method,'GET');x.fillReview();await x.client.reconcile();assert.match(x.nodes.get('status').textContent,/signed delivery evidence/);assert.equal(x.calls.filter(c=>c.o.method==='POST').length,1);assert.equal(JSON.parse(x.calls.find(c=>c.o.method==='POST').o.body).action,'reconcile');assert.ok(x.calls.every(c=>c.o.credentials==='same-origin'&&!c.o.headers?.Authorization));assert.equal(x.nodes.get('command-link').href,'/api/command-center#cases-heading');x.client.destroy();
 const text=fs.readFileSync(path.join(__dirname,'../owner-alert-command.js'),'utf8');assert.doesNotMatch(text,/sessionStorage|setItem|Bearer|publishableKey|\/auth\/v1|send-one/);assert.match(text,/window:root/);
});
test('changed session after reply clears all review inputs and withholds prior delivery output',async()=>{
 let reads=0;const x=browser({onFetch:(url,o,h)=>o.method==='GET'?h.session(++reads===3?F.N:F.S):h.result()});await tick();x.fillReview();await x.client.reconcile();assert.match(x.nodes.get('status').textContent,/Sign in to Rack Command/);assert.equal(x.nodes.get('reconcile').disabled,true);assert.equal(x.boxes.some(b=>b.checked),false);assert.equal(x.nodes.get('reference').value,'');assert.doesNotMatch(x.nodes.get('status').textContent,/has signed delivery/);x.client.destroy();
});
test('destroy during final session await cannot restore private output or reenable the form',async()=>{
 let reads=0,release,started;const seen=new Promise(r=>started=r);const x=browser({onFetch:(url,o,h)=>{if(o.method==='GET'&&++reads===3){started();return new Promise(r=>release=()=>r(h.session()));}return o.method==='GET'?h.session():h.result();}});await tick();x.fillReview();const pending=x.client.reconcile();await seen;x.client.destroy();release();await pending;assert.equal(x.nodes.get('status').textContent,'Private alert details cleared.');assert.equal(x.nodes.get('reconcile').disabled,true);
});
function assertCleared(x){assert.equal(x.nodes.get('review-fields').disabled,true);assert.equal(x.nodes.get('reconcile').disabled,true);assert.equal(x.boxes.some(b=>b.checked),false);assert.equal(x.nodes.get('revision').value,'');assert.equal(x.nodes.get('reference').value,'');assert.doesNotMatch(x.nodes.get('status').textContent,/has signed delivery/);}
test('blur, hidden visibility and BFcache pagehide clear review and delivery; return requires a fresh session with an empty review',async()=>{
 for(const reason of['blur','hidden','pagehide']){let release;const x=browser({onFetch:(url,o,h)=>h.calls.length===5?new Promise(r=>release=()=>r(h.session())):o.method==='GET'?h.session():h.result()});await tick();x.fillReview();await x.client.reconcile();assert.match(x.nodes.get('status').textContent,/has signed delivery/);const count=x.calls.length;
  if(reason==='hidden')x.visibility(true);else x.windowEvent(reason,{persisted:true});assertCleared(x);assert.equal(x.calls.length,count);await x.client.reconcile();assert.equal(x.calls.length,count);
  if(reason==='hidden')x.visibility(false);else x.windowEvent(reason==='blur'?'focus':'pageshow',{persisted:true});await tick();assert.equal(x.calls.length,count+1);assert.equal(x.calls.at(-1).o.method,'GET');assertCleared(x);release();await tick();assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);assert.equal(x.nodes.get('reference').value,'');assert.doesNotMatch(x.nodes.get('status').textContent,/has signed delivery/);x.client.destroy();
 }
});
test('logout notifications only deny, never recheck during pending logout, and require later server authorization',async()=>{
 for(const [type,props]of[['storage',{key:'rr-command-denial-v1',newValue:JSON.stringify({version:'rr-command-denial-v1',action:'signed-out',nonce:'opaque'})}],['rr-command-denial',{detail:'{}'}],['storage',{key:'rr-command-denial-v1',newValue:'malformed'}],['storage',{key:null}]]){
  let signed=true;const x=browser({onFetch:(url,o,h)=>o.method==='GET'?signed?h.session():Response.json({signedIn:false}):h.result()});await tick();x.fillReview();await x.client.reconcile();const count=x.calls.length;x.windowEvent(type,props);assertCleared(x);await tick();assert.equal(x.calls.length,count);await x.client.reconcile();assert.equal(x.calls.length,count);signed=false;x.windowEvent('focus');await tick();assert.equal(x.calls.length,count+1);assertCleared(x);x.client.destroy();
 }
});
test('actual Command logout publisher immediately clears same-window and other-window alert pages before logout finishes',async()=>{
 const {mount}=require('../test-admin.js');
 for(const sameWindow of[true,false]){const x=browser();await tick();x.fillReview();await x.client.reconcile();const count=x.calls.length,writes=[],adminWindow=sameWindow?x.window:new EventTarget();adminWindow.crypto={randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};adminWindow.CustomEvent=class extends Event{constructor(type,{detail}){super(type);this.detail=detail;}};adminWindow.localStorage={getItem:()=>null,setItem(key,value){writes.push({key,value});if(!sameWindow)x.windowEvent('storage',{key,newValue:value});}};
  const nodes=new Map(),adminDocument=new EventTarget();adminDocument.getElementById=id=>{if(!nodes.has(id)){const n=new EventTarget();Object.assign(n,{textContent:'',hidden:false,disabled:false,replaceChildren(){}});nodes.set(id,n);}return nodes.get(id);};let finish,logoutStarted=false;const held=new Promise(r=>finish=r);const admin=mount({document:adminDocument,window:adminWindow,fetchImpl:async()=>Response.json({error:'no overview used in this test'},{status:503}),storage:{},environments:[],endpoint:'/api/command-center',sessionProvider:()=>({member:F.S,sessionRef:F.S}),onSignOut:()=>{logoutStarted=true;return held;},setTimer:()=>0,clearTimer:()=>{}});await tick();adminDocument.getElementById('logout').dispatchEvent(new Event('click'));assert.equal(logoutStarted,true);assert.equal(writes.length,1);assertCleared(x);await tick();assert.equal(x.calls.length,count);finish();admin.destroy();x.client.destroy();
 }
});
test('browser bootstrap wires its real root lifecycle listeners and clears on pagehide',async()=>{
 const x=browser();await tick();x.client.destroy();const source=fs.readFileSync(path.join(__dirname,'../owner-alert-command.js'),'utf8'),target=new EventTarget(),sandbox={document:x.document,fetch:async()=>x.session(),localStorage:{getItem:()=>null},addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),AbortController,TextDecoder,Uint8Array,setTimeout,clearTimeout};require('node:vm').runInNewContext(source,sandbox);await tick();assert.equal(x.nodes.get('reconcile').disabled,false);x.fillReview();target.dispatchEvent(new Event('pagehide'));assertCleared(x);sandbox.RackOwnerAlertCommand.destroy();
});
test('lifecycle or logout aborts an ignored late reply and its finally cannot restore or disable a newer session',async()=>{
 for(const reason of['blur','pagehide','storage','rr-command-denial']){let reads=0,release,started;const seen=new Promise(r=>started=r);const x=browser({onFetch:(url,o,h)=>{if(o.method==='GET'&&++reads===3){started();return new Promise(r=>release=()=>r(h.session()));}return o.method==='GET'?h.session(reads>3?F.N:F.S):h.result();}});await tick();x.fillReview();const pending=x.client.reconcile();await seen;const prior=x.calls.at(-1).o.signal;x.windowEvent(reason,{persisted:true,key:'rr-command-denial-v1'});assert.equal(prior.aborted,true);assertCleared(x);x.windowEvent(reason==='pagehide'?'pageshow':'focus',{persisted:true});await tick();assert.equal(x.calls.length,5);assert.equal(x.calls.at(-1).o.method,'GET');assert.equal(x.nodes.get('reconcile').disabled,false);release();await pending;await tick();assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);assert.doesNotMatch(x.nodes.get('status').textContent,/has signed delivery/);x.client.destroy();
 }
});
test('stale or unknown denial can hide a newer login but never mutate its cookies or grant access',async()=>{
 const x=browser({onFetch:(url,o,h)=>o.method==='GET'?h.session(F.N):h.result()});await tick();x.fillReview();const count=x.calls.length;x.windowEvent('storage',{key:'different-key',newValue:'anything'});assert.equal(x.nodes.get('reconcile').disabled,false);x.windowEvent('storage',{key:'rr-command-denial-v1',newValue:JSON.stringify({version:'unknown',action:'signed-in',nonce:'old'})});assertCleared(x);assert.equal(x.calls.length,count);await x.client.refresh();assert.equal(x.calls.length,count+1);assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);assert.ok(x.calls.every(c=>c.o.method==='GET'));x.client.destroy();
});
test('missing listeners or storage fails closed; loss of storage in flight hides the result until a new server check',async()=>{
 for(const options of[{listeners:false},{storageAvailable:false}]){const x=browser(options);await tick();assertCleared(x);assert.equal(x.calls.length,0);await x.client.reconcile();assert.equal(x.calls.length,0);x.client.destroy();}
 let reads=0,release,started;const seen=new Promise(r=>started=r);const x=browser({onFetch:(url,o,h)=>{if(o.method==='GET'&&++reads===3){started();return new Promise(r=>release=()=>r(h.session()));}return o.method==='GET'?h.session():h.result();}});await tick();x.fillReview();const pending=x.client.reconcile();await seen;x.setStorageAvailable(false);release();await pending;assertCleared(x);x.setStorageAvailable(true);x.windowEvent('focus');await tick();assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);x.client.destroy();
});
test('destroy removes actual event handlers and no later lifecycle or logout event can refresh or overwrite cleared output',async()=>{
 const x=browser();await tick();x.fillReview();x.client.destroy();const count=x.calls.length;for(const type of['focus','pageshow','rr-command-denial','storage'])x.windowEvent(type,{key:'rr-command-denial-v1'});x.visibility(false);x.visibility(true);await tick();assert.equal(x.calls.length,count);assert.equal(x.nodes.get('status').textContent,'Private alert details cleared.');assertCleared(x);
});
test('initially hidden or unfocused pages cannot authenticate or enable controls until a fresh foreground check',async()=>{
 for(const options of[{initialHidden:true},{initialFocused:false}]){const x=browser(options);await tick();assertCleared(x);assert.equal(x.calls.length,0);await x.client.reconcile();assert.equal(x.calls.length,0);if(options.initialHidden)x.visibility(false);else x.windowEvent('focus');await tick();assert.equal(x.calls.length,1);assert.equal(x.calls[0].o.method,'GET');assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);x.client.destroy();}
});
test('logout during an ignored late POST clears immediately and a fresh focus read can finish before that POST',async()=>{
 let release,started;const seen=new Promise(r=>started=r);const x=browser({onFetch:(url,o,h)=>{if(o.method==='POST'){started();return new Promise(r=>release=()=>r(h.result()));}return h.session();}});await tick();x.fillReview();const pending=x.client.reconcile();await seen;const prior=x.calls.at(-1).o.signal;x.windowEvent('storage',{key:'rr-command-denial-v1',newValue:'{}'});assert.equal(prior.aborted,true);assertCleared(x);assert.equal(x.calls.length,3);x.windowEvent('focus');await tick();assert.equal(x.calls.length,4);assert.equal(x.calls.at(-1).o.method,'GET');assert.equal(x.nodes.get('reconcile').disabled,false);release();await pending;assert.equal(x.calls.length,4);assert.equal(x.nodes.get('reconcile').disabled,false);assert.equal(x.boxes.some(b=>b.checked),false);assert.doesNotMatch(x.nodes.get('status').textContent,/has signed delivery/);x.client.destroy();
});
test('ignored abort and late session response cannot authorize a later browser POST',async()=>{
 let release;const x=browser({timeoutMs:10,onFetch:(url,o,h)=>new Promise(r=>release=()=>r(h.session()))});await new Promise(r=>setTimeout(r,25));assert.equal(x.nodes.get('reconcile').disabled,true);release();await tick();await x.client.reconcile();assert.equal(x.calls.length,1);assert.match(x.nodes.get('status').textContent,/could not be verified/);x.client.destroy();
});
