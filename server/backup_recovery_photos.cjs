'use strict';
// Server-only foundation. No transport, scheduler, credentials or live restore
// endpoint is installed by importing this module.
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {TEST_ENVIRONMENTS}=require('./test_environment_registry.cjs');
const PRODUCTION_REF='zrfztnbyynrdzfeblkeq';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const PATH=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(jpg|jpeg|png|webp)$/;
const TYPES=Object.freeze({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
class BackupRecoveryError extends Error{constructor(code){super(code);this.name='BackupRecoveryError';this.code=code;}}
const fail=code=>{throw new BackupRecoveryError(code);};
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');}
function natural(value,max){return Number.isSafeInteger(value)&&value>=0&&value<=max;}
function imageMagic(bytes,type){return type==='image/png'?bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';}
function freshResponse(response){
 if(!(response instanceof Response)||response.status!==200||response.headers.has('location')||!response.body)fail('BACKUP_UNVERIFIED');
 const age=response.headers.get('age');
 if(age!==null&&(!/^\d+$/.test(age)||Number(age)>0)||['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(response.headers.get(k)||'')))fail('FRESH_BACKUP_EVIDENCE_REQUIRED');
}
async function boundedBody(response,limit,context){
 context.open();freshResponse(response);
 const advertised=response.headers.get('content-length');
 if(advertised!==null&&(!/^\d+$/.test(advertised)||Number(advertised)>limit))fail('BACKUP_SIZE_LIMIT');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){context.open();const part=await reader.read();context.open();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();fail('BACKUP_SIZE_LIMIT');}chunks.push(Buffer.from(part.value));}}
 finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks,size);
 if(advertised!==null&&Number(advertised)!==size)fail('BACKUP_UNVERIFIED');
 return bytes;
}
function createPhotoBackupRecovery({enabled=false,source,archive,archiveIdentity,manifestKey,authorizeRestoreDrill,clock=Date.now,maxObjects=500,maxTotalBytes=268435456,maxObjectBytes=2097152,pageSize=50,maxPages=100,timeoutMs=60000,retentionDays=7}={}){
 const refs=[PRODUCTION_REF,...Object.values(TEST_ENVIRONMENTS).map(e=>e.projectRef)];
 const sourceRef=source?.projectRef,sourceIdentity='supabase:'+sourceRef+':listing-photos';
 const key=Buffer.isBuffer(manifestKey)?Buffer.from(manifestKey):null;
 const configured=enabled===true&&refs.includes(sourceRef)&&source?.bucket==='listing-photos'&&typeof source.listPage==='function'&&typeof source.readVersion==='function'&&typeof archive?.inspect==='function'&&typeof archive?.read==='function'&&typeof archive?.putIfAbsent==='function'&&typeof archiveIdentity==='string'&&/^[a-z0-9][a-z0-9:_-]{2,199}$/.test(archiveIdentity)&&!archiveIdentity.startsWith('supabase:'+sourceRef+':')&&key?.length===32&&typeof clock==='function'&&Number.isSafeInteger(maxObjects)&&maxObjects>0&&maxObjects<=5000&&Number.isSafeInteger(maxTotalBytes)&&maxTotalBytes>0&&maxTotalBytes<=5368709120&&Number.isSafeInteger(maxObjectBytes)&&maxObjectBytes>0&&maxObjectBytes<=2097152&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=100&&Number.isSafeInteger(maxPages)&&maxPages>0&&maxPages<=100&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=300000&&Number.isSafeInteger(retentionDays)&&retentionDays>=7&&retentionDays<=365;
 // Snapshot-scoped objects avoid a lifecycle expiring an old shared blob that
 // is still referenced by a newer daily backup. Content hashes deduplicate only
 // within one immutable snapshot, whose minimum retention starts at capture.
 const sourceTag=hash(sourceIdentity).slice(0,32),manifestKeyFor=id=>'snapshots/'+sourceTag+'/'+id+'/manifest.json',blobKeyFor=(id,digest)=>'snapshots/'+sourceTag+'/'+id+'/objects/'+digest;
 const stamp=(value,context)=>Number.isSafeInteger(value)&&value>=context.startedAt&&value<=clock()+1000;
 async function run(work){
  if(!configured)fail('BACKUP_NOT_CONFIGURED');
  const controller=new AbortController(),startedAt=clock();let timer;
  if(!natural(startedAt,Number.MAX_SAFE_INTEGER))fail('BACKUP_NOT_CONFIGURED');
  const context={startedAt,signal:controller.signal,open(){if(controller.signal.aborted||clock()>startedAt+timeoutMs)fail('BACKUP_UNVERIFIED');}};
  try{return await Promise.race([work(context),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new BackupRecoveryError('BACKUP_UNVERIFIED'));},timeoutMs);})]);}
  catch(error){controller.abort();if(error instanceof BackupRecoveryError)throw error;fail('BACKUP_UNVERIFIED');}
  finally{clearTimeout(timer);}
 }
 async function privateArchive(context){
  context.open();const a=await archive.inspect({signal:context.signal});context.open();
  if(!a||a.identity!==archiveIdentity||a.private!==true||a.immutable!==true||a.deletePropagation!==false||a.independentCredentialScope!==true||!Number.isSafeInteger(a.retentionDays)||a.retentionDays<retentionDays||!stamp(a.checkedAt,context))fail('PRIVATE_RETAINED_ARCHIVE_REQUIRED');
 }
 async function scan(context){
  const items=[],cursors=new Set();let cursor=null,total=0,last='';
  for(let page=0;page<maxPages;page++){
   context.open();const result=await source.listPage({cursor,limit:pageSize,signal:context.signal});context.open();
   if(!result||result.sourceIdentity!==sourceIdentity||!stamp(result.checkedAt,context)||!Array.isArray(result.items)||result.items.length>pageSize||!(result.nextCursor===null||typeof result.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(result.nextCursor)))fail('COMPLETE_PHOTO_INVENTORY_REQUIRED');
   for(const item of result.items){
    if(!exactKeys(item,['path','version','size','contentType'])||!PATH.test(item.path)||item.path<=last||typeof item.version!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(item.version)||!Number.isSafeInteger(item.size)||item.size<1||item.size>maxObjectBytes||item.contentType!==TYPES[item.path.split('.').at(-1)])fail('INVALID_PHOTO_INVENTORY');
    total+=item.size;if(items.length>=maxObjects||total>maxTotalBytes)fail('BACKUP_SIZE_LIMIT');
    items.push(Object.freeze({path:item.path,version:item.version,size:item.size,contentType:item.contentType}));last=item.path;
   }
   if(result.nextCursor===null)return {items,total,inventorySha256:hash(canonical(items))};
   if(result.items.length===0||cursors.has(result.nextCursor))fail('COMPLETE_PHOTO_INVENTORY_REQUIRED');
   cursors.add(result.nextCursor);cursor=result.nextCursor;
  }
  fail('COMPLETE_PHOTO_INVENTORY_REQUIRED');
 }
 async function readArchiveBytes(objectKey,limit,context){
  context.open();const response=await archive.read({key:objectKey,signal:context.signal});context.open();
  if(response===null)return null;
  return {bytes:await boundedBody(response,limit,context),contentType:(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()};
 }
 async function ensureImmutable(objectKey,bytes,contentType,context){
  await privateArchive(context);
  let stored=await readArchiveBytes(objectKey,Math.max(bytes.length,1),context);
  if(stored===null){
   // A slow read must not carry an earlier private-policy observation into a
   // later write after the destination policy has changed.
   await privateArchive(context);
   context.open();try{await archive.putIfAbsent({key:objectKey,bytes:Buffer.from(bytes),contentType,sha256:hash(bytes),requirePrivate:true,minimumRetentionDays:retentionDays,signal:context.signal});}catch{/* Unknown writes reconcile only by reading this exact immutable key. */}
   context.open();stored=await readArchiveBytes(objectKey,Math.max(bytes.length,1),context);
  }
  if(!stored||stored.contentType!==contentType||stored.bytes.length!==bytes.length||!same(hash(stored.bytes),hash(bytes)))fail('IMMUTABLE_BACKUP_UNVERIFIED');
 }
 function envelopeFor(manifest){const text=canonical(manifest);return Buffer.from(canonical({manifest,sha256:hash(text),hmacSha256:createHmac('sha256',key).update(text).digest('hex')}));}
 function validateManifest(envelope,id,expected){
  if(!exactKeys(envelope,['manifest','sha256','hmacSha256'])||!SHA.test(envelope.sha256||'')||!SHA.test(envelope.hmacSha256||''))fail('MANIFEST_UNVERIFIED');
  const m=envelope.manifest,text=canonical(m);
  if(!same(envelope.sha256,hash(text))||!same(envelope.hmacSha256,createHmac('sha256',key).update(text).digest('hex'))||expected!==undefined&&!same(expected,envelope.sha256))fail('MANIFEST_UNVERIFIED');
  if(!exactKeys(m,['version','snapshotId','sourceIdentity','captureStartedAt','captureFinishedAt','objectCount','totalBytes','inventorySha256','entries'])||m.version!==1||m.snapshotId!==id||m.sourceIdentity!==sourceIdentity||!natural(m.captureStartedAt,clock()+1000)||!natural(m.captureFinishedAt,clock()+1000)||m.captureFinishedAt<m.captureStartedAt||!natural(m.objectCount,maxObjects)||!natural(m.totalBytes,maxTotalBytes)||!SHA.test(m.inventorySha256||'')||!Array.isArray(m.entries)||m.entries.length!==m.objectCount)fail('MANIFEST_UNVERIFIED');
  let last='',total=0;const inventory=[];
  for(const e of m.entries){
   if(!exactKeys(e,['path','version','size','contentType','sha256','backupKey'])||!PATH.test(e.path)||e.path<=last||typeof e.version!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(e.version)||!Number.isSafeInteger(e.size)||e.size<1||e.size>maxObjectBytes||e.contentType!==TYPES[e.path.split('.').at(-1)]||!SHA.test(e.sha256||'')||e.backupKey!==blobKeyFor(id,e.sha256))fail('MANIFEST_UNVERIFIED');
   total+=e.size;last=e.path;inventory.push({path:e.path,version:e.version,size:e.size,contentType:e.contentType});
  }
  if(total!==m.totalBytes||hash(canonical(inventory))!==m.inventorySha256)fail('MANIFEST_UNVERIFIED');
  return {manifest:m,manifestSha256:envelope.sha256};
 }
 async function load(id,expected,context){
  if(!UUID.test(id||'')||expected!==undefined&&!SHA.test(expected))fail('INVALID_SNAPSHOT_REFERENCE');
  await privateArchive(context);const stored=await readArchiveBytes(manifestKeyFor(id),2097152,context);
  if(stored===null)return null;
  if(stored.contentType!=='application/json')fail('MANIFEST_UNVERIFIED');
  let envelope;try{envelope=JSON.parse(stored.bytes.toString('utf8'));}catch{fail('MANIFEST_UNVERIFIED');}
  return validateManifest(envelope,id,expected);
 }
 async function verifiedObjects(found,context,visit){
  for(const entry of found.manifest.entries){
   await privateArchive(context);const stored=await readArchiveBytes(entry.backupKey,entry.size,context);
   if(!stored||stored.bytes.length!==entry.size||stored.contentType!==entry.contentType||!same(hash(stored.bytes),entry.sha256)||!imageMagic(stored.bytes,entry.contentType))fail('PHOTO_BACKUP_UNVERIFIED');
   if(visit)await visit(entry,stored.bytes,context);
  }
  await privateArchive(context);
 }
 function receipt(found,extra={}){return Object.freeze({snapshotId:found.manifest.snapshotId,manifestSha256:found.manifestSha256,objectCount:found.manifest.objectCount,totalBytes:found.manifest.totalBytes,captureFinishedAt:found.manifest.captureFinishedAt,verified:true,cloudReady:false,releaseEnabled:false,...extra});}
 async function drillAuthority(target,snapshotId,expected,drillId,context){
  if(typeof authorizeRestoreDrill!=='function'||typeof target?.inspect!=='function'||typeof target?.putIfAbsent!=='function'||typeof target?.read!=='function')fail('ISOLATED_RESTORE_AUTHORITY_REQUIRED');
  const expectedRef=TEST_ENVIRONMENTS.acceptance.projectRef;
  context.open();const authority=await authorizeRestoreDrill({snapshotId,manifestSha256:expected,drillId,targetProjectRef:expectedRef,purpose:'isolated-restore-drill',signal:context.signal});context.open();
  if(!authority||authority.authorized!==true||authority.snapshotId!==snapshotId||authority.manifestSha256!==expected||authority.drillId!==drillId||authority.targetProjectRef!==expectedRef||authority.purpose!=='isolated-restore-drill'||!stamp(authority.checkedAt,context)||!Number.isSafeInteger(authority.expiresAt)||authority.expiresAt<=clock()||authority.expiresAt>clock()+60000)fail('ISOLATED_RESTORE_AUTHORITY_REQUIRED');
  const attested=await target.inspect({signal:context.signal});context.open();
  if(!attested||attested.projectRef!==expectedRef||attested.projectRef===sourceRef||attested.bucket!=='rr-backup-restore-drill'||attested.private!==true||attested.production!==false||attested.purpose!=='isolated-restore-drill'||!stamp(attested.checkedAt,context))fail('ISOLATED_RESTORE_TARGET_REQUIRED');
  if(authority.expiresAt<=clock())fail('ISOLATED_RESTORE_AUTHORITY_REQUIRED');
  return Object.freeze({snapshotId,manifestSha256:expected,drillId,targetProjectRef:expectedRef,purpose:'isolated-restore-drill',checkedAt:authority.checkedAt,expiresAt:authority.expiresAt});
 }
 return Object.freeze({
  async createSnapshot({snapshotId}={}){return run(async context=>{
   if(!UUID.test(snapshotId||''))fail('INVALID_SNAPSHOT_REFERENCE');
   const existing=await load(snapshotId,undefined,context);
   if(existing){await verifiedObjects(existing,context);return receipt(existing,{reused:true});}
   const first=await scan(context),entries=[];
   for(const item of first.items){
    context.open();const read=await source.readVersion({path:item.path,version:item.version,signal:context.signal});context.open();
    if(!read||read.version!==item.version)fail('SOURCE_PHOTO_CHANGED');
    const bytes=await boundedBody(read.response,item.size,context),type=(read.response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(bytes.length!==item.size||type!==item.contentType||!imageMagic(bytes,type))fail('SOURCE_PHOTO_CHANGED');
    const sha256=hash(bytes),backupKey=blobKeyFor(snapshotId,sha256);await ensureImmutable(backupKey,bytes,type,context);entries.push({...item,sha256,backupKey});
   }
   const final=await scan(context);
   if(first.inventorySha256!==final.inventorySha256||first.total!==final.total)fail('SOURCE_INVENTORY_CHANGED');
   const manifest={version:1,snapshotId,sourceIdentity,captureStartedAt:context.startedAt,captureFinishedAt:clock(),objectCount:entries.length,totalBytes:first.total,inventorySha256:first.inventorySha256,entries};
   const envelope=envelopeFor(manifest);if(envelope.length>2097152)fail('BACKUP_SIZE_LIMIT');
   await ensureImmutable(manifestKeyFor(snapshotId),envelope,'application/json',context);
   const found=await load(snapshotId,hash(canonical(manifest)),context);if(!found)fail('MANIFEST_UNVERIFIED');
   await verifiedObjects(found,context);return receipt(found,{reused:false});
  });},
  async verifySnapshot({snapshotId,manifestSha256}={}){return run(async context=>{
   if(!SHA.test(manifestSha256||''))fail('INVALID_SNAPSHOT_REFERENCE');
   const found=await load(snapshotId,manifestSha256,context);if(!found)fail('MANIFEST_UNVERIFIED');await verifiedObjects(found,context);return receipt(found,{readOnly:true});
  });},
  async restoreDrill({snapshotId,manifestSha256,drillId,target}={}){return run(async context=>{
   if(!UUID.test(drillId||'')||!SHA.test(manifestSha256||''))fail('INVALID_SNAPSHOT_REFERENCE');
   const found=await load(snapshotId,manifestSha256,context);if(!found)fail('MANIFEST_UNVERIFIED');
   // Verify the ENTIRE backup before the first isolated write.
   await verifiedObjects(found,context);await drillAuthority(target,snapshotId,manifestSha256,drillId,context);
   await verifiedObjects(found,context,async(entry,bytes)=>{
    await drillAuthority(target,snapshotId,manifestSha256,drillId,context);
    const path='drills/'+drillId+'/'+entry.path;
    context.open();let restored=await target.read({path,signal:context.signal});context.open();
    if(restored===null){
     const authority=await drillAuthority(target,snapshotId,manifestSha256,drillId,context);context.open();
     try{await target.putIfAbsent({path,bytes:Buffer.from(bytes),contentType:entry.contentType,sha256:entry.sha256,requirePrivate:true,authority,signal:context.signal});}catch{/* Never replace or re-POST an uncertain restore write. */}
     context.open();restored=await target.read({path,signal:context.signal});context.open();
    }
    if(restored===null)fail('RESTORE_DRILL_UNVERIFIED');
    const restoredBytes=await boundedBody(restored,entry.size,context);
    if(restoredBytes.length!==entry.size||(restored.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!==entry.contentType||!same(hash(restoredBytes),entry.sha256))fail('RESTORE_DRILL_UNVERIFIED');
   });
   await drillAuthority(target,snapshotId,manifestSha256,drillId,context);
   return receipt(found,{drillId,isolatedRestoreVerified:true,productionRestoreEnabled:false,targetProjectRef:TEST_ENVIRONMENTS.acceptance.projectRef});
  });}
 });
}
module.exports={createPhotoBackupRecovery,BackupRecoveryError};
