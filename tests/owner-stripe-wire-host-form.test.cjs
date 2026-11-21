'use strict';
// Actual handler with native querystring parsing and restored in-process streams.
// Auth/RPC/provider replies and clocks are fictional; this is not hosted acceptance.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {parse}=require('node:querystring');
const {Readable,PassThrough}=require('node:stream');
const {fixture,wire,response,OWNER,OTHER}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {createOwnerStripeWireCheck,PATH}=require('../server/owner_stripe_wire_check.cjs');
const {ENV,API_VERSION}=require('../server/owner_practice_runtime.cjs');
const {LIST_PATH}=require('../server/seller_get_preflight.cjs');
const RAW='action=wire-check';
const PATHS=['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance'];
const MESSAGE='The private Stripe test check is held. No seller or payment action is authorized.';
const STAGES=['owner','form','provider','final-owner'];
function rig(options={}){
 const provider=[];let activeRequest;
 const f=fixture({event:async(name,args,control)=>{
  if(options.ownerEvent)await options.ownerEvent({name,args,control,provider,req:activeRequest});
 }});
 const settings={...f.settings,RACK_RELIC_TEST_REFUNDS_ENABLED:'false',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false',
  RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_SUPABASE_SERVER_KEY:f.serverKey,
  RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:f.publishableKey,RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'true',
  RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING:JSON.stringify({version:'rr-owner-stripe-wire-window-v1',ownerId:OWNER,
   notBefore:f.now-1000,notAfter:f.now+(options.windowMs??1199000)}),
  RACK_RELIC_STRIPE_WIRE_READ_KEY:f.restrictedKey,...options.env};
 const fetchImpl=async(url,init)=>{
  if(!url.startsWith('https://api.stripe.com/'))return f.fetchImpl(url,init);
  const path=url.slice('https://api.stripe.com'.length);provider.push(path);
  assert.equal(path,PATHS[provider.length-1]);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
  assert.equal(Object.hasOwn(init,'body'),false);assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);
  assert.equal(init.headers['Stripe-Version'],API_VERSION);assert.equal(init.headers['Accept-Encoding'],'identity');
  for(const h of ['Stripe-Account','Stripe-Context','Idempotency-Key'])assert.equal(Object.hasOwn(init.headers,h),false);
  const value=path==='/v1/account'?{object:'account',id:ENV.accountId}:path==='/v1/balance'
   ?{object:'balance',livemode:false}:{data:[],next_page_url:null,previous_page_url:null};
  const result=wire(url,value,f.now,{provider:true,headers:{'request-id':'req_FictionalHostForm'+provider.length}});
  if(options.provider)await options.provider({f,req:activeRequest,result,provider});
  return result;
 };
 const mount=createOwnerStripeWireCheck({env:settings,fetchImpl,clock:f.ports.clock,monotonicClock:f.ports.monotonicClock});
 async function request(extra={}){
  const method=extra.method??'POST';
  const req=extra.stream??Readable.from(method==='POST'?[Buffer.from(extra.raw??RAW)]:[]);
  activeRequest=req;req.url=extra.url??PATH;req.method=method;
  req.headers={cookie:f.cookie(extra.cookies),origin:ENV.previewOrigin,'sec-fetch-site':'same-origin',
   'content-type':'application/x-www-form-urlencoded',...extra.headers};
  if(Object.hasOwn(extra,'parsedBody'))req.body=extra.parsedBody;
  const res=response();await mount.handler(req,res);return res;
 }
 return{f,provider,request};
}
function noMutation(t){
 assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.sqlCalls,[]);assert.deepEqual(t.f.providerPosts,[]);
 assert.equal(t.f.phase,'prepared');
}
function held(t,res,status,stage,{providerCount=0}={}){
 assert.equal(res.statusCode,status,res.body);const body=JSON.parse(res.body);
 assert.deepEqual(Object.keys(body).sort(),['error','heldStage']);assert.equal(body.error,MESSAGE);
 assert.equal(body.heldStage,stage);assert(STAGES.includes(body.heldStage));assert.equal(t.provider.length,providerCount);
 for(const secret of [t.f.restrictedKey,t.f.serverKey,t.f.publishableKey])assert(!res.body.includes(secret));
 assert.equal(res.headers['set-cookie'],undefined);noMutation(t);
}
function observed(t,res){
 assert.equal(res.statusCode,200,res.body);const body=JSON.parse(res.body);
 assert.equal(body.state,'observed');assert.equal(Object.hasOwn(body,'heldStage'),false);assert.deepEqual(t.provider,PATHS);
 for(const name of ['providerWrites','sellerReadinessVerified','writePermissionsVerified','launchClearance','durableCrossRestartOneShot'])assert.equal(body[name],false);
 assert.equal(res.headers['set-cookie'],undefined);noMutation(t);
}

test('native querystring null-prototype body plus the restored exact bytes reaches only the five fixed GETs',async()=>{
 const t=rig(),body=parse(RAW);assert.equal(Object.getPrototypeOf(body),null);
 observed(t,await t.request({parsedBody:body}));
});

test('PassThrough replay validates the original bytes rather than trusting the normalized action',async()=>{
 const t=rig(),stream=new PassThrough();stream.end(Buffer.from(RAW));
 observed(t,await t.request({stream,parsedBody:parse(RAW)}));
});

test('ordinary parsed-object and unparsed raw compatibility remain unchanged',async()=>{
 const plain=rig();observed(plain,await plain.request({parsedBody:{action:'wire-check'},stream:Readable.from([])}));
 const raw=rig();observed(raw,await raw.request());
});

test('duplicate, extra, missing and non-string normalized actions are refused before Stripe',async()=>{
 for(const raw of [RAW+'&action=wire-check',RAW+'&other=1','other=1','action=wire-check&action=', 'action[0]=wire-check']){
  const t=rig();held(t,await t.request({raw,parsedBody:parse(raw)}),400,'form');
 }
 for(const action of [null,[],['wire-check'],true,42]){
  const t=rig(),body=Object.assign(Object.create(null),{action});
  held(t,await t.request({parsedBody:body}),400,'form');
 }
});

test('null-prototype normalization cannot admit encoded aliases, trailing bytes or over-limit raw forms',async()=>{
 for(const raw of ['action=%77ire-check',RAW+'&',RAW+'\n',' action=wire-check']){
  const t=rig();held(t,await t.request({raw,parsedBody:parse(RAW)}),400,'form');
 }
 const t=rig();held(t,await t.request({raw:RAW+'x'.repeat(65),parsedBody:parse(RAW)}),413,'form');
});

test('missing replay and a mismatched replay are held even with an otherwise valid parsed action',async()=>{
 for(const raw of ['', 'action=other','action=wire-check&action=wire-check']){
  const t=rig();held(t,await t.request({raw,parsedBody:parse(RAW)}),400,'form');
 }
});

test('accessors, hidden keys, symbols and foreign prototypes never become parsed replay authority',async()=>{
 let touched=0;const accessor=Object.create(null);
 Object.defineProperty(accessor,'action',{enumerable:true,get(){touched++;return 'wire-check';}});
 const hidden=Object.create(null);Object.defineProperty(hidden,'action',{value:'wire-check'});
 const symbol=Object.assign(Object.create(null),{action:'wire-check'});symbol[Symbol('extra')]='x';
 const foreign=Object.create({});Object.defineProperty(foreign,'action',{value:'wire-check',enumerable:true});
 for(const parsedBody of [accessor,hidden,symbol,foreign]){
  const t=rig();held(t,await t.request({parsedBody}),400,'form');
 }
 assert.equal(touched,0);
});

test('streamed replay remains inside the existing elapsed budget and the owner window',async()=>{
 const timed=rig();const slow=Readable.from((async function*(){timed.f.advance(5001);yield Buffer.from(RAW);})());
 held(timed,await timed.request({stream:slow,parsedBody:parse(RAW)}),503,'form');
 const window=rig({windowMs:1000});const late=Readable.from((async function*(){window.f.advance(1001);yield Buffer.from(RAW);})());
 held(window,await window.request({stream:late,parsedBody:parse(RAW)}),503,'owner');
});

test('revocation during replay is independently checked before any Stripe dispatch',async()=>{
 const t=rig();const stream=Readable.from((async function*(){t.f.revoke();yield Buffer.from(RAW);})());
 held(t,await t.request({stream,parsedBody:parse(RAW)}),401,'owner');
});

test('final owner rejection carries only its finite stage and never accepts the completed reads',async()=>{
 let afterLastRead=0;
 const t=rig({ownerEvent:({name,control,provider})=>{
  if(name==='owner:user'&&provider.length===5&&++afterLastRead===2)control.revoke();
 }});
 held(t,await t.request({parsedBody:parse(RAW)}),401,'final-owner',{providerCount:5});
});

test('an elapsed provider read stays held at the subsequent final-check phase without implying its cause',async()=>{
 const t=rig({provider:({f})=>f.advance(5001)});
 held(t,await t.request({parsedBody:parse(RAW)}),503,'final-owner',{providerCount:1});
});

test('provider failures keep the existing structured held report instead of leaking arbitrary error text',async()=>{
 const t=rig({provider:({f})=>{throw Error('Never expose '+f.restrictedKey);}}),res=await t.request({parsedBody:parse(RAW)});
 assert.equal(res.statusCode,503,res.body);const body=JSON.parse(res.body);
 assert.equal(body.state,'held');assert.equal(Object.hasOwn(body,'heldStage'),false);assert.equal(body.observation.code,'wire_held');
 assert.equal(t.provider.length,1);assert(!res.body.includes(t.f.restrictedKey));noMutation(t);
});

test('new held-stage metadata is absent from closed and early origin/type denials',async()=>{
 const variants=[
  {options:{env:{RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'false'}},request:{method:'GET'},status:404},
  {request:{headers:{origin:'null'}},status:403},
  {request:{headers:{'content-type':'application/json'}},status:415}
 ];
 for(const item of variants){const t=rig(item.options),res=await t.request(item.request);
  assert.equal(res.statusCode,item.status,res.body);assert.equal(Object.hasOwn(JSON.parse(res.body),'heldStage'),false);
  assert.deepEqual(t.f.calls,[]);assert.deepEqual(t.provider,[]);noMutation(t);
 }
 const nonowner=rig(),res=await nonowner.request({parsedBody:parse(RAW),cookies:{actor:OTHER,refresh:false}});
 held(nonowner,res,401,'owner');
});
