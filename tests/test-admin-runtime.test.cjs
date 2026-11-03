'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const {projectAdminOverview,sanitizeAdminSnapshot,validateAdminOverview}=require('../test-admin.js');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',BUY='22222222-2222-4222-8222-222222222222',NOW=Date.now();
const stamp=n=>new Date(NOW+n).toISOString();
function snapshot(){return {test:true,live:false,releaseEnabled:false,observedAt:stamp(0),counts:{orders:1,paidOrders:1,heldOrders:1,sellers:1,openCases:0,alertDeliveryGaps:0},orders:[{orderRef:'33333333-3333-4333-8333-333333333333',state:'paid',riskStatus:'review',refundState:'none',totalCents:3502,observedAt:stamp(-5000),holdRequired:true}],cases:[],hasMoreOrders:false,hasMoreCases:false,sources:{stripeObservedAt:stamp(-600000),sellerObservedAt:null,shippingObservedAt:null}};}
function env(row=A){return {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:row.branch,VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_TEST_ADMIN_OWNER_ID:OP,RACK_RELIC_TEST_SUPABASE_URL:row.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:row.accountId,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_MEMBER_IDS:OP+','+BUY,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OP,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true'};}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;try{this.data=JSON.parse(v);}catch{}}});
async function call({patch={},actor=OP,authorization='Bearer fixture',method='GET',url='/api/test-admin?action=overview',raw=snapshot(),headers={}}={}){let auths=0;const calls=[],h=createTestAdminRuntime({env:{...env(),...patch},clock:()=>NOW,fetchImpl:async(u,o)=>{calls.push({u,o});assert.equal(new URL(u).origin,A.projectUrl);if(u.endsWith('/auth/v1/user'))return Response.json({id:Array.isArray(actor)?actor[Math.min(auths++,actor.length-1)]:actor},{headers});assert.equal(u,A.projectUrl+'/rest/v1/rpc/rr_test_admin_overview');assert.deepEqual(JSON.parse(o.body),{p_owner:OP,p_actor:OP});return Response.json(raw,{headers});}}),res=response();await h({method,url,headers:{authorization}},res);return {calls,res};}
test('admin route is off by default and rejects production, mixed tuples and all writes before private access',async()=>{
 for(const patch of [{RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:''},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{RACK_RELIC_TEST_SUPABASE_URL:L.projectUrl},{RACK_RELIC_TEST_STRIPE_ACCOUNT:L.accountId}]){const x=await call({patch});assert.equal(x.res.statusCode,404);assert.equal(x.calls.length,0);}
 for(const method of ['POST','PUT','DELETE']){const x=await call({method});assert.equal(x.res.statusCode,405);assert.equal(x.calls.length,0);}
 for(const url of ['/api/test-admin?action=overview&actor='+OP,'/api/test-admin?action=overview&action=config','/api/test-admin?action=release']){const x=await call({url});assert.equal(x.res.statusCode,400);assert.equal(x.calls.length,0);}
});
test('anonymous and non-operator members cannot read a snapshot or reach the privileged RPC',async()=>{
 const anonymous=await call({authorization:null});assert.equal(anonymous.res.statusCode,403);assert.equal(anonymous.calls.length,0);
 const buyer=await call({actor:BUY});assert.equal(buyer.res.statusCode,403);assert.equal(buyer.calls.length,1);
 const outsider=await call({actor:'44444444-4444-4444-8444-444444444444'});assert.equal(outsider.res.statusCode,403);assert.equal(outsider.calls.length,1);
 for(const patch of [{RACK_RELIC_TEST_MEMBER_IDS:OP+','+OP},{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:BUY+',44444444-4444-4444-8444-444444444444'},{RACK_RELIC_TEST_REFUNDS_ENABLED:''}]){const x=await call({patch});assert.equal(x.res.statusCode,503);assert.equal(x.calls.length,0);}
});
test('authorized snapshot uses only fresh database reads and never turns old/missing observations into healthy sources',async()=>{
 const raw=snapshot();raw.secret='must not appear';raw.orders[0].email='private@example.invalid';const x=await call({raw});assert.equal(x.res.statusCode,200);assert.equal(x.calls.length,3);assert.equal(x.res.data.test,true);assert.equal(x.res.data.live,false);assert.equal(x.res.data.releaseEnabled,false);assert.equal(x.res.data.sources.stripe.state,'stale');assert.equal(x.res.data.sources.sellers.state,'not_recorded');assert.equal(x.res.data.sources.vercel.state,'unavailable');assert.equal(x.res.data.sources.vercel.revision,'a'.repeat(40));assert.ok(Object.values(x.res.data.sources).every(s=>s.health==='unverified'));assert.equal(JSON.stringify(x.res.data).includes('must not appear'),false);assert.equal(JSON.stringify(x.res.data).includes('private@example'),false);assert.ok(x.calls.every(c=>c.u.startsWith(A.projectUrl)));assert.match(x.res.headers['Cache-Control'],/no-store/);assert.equal(x.res.headers['Referrer-Policy'],'no-referrer');
});
test('malformed, future, stale or cached source evidence fails closed without private details',async()=>{
 for(const change of [s=>s.live=true,s=>s.releaseEnabled=true,s=>s.observedAt=stamp(-61000),s=>s.sources.stripeObservedAt=stamp(31000),s=>s.sources.shippingObservedAt='healthy',s=>s.orders[0].holdRequired=false,s=>s.orders[0].state='released',s=>s.orders=Array(16).fill(s.orders[0]),s=>s.cases=Array(11).fill({})]){const raw=snapshot();change(raw);const x=await call({raw});assert.equal(x.res.statusCode,503);assert.equal(x.res.data.orders,undefined);}
 for(const headers of [{age:'1'},{'cf-cache-status':'HIT'}]){const x=await call({headers});assert.equal(x.res.statusCode,503);}
});
test('shell and public configuration contain only test identity and defensive privacy policy',async()=>{
 const config=await call({url:'/api/test-admin?action=config'});assert.equal(config.calls.length,0);assert.deepEqual(Object.keys(config.res.data).sort(),['test','live','environmentId','projectUrl','returnUrl'].sort());
 const shell=await call({url:'/api/test-admin'});assert.equal(shell.res.statusCode,200);assert.equal(shell.calls.length,0);assert.match(shell.res.body,/PRIVATE TEST AREA/);assert.match(shell.res.headers['Content-Security-Policy'],/connect-src 'self'/);assert.equal(shell.res.headers['X-Robots-Tag'],'noindex, nofollow');assert.equal(/<form|onclick=|analytics|googletag/i.test(shell.res.body),false);assert.equal(/id="counts"|id="orders"|id="cases"|Source observations/.test(shell.res.body),false);
});
test('shared projection rejects wrong browser environment and fabricated healthy source labels',()=>{
 const data=projectAdminOverview(snapshot(),{environmentId:A.id,now:NOW});assert.equal(validateAdminOverview(data,{environmentId:A.id,now:NOW}).sources.stripe.state,'stale');assert.throws(()=>validateAdminOverview(data,{environmentId:L.id,now:NOW}));assert.throws(()=>validateAdminOverview({...data,sources:{...data.sources,stripe:{...data.sources.stripe,state:'healthy'}}},{environmentId:A.id,now:NOW}));assert.throws(()=>sanitizeAdminSnapshot({...snapshot(),counts:{orders:-1}},{now:NOW}));
});

test('operator authority is rechecked after the database read before private data is returned',async()=>{const x=await call({actor:[OP,BUY]});assert.equal(x.res.statusCode,403);assert.equal(x.res.data.orders,undefined);assert.equal(x.calls.filter(c=>c.u.endsWith('/auth/v1/user')).length,2);});

test('only the single explicit owner can pass admin access, including when another member is a refund operator',async()=>{
 const allowed=await call({url:'/api/test-admin?action=access'});assert.equal(allowed.res.statusCode,200);assert.deepEqual(allowed.res.data,{test:true,allowed:true});assert.equal(allowed.calls.length,1);
 for(const action of ['access','overview']){const other=await call({actor:BUY,url:'/api/test-admin?action='+action,patch:{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OP+','+BUY}});assert.equal(other.res.statusCode,403);assert.equal(other.calls.length,1);}
 for(const ownerId of [undefined,'',OP+','+BUY,'44444444-4444-4444-8444-444444444444']){const x=await call({patch:{RACK_RELIC_TEST_ADMIN_OWNER_ID:ownerId}});assert.equal(x.res.statusCode,503);assert.equal(x.calls.length,0);}
});

test('a delayed payment remains visible as pending and held through the owner runtime and projection',async()=>{const raw=snapshot();raw.orders[0].state='payment_pending';raw.orders[0].riskStatus='pending';raw.counts.paidOrders=0;const x=await call({raw});assert.equal(x.res.statusCode,200);assert.equal(x.res.data.orders[0].state,'payment_pending');assert.equal(x.res.data.orders[0].holdRequired,true);assert.equal(x.res.data.counts.paidOrders,0);assert.equal(x.res.data.counts.heldOrders,1);assert.equal(validateAdminOverview(x.res.data,{environmentId:A.id,now:NOW}).orders[0].state,'payment_pending');});
