// SOURCE PROPOSAL ONLY. Exact isolated callback; native Web Crypto, no imports.
const ACCOUNT_URL='https://tzymapahsfiyhgilsmxl.supabase.co';
// Supabase's relay may strip /functions/v1 and rewrite the origin. Routing is
// NOT authentication: fixed runtime branch + raw-body HMAC remain mandatory.
const CALLBACK_PATHS=new Set(['/functions/v1/rack-alert-receipts','/rack-alert-receipts']);
const T='resend_rack_owner_v1',D='rack_owner_wayne_v1';
const SENDER='alerts@alerts.rackrelic.com',OWNER='wayne@rackrelic.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/,DELIVERY_KEY=/^rr_test_case_alert_[1-9][0-9]{0,15}$/;
const EVENTS=new Set(['email.delivered','email.bounced','email.complained','email.delivery_delayed','email.failed','email.sent','email.suppressed']);
const utf8=new TextEncoder(),fail=()=>{throw Error('RECEIPT_UNVERIFIED');};
const reply=status=>new Response(null,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
function base64(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail();
 const s=atob(value),bytes=Uint8Array.from(s,c=>c.charCodeAt(0));
 if(btoa(s).replace(/=+$/,'')!==value.replace(/=+$/,''))fail();return bytes;
}
export async function verifySvixSignature({rawBody,headers,signingSecret,nowMs}){
 try{
  if(!(rawBody instanceof Uint8Array)||!rawBody.length||rawBody.length>32768||!Number.isSafeInteger(nowMs)||
   typeof signingSecret!=='string'||!signingSecret.startsWith('whsec_'))return false;
  const secret=base64(signingSecret.slice(6));if(secret.length<16||secret.length>64)return false;
  const id=headers?.['svix-id'],ts=headers?.['svix-timestamp'],signatures=headers?.['svix-signature'];
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||typeof ts!=='string'||!/^\d{10}$/.test(ts)||
   Math.abs(Math.floor(nowMs/1000)-Number(ts))>300||typeof signatures!=='string'||signatures.length>2048)return false;
  const parts=signatures.split(' ');if(parts.length<1||parts.length>8)return false;
  const prefix=utf8.encode(id+'.'+ts+'.'),content=new Uint8Array(prefix.length+rawBody.length);
  content.set(prefix);content.set(rawBody,prefix.length);
  const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['verify']);let matched=false;
  for(const part of parts){const m=/^v1,([A-Za-z0-9+/]{43}=)$/.exec(part);if(!m)continue;
   const sig=base64(m[1]);if(sig.length===32&&await crypto.subtle.verify('HMAC',key,sig,content))matched=true;}
  return matched;
 }catch{return false;}
}
async function bytesOf(body,limit,signal){
 if(!body||signal.aborted)fail();const reader=body.getReader(),chunks=[];let size=0;
 const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){const p=await reader.read();if(signal.aborted)fail();if(p.done)break;
  size+=p.value.byteLength;if(size>limit){await reader.cancel();fail();}chunks.push(p.value);}}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const p of chunks){bytes.set(p,offset);offset+=p.byteLength;}return bytes;
}
function receiptInput(payload,eventId,bodyHash,policyHash){
 const d=payload?.data;
 if(!EVENTS.has(payload?.type)||typeof payload.created_at!=='string'||!Number.isFinite(Date.parse(payload.created_at))||
  !UUID.test(d?.email_id||'')||d.from!==SENDER||!Array.isArray(d.to)||d.to.length!==1||d.to[0]!==OWNER||
  d.subject!=='Rack Relic TEST case alert'||!d.tags||typeof d.tags!=='object'||Array.isArray(d.tags)||
  Object.keys(d.tags).sort().join(',')!=='rr_delivery_key,rr_payload_sha256'||
  !DELIVERY_KEY.test(d.tags.rr_delivery_key||'')||!SHA.test(d.tags.rr_payload_sha256||'')||d.broadcast_id!=null||d.template_id!=null)fail();
 return {p_key:d.tags.rr_delivery_key,p_payload:d.tags.rr_payload_sha256,p_policy:policyHash,p_email:d.email_id,
  p_event:eventId,p_body:bodyHash,p_type:payload.type,p_created:payload.created_at};
}
// This account also sends sign-in links. Authenticate their webhook before
// acknowledging it, but never send it into the owner-alert receipt ledger.
// Alert identity or alert tags always take precedence and remain strict.
function unrelatedSignIn(payload){
 const d=payload?.data;
 return EVENTS.has(payload?.type)&&typeof payload.created_at==='string'&&Number.isFinite(Date.parse(payload.created_at))&&
  UUID.test(d?.email_id||'')&&
  (d.from==='signin@alerts.rackrelic.com'||d.from==='"Rack Relic" <signin@alerts.rackrelic.com>')&&
  d.subject==='Your sign-in link'&&Array.isArray(d.to)&&d.to.length===1&&
  ['wayne@rackrelic.com','support@rackrelic.com'].includes(d.to[0])&&
  (d.tags==null||typeof d.tags==='object'&&!Array.isArray(d.tags)&&
   !Object.keys(d.tags).some(k=>k.startsWith('rr_')))&&d.broadcast_id==null&&d.template_id==null;
}
async function persist(fetchImpl,key,args,signal){
 const url=ACCOUNT_URL+'/rest/v1/rpc/rr_test_resend_owner_receipt';
 const r=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',signal,
  headers:{apikey:key,'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(args)});
 if(signal.aborted||!(r instanceof Response)||r.status!==200||r.url!==url||r.redirected||r.headers.has('location')||
  !/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||
  r.headers.has('age')&&r.headers.get('age')!=='0'||/HIT|STALE|UPDATING/i.test(r.headers.get('cf-cache-status')||''))fail();
 const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))fail();
 const bytes=await bytesOf(r.body,8192,signal);if(length!==null&&Number(length)!==bytes.length)fail();
 const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(signal.aborted||result?.test!==true||result.releaseEnabled!==false||result.transportId!==T||result.destinationId!==D||
  result.deliveryKey!==args.p_key||result.payloadHash!==args.p_payload||result.policyHash!==args.p_policy||result.providerEmailId!==args.p_email||
  result.sendAllowed!==false||!UUID.test(result.attemptId||'')||!SHA.test(result.requestHash||'')||
  !['accepted','delivered','issue_hold'].includes(result.state)||typeof result.delivered!=='boolean'||typeof result.adverseSeen!=='boolean'||
  result.delivered!==(result.state==='delivered')||result.adverseSeen!==(result.state==='issue_hold'))fail();
}
export function createRackAlertReceiptEndpoint({env,fetchImpl,clock=Date.now,timeoutMs=3000}={}){
 let serviceKey,signingSecret,ready=false;
 try{
  if(typeof env!=='function'||typeof fetchImpl!=='function'||typeof clock!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>10000)return ()=>reply(503);
  if(env('RACK_RELIC_TEST_RESEND_RECEIPTS_ENABLED')!=='true'||env('SUPABASE_URL')!==ACCOUNT_URL)return ()=>reply(503);
  const keys=JSON.parse(env('SUPABASE_SECRET_KEYS')||'null');
  if(!keys||typeof keys!=='object'||Array.isArray(keys)||!Object.prototype.hasOwnProperty.call(keys,'default'))return ()=>reply(503);
  serviceKey=keys.default;signingSecret=env('RACK_RELIC_TEST_RESEND_WEBHOOK_SECRET');
  if(typeof serviceKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serviceKey)||typeof signingSecret!=='string'||!signingSecret.startsWith('whsec_'))return ()=>reply(503);
  const secret=base64(signingSecret.slice(6));ready=secret.length>=16&&secret.length<=64;
 }catch{return ()=>reply(503);}
 return async request=>{
  if(!ready)return reply(503);
  if(!(request instanceof Request))return reply(404);
  let url;try{url=new URL(request.url);}catch{return reply(404);}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||request.url.includes('?')||url.hash||
   !CALLBACK_PATHS.has(url.pathname))return reply(404);
  if(request.method!=='POST')return reply(405);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return reply(415);
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>32768))return reply(413);
  const headers=Object.fromEntries(['svix-id','svix-timestamp','svix-signature'].map(k=>[k,request.headers.get(k)]));
  if(Object.values(headers).some(v=>typeof v!=='string')||Object.values(headers).reduce((n,v)=>n+v.length,0)>2304)return reply(400);
  const c=new AbortController(),abort=()=>c.abort();let timer;
  if(request.signal.aborted)abort();else request.signal.addEventListener('abort',abort,{once:true});
  try{return await Promise.race([Promise.resolve().then(async()=>{
   const rawBody=await bytesOf(request.body,32768,c.signal);if(length!==null&&Number(length)!==rawBody.length)fail();
   if(!await verifySvixSignature({rawBody,headers,signingSecret,nowMs:clock()})||c.signal.aborted)fail();
   const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBody));
   if(unrelatedSignIn(payload))return reply(204);
   const policyHash=await hash(utf8.encode(JSON.stringify({transportId:T,destinationId:D,sender:SENDER,recipient:OWNER})));
   const args=receiptInput(payload,headers['svix-id'],await hash(rawBody),policyHash);if(c.signal.aborted)fail();
   await persist(fetchImpl,serviceKey,args,c.signal);if(c.signal.aborted)fail();return reply(204);
  }),new Promise(resolve=>{timer=setTimeout(()=>{abort();resolve(reply(503));},timeoutMs);})]);}
  catch{return reply(503);} // No successful acknowledgment of an unknown durable result.
  finally{clearTimeout(timer);abort();request.signal.removeEventListener('abort',abort);}
 };
}
if(typeof Deno!=='undefined'&&typeof Deno.serve==='function'){
 Deno.serve(createRackAlertReceiptEndpoint({env:name=>Deno.env.get(name),fetchImpl:fetch,clock:Date.now}));
}
