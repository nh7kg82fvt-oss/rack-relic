'use strict';
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const REF='tzymapahsfiyhgilsmxl',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===ks.slice().sort().join('|');
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const mac=(key,x)=>createHmac('sha256',key).update(canonical(x)).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=()=>{throw Error('BACKUP_FACADE_HELD');};
const keyOK=k=>Buffer.isBuffer(k)&&k.length===32;
function authorize(key,service,operation,input,grant,now){
 if(!exact(grant,['v','service','operation','projectRef','requestId','issuedAt','expiresAt','bodySha256','mac'])||grant.v!=='rr-backup-facade-capability-v1'||grant.service!==service||grant.operation!==operation||grant.projectRef!==REF||!UUID.test(grant.requestId)||
  !Number.isSafeInteger(now)||!Number.isSafeInteger(grant.issuedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.issuedAt>now||grant.expiresAt<=now||grant.expiresAt-grant.issuedAt>5000||grant.bodySha256!==hash(canonical(input)))fail();
 const {mac:signature,...payload}=grant;if(!keyOK(key)||!equal(signature,mac(key,payload)))fail();
}
function snapshot(value){
 let nodes=0;
 function copy(x,depth){
  if(++nodes>1024||depth>10)fail();
  if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return x;
  if(typeof x==='string'){if(Buffer.byteLength(x)>32768)fail();return x;}
  if(Array.isArray(x))return Object.freeze(x.map(v=>copy(v,depth+1)));
  if(!x||Object.getPrototypeOf(x)!==Object.prototype)fail();
  return Object.freeze(Object.fromEntries(Object.keys(x).map(k=>[k,copy(x[k],depth+1)])));
 }
 const result=copy(value,0);if(Buffer.byteLength(canonical(result))>32768)fail();return result;
}
function bounded({enabled=false,capabilityKey,service,clock=Date.now,timeoutMs=5000,ready=false}={}){
 const key=keyOK(capabilityKey)?Buffer.from(capabilityKey):null;let busy=false;
 return async(operation,input,grant,fn)=>{
  let q,g,started;try{
   if(enabled!==true||!ready||!key||busy||typeof clock!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>5000)fail();
   q=snapshot(input);g=snapshot(grant);started=clock();authorize(key,service,operation,q,g,started);
  }catch{fail();}
  busy=true;const c=new AbortController();let timer,last=started;
  const check=()=>{const t=clock();if(c.signal.aborted||!Number.isSafeInteger(t)||t<last||t>=g.expiresAt)fail();last=t;return t;};
  const job=Promise.resolve().then(()=>{check();return fn({signal:c.signal,check,input:q,grant:g});});
  // A timed-out transport that ignores AbortSignal keeps this instance held.
  job.then(()=>{busy=false;},()=>{busy=false;});
  try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('BACKUP_FACADE_HELD'));},timeoutMs);})]);}
  catch{fail();}finally{c.abort();clearTimeout(timer);}
 };
}
async function body(response,max,ctx){
 ctx.check();const n=response.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>max))fail();const r=response.body?.getReader();if(!r)fail();let size=0;const parts=[],stop=()=>{r.cancel().catch(()=>{});};ctx.signal.addEventListener('abort',stop,{once:true});
 try{for(;;){ctx.check();const p=await r.read();ctx.check();if(p.done)break;size+=p.value.byteLength;if(size>max){await r.cancel();fail();}parts.push(Buffer.from(p.value));}}
 finally{ctx.signal.removeEventListener('abort',stop);r.releaseLock();}if(n!==null&&Number(n)!==size)fail();return Buffer.concat(parts);
}
module.exports={REF,UUID,exact,canonical,hash,mac,equal,fail,keyOK,bounded,body};
