// Included in the generated staging-only Supabase entrypoint.
export function createTestEdgeWebhook({projectUrl,serviceKey,webhookSecret,fetchImpl=fetch}={}){
 const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0','Content-Type':'application/json','X-Content-Type-Options':'nosniff'}});
 let configured=projectUrl==='https://zvtaqzcqfdjpuwnlpzln.supabase.co'&&typeof webhookSecret==='string'&&/^whsec_[A-Za-z0-9]+$/.test(webhookSecret);
 if(typeof serviceKey!=='string')configured=false;
 else if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey)){
  try{const claims=JSON.parse(Buffer.from(serviceKey.split('.')[1],'base64url').toString());configured=configured&&claims.role==='service_role'&&claims.ref==='zvtaqzcqfdjpuwnlpzln';}catch{configured=false;}
 }
 return async request=>{
  if(!configured)return reply(503,{error:'Test payment notifications unavailable'});
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
  const signature=request.headers.get('stripe-signature');
  if(typeof signature!=='string'||signature.length>4096)return reply(400,{error:'Invalid test notification'});
  let event,raw;
  try{
   const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
   let length=0;const parts=[];
   while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1048576){await reader.cancel();return reply(413,{error:'Notification too large'});}parts.push(Buffer.from(value));}
   raw=Buffer.concat(parts,length);event=verifyStripeTestEvent(raw,signature,{secret:webhookSecret});
   if(event.account&&event.account!=='acct_1UWJZuGVbz9Pnhxd')throw Error('Wrong account');
  }catch{return reply(400,{error:'Invalid test notification'});}
  const s=event.data.object;
  const payload={p_event:event.id,p_payload_hash:createHash('sha256').update(raw).digest('hex'),p_type:event.type,p_order:s.client_reference_id,p_session:s.id,p_amount:s.amount_total,p_currency:s.currency,p_paid:s.payment_status==='paid'&&s.status==='complete'};
  try{
   const r=await fetchImpl(projectUrl+'/rest/v1/rpc/rr_test_process_event',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(!r.ok)return reply(503,{error:'Test order update unavailable'});
   const age=r.headers.get('age');if(age!==null&&(!/^\d+$/.test(age)||Number(age)>0))return reply(503,{error:'Test order update unavailable'});
   const result=await r.json();if(typeof result?.duplicate!=='boolean'||typeof result.state!=='string')return reply(503,{error:'Test order update unavailable'});
   return reply(200,{received:true});
  }catch{return reply(503,{error:'Test order update unavailable'});}
 };
}
if(typeof Deno!=='undefined')Deno.serve(createTestEdgeWebhook({projectUrl:Deno.env.get('SUPABASE_URL'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),webhookSecret:Deno.env.get('RACK_RELIC_TEST_WEBHOOK_SECRET')}));
