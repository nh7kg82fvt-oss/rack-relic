'use strict';
// LOCAL, UNINSTALLED ONE-SLOT TEST DERIVATIVE. No default fetch or credentials.
// A consumed/uncertain delivery never becomes permission to retry or rearm.
const {createHash}=require('node:crypto');
const REF='tzymapahsfiyhgilsmxl';
const RPC='https://'+REF+'.supabase.co/rest/v1/rpc/';
const ID_KEYS=['ticketId','cron','scheduledTime','deadline','rootSha256','acceptanceSha256','requestSha256','selectionSha256'];
const WIRE_KEYS=['selection','request','ownerGrant','enrollment','custodyReview','collectorGrantReview','sourcePrincipalGrant','lease','signedWindowBinding'];
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,NONCE=/^[a-f0-9]{32}$/;
const LIMIT=524288;
const fail=()=>{throw Error('SCHEDULE_TICKET_V1_HELD');};
const sha=s=>createHash('sha256').update(s).digest('hex');
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===keys.length&&Object.values(Object.getOwnPropertyDescriptors(o)).every(d=>d.enumerable&&Object.hasOwn(d,'value'))&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
function plain(value){
 let count=0;
 function walk(x,depth){
  if(++count>8192||depth>24)fail();
  if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return x;
  if(typeof x==='string'){if(Buffer.byteLength(x)>LIMIT)fail();return x;}
  if(!x||!Array.isArray(x)&&Object.getPrototypeOf(x)!==Object.prototype)fail();
  const ds=Object.getOwnPropertyDescriptors(x),names=Reflect.ownKeys(ds);
  if(names.length>8192||names.some(k=>typeof k!=='string'||k!=='length'&&(!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))))fail();
  if(Array.isArray(x)){if(x.length>4096||names.length!==x.length+1)fail();return Array.from({length:x.length},(_,i)=>{if(!Object.hasOwn(ds,String(i)))fail();return walk(ds[i].value,depth+1);});}
  return Object.fromEntries(names.map(k=>[k,walk(ds[k].value,depth+1)]));
 }
 const out=walk(value,0);if(Buffer.byteLength(canonical(out))>LIMIT)fail();return out;
}
function parse(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>LIMIT)fail();
 const value=JSON.parse(text);let at=0,nodes=0;
 const ws=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const str=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}fail();};
 function scan(depth){if(++nodes>8192||depth>24)fail();ws();if(text[at]==='{'){at++;ws();const names=new Set();if(text[at]==='}'){at++;return;}for(;;){ws();const k=str();if(names.has(k))fail();names.add(k);ws();at++;scan(depth+1);ws();if(text[at++]==='}')return;}}if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){scan(depth+1);ws();if(text[at++]===']')return;}}if(text[at]==='"'){str();return;}while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;}
 scan(0);ws();if(at!==text.length)fail();return plain(value);
}
function hash(x){return typeof x==='string'&&SHA.test(x)&&x!=='0'.repeat(64);}
function identity(value){
 const x=plain(value);
 if(!exact(x,ID_KEYS)||!UUID.test(x.ticketId||'')||x.ticketId==='00000000-0000-0000-0000-000000000000'||typeof x.cron!=='string'||x.cron.length>64||!/^\S+(?: \S+){4}$/.test(x.cron)||!Number.isSafeInteger(x.scheduledTime)||x.scheduledTime<1||x.scheduledTime%60000!==0||!Number.isSafeInteger(x.deadline)||x.deadline!==x.scheduledTime+5000||ID_KEYS.filter(k=>k.endsWith('Sha256')).some(k=>!hash(x[k])))fail();
 return x;
}
function envelopeText(text,x){
 if(typeof text!=='string'||Buffer.byteLength(text)<2||Buffer.byteLength(text)>65536)fail();
 const e=parse(text);
 if(!exact(e,WIRE_KEYS)||canonical(e)!==text||!exact(e.request,['version','selectionSha256','executionId','nonce','requestedAt','deadline'])||e.request.version!=='rr-cf-backup-root-request-v1'||e.request.requestedAt!==x.scheduledTime||e.request.deadline!==x.deadline||e.request.selectionSha256!==x.selectionSha256||sha(canonical(e.request))!==x.requestSha256||sha(canonical(e.selection))!==x.selectionSha256)fail();
 // Full signature, root, custody and raw-credential exclusion remain Journal's
 // existing exact-wire authentication duty; this adapter never authorizes IO.
 return text;
}
function consumed(x,p){if(!exact(p,['version','ticketId','consumed'])||p.version!=='rr-schedule-ticket-consumed-v1'||p.ticketId!==x.ticketId||p.consumed!==true)fail();return p;}
function record(value,x){
 const p=plain(value);if(p?.version==='rr-schedule-ticket-consumed-v1')return consumed(x,p);
 if(!exact(p,['version',...ID_KEYS,'envelopeSha256','envelopeText','consumed'])||p.version!=='rr-schedule-ticket-record-v1'||p.consumed!==false||ID_KEYS.some(k=>p[k]!==x[k])||!hash(p.envelopeSha256)||sha(envelopeText(p.envelopeText,x))!==p.envelopeSha256)fail();return p;
}
function claim(value,x){
 const p=plain(value);if(p?.version==='rr-schedule-ticket-consumed-v1')return consumed(x,p);
 if(!exact(p,['version','ticketId','nonce','envelopeSha256','claimedAt','consumed'])||p.version!=='rr-schedule-ticket-claim-v1'||p.ticketId!==x.ticketId||p.nonce!==x.nonce||p.envelopeSha256!==x.envelopeSha256||p.consumed!==true||!Number.isSafeInteger(p.claimedAt)||p.claimedAt<x.scheduledTime||p.claimedAt>=x.deadline)fail();return p;
}
function args(x){return {p_ticket_id:x.ticketId,p_cron:x.cron,p_scheduled_time:x.scheduledTime,p_deadline:x.deadline,p_root_sha256:x.rootSha256,p_acceptance_sha256:x.acceptanceSha256,p_request_sha256:x.requestSha256,p_selection_sha256:x.selectionSha256};}
async function body(r,signal){
 const length=r.headers.get('content-length');if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>LIMIT))fail();
 const reader=r.body?.getReader();if(!reader)fail();let size=0;const parts=[],abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)fail();const p=await reader.read();if(signal.aborted)fail();if(p.done)break;if(!(p.value instanceof Uint8Array))fail();size+=p.value.byteLength;if(size>LIMIT){reader.cancel().catch(()=>{});fail();}parts.push(Buffer.from(p.value));}}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(length!==null&&Number(length)!==size)fail();return parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
}
function createScheduleTicketRepositoryV1({enabled=false,serviceKey=null,transport=null}={}){
 const ready=enabled===true&&typeof serviceKey==='string'&&serviceKey.length<=256&&/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serviceKey)&&typeof transport==='function';
 async function invoke(value,isConsume,signal){
  let controller,timer,abort;try{
   if(!ready||!(signal instanceof AbortSignal)||signal.aborted)fail();const v=plain(value),base=identity(Object.fromEntries(ID_KEYS.map(k=>[k,v[k]])));
   if(!exact(v,isConsume?[...ID_KEYS,'envelopeSha256','nonce']:ID_KEYS)||isConsume&&(!hash(v.envelopeSha256)||!NONCE.test(v.nonce||'')||v.nonce==='0'.repeat(32)))fail();
   const now=Date.now();if(!Number.isSafeInteger(now)||now<base.scheduledTime||now>=base.deadline)fail();
   controller=new AbortController();abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)fail();
   const stopped=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(Error('SCHEDULE_TICKET_V1_HELD')),{once:true});});timer=setTimeout(abort,base.deadline-now);
   const url=RPC+(isConsume?'rr_test_backup_schedule_ticket_consume_v1':'rr_test_backup_schedule_ticket_read_v1'),a={...args(base),...(isConsume?{p_envelope_sha256:v.envelopeSha256,p_nonce:v.nonce}:{})};
   const job=Promise.resolve().then(async()=>{
    if(controller.signal.aborted)fail();const r=await transport(url,{method:'POST',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{apikey:serviceKey,'content-type':'application/json','cache-control':'no-store','accept-encoding':'identity'},body:JSON.stringify(a)});
    if(controller.signal.aborted||!(r instanceof Response)||r.status!==200||r.redirected||r.headers.has('location')||r.url&&r.url!==url||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||r.headers.has('content-encoding')&&!/^identity$/i.test(r.headers.get('content-encoding'))||r.headers.has('age')&&r.headers.get('age')!=='0'||['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(r.headers.get(k)||'')))fail();
    const p=await body(r,controller.signal),end=Date.now();if(controller.signal.aborted||!Number.isSafeInteger(end)||end<now||end>=base.deadline)fail();return isConsume?claim(p,v):record(p,base);
   });return await Promise.race([job,stopped]);
  }catch{fail();}finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);controller?.abort();}
 }
 return Object.freeze({ready,read:(x,{signal}={})=>invoke(x,false,signal),consume:(x,{signal}={})=>invoke(x,true,signal)});
}
module.exports=Object.freeze({createScheduleTicketRepositoryV1,validateScheduleTicketIdentityV1:identity,validateScheduleTicketRecordV1:record,canonicalScheduleTicketV1:canonical,SCHEDULE_TICKET_PROJECT_REF_V1:REF});
