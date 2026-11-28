'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SERVICES=Object.freeze(['stripe','shippo','supabase','vercel','backups','website']);
const STATUSES=Object.freeze(['open','in_review','waiting','complete']);
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
class AdminWorkInvalid extends Error{}
class AdminWorkConflict extends Error{constructor(reason){super('Private work record conflict');this.reason=reason;}}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeText=(v,max,empty=false)=>typeof v==='string'&&(empty||v.length>0)&&v.length<=max&&Buffer.byteLength(v)<=max*4&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
function command(value){
 const keys=['operation','requestId','itemId','version','service','title','note','status'];
 if(!object(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||!['create','update'].includes(value.operation)||!UUID.test(value.requestId||'')||!UUID.test(value.itemId||'')||!Number.isSafeInteger(value.version)||value.version<0||value.version>=1000000000||value.operation==='create'&&value.version!==0||value.operation==='update'&&value.version<1||!SERVICES.includes(value.service)||!STATUSES.includes(value.status)||!safeText(value.title,120)||value.title.trim()!==value.title||/[\r\n\t]/.test(value.title)||!safeText(value.note,2000,true))throw new AdminWorkInvalid('Invalid private work request');
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
function timestamp(value,now){if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<1000000000000||Date.parse(value)>now+30000)throw new AdminWorkInvalid('Invalid private work time');return value;}
function cursorBound(value,now){if(!object(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'updatedAt')||!Object.hasOwn(value,'id')||!UUID.test(value.id||''))throw new AdminWorkInvalid('Invalid private work cursor');return {updatedAt:timestamp(value.updatedAt,now),id:value.id};}
const encodeCursor=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function cursor(value,{now=Date.now()}={}){if(value===null)return null;if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(value))throw new AdminWorkInvalid('Invalid private work cursor');let decoded;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'base64url')));}catch{throw new AdminWorkInvalid('Invalid private work cursor');}const bound=cursorBound(decoded,now);if(encodeCursor(bound)!==value)throw new AdminWorkInvalid('Invalid private work cursor');return bound;}
const micros=value=>Date.parse(value)*1000+Number((value.match(/\.(\d{1,6})/)?.[1]||'').padEnd(6,'0').slice(3));
const compare=(a,b)=>micros(b.updatedAt)-micros(a.updatedAt)||a.id.localeCompare(b.id);
function item(value,{now=Date.now()}={}){
 if(!object(value)||!UUID.test(value.id||'')||!Number.isSafeInteger(value.version)||value.version<1||value.version>1000000000)throw new AdminWorkInvalid('Invalid private work item');
 command({operation:'update',requestId:value.id,itemId:value.id,version:value.version===1000000000?999999999:value.version,service:value.service,title:value.title,note:value.note,status:value.status});
 const createdAt=timestamp(value.createdAt,now),updatedAt=timestamp(value.updatedAt,now);if(Date.parse(createdAt)>Date.parse(updatedAt))throw new AdminWorkInvalid('Invalid private work sequence');
 return {id:value.id,service:value.service,title:value.title,note:value.note,status:value.status,version:value.version,createdAt,updatedAt};
}
function base(value){if(value?.test!==true||value.live!==false||value.releaseEnabled!==false)throw new AdminWorkInvalid('Private test work only');}
function list(value,{now=Date.now(),cursor:token=null}={}){base(value);if(!Number.isSafeInteger(now))throw new AdminWorkInvalid('Trusted work read time required');const after=cursor(token,{now}),observedAt=timestamp(value.observedAt,now);if(now-Date.parse(observedAt)>60000||!Array.isArray(value.items)||value.items.length>25||typeof value.hasMore!=='boolean')throw new AdminWorkInvalid('Fresh bounded private work list required');const items=value.items.map(v=>item(v,{now}));if(new Set(items.map(v=>v.id)).size!==items.length||items.some((v,i)=>i>0&&compare(items[i-1],v)>=0)||after&&items.some(v=>compare(after,v)>=0))throw new AdminWorkInvalid('Invalid private work page');let nextCursor=null;if(value.hasMore){if(items.length!==25)throw new AdminWorkInvalid('Incomplete private work page');const bound=cursorBound(value.nextAfter,now),last=items.at(-1);if(bound.id!==last.id||bound.updatedAt!==last.updatedAt)throw new AdminWorkInvalid('Private work cursor mismatch');nextCursor=encodeCursor(bound);if(nextCursor===token)throw new AdminWorkInvalid('Looping private work cursor');}else if(value.nextAfter!==null)throw new AdminWorkInvalid('Unexpected private work cursor');return {test:true,live:false,releaseEnabled:false,observedAt,items,hasMore:value.hasMore,nextCursor};}
function receipt(value,{requestId,expected,now=Date.now()}={}){
 base(value);if(!UUID.test(requestId||'')||value.requestId!==requestId)throw new AdminWorkInvalid('Private work receipt mismatch');
 if(value.state==='unconfirmed'){if(expected)throw new AdminWorkInvalid('Private work save unconfirmed');return {test:true,live:false,releaseEnabled:false,requestId,state:'unconfirmed'};}
 if(typeof value.replayed!=='boolean')throw new AdminWorkInvalid('Private work receipt required');const saved=item(value.item,{now});
 if(expected){const c=command(expected);if(c.requestId!==requestId||saved.id!==c.itemId||saved.version!==c.version+1||['service','title','note','status'].some(k=>saved[k]!==c[k]))throw new AdminWorkInvalid('Private work receipt mismatch');}
 return {test:true,live:false,releaseEnabled:false,requestId,replayed:value.replayed,item:saved};
}
async function readBody(req){
 const limit=16384;
 const parse=raw=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new AdminWorkInvalid('JSON required');}};
 let body;try{body=req.body;}catch{throw new AdminWorkInvalid('JSON required');}
 if(body!==undefined){
  if(typeof body==='string'||Buffer.isBuffer(body)){const raw=Buffer.isBuffer(body)?body:Buffer.from(body);if(raw.length>limit){const e=new AdminWorkInvalid('Request too large');e.status=413;throw e;}return parse(raw);}
  // Vercel's Node helper lazily parses application/json. Accept that documented
  // representation only as bounded, plain command data, never as raw webhook
  // evidence. No getter, coercible object or toJSON method is invoked here.
  if(!body||![Object.prototype,null].includes(Object.getPrototypeOf(body)))throw new AdminWorkInvalid('JSON required');
  const keys=Reflect.ownKeys(body);if(keys.length!==8||keys.some(k=>typeof k!=='string'))throw new AdminWorkInvalid('Invalid private work request');
  const copy={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(body,k);if(!d||!Object.hasOwn(d,'value')||d.value!==null&&!['string','number','boolean'].includes(typeof d.value))throw new AdminWorkInvalid('Invalid private work request');Object.defineProperty(copy,k,{value:d.value,enumerable:true});}
  const checked=command(copy);if(Buffer.byteLength(JSON.stringify(checked))>limit){const e=new AdminWorkInvalid('Request too large');e.status=413;throw e;}return checked;
 }
 if(typeof req[Symbol.asyncIterator]!=='function')throw new AdminWorkInvalid('JSON required');
 let timer;try{return await Promise.race([(async()=>{let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>limit){const e=new AdminWorkInvalid('Request too large');e.status=413;throw e;}chunks.push(b);}return parse(Buffer.concat(chunks));})(),new Promise((_,reject)=>{timer=setTimeout(()=>{req.destroy?.();const e=new AdminWorkInvalid('Request timed out');e.status=408;reject(e);},5000);timer.unref?.();})]);}finally{clearTimeout(timer);}
}
module.exports={UUID,SERVICES,STATUSES,AdminWorkInvalid,AdminWorkConflict,command,item,list,receipt,readBody,cursor};
