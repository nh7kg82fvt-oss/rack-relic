'use strict';
/* Production photo delivery. Storage client reads must also be restricted.
 * Existing cached raw-object URLs require a separate object-path migration.
 */
const PRODUCTION='https://zrfztnbyynrdzfeblkeq.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIMIT=2097152;
const NO_STORE=Object.freeze({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Pragma':'no-cache','Expires':'0','Vary':'Authorization','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
class Denied extends Error{}
class Unavailable extends Error{}
function header(req,name){const v=req.headers?.[name];if(v===undefined)return null;if(typeof v!=='string')throw new Denied();return v}
function noCachedAuthority(response){
 if(['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(response.headers.get(k)||'')))throw new Unavailable();
 const age=response.headers.get('age');if(age!==null&&(!/^\d+$/.test(age)||Number(age)>0))throw new Unavailable();
}
function safeRow(row,id,member){
 if(!row||row.id!==id||!UUID.test(row.seller_id)||!['draft','published','sold','archived'].includes(row.status)||!['active','hidden'].includes(row.moderation_status))throw new Denied();
 if(member!==row.seller_id&&!(row.moderation_status==='active'&&['published','sold'].includes(row.status)))throw new Denied();
 const path=row.photo_path;
 if(typeof path!=='string'||!path.startsWith(row.seller_id+'/'+id+'/'))throw new Denied();
 const file=path.slice((row.seller_id+'/'+id+'/').length);
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(jpg|jpeg|png|webp)$/.test(file))throw new Denied();
 return {seller:row.seller_id,path};
}
async function boundedImage(response){
 if(!(response instanceof Response)||response.status!==200||response.headers.has('location')||!response.body)throw new Unavailable();
 const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Unavailable();
 const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>LIMIT))throw new Unavailable();
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>LIMIT){await reader.cancel();throw new Unavailable()}chunks.push(Buffer.from(value))}}
 finally{reader.releaseLock()}
 const bytes=Buffer.concat(chunks,length);if(!length)throw new Unavailable();
 const magic=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!magic)throw new Unavailable();return {type,bytes};
}
function createListingPhotoHandler({projectUrl,publicKey,readObject,fetchImpl=globalThis.fetch,timeoutMs=5000}={}){
 // Exact production project only; callers cannot select an origin.
 const configured=projectUrl===PRODUCTION&&typeof publicKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)&&typeof readObject==='function'&&typeof fetchImpl==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=10000;
 return async function listingPhoto(req,res){
  for(const [k,v] of Object.entries(NO_STORE))res.setHeader(k,v);
  const send=(status,body,type='text/plain; charset=utf-8')=>{res.statusCode=status;res.setHeader('Content-Type',type);res.setHeader('Content-Length',Buffer.byteLength(body));res.end(body)};
  if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,'Photo unavailable');return}
  if(!configured){send(503,'Photo service unavailable');return}
  const control=new AbortController();let timer;
  const work=async()=>{
   if(typeof req.url!=='string')throw new Denied();
   const match=/^\/api\/listing-photo\/([0-9a-f-]+)$/.exec(req.url);if(!match||!UUID.test(match[1]))throw new Denied();
   if(header(req,'range')!==null)throw new Denied();
   const id=match[1],authorization=header(req,'authorization');let member=null;
   const headers={apikey:publicKey,'Cache-Control':'no-store','Accept':'application/json'};
   if(authorization!==null){
    if(!/^Bearer [^\s]{1,8192}$/i.test(authorization))throw new Denied();
    headers.Authorization=authorization;
    const auth=await fetchImpl(projectUrl+'/auth/v1/user',{method:'GET',headers,cache:'no-store',redirect:'error',signal:control.signal});
    noCachedAuthority(auth);if(auth.status!==200)throw new Denied();
    const user=await auth.json();if(!user||typeof user.id!=='string'||!UUID.test(user.id))throw new Denied();member=user.id;
   }
   const current=async()=>{
    if(control.signal.aborted)throw new Unavailable();
    const url=new URL(projectUrl+'/rest/v1/listings');url.searchParams.set('select','id,seller_id,status,moderation_status,photo_path');url.searchParams.set('id','eq.'+id);url.searchParams.set('limit','1');
    const result=await fetchImpl(url.toString(),{method:'GET',headers,cache:'no-store',redirect:'error',signal:control.signal});
    noCachedAuthority(result);if(result.status!==200)throw new Unavailable();
    const rows=await result.json();if(!Array.isArray(rows)||rows.length!==1)throw new Denied();return safeRow(rows[0],id,member);
   };
   const first=await current();if(control.signal.aborted)throw new Unavailable();
   // Adapter must be approved server-only origin access, never a caller URL.
   const image=await readObject({bucket:'listing-photos',path:first.path,signal:control.signal});
   const body=await boundedImage(image);const final=await current();
   if(control.signal.aborted||final.seller!==first.seller||final.path!==first.path)throw new Denied();
   return body;
  };
  try{
   const body=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{control.abort();reject(new Unavailable())},timeoutMs)})]);
   send(200,body.bytes,body.type);
  }catch(e){control.abort();send(e instanceof Denied?404:503,e instanceof Denied?'Photo unavailable':'Photo service unavailable')}
  finally{clearTimeout(timer)}
 };
}
module.exports={createListingPhotoHandler};
