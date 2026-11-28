'use strict';
// ADDITIVE NODE-ONLY RLS-session proposal, OFF by default; no env/auth/token refresh.
const {createRlsSourceSessionCredentials}=require('./rls_source_session_credentials.cjs');
const {createHmac}=require('node:crypto');
const {REF,exact,canonical,hash,mac,equal,fail,keyOK,bounded,body}=require('./backup_facade_capability.cjs');
const SERVICE='rack-relic-backup-source-reader',BUCKET='listing-photos',HOST=REF+'.storage.supabase.co',BASE='/storage/v1/s3/'+BUCKET;
const PATH=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(jpg|jpeg|png|webp)$/;
const ETAG=/^"[A-Za-z0-9_-]{1,128}"$/,TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const hmac=(k,x)=>createHmac('sha256',k).update(x).digest();
// Strict bounded S3 ListObjectsV2 subset. No DTD/entities/attributes/extensions.
function xml(text){
 text=text.replace(/^<\?xml version="1\.0"(?: encoding="UTF-8")?\?>\s*/,'');
 const tokens=text.match(/<[^>]*>|[^<]+/g)||[];if(tokens.join('')!==text||tokens.length>1000)fail();const stack=[],roots=[];
 for(const t of tokens){if(t[0]!=='<'){if(!stack.length){if(t.trim())fail();}else stack.at(-1).text+=t;continue;}
  if(t.startsWith('</')){const name=t.slice(2,-1);if(!stack.length||stack.at(-1).name!==name)fail();stack.pop();continue;}
  const m=t.match(/^<([A-Za-z][A-Za-z0-9]*)(?: xmlns="http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/")?(\/?)>$/);if(!m||stack.length>3||t.includes(' xmlns=')&&(stack.length||m[1]!=='ListBucketResult'))fail();
  const n={name:m[1],text:'',children:[]};if(stack.length)stack.at(-1).children.push(n);else roots.push(n);if(!m[2])stack.push(n);
 }
 if(stack.length||roots.length!==1||roots[0].name!=='ListBucketResult')fail();return roots[0];
}
function leaf(n){if(n.children.length||n.text.replace(/&(quot|apos|amp|lt|gt);/g,'').includes('&'))fail();return n.text.replace(/&(quot|apos|amp|lt|gt);/g,(_,x)=>({quot:'"',apos:"'",amp:'&',lt:'<',gt:'>'}[x]));}
function fields(n,allowed,required){if(n.text.trim()||n.children.some(x=>!allowed.includes(x.name))||required.some(k=>n.children.filter(x=>x.name===k).length!==1)||allowed.filter(k=>k!=='Contents').some(k=>n.children.filter(x=>x.name===k).length>1))fail();return Object.fromEntries(n.children.filter(x=>x.name!=='Contents').map(x=>[x.name,leaf(x)]));}
function page(text,token){
 const root=xml(text),q=fields(root,['Name','Prefix','MaxKeys','KeyCount','IsTruncated','Contents','NextContinuationToken','ContinuationToken'],['Name','Prefix','MaxKeys','KeyCount','IsTruncated']);
 if(q.Name!==BUCKET||q.Prefix!==''||q.MaxKeys!=='5'||!['true','false'].includes(q.IsTruncated)||!/^[0-9]+$/.test(q.KeyCount)||q.ContinuationToken!==undefined&&q.ContinuationToken!==(token||''))fail();
 const rows=root.children.filter(x=>x.name==='Contents').map(n=>{const x=fields(n,['Key','ETag','Size','LastModified','StorageClass'],['Key','ETag','Size','LastModified','StorageClass']);
  if(!PATH.test(x.Key)||!ETAG.test(x.ETag)||!/^[1-9][0-9]*$/.test(x.Size)||Number(x.Size)>2097152||!Number.isFinite(Date.parse(x.LastModified))||x.StorageClass!=='STANDARD')fail();
  return {path:x.Key,etag:x.ETag,size:Number(x.Size),lastModified:x.LastModified,contentType:TYPES[x.Key.split('.').at(-1)]};});
 if(rows.length>5||Number(q.KeyCount)!==rows.length||q.IsTruncated==='true'&&(!q.NextContinuationToken||!/^[A-Za-z0-9+/=_-]{1,1024}$/.test(q.NextContinuationToken)||!rows.length)||q.IsTruncated==='false'&&q.NextContinuationToken!==undefined)fail();
 return {rows,next:q.IsTruncated==='true'?q.NextContinuationToken:null};
}
function createRlsSessionSourcePhotoFacade({enabled=false,capabilityKey,inventorySealKey,dedicatedPrincipalId=null,legacyAnonKey=null,userAccessToken=null,principalGrant=null,expectedGrantSha256=null,region,fetchImpl,clock=Date.now,timeoutMs=5000}={}){
 const credentials=createRlsSourceSessionCredentials({dedicatedPrincipalId,legacyAnonKey,userAccessToken,principalGrant,expectedGrantSha256});
 const ready=!!credentials&&keyOK(inventorySealKey)&&keyOK(capabilityKey)&&!equal(inventorySealKey.toString('hex'),capabilityKey.toString('hex'))&&typeof fetchImpl==='function'&&typeof clock==='function'&&/^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]$/.test(region||'');
 const sealKey=keyOK(inventorySealKey)?Buffer.from(inventorySealKey):null;
 const checkedClock=()=>{if(!credentials)fail();return credentials.check(clock());};
 const run=bounded({enabled,capabilityKey,service:SERVICE,clock:checkedClock,timeoutMs,ready});
 async function get(path,params,etag,ctx){
  const stamp=new Date(ctx.check()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),payloadHash=hash('');
  const query=Object.keys(params).sort().map(k=>encode(k)+'='+encode(params[k])).join('&');
  const hs={host:HOST,'x-amz-content-sha256':payloadHash,'x-amz-date':stamp,'x-amz-security-token':credentials.sessionToken,...(etag?{'if-match':etag}:{})},names=Object.keys(hs).sort(),canonicalHeaders=names.map(n=>n+':'+hs[n]+'\n').join(''),signedHeaders=names.join(';');
  const canonicalRequest=['GET',path,query,canonicalHeaders,signedHeaders,payloadHash].join('\n'),scope=day+'/'+region+'/s3/aws4_request';
  const key=hmac(hmac(hmac(hmac('AWS4'+credentials.secretAccessKey,day),region),'s3'),'aws4_request');
  const signature=createHmac('sha256',key).update(['AWS4-HMAC-SHA256',stamp,scope,hash(canonicalRequest)].join('\n')).digest('hex');
  const url='https://'+HOST+path+(query?'?'+query:'');ctx.check();const r=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',signal:ctx.signal,headers:{...hs,authorization:'AWS4-HMAC-SHA256 Credential='+credentials.accessKeyId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature,'cache-control':'no-store'}});ctx.check();
  const date=Date.parse(r?.headers?.get('date')||'');if(!(r instanceof Response)||r.status!==200||r.url!==url||r.redirected||r.headers.has('location')||r.headers.has('content-range')||r.headers.has('link')||r.headers.has('age')&&r.headers.get('age')!=='0'||/HIT|STALE|UPDATING|REVALIDATED/i.test(r.headers.get('cf-cache-status')||'')||!Number.isFinite(date)||date>ctx.check()+1000||ctx.check()-date>5000)fail();return r;
 }
 async function scan(ctx){const entries=[],seen=new Set();let token=null,last='';
  for(let i=0;i<3;i++){const r=await get(BASE,{'list-type':'2','max-keys':'5',...(token?{'continuation-token':token}:{})},null,ctx);if(!/^application\/xml(?:;|$)/i.test(r.headers.get('content-type')||''))fail();
   const p=page(new TextDecoder('utf-8',{fatal:true}).decode(await body(r,32768,ctx)),token);
   for(const row of p.rows){if(row.path<=last||Date.parse(row.lastModified)>ctx.check()+1000)fail();last=row.path;entries.push(row);if(entries.length>10)fail();}
   if(p.next===null)return entries;if(seen.has(p.next))fail();seen.add(p.next);token=p.next;
  }fail();
 }
 function validateReceipt(r,ctx){
  if(!exact(r,['v','projectRef','bucket','entries','inventorySha256','issuedAt','expiresAt','mac'])||r.v!=='rr-source-etag-inventory-v1'||r.projectRef!==REF||r.bucket!==BUCKET||!Array.isArray(r.entries)||r.entries.length>10||!Number.isSafeInteger(r.issuedAt)||!Number.isSafeInteger(r.expiresAt)||r.issuedAt>ctx.check()||r.expiresAt<=ctx.check()||r.expiresAt-r.issuedAt>5000||r.inventorySha256!==hash(canonical(r.entries)))fail();
  const {mac:signature,...payload}=r;if(!equal(signature,mac(sealKey,payload)))fail();return r.entries;
 }
 return Object.freeze({
  inventory(input,grant){return run('inventory',input,grant,async ctx=>{input=ctx.input;grant=ctx.grant;if(!exact(input,[]))fail();const entries=await scan(ctx),issuedAt=ctx.check(),r={v:'rr-source-etag-inventory-v1',projectRef:REF,bucket:BUCKET,entries,inventorySha256:hash(canonical(entries)),issuedAt,expiresAt:Math.min(issuedAt+5000,grant.expiresAt)};return {...r,mac:mac(sealKey,r)};});},
  read(input,grant){return run('read',input,grant,async ctx=>{input=ctx.input;grant=ctx.grant;if(!exact(input,['inventory','path'])||!PATH.test(input.path||''))fail();const entries=validateReceipt(input.inventory,ctx),e=entries.find(x=>x.path===input.path);if(!e)fail();
   const r=await get(BASE+'/'+e.path.split('/').map(encode).join('/'),{},e.etag,ctx);if(r.headers.get('etag')!==e.etag||r.headers.get('content-type')!==e.contentType||r.headers.get('last-modified')===null||Date.parse(r.headers.get('last-modified'))!==Date.parse(e.lastModified))fail();
   const bytes=await body(r,e.size,ctx);if(bytes.length!==e.size)fail();validateReceipt(input.inventory,ctx);return {projectRef:REF,bucket:BUCKET,path:e.path,contentValidator:{kind:'s3-etag',value:e.etag},bytes:Uint8Array.from(bytes),sha256:hash(bytes),privateBucketVerified:false,backupVerified:false,releaseEnabled:false};});},
  recheck(input,grant){return run('recheck',input,grant,async ctx=>{input=ctx.input;grant=ctx.grant;if(!exact(input,['inventory']))fail();validateReceipt(input.inventory,ctx);const entries=await scan(ctx);validateReceipt(input.inventory,ctx);if(hash(canonical(entries))!==input.inventory.inventorySha256)fail();return {inventorySha256:input.inventory.inventorySha256,stableInventoryObserved:true,atomicSnapshot:false,historicalVersionAvailable:false,backupVerified:false,releaseEnabled:false};});}
 });
}
module.exports={createRlsSessionSourcePhotoFacade};
