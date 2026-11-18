'use strict';
// SOURCE ONLY. A signed operator-supplied enrollment is outside every Worker
// version/configuration. This verifier creates no key or external anchor.
const {createHash,createPublicKey,verify}=require('node:crypto');
const ROLES=Object.freeze(['caller','verifier','source','journal','gateway']);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DOMAIN='rack-relic/scoped-construction-v5/final-enrollment\n';
const fail=()=>{throw Error('V5_RUNTIME_ENROLLMENT_HELD');};
function copy(input){
 let nodes=0;
 function walk(x,depth){
  if(++nodes>4096||depth>16)fail();
  if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isSafeInteger(x))return x;
  if(typeof x==='string'){if(Buffer.byteLength(x)>65536)fail();return x;}
  if(!x||typeof x!=='object')fail();
  const descriptors=Object.getOwnPropertyDescriptors(x),keys=Reflect.ownKeys(x);
  if(keys.some(k=>typeof k!=='string')||Object.values(descriptors).some(p=>!Object.hasOwn(p,'value')))fail();
  if(Array.isArray(x)){
   if(keys.length!==x.length+1||keys.some(k=>k!=='length'&&(!/^(?:0|[1-9][0-9]*)$/.test(k)||Number(k)>=x.length))||keys.some(k=>k!=='length'&&descriptors[k].enumerable!==true))fail();
   return Object.freeze(Array.from({length:x.length},(_,i)=>walk(descriptors[String(i)].value,depth+1)));
  }
  if(Object.getPrototypeOf(x)!==Object.prototype||keys.some(k=>descriptors[k].enumerable!==true))fail();
  return Object.freeze(Object.fromEntries(keys.map(k=>[k,walk(descriptors[k].value,depth+1)])));
 }
 const result=walk(input,0);if(Buffer.byteLength(canonical(result))>65536)fail();return result;
}
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const sha=x=>typeof x==='string'&&SHA.test(x)&&x!=='0'.repeat(64);
const uuid=x=>typeof x==='string'&&UUID.test(x)&&x!=='00000000-0000-0000-0000-000000000000';
function reviewerKey(record){
 if(!exact(record,['keyId','spkiBase64'])||!sha(record.keyId)||typeof record.spkiBase64!=='string')fail();
 const der=Buffer.from(record.spkiBase64,'base64');
 if(der.length!==44||der.toString('base64')!==record.spkiBase64||der.subarray(0,12).toString('hex')!=='302a300506032b6570032100'||createHash('sha256').update(der).digest('hex')!==record.keyId)fail();
 const key=createPublicKey({key:der,format:'der',type:'spki'});if(key.asymmetricKeyType!=='ed25519')fail();return key;
}
function verifyV5RuntimeEnrollment(input){
 const {root,executionAcceptance:a,packetSha256,reviewerKey:r,enrollment:e,now}=copy(input);
 if(!root||!a||!a.constructionProfile||!Array.isArray(a.participants)||a.participants.length!==5||!Number.isSafeInteger(now)||!sha(packetSha256)||r?.keyId!==a.constructionProfile.reviewerKeyId||r?.keyId===root.collectorKey?.keyId)fail();
 if(!exact(e,['algorithm','keyId','payload','signature'])||e.algorithm!=='Ed25519'||e.keyId!==r.keyId||typeof e.signature!=='string')fail();
 const signature=Buffer.from(e.signature,'base64');
 if(signature.length!==64||signature.toString('base64')!==e.signature||!verify(null,Buffer.from(DOMAIN+canonical(e.payload)),reviewerKey(r),signature))fail();
 const p=e.payload;
 if(!exact(p,['version','rootSha256','acceptanceSha256','packetSha256','ownerExecutionDecisionSha256','constructionReviewSha256','custodyReviewSha256','issuedAt','expiresAt','runtimeVersions'])||p.version!=='rr-backup-final-runtime-enrollment-v5'||p.rootSha256!==digest(root)||p.acceptanceSha256!==digest(a)||p.acceptanceSha256!==root.acceptanceSha256||p.packetSha256!==packetSha256||p.ownerExecutionDecisionSha256!==a.ownerExecutionDecisionSha256||p.constructionReviewSha256!==a.constructionProfile.reviewSha256||p.custodyReviewSha256!==a.constructionProfile.custodyReviewSha256)fail();
 if(!Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||p.issuedAt<a.acceptedAt||p.issuedAt>now||p.expiresAt<=now||p.expiresAt<=p.issuedAt||p.expiresAt>a.expiresAt||p.expiresAt-p.issuedAt>86400000||!Array.isArray(p.runtimeVersions)||p.runtimeVersions.length!==5)fail();
 const observed=a.participants.map((profile,index)=>{
  const runtime=p.runtimeVersions[index];
  if(!exact(runtime,['role','workerId','deploymentId','versionId','moduleSha256','runtimeReadbackEvidenceSha256'])||profile.role!==ROLES[index]||runtime.role!==profile.role||runtime.workerId!==profile.workerId||!uuid(runtime.deploymentId)||!uuid(runtime.versionId)||runtime.moduleSha256!==profile.module?.sha256||!sha(runtime.runtimeReadbackEvidenceSha256))fail();
  return Object.freeze({...profile,deploymentId:runtime.deploymentId,versions:Object.freeze([Object.freeze({versionId:runtime.versionId,percentage:100})])});
 });
 return Object.freeze({kind:'rr-final-runtime-enrollment-binding-v5',enrollmentSha256:digest(e),expiresAt:p.expiresAt,observedParticipants:Object.freeze(observed),providerSecretValuesRead:false,providerObservedByThisFunction:false});
}
module.exports=Object.freeze({verifyV5RuntimeEnrollment,V5_ENROLLMENT_DOMAIN:DOMAIN,copyV5ConstructionData:copy,canonicalV5Construction:canonical,digestV5Construction:digest});
