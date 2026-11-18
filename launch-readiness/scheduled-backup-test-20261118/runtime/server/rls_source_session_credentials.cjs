'use strict';
// NODE-ONLY construction preflight. Decoding JWT claims verifies NO signature,
// principal provenance or RLS grant. Supabase S3 must authenticate/enforce them.
const {createHash}=require('node:crypto');
const REF='tzymapahsfiyhgilsmxl',BUCKET='listing-photos',ISSUER='https://'+REF+'.supabase.co/auth/v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const FIELDS=['version','projectRef','bucket','dedicatedPrincipalId','issuer','audience','purpose','bucketPrivate','selectPolicySha256','mutationDenyPolicySha256','otherPrivilegesReviewSha256','ownerAuthorizationSha256','reviewedAt','expiresAt'];
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const grantSha256=x=>createHash('sha256').update(canonical(x)).digest('hex');
const fail=()=>{throw Error('RLS_SOURCE_SESSION_HELD');};
function plainData(x,fields){if(!x||Object.getPrototypeOf(x)!==Object.prototype||Reflect.ownKeys(x).length!==fields.length||fields.some(k=>{const d=Object.getOwnPropertyDescriptor(x,k);return !d||!Object.hasOwn(d,'value')||!d.enumerable;}))fail();return x;}
function jwt(value){
 if(typeof value!=='string'||value.length>16384||!value.length)fail();const parts=value.split('.');if(parts.length!==3)fail();
 const decoded=parts.map((p,i)=>{if(!/^[A-Za-z0-9_-]+$/.test(p))fail();const b=Buffer.from(p,'base64url');if(b.toString('base64url')!==p||b.length>(i===0?1024:i===1?8192:1024))fail();return b;});
 const h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded[0])),p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded[1]));
 if(!h||Object.getPrototypeOf(h)!==Object.prototype||!['HS256','ES256','RS256','EdDSA'].includes(h.alg)||h.typ!==undefined&&h.typ!=='JWT'||!p||Object.getPrototypeOf(p)!==Object.prototype)fail();return p;
}
function createRlsSourceSessionCredentials({dedicatedPrincipalId=null,legacyAnonKey=null,userAccessToken=null,principalGrant=null,expectedGrantSha256=null}={}){
 let grant,anon,session;
 try{
  if(typeof dedicatedPrincipalId!=='string'||!UUID.test(dedicatedPrincipalId)||dedicatedPrincipalId==='00000000-0000-0000-0000-000000000000'||typeof expectedGrantSha256!=='string'||!SHA.test(expectedGrantSha256))fail();
  plainData(principalGrant,FIELDS);grant=Object.freeze(Object.fromEntries(FIELDS.map(k=>[k,principalGrant[k]])));
  if(grant.version!=='rr-rls-source-principal-grant-v1'||grant.projectRef!==REF||grant.bucket!==BUCKET||grant.dedicatedPrincipalId!==dedicatedPrincipalId||grant.issuer!==ISSUER||grant.audience!=='authenticated'||grant.purpose!=='dedicated-machine-storage-select-only'||grant.bucketPrivate!==true||!Number.isSafeInteger(grant.reviewedAt)||!Number.isSafeInteger(grant.expiresAt)||['selectPolicySha256','mutationDenyPolicySha256','otherPrivilegesReviewSha256','ownerAuthorizationSha256'].some(k=>typeof grant[k]!=='string'||!SHA.test(grant[k])||grant[k]==='0'.repeat(64))||grantSha256(grant)!==expectedGrantSha256)fail();
  anon=jwt(legacyAnonKey);session=jwt(userAccessToken);
  if(anon.role!=='anon'||anon.ref!==REF||anon.iss!=='supabase'||session.sub!==dedicatedPrincipalId||session.iss!==ISSUER||session.aud!=='authenticated'||session.role!=='authenticated'||session.is_anonymous===true)fail();
 }catch{return null;}
 function check(now){
  const seconds=Math.floor(now/1000);if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(grant.reviewedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.reviewedAt>now||grant.expiresAt<=now||grant.expiresAt-grant.reviewedAt>86400000||!Number.isSafeInteger(anon.exp)||anon.exp<=seconds||!Number.isSafeInteger(session.iat)||session.iat>seconds+1||!Number.isSafeInteger(session.exp)||session.exp<=seconds||session.exp<=session.iat||session.exp-session.iat>3600||session.nbf!==undefined&&(!Number.isSafeInteger(session.nbf)||session.nbf>seconds))fail();return now;
 }
 // Credentials are opaque provider inputs. No scopeVerified/authorized outcome.
 return Object.freeze({accessKeyId:REF,secretAccessKey:legacyAnonKey,sessionToken:userAccessToken,check});
}
module.exports={createRlsSourceSessionCredentials,rlsSourceGrantSha256:grantSha256};
