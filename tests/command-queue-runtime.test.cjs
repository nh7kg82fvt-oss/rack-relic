'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHmac}=require('node:crypto');
const {rig,id,OWNER,OTHER,SESSION,SECOND,caseRef,env,token,response,E}=require('./helpers/command-queue-fixture.cjs');
let x;before(async()=>{x=await rig();await x.seed();await x.activate();});after(async()=>x?.close());
const page=(repo,extra={})=>x.run(repo,'list',{kind:'cases',filter:'all',...extra});
const getCase=async()=>{return (await x.run(x.repository(),'lookup',{kind:'cases',ref:caseRef(30)})).result.item;};
async function http(url,opts={}){const r={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v){this.data=JSON.parse(v);}};await x.http(opts.env)({url,method:opts.method||'GET',headers:{origin:E.previewOrigin,'sec-fetch-site':'same-origin','content-type':'application/json',...opts.headers},...(opts.body===undefined?{}:{body:opts.body})},r);return r;}
const query=(extra='')=>'/api/command-center?action=queue&op=list&kind=cases&filter=all&nonce='+randomUUID()+extra;
test('current-session pre/post verification wraps every queue read and cursor continuation',async()=>{const repo=x.repository(),start=x.calls.length,p=await page(repo);assert.equal(p.result.items.length,25);const tail=await page(repo,{cursor:p.result.nextCursor});assert.equal(tail.result.items.length,10);const calls=x.calls.slice(start);assert.equal(calls.filter(c=>c.url.endsWith('/auth/v1/user')).length,4);assert.equal(calls.filter(c=>c.url.endsWith('/rr_test_command_owner_session')).length,4);assert.equal(calls.filter(c=>c.url.endsWith('/rr_test_command_queue')).length,2);});
test('cursor MAC rejects tampering, other kind/filter/session and expiry before queue RPC',async()=>{const repo=x.repository(),p=await page(repo),t=p.result.nextCursor;
 for(const extra of [{cursor:t.slice(0,-5)+'AAAAA'},{cursor:t,kind:'orders'},{cursor:t,filter:'attention'},{cursor:t,authorization:'Bearer '+token(SECOND)}])await assert.rejects(page(repo,extra),e=>e.code==='invalid_cursor');
 const expired=JSON.parse(Buffer.from(t.split('.')[0],'base64url'));expired.issued=Date.now()-61000;expired.expires=expired.issued+60000;const payload=Buffer.from(JSON.stringify(expired)).toString('base64url');const signed=payload+'.'+createHmac('sha256',env().RACK_RELIC_TEST_SUPABASE_SERVER_KEY).update('rr-command-queue-cursor-v1\0').update(payload).digest('base64url');await assert.rejects(page(repo,{cursor:signed}),e=>e.code==='invalid_cursor');
});
test('wrong owner/JWT environment/expired session and missing capability remain closed',async()=>{
 await assert.rejects(page(x.repository(),{authorization:'Bearer '+token(SESSION,OTHER)}));
 const closed=x.repository({env:{...env(),RACK_RELIC_COMMAND_QUEUE_ACK_ENABLED:'false'}});const start=x.calls.length;await assert.rejects(page(closed));assert.equal(x.calls.length,start);
 for(const patch of [{VERCEL_ENV:'production'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_foreign'},{RACK_RELIC_TEST_SUPABASE_URL:'https://foreign.invalid'},{RACK_RELIC_TEST_REFUNDS_ENABLED:'false'},{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OTHER}])assert.equal((await http(query(),{env:patch})).statusCode,404);
});
test('strict HTTP parameters, methods and CSRF checks reject before any authority read',async()=>{const start=x.calls.length;
 for(const u of [query('&kind=orders'),query('&nonce='+randomUUID()),query('&actor='+OTHER),query('&environment=live'),query().replace('kind=cases','kind=all'),query().replace('filter=all','filter=sql')])assert.equal((await http(u)).statusCode,400);
 assert.equal((await http(query(),{method:'POST'})).statusCode,405);
 const u='/api/command-center?action=queue&op=ack&nonce='+randomUUID();assert.equal((await http(u,{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'})).statusCode,403);
 assert.equal((await http(u,{method:'POST',body:'{"requestId":"'+id(99)+'","requestId":"'+id(100)+'"}'})).statusCode,400);
 assert.equal((await http(u,{method:'POST',headers:{'content-length':'2049'},body:'{}'})).statusCode,413);assert.equal(x.calls.length,start);
});
test('HTTP response carries privacy headers, exact session and fresh request nonce',async()=>{const r=await http(query());assert.equal(r.statusCode,200);assert.match(r.headers['cache-control'],/private, no-store/);assert.equal(r.headers['x-rack-command-session'],SESSION);assert.equal(r.data.live,false);assert.equal(r.data.releaseEnabled,false);});
test('swapped, cached, future, stale, foreign-mode and foreign-session queue replies fail closed',async()=>{for(const kind of ['nonce','ownerId','sessionRef','live','stale','cached','redirect']){
 x.hook=async(url,o,phase,v)=>{if(phase==='after'&&url.endsWith('/rr_test_command_queue')){v=structuredClone(v);if(kind==='cached')return response(url,v,200,{'cf-cache-status':'HIT'});if(kind==='redirect')return response('https://foreign.invalid',v);if(kind==='stale')v.observedAt-=60000;else if(kind==='live')v.live=true;else v[kind]=id(999);return response(url,v);}};
 await assert.rejects(page(x.repository()));}x.hook=null;
});
test('session removed after database result prevents rendering it',async()=>{x.hook=async(url,o,phase)=>{if(phase==='after'&&url.endsWith('/rr_test_command_queue'))await x.db.query('DELETE FROM auth.sessions WHERE id=$1',[SESSION]);};await assert.rejects(page(x.repository()),e=>e.status===401);x.hook=null;await x.db.query('INSERT INTO auth.sessions(id,user_id)VALUES($1,$2)',[SESSION,OWNER]);});
test('lost acknowledgement is found by original request; no second write from receipt lookup',async()=>{const c=await getCase(),command={requestId:id(800),caseRef:c.caseRef,orderRef:c.orderRef,generation:c.generation,evidenceVersion:c.evidenceVersion};let writes=0;
 x.hook=async(url,o,phase)=>{if(url.endsWith('/rr_test_command_queue')&&JSON.parse(o.body).p_operation==='ack'){if(phase==='before')writes++;else throw Error('lost acknowledgement');}};
 await assert.rejects(x.run(x.repository(),'ack',{command,requestId:command.requestId}),e=>e.code==='unknown');x.hook=null;
 const r=await x.run(x.repository(),'receipt',{requestId:command.requestId});assert.equal(r.result.acknowledgement.firstRequestId,command.requestId);assert.equal(writes,1);
});
test('expired during owner readiness cannot start a queue write, ignored abort late ACK stays unknown',async()=>{const c=await getCase(),command={requestId:id(801),caseRef:c.caseRef,orderRef:c.orderRef,generation:c.generation,evidenceVersion:c.evidenceVersion};let now=Date.now(),reads=0;
 x.hook=async(url,o,phase)=>{if(phase==='after'&&url.endsWith('/rr_test_command_owner_session')&&++reads===1)now+=16000;};const start=x.calls.filter(c=>c.url.endsWith('/rr_test_command_queue')).length;
 await assert.rejects(x.run(x.repository({clock:()=>now}),'ack',{command,requestId:command.requestId}));assert.equal(x.calls.filter(c=>c.url.endsWith('/rr_test_command_queue')).length,start);x.hook=null;
 now=Date.now();x.hook=async(url,o,phase)=>{if(phase==='after'&&url.endsWith('/rr_test_command_queue'))now+=16000;};await assert.rejects(x.run(x.repository({clock:()=>now}),'ack',{command,requestId:command.requestId}),e=>e.code==='unknown');x.hook=null;
 assert.equal((await x.run(x.repository(),'receipt',{requestId:command.requestId})).result.acknowledgement.firstRequestId,id(800));
});

test('valid raw-body HTTP acknowledgement and original receipt use the dedicated guarded path',async()=>{const c=await getCase(),cmd={requestId:id(899),caseRef:c.caseRef,orderRef:c.orderRef,generation:c.generation,evidenceVersion:c.evidenceVersion};const r=await http('/api/command-center?action=queue&op=ack&nonce='+randomUUID(),{method:'POST',body:JSON.stringify(cmd)});assert.equal(r.statusCode,200);assert.equal(r.data.result.acknowledgement.ownerId,OWNER);assert.equal(r.data.result.requestId,cmd.requestId);assert.equal(r.data.releaseEnabled,false);const read=await http('/api/command-center?action=queue&op=receipt&nonce='+randomUUID()+'&requestId='+cmd.requestId);assert.equal(read.statusCode,200);assert.deepEqual(read.data.result.acknowledgement,r.data.result.acknowledgement);});

test('noncanonical MAC spelling and forged cursor boundary are rejected before another page',async()=>{const repo=x.repository(),r=await page(repo),parts=r.result.nextCursor.split('.'),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';const last=alphabet.indexOf(parts[1].at(-1));const alias=parts[0]+'.'+parts[1].slice(0,-1)+alphabet[last+1];assert.deepEqual(Buffer.from(alias.split('.')[1],'base64url'),Buffer.from(parts[1],'base64url'));await assert.rejects(page(repo,{cursor:alias}),e=>e.code==='invalid_cursor');const v=JSON.parse(Buffer.from(parts[0],'base64url'));v.after=caseRef(1);await assert.rejects(page(repo,{cursor:Buffer.from(JSON.stringify(v)).toString('base64url')+'.'+parts[1]}),e=>e.code==='invalid_cursor');});
test('queue projection exposes no customer, provider, credential or raw evidence fields',async()=>{const r=await page(x.repository());const raw=JSON.stringify(r);for(const text of ['du_fictional','evt_fictional','buyer_id','seller_id','session_id','sb_secret','email','charge_id','payload_hash'])assert.equal(raw.includes(text),false,text);assert.ok(r.result.items.every(c=>c.holdRequired===true));});
