'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createPhotoBackupRecovery}=require('../server/backup_recovery_photos.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const NOW=1793700000000,REF='zrfztnbyynrdzfeblkeq',SID='11111111-1111-4111-8111-111111111111',SID2='22222222-2222-4222-8222-222222222222',SID3='33333333-3333-4333-8333-333333333333',DRILL='44444444-4444-4444-8444-444444444444';
const SELLER='55555555-5555-4555-8555-555555555555',LISTING='66666666-6666-4666-8666-666666666666',A=SELLER+'/'+LISTING+'/a.jpg',B=SELLER+'/'+LISTING+'/b.jpg';
const jpeg=n=>Buffer.from([255,216,255,n]),digest=b=>createHash('sha256').update(b).digest('hex');
function fixture({count=2,options={}}={}){
 const sourceFiles=new Map([[A,{bytes:jpeg(1),version:'v1',contentType:'image/jpeg'}],...(count===2?[[B,{bytes:jpeg(2),version:'v2',contentType:'image/jpeg'}]]:[])]),archiveFiles=new Map(),restoreFiles=new Map(),calls={list:0,sourceReads:0,archiveWrites:[],restoreWrites:[],archiveReads:0,restoreReads:0,authority:0};
 const hooks={};let proof={identity:'archive:private-rr-photos',private:true,immutable:true,retentionDays:7,deletePropagation:false,independentCredentialScope:true,checkedAt:NOW};
 const source={projectRef:REF,bucket:'listing-photos',async listPage({cursor,limit}){
  calls.list++;if(hooks.list)return hooks.list({cursor,limit,calls,sourceFiles});
  const list=[...sourceFiles].sort(([a],[b])=>a.localeCompare(b)).map(([path,f])=>({path,version:f.version,size:f.bytes.length,contentType:f.contentType})),offset=cursor===null?0:Number(cursor.slice(1));
  return {sourceIdentity:'supabase:'+REF+':listing-photos',checkedAt:NOW,items:list.slice(offset,offset+limit),nextCursor:offset+limit<list.length?'p'+(offset+limit):null};
 },async readVersion({path,version}){
  calls.sourceReads++;if(hooks.sourceRead)return hooks.sourceRead({path,version,calls,sourceFiles});const f=sourceFiles.get(path);return {version:f.version,response:new Response(Buffer.from(f.bytes),{headers:{'content-type':f.contentType}})};
 }};
 const archive={async inspect(){return hooks.inspect?hooks.inspect({...proof},calls):{...proof};},async read({key}){
  calls.archiveReads++;if(hooks.archiveRead)return hooks.archiveRead({key,calls,archiveFiles});const f=archiveFiles.get(key);return f?new Response(Buffer.from(f.bytes),{headers:{'content-type':f.contentType}}):null;
 },async putIfAbsent(input){calls.archiveWrites.push({...input,bytes:Buffer.from(input.bytes)});if(hooks.archivePut)return hooks.archivePut(input,archiveFiles);assert.equal(input.requirePrivate,true);assert.equal(input.minimumRetentionDays,7);if(archiveFiles.has(input.key))throw Error('Conflict');archiveFiles.set(input.key,{bytes:Buffer.from(input.bytes),contentType:input.contentType});},async delete(){throw Error('Must not mirror deletion');}};
 let targetProof={projectRef:TEST_ENVIRONMENTS.acceptance.projectRef,bucket:'rr-backup-restore-drill',private:true,production:false,purpose:'isolated-restore-drill',checkedAt:NOW};
 const target={async inspect(){return {...targetProof};},async read({path}){calls.restoreReads++;const f=restoreFiles.get(path);return f?new Response(Buffer.from(f.bytes),{headers:{'content-type':f.contentType}}):null;},async putIfAbsent(input){calls.restoreWrites.push(input);if(hooks.restorePut)return hooks.restorePut(input,restoreFiles);assert.equal(input.requirePrivate,true);if(restoreFiles.has(input.path))throw Error('Conflict');restoreFiles.set(input.path,{bytes:Buffer.from(input.bytes),contentType:input.contentType});}};
 const authority=async input=>{calls.authority++;return hooks.authority?hooks.authority(input):{...input,authorized:true,checkedAt:NOW,expiresAt:NOW+60000};};
 const args={enabled:true,source,archive,archiveIdentity:proof.identity,manifestKey:Buffer.alloc(32,7),authorizeRestoreDrill:authority,clock:()=>NOW,...options};
 return {service:createPhotoBackupRecovery(args),args,calls,hooks,sourceFiles,archiveFiles,restoreFiles,target,setProof:x=>{proof={...proof,...x};},setTarget:x=>{targetProof={...targetProof,...x};}};
}
const snapshot=f=>f.service.createSnapshot({snapshotId:SID});
const verify=(f,r)=>f.service.verifySnapshot({snapshotId:r.snapshotId,manifestSha256:r.manifestSha256});
test('backup is disabled without deliberate configuration and rejects an archive sharing the source boundary',async()=>{
 const f=fixture();await assert.rejects(createPhotoBackupRecovery({...f.args,enabled:false}).createSnapshot({snapshotId:SID}),/BACKUP_NOT_CONFIGURED/);
 for(const bucket of ['listing-photos','another-bucket'])await assert.rejects(createPhotoBackupRecovery({...f.args,archiveIdentity:'supabase:'+REF+':'+bucket}).createSnapshot({snapshotId:SID}),/BACKUP_NOT_CONFIGURED/);assert.equal(f.calls.list,0);assert.equal(f.calls.archiveWrites.length,0);
});
test('all paginated photos are copied, hashed, authenticated and read back before a complete snapshot is reported',async()=>{
 const f=fixture({options:{pageSize:1}}),r=await snapshot(f);assert.equal(r.verified,true);assert.equal(r.objectCount,2);assert.equal(r.totalBytes,8);assert.equal(r.cloudReady,false);assert.equal(r.releaseEnabled,false);assert.equal(f.calls.list,4);assert.equal(f.calls.archiveWrites.length,3);assert.equal(JSON.stringify(r).includes(SELLER),false);
 const writes=f.calls.archiveWrites.length,check=await verify(f,r);assert.equal(check.readOnly,true);assert.equal(f.calls.archiveWrites.length,writes);
});
test('new versions and deletion snapshots never remove older photo contents or manifests',async()=>{
 const f=fixture({count:1}),old=await snapshot(f);f.sourceFiles.set(A,{bytes:jpeg(8),version:'new',contentType:'image/jpeg'});const newer=await f.service.createSnapshot({snapshotId:SID2});assert.notEqual(old.manifestSha256,newer.manifestSha256);
 f.sourceFiles.clear();const empty=await f.service.createSnapshot({snapshotId:SID3});assert.equal(empty.objectCount,0);assert.equal((await verify(f,old)).verified,true);assert.equal((await verify(f,newer)).verified,true);assert.equal([...f.archiveFiles.keys()].filter(k=>k.includes('/objects/')).length,2);assert.equal([...f.archiveFiles.keys()].filter(k=>k.endsWith('/manifest.json')).length,3);
});
test('a lost upload response reconciles the same immutable key without a second write',async()=>{
 const f=fixture({count:1});f.hooks.archivePut=(i,files)=>{files.set(i.key,{bytes:Buffer.from(i.bytes),contentType:i.contentType});throw Error('Private provider details must not escape');};const r=await snapshot(f);assert.equal(r.verified,true);assert.equal(f.calls.archiveWrites.length,2);assert.equal(new Set(f.calls.archiveWrites.map(i=>i.key)).size,2);
 const count=f.calls.archiveWrites.length;f.hooks.list=()=>{throw Error('Source not available now');};const replay=await snapshot(f);assert.equal(replay.reused,true);assert.equal(replay.manifestSha256,r.manifestSha256);assert.equal(f.calls.archiveWrites.length,count);
});
test('unverified or corrupt writes do not publish a completed manifest or retry another key',async()=>{
 for(const kind of ['missing','corrupt']){const f=fixture({count:1});f.hooks.archivePut=(i,files)=>{if(kind==='corrupt')files.set(i.key,{bytes:jpeg(9),contentType:i.contentType});throw Error('secret upstream trace');};await assert.rejects(snapshot(f),error=>error.message==='IMMUTABLE_BACKUP_UNVERIFIED');assert.equal(f.calls.archiveWrites.length,1);assert.equal([...f.archiveFiles.keys()].some(k=>k.includes('/manifest.json')),false);}
});
test('source version, byte length and image-type changes block completion',async()=>{
 for(const kind of ['version','length','type','magic']){const f=fixture({count:1});f.hooks.sourceRead=()=>({version:kind==='version'?'changed':'v1',response:new Response(kind==='length'?jpeg(1).subarray(0,3):kind==='magic'?Buffer.from('fake'):jpeg(1),{headers:{'content-type':kind==='type'?'image/png':'image/jpeg'}})});await assert.rejects(snapshot(f));assert.equal(f.calls.archiveWrites.length,0);}
});
test('a changed inventory during the run leaves the partial blobs uncommitted',async()=>{
 const f=fixture({count:1});f.hooks.sourceRead=({sourceFiles})=>{const original=sourceFiles.get(A);sourceFiles.set(A,{...original,version:'v3'});return {version:'v1',response:new Response(original.bytes,{headers:{'content-type':'image/jpeg'}})};};await assert.rejects(snapshot(f),/SOURCE_INVENTORY_CHANGED/);assert.equal(f.calls.archiveWrites.length,1);assert.equal([...f.archiveFiles.keys()].some(k=>k.includes('/manifest.json')),false);
});
test('looping cursors, duplicates, traversal paths and inventory budgets are rejected before archive writes',async()=>{
 for(const kind of ['loop','duplicate','traversal','count','bytes']){
  const f=fixture({options:kind==='count'?{maxObjects:1}:kind==='bytes'?{maxTotalBytes:3}:{pageSize:1}});
  if(['loop','duplicate','traversal'].includes(kind))f.hooks.list=()=>({sourceIdentity:'supabase:'+REF+':listing-photos',checkedAt:NOW,items:[{path:kind==='traversal'?SELLER+'/'+LISTING+'/../a.jpg':A,version:'v1',size:4,contentType:'image/jpeg'}],nextCursor:kind==='traversal'?null:'again'});
  await assert.rejects(snapshot(f));assert.equal(f.calls.archiveWrites.length,0);
 }
});
test('archive policy must be fresh, private, independent and retain immutable versions',async()=>{
 for(const patch of [{private:false},{immutable:false},{deletePropagation:true},{retentionDays:6},{independentCredentialScope:false},{checkedAt:NOW-1},{identity:'other:archive'}]){const f=fixture();f.setProof(patch);await assert.rejects(snapshot(f),/PRIVATE_RETAINED_ARCHIVE_REQUIRED/);assert.equal(f.calls.sourceReads,0);assert.equal(f.calls.archiveWrites.length,0);}
 const f=fixture({count:2});f.hooks.inspect=(proof,calls)=>({...proof,private:calls.archiveWrites.length===0});await assert.rejects(snapshot(f),/PRIVATE_RETAINED_ARCHIVE_REQUIRED/);assert.equal(f.calls.archiveWrites.length,1);
});
test('manifest authentication, caller receipt and each stored photo checksum are independently required',async()=>{
 const f=fixture({count:1}),r=await snapshot(f);await assert.rejects(f.service.verifySnapshot({...r,manifestSha256:'a'.repeat(64)}),/MANIFEST_UNVERIFIED/);
 const key=[...f.archiveFiles.keys()].find(k=>k.endsWith('manifest.json')),saved=f.archiveFiles.get(key),forged=JSON.parse(saved.bytes);forged.manifest.entries[0].version='forged';forged.sha256=digest(JSON.stringify(forged.manifest));f.archiveFiles.set(key,{...saved,bytes:Buffer.from(JSON.stringify(forged))});await assert.rejects(verify(f,r),/MANIFEST_UNVERIFIED/);
 f.archiveFiles.set(key,saved);const blob=[...f.archiveFiles.keys()].find(k=>k.includes('/objects/'));f.archiveFiles.set(blob,{bytes:jpeg(4),contentType:'image/jpeg'});await assert.rejects(verify(f,r),/PHOTO_BACKUP_UNVERIFIED/);
});
test('cached archive/source evidence and overlong streams cannot establish a verified backup',async()=>{
 const f=fixture({count:1});f.hooks.sourceRead=()=>({version:'v1',response:new Response(jpeg(1),{headers:{'content-type':'image/jpeg',age:'1'}})});await assert.rejects(snapshot(f),/FRESH_BACKUP_EVIDENCE_REQUIRED/);
 const g=fixture({count:1});g.hooks.sourceRead=()=>({version:'v1',response:new Response(new ReadableStream({start(c){c.enqueue(jpeg(1));c.enqueue(jpeg(2));c.close();}}),{headers:{'content-type':'image/jpeg'}})});await assert.rejects(snapshot(g),/BACKUP_SIZE_LIMIT/);assert.equal(g.calls.archiveWrites.length,0);
});
test('restore drill verifies all backup objects before writing only to an isolated private prefix',async()=>{
 const f=fixture(),r=await snapshot(f),input={snapshotId:SID,manifestSha256:r.manifestSha256,drillId:DRILL,target:f.target};const d=await f.service.restoreDrill(input);assert.equal(d.isolatedRestoreVerified,true);assert.equal(d.productionRestoreEnabled,false);assert.equal(d.releaseEnabled,false);assert.equal(f.calls.restoreWrites.length,2);assert.ok(f.calls.restoreWrites.every(w=>w.path.startsWith('drills/'+DRILL+'/')));
 const count=f.calls.restoreWrites.length;await f.service.restoreDrill(input);assert.equal(f.calls.restoreWrites.length,count);
 const g=fixture(),gr=await snapshot(g);const blob=[...g.archiveFiles.keys()].filter(k=>k.includes('/objects/')).at(-1);g.archiveFiles.set(blob,{bytes:jpeg(4),contentType:'image/jpeg'});await assert.rejects(g.service.restoreDrill({snapshotId:SID,manifestSha256:gr.manifestSha256,drillId:DRILL,target:g.target}),/PHOTO_BACKUP_UNVERIFIED/);assert.equal(g.calls.restoreWrites.length,0);
});
test('production/public targets, missing or revoked authority and uncertain isolated writes never report a restored drill',async()=>{
 for(const patch of [{projectRef:REF},{private:false},{production:true},{bucket:'listing-photos'}]){const f=fixture({count:1}),r=await snapshot(f);f.setTarget(patch);await assert.rejects(f.service.restoreDrill({snapshotId:SID,manifestSha256:r.manifestSha256,drillId:DRILL,target:f.target}),/ISOLATED_RESTORE_TARGET_REQUIRED/);assert.equal(f.calls.restoreWrites.length,0);}
 const f=fixture(),r=await snapshot(f);f.hooks.authority=input=>({...input,authorized:f.calls.authority<5,checkedAt:NOW,expiresAt:NOW+60000});await assert.rejects(f.service.restoreDrill({snapshotId:SID,manifestSha256:r.manifestSha256,drillId:DRILL,target:f.target}),/ISOLATED_RESTORE_AUTHORITY_REQUIRED/);assert.equal(f.calls.restoreWrites.length,1);
 const g=fixture({count:1}),gr=await snapshot(g);g.hooks.restorePut=()=>{throw Error('uncertain');};await assert.rejects(g.service.restoreDrill({snapshotId:SID,manifestSha256:gr.manifestSha256,drillId:DRILL,target:g.target}),/RESTORE_DRILL_UNVERIFIED/);assert.equal(g.calls.restoreWrites.length,1);
});
test('timed-out inventory work cannot later continue to archive writes',async()=>{
 const f=fixture({options:{timeoutMs:5}});let release;f.hooks.list=()=>new Promise(resolve=>{release=()=>resolve({sourceIdentity:'supabase:'+REF+':listing-photos',checkedAt:NOW,items:[],nextCursor:null});});await assert.rejects(snapshot(f),/BACKUP_UNVERIFIED/);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.archiveWrites.length,0);
});
test('revocation during a missing-object target read blocks the subsequent restore write',async()=>{
 const f=fixture({count:1}),r=await snapshot(f);let revoked=false;
 f.hooks.authority=input=>({...input,authorized:!revoked,checkedAt:NOW,expiresAt:NOW+60000});
 const original=f.target.read;f.target.read=async input=>{const value=await original(input);revoked=true;return value;};
 await assert.rejects(f.service.restoreDrill({snapshotId:SID,manifestSha256:r.manifestSha256,drillId:DRILL,target:f.target}),/ISOLATED_RESTORE_AUTHORITY_REQUIRED/);assert.equal(f.calls.restoreWrites.length,0);
});
test('a restore grant expiring while target policy is checked cannot authorize a write',async()=>{
 let now=NOW;const f=fixture({count:1,options:{clock:()=>now}}),r=await snapshot(f);
 f.hooks.authority=input=>({...input,authorized:true,checkedAt:NOW,expiresAt:NOW+1});
 const original=f.target.inspect;f.target.inspect=async input=>{const value=await original(input);now=NOW+2;return value;};
 await assert.rejects(f.service.restoreDrill({snapshotId:SID,manifestSha256:r.manifestSha256,drillId:DRILL,target:f.target}),/ISOLATED_RESTORE_AUTHORITY_REQUIRED/);assert.equal(f.calls.restoreWrites.length,0);
});
test('an archive becoming public during a missing-object read blocks the subsequent backup write',async()=>{
 const f=fixture({count:1});f.hooks.archiveRead=({key})=>{if(key.includes('/objects/'))f.setProof({private:false});return null;};await assert.rejects(snapshot(f),/PRIVATE_RETAINED_ARCHIVE_REQUIRED/);assert.equal(f.calls.archiveWrites.length,0);
});
