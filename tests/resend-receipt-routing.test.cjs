const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHmac}=require('node:crypto');
const code=readFileSync(join(__dirname,'../supabase/functions/rack-alert-receipts/index.ts'),'utf8');
let createRackAlertReceiptEndpoint;
test.before(async()=>{({createRackAlertReceiptEndpoint}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')));});
const NOW=Date.parse('2026-11-28T03:22:00Z'), TS=String(NOW/1000), ID='msg_fixture_receipt';
const secret=Buffer.alloc(32,7), SECRET='whsec_'+secret.toString('base64');
const EMAIL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload=()=>({type:'email.delivered',created_at:new Date(NOW).toISOString(),data:{email_id:EMAIL,from:'"Rack Relic" <signin@alerts.rackrelic.com>',subject:'Your sign-in link',to:['support@rackrelic.com']}});
function request(p,{tamper=false,stale=false}={}){
 const body=JSON.stringify(p), ts=stale?String(NOW/1000-301):TS;
 const signature=createHmac('sha256',secret).update(ID+'.'+ts+'.'+body).digest('base64');
 return new Request('https://tzymapahsfiyhgilsmxl.supabase.co/functions/v1/rack-alert-receipts',{method:'POST',headers:{'content-type':'application/json','svix-id':ID,'svix-timestamp':ts,'svix-signature':'v1,'+signature},body:tamper?body+' ':body});
}
function setup({persistFails=false,enabled=true}={}){
 let calls=0;
 const env={RACK_RELIC_TEST_RESEND_RECEIPTS_ENABLED:enabled?'true':'false',SUPABASE_URL:'https://tzymapahsfiyhgilsmxl.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_fixture_only_never_real'}),RACK_RELIC_TEST_RESEND_WEBHOOK_SECRET:SECRET};
 const endpoint=createRackAlertReceiptEndpoint({env:k=>env[k],clock:()=>NOW,fetchImpl:async(url,options)=>{
  calls++; if(persistFails)return new Response(null,{status:503});
  const a=JSON.parse(options.body), result={test:true,releaseEnabled:false,transportId:'resend_rack_owner_v1',destinationId:'rack_owner_wayne_v1',deliveryKey:a.p_key,payloadHash:a.p_payload,policyHash:a.p_policy,providerEmailId:a.p_email,sendAllowed:false,attemptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',requestHash:'c'.repeat(64),state:'delivered',delivered:true,adverseSeen:false};
  const response=new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});Object.defineProperty(response,'url',{value:url});return response;
 }});
 return {endpoint,calls:()=>calls};
}
test('signed known support sign-in event is acknowledged without alert-ledger access',async()=>{const x=setup();assert.equal((await x.endpoint(request(payload()))).status,204);assert.equal(x.calls(),0);});
test('signed known owner sign-in event and bare sender are acknowledged without alert-ledger access',async()=>{const x=setup(),p=payload();p.data.from='signin@alerts.rackrelic.com';p.data.to=['wayne@rackrelic.com'];assert.equal((await x.endpoint(request(p))).status,204);assert.equal(x.calls(),0);});
test('tampered and stale sign-in signatures remain rejected',async()=>{for(const opts of [{tamper:true},{stale:true}]){const x=setup();assert.equal((await x.endpoint(request(payload(),opts))).status,503);assert.equal(x.calls(),0);}});
test('any Rack receipt tag or owner-alert sender/subject remains on strict alert path',async()=>{for(const change of [d=>d.tags={rr_delivery_key:'rr_test_case_alert_1'},d=>d.subject='Rack Relic TEST case alert',d=>d.from='alerts@alerts.rackrelic.com']){const x=setup(),p=payload();change(p.data);assert.equal((await x.endpoint(request(p))).status,503);assert.equal(x.calls(),0);}});
test('unknown recipient, event type, malformed tags and marketing metadata are rejected',async()=>{for(const change of [p=>p.data.to=['other@example.invalid'],p=>p.type='email.opened',p=>p.data.tags=[],p=>p.data.broadcast_id='broadcast',p=>p.data.email_id='invalid']){const x=setup(),p=payload();change(p);assert.equal((await x.endpoint(request(p))).status,503);assert.equal(x.calls(),0);}});
function alert(){const p=payload();p.data={...p.data,from:'alerts@alerts.rackrelic.com',subject:'Rack Relic TEST case alert',to:['wayne@rackrelic.com'],tags:{rr_delivery_key:'rr_test_case_alert_1',rr_payload_sha256:'a'.repeat(64)}};return p;}
test('genuine signed owner alert still requires and validates one durable receipt',async()=>{const x=setup();assert.equal((await x.endpoint(request(alert()))).status,204);assert.equal(x.calls(),1);});
test('unknown durable owner-alert result remains retryable failure',async()=>{const x=setup({persistFails:true});assert.equal((await x.endpoint(request(alert()))).status,503);assert.equal(x.calls(),1);});
test('disabled receiver remains closed even for correctly signed sign-in events',async()=>{const x=setup({enabled:false});assert.equal((await x.endpoint(request(payload()))).status,503);assert.equal(x.calls(),0);});
