// Included in the generated staging-only Supabase entrypoint.
const WEBHOOK_IO_TIMEOUT_MS=10000;

async function withWebhookDeadline(requestSignal,operation){
 const expiresAt=performance.now()+WEBHOOK_IO_TIMEOUT_MS;
 const signal=AbortSignal.any([requestSignal,AbortSignal.timeout(WEBHOOK_IO_TIMEOUT_MS)]);
 signal.throwIfAborted();
 let onAbort;
 const aborted=new Promise((_,reject)=>{
  onAbort=()=>reject(signal.reason);
  signal.addEventListener('abort',onAbort,{once:true});
 });
 try{
  const result=await Promise.race([operation(signal),aborted]);
  signal.throwIfAborted();
  if(performance.now()>=expiresAt)throw new DOMException('Webhook I/O deadline expired','TimeoutError');
  return result;
 }finally{signal.removeEventListener('abort',onAbort);}
}

export function createTestEdgeWebhook({projectUrl,accountId,serviceKey,webhookSecret,refundsEnabled=false,refundRequestsEnabled=false,disputesEnabled=false,fetchImpl=fetch}={}){
 const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0','Content-Type':'application/json','X-Content-Type-Options':'nosniff'}});
 const environment=getTestEnvironmentByProject(projectUrl);
 const expectedAccount=accountId??(environment?.id==='legacy'?environment.accountId:null);
 const modernServiceKey=typeof serviceKey==='string'&&/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey);
 let configured=!!environment&&expectedAccount===environment.accountId&&typeof webhookSecret==='string'&&/^whsec_[A-Za-z0-9]+$/.test(webhookSecret);
 if(typeof serviceKey!=='string')configured=false;
 else if(!modernServiceKey){
  try{const claims=JSON.parse(Buffer.from(serviceKey.split('.')[1],'base64url').toString());configured=configured&&claims.role==='service_role'&&claims.ref===environment?.projectRef;}catch{configured=false;}
 }
 return async request=>{
  if(!configured)return reply(503,{error:'Test payment notifications unavailable'});
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
  const signature=request.headers.get('stripe-signature');
  if(typeof signature!=='string'||signature.length>4096)return reply(400,{error:'Invalid test notification'});
  let event,raw;
  try{
   const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
   let complete=false;
   try{
    raw=await withWebhookDeadline(request.signal,async signal=>{
     let length=0;const parts=[];
     while(true){
      const {value,done}=await reader.read();
      signal.throwIfAborted();
      if(done){complete=true;return Buffer.concat(parts,length);}
      length+=value.length;
      if(length>1048576)return null;
      parts.push(Buffer.from(value));
     }
    });
   }finally{
    if(!complete)void reader.cancel().catch(()=>{});
    reader.releaseLock();
   }
   if(raw===null)return reply(413,{error:'Notification too large'});
   event=verifyStripeTestEvent(raw,signature,{secret:webhookSecret,accountId:expectedAccount});
   if(event.account&&event.account!==expectedAccount)throw Error('Wrong account');
  }catch(error){
   if(error?.name==='TimeoutError'||request.signal.aborted)return reply(408,{error:'Notification body deadline expired'});
   return reply(400,{error:'Invalid test notification'});
  }
  try{
   const {name,payload}=stripeTestEventRpc(event,raw,{accountId:expectedAccount,refundsEnabled:refundsEnabled===true,refundRequestsEnabled:refundRequestsEnabled===true,disputesEnabled:disputesEnabled===true});
   const headers={apikey:serviceKey,'Content-Type':'application/json'};
   if(!modernServiceKey)headers.Authorization='Bearer '+serviceKey;
   const result=await withWebhookDeadline(request.signal,async signal=>{
    const r=await fetchImpl(projectUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',signal,headers,body:JSON.stringify(payload)});
    signal.throwIfAborted();
    if(!r.ok)return null;
    const age=r.headers.get('age');if(age!==null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers.get(k)||'').toUpperCase())))return null;
    return r.json();
   });
   if(typeof result?.duplicate!=='boolean'||typeof result.state!=='string')return reply(503,{error:'Test order update unavailable'});
   return reply(200,{received:true});
  }catch{return reply(503,{error:'Test order update unavailable'});}
 };
}
if(typeof Deno!=='undefined')Deno.serve(createTestEdgeWebhook({projectUrl:Deno.env.get('SUPABASE_URL'),accountId:Deno.env.get('RACK_RELIC_TEST_STRIPE_ACCOUNT'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),webhookSecret:Deno.env.get('RACK_RELIC_TEST_WEBHOOK_SECRET'),refundsEnabled:Deno.env.get('RACK_RELIC_TEST_REFUNDS_ENABLED')==='true',refundRequestsEnabled:Deno.env.get('RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED')==='true',disputesEnabled:Deno.env.get('RACK_RELIC_TEST_DISPUTE_HOLDS_ENABLED')==='true'}));
