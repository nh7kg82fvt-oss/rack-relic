'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const F=require('./command-owner-fixture.cjs');let authority;before(async()=>{authority=await F.create();});after(async()=>authority?.db.close());
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const {command,list,receipt,readBody,AdminWorkInvalid,cursor}=require('../server/admin_work_data.cjs');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',BUY='22222222-2222-4222-8222-222222222222',I='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444',NOW=Date.now(),TIME=new Date(NOW).toISOString();
const C={operation:'create',requestId:R,itemId:I,version:0,service:'vercel',title:'Check code delivery',note:'Private practice follow-up.',status:'open'};
const item={id:I,service:C.service,title:C.title,note:C.note,status:C.status,version:1,createdAt:TIME,updatedAt:TIME};
const saved={test:true,live:false,releaseEnabled:false,requestId:R,replayed:false,item};
const work={test:true,live:false,releaseEnabled:false,observedAt:TIME,items:[item],hasMore:false,nextAfter:null};
const env=()=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:A.branch,RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_TEST_ADMIN_WORK_ENABLED:'true',RACK_RELIC_TEST_ADMIN_OWNER_ID:OP,RACK_RELIC_TEST_SUPABASE_URL:A.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:A.accountId,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:F.SERVER,RACK_RELIC_TEST_MEMBER_IDS:OP+','+BUY,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OP,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true'});
async function call({method='POST',url='/api/test-admin?action=work',body=JSON.stringify(C),parsedBody,actor=OP,patch={},headers={},rpcResponse,rpcStatus=200,authorization='Bearer '+F.token()}={}){
 const calls=[];let auths=0;const h=createTestAdminRuntime({env:{...env(),...patch},clock:Date.now,fetchImpl:async(u,o)=>{calls.push({u,o});assert.equal(new URL(u).origin,A.projectUrl);if(u.endsWith('/auth/v1/user'))return F.response(u,{id:Array.isArray(actor)?actor[Math.min(auths++,actor.length-1)]:actor,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',is_anonymous:false});if(u.endsWith('/'+F.RPC))return F.response(u,await authority.rpc(F.RPC,JSON.parse(o.body)));const name=u.split('/').pop();assert.ok(['rr_test_admin_work_list','rr_test_admin_work_receipt','rr_test_write_admin_work'].includes(name));const b=JSON.parse(o.body);assert.equal(b.p_owner,OP);assert.equal(b.p_actor,OP);return Response.json(rpcResponse||(name==='rr_test_admin_work_list'?work:name==='rr_test_admin_work_receipt'?{...saved,replayed:true}:saved),{status:rpcStatus});}});
 const req=Readable.from(body===null?[]:[body]);req.method=method;req.url=url;req.headers={authorization,origin:A.previewOrigin,'content-type':'application/json',...headers};
 if(parsedBody!==undefined)Object.defineProperty(req,'body',{get(){return parsedBody;}});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;this.data=JSON.parse(value);}};await h(req,res);return {calls,res};
}
test('internal work is off by default; non-work writes and foreign or malformed forms fail before data access',async()=>{
 for(const method of ['GET','POST']){const x=await call({method,patch:{RACK_RELIC_TEST_ADMIN_WORK_ENABLED:''}});assert.equal(x.res.statusCode,404);assert.equal(x.calls.length,0);}
 const legacy=await call({patch:{VERCEL_GIT_COMMIT_REF:L.branch,RACK_RELIC_TEST_SUPABASE_URL:L.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:L.accountId}});assert.equal(legacy.res.statusCode,404);assert.equal(legacy.calls.length,0);
 for(const action of ['', 'overview','config','access','refund','release']){const x=await call({url:'/api/test-admin'+(action?'?action='+action:'')});assert.equal(x.res.statusCode,405);assert.equal(x.calls.length,0);}
 for(const headers of [{origin:'https://foreign.invalid'},{origin:undefined},{'sec-fetch-site':'cross-site'}]){const x=await call({headers});assert.equal(x.res.statusCode,403);assert.equal(x.calls.length,0);}
 for(const headers of [{'content-type':'text/plain'},{'content-type':undefined}]){const x=await call({headers});assert.equal(x.res.statusCode,415);assert.equal(x.calls.length,0);}
 for(const body of ['{',JSON.stringify({...C,releaseEnabled:true}),JSON.stringify({...C,ownerId:BUY}),JSON.stringify({...C,status:'released'}),JSON.stringify({...C,version:null})]){const x=await call({body});assert.equal(x.res.statusCode,400);assert.equal(x.calls.length,0);}
 const big=await call({body:'x'.repeat(16385)});assert.equal(big.res.statusCode,413);assert.equal(big.calls.length,0);
 for(const url of ['/api/test-admin?action=work&action=work','/api/test-admin?action=work&requestId='+R,'/api/test-admin?action=work&ownerId='+OP]){const x=await call({url});assert.equal(x.res.statusCode,400);assert.equal(x.calls.length,0);}
});
test('Vercel parsed JSON and raw bodies produce the same owner-bound save and receipt',async()=>{
 const raw=await call(),parsed=await call({body:null,parsedBody:{...C}});
 assert.equal(parsed.res.statusCode,200);assert.deepEqual(parsed.res.data,raw.res.data);assert.deepEqual(parsed.calls.filter(c=>!c.u.endsWith('/'+F.RPC)).map(c=>[c.u,c.o.method,c.o.body]),raw.calls.filter(c=>!c.u.endsWith('/'+F.RPC)).map(c=>[c.u,c.o.method,c.o.body]));
 assert.equal(parsed.calls.filter(c=>c.u.endsWith('/auth/v1/user')).length,2);
 for(const actor of [BUY,[OP,BUY]])assert.equal((await call({body:null,parsedBody:{...C},actor})).res.statusCode,403);
});
test('parsed command handling preserves size, field and same-origin limits without object coercion',async()=>{
 let touched=0;const getter={...C};Object.defineProperty(getter,'title',{enumerable:true,get(){touched++;return C.title;}});
 const toJSON={...C,toJSON(){touched++;return C;}},coercible={...C,requestId:{toString(){touched++;return R;}}};
 for(const body of [null,[],new String(JSON.stringify(C)),getter,toJSON,coercible,{...C,note:'x'.repeat(2001)},{...C,releaseEnabled:true},{...C,ownerId:BUY},{...C,version:NaN},{...C,version:Infinity}])await assert.rejects(readBody({body}),AdminWorkInvalid);
 assert.equal(touched,0);let reads=0;assert.deepEqual(await readBody(Object.defineProperty({},'body',{get(){reads++;return {...C};}})),C);assert.equal(reads,1);
 await assert.rejects(readBody(Object.defineProperty({},'body',{get(){throw Error('private parse detail');}})),AdminWorkInvalid);
 const cross=await call({body:null,parsedBody:{...C},headers:{origin:'https://foreign.invalid'}});assert.equal(cross.res.statusCode,403);assert.equal(cross.calls.length,0);
 const tooBig=await call({body:null,parsedBody:{...C},headers:{'content-length':'16385'}});assert.equal(tooBig.res.statusCode,413);assert.equal(tooBig.calls.length,0);
});
test('only the exact owner can save work and owner authority is freshly rechecked before returning it',async()=>{
 for(const actor of [BUY,'55555555-5555-4555-8555-555555555555']){const x=await call({actor,patch:{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OP+','+BUY}});assert.equal(x.res.statusCode,403);assert.equal(x.calls.length,1);}
 const anonymous=await call({authorization:null});assert.equal(anonymous.res.statusCode,403);assert.equal(anonymous.calls.length,0);
 const x=await call();assert.equal(x.res.statusCode,200);assert.deepEqual(x.res.data,saved);assert.equal(x.calls.filter(c=>c.u.endsWith('/auth/v1/user')).length,2);assert.deepEqual(JSON.parse(x.calls.find(c=>c.u.endsWith('/rr_test_write_admin_work')).o.body),{p_owner:OP,p_actor:OP,p_command:C});
 const changed=await call({actor:[OP,BUY]});assert.equal(changed.res.statusCode,403);assert.equal(changed.res.data.item,undefined);assert.equal(changed.calls.length,4);
});
test('owner GET returns a bounded work list or original recorded receipt; an absent receipt stays unconfirmed',async()=>{
 const x=await call({method:'GET'});assert.equal(x.res.statusCode,200);assert.deepEqual(x.res.data,list(work,{now:NOW}));assert.equal(x.calls.length,5);assert.deepEqual(JSON.parse(x.calls.find(c=>c.u.endsWith('/rr_test_admin_work_list')).o.body),{p_owner:OP,p_actor:OP,p_before:null,p_after:null});
 const changed=await call({method:'GET',actor:[OP,BUY]});assert.equal(changed.res.statusCode,403);assert.equal(changed.res.data.items,undefined);
 const r=await call({method:'GET',url:'/api/test-admin?action=work&requestId='+R});assert.equal(r.res.statusCode,200);assert.equal(r.res.data.replayed,true);assert.deepEqual(JSON.parse(r.calls.find(c=>c.u.endsWith('/rr_test_admin_work_receipt')).o.body),{p_owner:OP,p_actor:OP,p_request:R});
 const missing=await call({method:'GET',url:'/api/test-admin?action=work&requestId='+R,rpcResponse:{test:true,live:false,releaseEnabled:false,requestId:R,state:'unconfirmed'}});assert.deepEqual(missing.res.data,{test:true,live:false,releaseEnabled:false,requestId:R,state:'unconfirmed'});
 const bad=await call({method:'GET',url:'/api/test-admin?action=work&requestId=bad'});assert.equal(bad.res.statusCode,400);assert.equal(bad.calls.length,0);
 for(const query of ['cursor=bad','cursor=','cursor='+('x'.repeat(257)),'cursor=bad&requestId='+R]){const badPage=await call({method:'GET',url:'/api/test-admin?action=work&'+query});assert.equal(badPage.res.statusCode,400);assert.equal(badPage.calls.length,0);}
});
test('only explicit database version conflicts become safe edit conflicts; unknown writes do not claim failure or expose details',async()=>{
 for(const [message,code]of [['Work version conflict','version_conflict'],['Work request conflict','request_conflict'],['Work item conflict','item_conflict']]){const x=await call({rpcResponse:{code:'P0001',message},rpcStatus:400});assert.equal(x.res.statusCode,409);assert.equal(x.res.data.code,code);assert.equal(x.res.data.item,undefined);}
 const unknown=await call({rpcResponse:{code:'42703',message:'secret provider payload'},rpcStatus:400});assert.equal(unknown.res.statusCode,503);assert.match(unknown.res.data.error,/could not be confirmed/);assert.equal(unknown.res.body.includes('secret'),false);
 const mismatch=await call({rpcResponse:{...saved,item:{...item,status:'complete'}}});assert.equal(mismatch.res.statusCode,503);assert.equal(mismatch.res.data.item,undefined);
});
test('shared work validation preserves known receipts and rejects fabricated authority, malformed state and cached-old lists',async()=>{
 assert.deepEqual(command(C),C);for(const patch of [{version:1},{note:'x'.repeat(2001)},{title:' newline\n'},{extra:true}])assert.throws(()=>command({...C,...patch}),AdminWorkInvalid);
 assert.deepEqual(receipt(saved,{requestId:R,expected:C}),saved);assert.throws(()=>receipt({...saved,releaseEnabled:true},{requestId:R}));assert.throws(()=>list({...work,observedAt:new Date(NOW-61000).toISOString()},{now:NOW}));assert.throws(()=>list({...work,items:[item,item]}));
 await assert.rejects(readBody({body:Buffer.from([0xff,0xfe])}),AdminWorkInvalid);
});
test('work page ordering and cursors preserve PostgreSQL microseconds and cannot loop or move backward',()=>{
 const base=new Date(NOW-1000).toISOString().slice(0,19),newer={...item,id:R,updatedAt:base+'.123002Z',createdAt:base+'.000000Z'},older={...item,id:I,updatedAt:base+'.123001Z',createdAt:base+'.000000Z'};
 assert.equal(Date.parse(newer.updatedAt),Date.parse(older.updatedAt));assert.deepEqual(list({...work,items:[newer,older]},{now:NOW}).items.map(i=>i.id),[R,I]);assert.throws(()=>list({...work,items:[older,newer]},{now:NOW}));
 const token=Buffer.from(JSON.stringify({updatedAt:newer.updatedAt,id:R})).toString('base64url');assert.deepEqual(cursor(token,{now:NOW}),{updatedAt:newer.updatedAt,id:R});assert.deepEqual(list({...work,items:[older]},{now:NOW,cursor:token}).items.map(i=>i.id),[I]);assert.throws(()=>list({...work,items:[newer]},{now:NOW,cursor:token}));
});
