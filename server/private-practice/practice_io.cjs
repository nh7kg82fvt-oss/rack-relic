'use strict';
const U=require('../private-tax/quote_buyer_transport.cjs');
class Held extends Error{constructor(){super('Practice action held');}}
const hold=()=>{throw new Held();},sha=v=>require('node:crypto').createHash('sha256').update(v).digest('hex');
function budget(signal,clock=Date.now,mono=()=>performance.now(),limit=60000){
 if(!(signal instanceof AbortSignal)||signal.aborted)hold();const start=clock(),first=mono();if(!Number.isSafeInteger(start)||start<1||!Number.isFinite(first)||first<0)hold();let w=start,m=first;
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),limit),combined=AbortSignal.any([signal,abort.signal]);
 function check(){const nw=clock(),nm=mono();if(combined.aborted||!Number.isSafeInteger(nw)||!Number.isFinite(nm)||nw<w||nm<m||nw-start>=limit||nm-first>=limit)hold();w=nw;m=nm;return nw;}
 async function wait(p){check();let cb;try{const v=await Promise.race([p,new Promise((_,reject)=>{cb=()=>reject(new Held());combined.addEventListener('abort',cb,{once:true});if(combined.aborted)cb();})]);check();return v;}finally{if(cb)combined.removeEventListener('abort',cb);}}
 return{signal:combined,check,wait,close(){clearTimeout(timer);abort.abort();}};
}
async function request(fetchImpl,url,init,scope,max=32768){
 scope.check();const r=await scope.wait(Promise.resolve().then(()=>{scope.check();return fetchImpl(url,{...init,signal:scope.signal,redirect:'manual',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json','Accept-Encoding':'identity','Cache-Control':'no-store',Pragma:'no-cache',...init.headers}});}));
 if(r?.status!==200||r.url!==url||r.redirected!==false||!r.headers?.get||!r.body?.getReader)hold();const h=r.headers,date=Date.parse(h.get('date')||''),now=scope.check(),len=h.get('content-length');U.uncached(h);
 if(h.get('location')!==null||!Number.isFinite(date)||date<now-60000||date>now+30000||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h.get('content-type')||'')||len!==null&&(!/^(0|[1-9]\d*)$/.test(len)||Number(len)>max))hold();
 const reader=r.body.getReader(),parts=[];let size=0;try{for(;;){const x=await scope.wait(reader.read());if(x.done)break;if(!(x.value instanceof Uint8Array)||(size+=x.value.length)>max)hold();parts.push(Buffer.from(x.value));}if(len!==null&&Number(len)!==size)hold();const bytes=Buffer.concat(parts);let value;try{value=U.plain(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{bytes.fill(0);hold();}return{value,bytes,headers:r.headers};}finally{parts.forEach(b=>b.fill(0));try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
}
module.exports={U,Held,hold,sha,budget,request};
