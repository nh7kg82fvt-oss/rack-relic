'use strict';
// Fictional internal ports only. No signed provider event or hosted record is created.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const F=require(path.join(root,'tests/fictional-fixture.cjs'));
const {createUrgentAlertHost}=require(path.join(root,'source/server/urgent_alert_edge_host.cjs'));
function exercise(){
 const x=F.fixture(),original=x.options.fetchImpl,queue=[x.alert(),{...x.alert(),alertId:2,deliveryKey:'rr_test_case_alert_2',case:{...x.alert().case,caseId:'du_other'}}];
 const journals=new Map();let genericClaims=0;
 x.options.fetchImpl=async(url,init)=>{
  const rpc=url.split('/').at(-1);const p=init.body?JSON.parse(init.body):{};
  if(['rr_test_claim_case_alerts','rr_test_claim_enrolled_case_alert'].includes(rpc)){
   let a;if(rpc==='rr_test_claim_case_alerts'){genericClaims++;a=queue.shift();}
   else {const i=queue.findIndex(a=>a.alertId===p.p_scope.alertId);if(i>=0)a=queue.splice(i,1)[0];}
   return F.response({test:true,cloudReady:false,releaseEnabled:false,alerts:a?[a]:[]},url);
  }
  if(rpc==='rr_test_enrolled_case_alert_authority')return F.response({test:true,allowed:true,releaseEnabled:false},url);
  if(rpc==='rr_test_resend_owner_claim'){
   let r=journals.get(p.p_key),allowed=!r;
   if(!r){r={test:true,transportId:F.PINS.transportId,destinationId:F.PINS.destinationId,deliveryKey:p.p_key,payloadHash:p.p_payload,requestHash:p.p_request,policyHash:p.p_policy,attemptId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',providerEmailId:null,state:'unknown',delivered:false,adverseSeen:false,releaseEnabled:false};journals.set(p.p_key,r);}
   return F.response({...r,sendAllowed:allowed},url);
  }
  if(rpc==='rr_test_resend_owner_accept'){const r=journals.get(p.p_key);Object.assign(r,{providerEmailId:p.p_email,state:'accepted'});return F.response({...r,sendAllowed:false},url);}
  if(rpc==='rr_test_resend_owner_read')return F.response({...journals.get(p.p_key),sendAllowed:false},url);
  return original(url,init);
 };
 // This stand-in is only the receiver's already-authorized internal DB port.
 // It does not manufacture an HMAC or claim actual provider acceptance.
 const receiverFactory=({fetchImpl})=>async req=>{
  const scope=x.state.enrollment.alertScope;
  return fetchImpl(F.RISK,{method:'POST',redirect:'error',cache:'no-store',signal:req.signal,headers:{apikey:'sb_secret_fictionalInternalOnly'},body:JSON.stringify({p_type:'charge.dispute.created',p_event:req.url.endsWith('/other')?'evt_other':scope?.providerEventId||'evt_synthetic',p_case:req.url.endsWith('/other')?'du_other':'du_synthetic',p_payload_hash:scope?.providerPayloadHash||'a'.repeat(64)})});
 };
 return{x,queue,journals,claims:()=>genericClaims,host:()=>createUrgentAlertHost({...x.options,receiverFactory})};
}
test('one enrolled exercise never sends a different queued alert across new host instances',async()=>{
 const e=exercise();await e.host()(new Request('https://fixture.invalid/approved'));await e.host()(new Request('https://fixture.invalid/other'));
 assert.equal(e.x.state.emails.length,1);assert.equal(e.queue.length,1);assert.equal(e.queue[0].alertId,2);assert.equal(e.claims(),0);
});
module.exports={exercise};

const approved=()=>new Request('https://fixture.invalid/approved');
test('same enrolled event in concurrent fresh hosts consumes one row and one durable send',async()=>{
 const e=exercise();await Promise.all([e.host()(approved()),e.host()(approved()),e.host()(approved())]);
 assert.equal(e.x.state.emails.length,1);assert.equal(e.journals.size,1);assert.equal(e.queue.length,1);assert.equal(e.claims(),0);
});
test('all returned scope identities and exact payload must match before journal claim',async()=>{
 for(const change of [a=>a.alertId=2,a=>a.attempt=2,a=>a.evidenceHash='0'.repeat(32),a=>a.providerEventId='evt_wrong',a=>a.providerPayloadHash='0'.repeat(64),a=>a.case.generation++,a=>a.case.orderId=F.WORKER,a=>a.case.caseId='du_wrong',a=>a.severity=3,a=>a.case.dueBy='2031-01-01T05:00:00Z']){
  const e=exercise(),base=e.x.options.fetchImpl;e.x.options.fetchImpl=async(url,init)=>{const r=await base(url,init);if(url.endsWith('/rr_test_claim_enrolled_case_alert')){const b=await r.json();change(b.alerts[0]);return F.response(b,url);}return r;};
  await e.host()(approved()).catch(()=>{});assert.equal(e.x.state.emails.length,0);assert.equal(e.journals.size,0);
 }
});
test('unbound, extra or null scope fails closed to ingestion only',async()=>{
 for(const change of [s=>delete s.alertScope,s=>s.alertScope=null,s=>s.alertScope.extra=true,s=>s.alertScope.payloadHash=null,s=>s.alertScope.caseId='issfr_RackOwnerAlertRehearsal']){
  const e=exercise();change(e.x.state.enrollment);await e.host()(approved());assert.equal(e.x.state.held,true);assert.equal(e.queue.length,2);assert.equal(e.journals.size,0);assert.equal(e.x.state.emails.length,0);
 }
});
test('finality after journal consumption stops lowest-level send without renewing grant on restart',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl;let reads=0;
 e.x.options.fetchImpl=async(url,init)=>url.endsWith('/rr_test_enrolled_case_alert_authority')?F.response({test:true,releaseEnabled:false,allowed:++reads===1},url):base(url,init);
 await e.host()(approved());assert.equal(reads,2);assert.equal(e.x.state.emails.length,0);assert.equal(e.journals.size,1);
 await e.host()(approved());assert.equal(e.x.state.emails.length,0);assert.equal(e.journals.size,1);
});
test('lost email acknowledgement preserves unknown and never sends again across fresh hosts',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl;
 e.x.options.fetchImpl=async(url,init)=>{const r=await base(url,init);if(url==='https://api.resend.com/emails')throw Error('fictional lost email ACK');return r;};
 await e.host()(approved());await e.host()(approved());assert.equal(e.x.state.emails.length,1);assert.equal([...e.journals.values()][0].state,'unknown');
});
test('lost exact-claim response keeps committed lease and never selects foreign work',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl;let first=true;
 e.x.options.fetchImpl=async(url,init)=>{const r=await base(url,init);if(first&&url.endsWith('/rr_test_claim_enrolled_case_alert')){first=false;throw Error('fictional claim ACK lost');}return r;};
 await e.host()(approved()).catch(()=>{});await e.host()(approved());assert.equal(e.x.state.emails.length,0);assert.equal(e.queue.length,1);assert.equal(e.journals.size,0);
});
test('one-shot journal survives duplicate hostile lease replay and cannot grant a second POST',async()=>{
 const e=exercise(),copy=structuredClone(e.queue[0]);await e.host()(approved());e.queue.unshift(copy);
 await e.host()(approved());assert.equal(e.x.state.emails.length,1);assert.equal(e.journals.size,1);
});
test('expiry/revocation while final authority is awaited cannot start email',async()=>{
 for(const mode of ['expired','stopped','changed']){const e=exercise(),base=e.x.options.fetchImpl;let reads=0;
  e.x.options.fetchImpl=async(url,init)=>{const r=await base(url,init);if(url.endsWith('/rr_test_enrolled_case_alert_authority')&&++reads===2){if(mode==='expired')e.x.state.now=e.x.state.enrollment.expiresAt;else if(mode==='stopped')e.x.state.stopped=true;else e.x.state.enrollment.alertScope.evidenceHash='0'.repeat(32);}return r;};
  await e.host()(approved()).catch(()=>{});assert.equal(e.journals.size,1);assert.equal(e.x.state.emails.length,0);
 }
});
test('ignored abort and late authority ACK stay held under original finite deadline',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl,entered=Promise.withResolvers(),late=Promise.withResolvers();let reads=0;
 e.x.state.enrollment.expiresAt=e.x.state.now+150;
 e.x.options.fetchImpl=async(url,init)=>{if(url.endsWith('/rr_test_enrolled_case_alert_authority')&&++reads===2){entered.resolve(url);return late.promise;}return base(url,init);};
 const task=e.host()(approved()).catch(()=>{}),url=await entered.promise;await task;late.resolve(F.response({test:true,releaseEnabled:false,allowed:true},url));await new Promise(r=>setImmediate(r));
 assert.equal(e.x.state.emails.length,0);assert.equal(e.journals.size,1);
});
test('actual database transport remains apikey-only and generic claim is never dispatched',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl;const calls=[];
 e.x.options.fetchImpl=async(url,init)=>{if(url.includes('/rest/v1/rpc/')&&!url.endsWith('/rr_test_process_risk_notice')){const h=new Headers(init.headers);assert.equal(h.has('authorization'),false);assert.match(h.get('apikey'),/^sb_secret_/);calls.push(url);}return base(url,init);};
 await e.host()(approved());assert.equal(calls.filter(x=>x.endsWith('/rr_test_enrolled_case_alert_authority')).length,2);assert.equal(e.claims(),0);assert.equal(e.x.state.emails.length,1);
});

test('slow sequential fixture ports exhaust original five seconds instead of extending the send window',async()=>{
 const e=exercise(),base=e.x.options.fetchImpl;
 e.x.options.fetchImpl=async(url,init)=>{const r=await base(url,init);e.x.state.now+=300;e.x.state.mono+=300;return r;};
 await e.host()(approved()).catch(()=>{});assert.equal(e.x.state.emails.length,0);assert.ok(e.x.state.mono>=5100);assert.equal(e.claims(),0);
});
