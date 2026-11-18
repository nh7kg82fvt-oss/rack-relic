'use strict';
// Server-only configuration boundary. No provider I/O, env discovery or fallback.
const {createHash}=require('node:crypto');
const FIXED=Object.freeze({projectRef:'xkxolhgafjadpknsfqqw',projectUrl:'https://xkxolhgafjadpknsfqqw.supabase.co',vercelProjectId:'prj_XO9ADzBydcq45PHSQHX9v23GPCri',branch:'codex/recovery-readiness-20261117',origin:'https://rack-relic-git-codex-recovery-readiness-20261117-rack-relic.vercel.app',maxWindowMs:900000,maxProfileBytes:4096});
const ENV=Object.freeze({enabled:'RACK_RECOVERY_ENABLED',profile:'RACK_RECOVERY_PROFILE',serverSecret:'RACK_RECOVERY_SERVER_SECRET'});
const FIELDS=Object.freeze(['version','projectRef','ownerId','email','origin','branch','revision','notBefore','expiresAt','reviewRef','publishableKey']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function ownString(o,k,max){const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||d.value.length>max)return null;return d.value;}
function exact(o,keys){return o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(o,k);return d?.enumerable&&Object.hasOwn(d,'value');});}
function loadRecoveryComposition({environment=process.env,clock=Date.now}={}){
 try{
  if(!environment||typeof clock!=='function'||ownString(environment,ENV.enabled,5)!=='true')return null;
  if(ownString(environment,'VERCEL_ENV',32)!=='preview'||ownString(environment,'VERCEL_PROJECT_ID',100)!==FIXED.vercelProjectId||ownString(environment,'VERCEL_GIT_COMMIT_REF',100)!==FIXED.branch)return null;
  const raw=ownString(environment,ENV.profile,FIXED.maxProfileBytes);
  if(raw===null||Buffer.byteLength(raw,'utf8')>FIXED.maxProfileBytes)return null;
  const p=JSON.parse(raw);
  // Canonical JSON also rejects duplicate properties and non-plain/extra fields.
  if(!exact(p,FIELDS)||JSON.stringify(p)!==raw||p.version!=='rr-recovery-private-profile-v1'||p.projectRef!==FIXED.projectRef||p.origin!==FIXED.origin||p.branch!==FIXED.branch)return null;
  if(!UUID.test(p.ownerId||'')||p.ownerId==='00000000-0000-0000-0000-000000000000'||typeof p.email!=='string'||p.email.length>254||!/^\S+@\S+\.\S+$/.test(p.email)||p.email!==p.email.trim().toLowerCase())return null;
  if(typeof p.revision!=='string'||!/^[a-f0-9]{40}$/.test(p.revision)||ownString(environment,'VERCEL_GIT_COMMIT_SHA',40)!==p.revision||typeof p.reviewRef!=='string'||!/^rr-review-[A-Za-z0-9_-]{8,100}$/.test(p.reviewRef))return null;
  const now=clock();
  if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(p.notBefore)||!Number.isSafeInteger(p.expiresAt)||p.notBefore<=0||p.expiresAt<=p.notBefore||p.expiresAt-p.notBefore>FIXED.maxWindowMs||now<p.notBefore||now>=p.expiresAt)return null;
  const serverKey=ownString(environment,ENV.serverSecret,210);
  if(!/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(serverKey||'')||typeof p.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(p.publishableKey))return null;
  const enrollment=Object.freeze({version:'rr-recovery-host-enrollment-v1',projectUrl:FIXED.projectUrl,ownerId:p.ownerId,origin:FIXED.origin,branch:FIXED.branch,revision:p.revision,notBefore:p.notBefore,expiresAt:p.expiresAt,reviewRef:p.reviewRef});
  const deployment=Object.freeze({kind:'preview',projectUrl:FIXED.projectUrl,origin:FIXED.origin,branch:FIXED.branch,revision:p.revision,protection:'vercel-authentication'});
  const browser=Object.freeze({enabled:true,enrollment:Object.freeze({version:'rr-recovery-coordinator-v1',projectRef:FIXED.projectRef,ownerId:p.ownerId,email:p.email,origin:FIXED.origin,branch:FIXED.branch,revision:p.revision,notBefore:p.notBefore,expiresAt:p.expiresAt}),publishableKey:p.publishableKey});
  if(JSON.stringify(browser).includes(serverKey))return null;
  const fingerprint=createHash('sha256').update(raw).update('\n').update(serverKey).digest('hex');
  return Object.freeze({fingerprint,host:Object.freeze({enabled:true,enrollment,deployment,serverKey}),browser});
 }catch{return null;}
}
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' "+FIXED.projectUrl+"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const HEADERS=Object.freeze({'Cache-Control':'private, no-store, max-age=0, no-transform','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','X-Frame-Options':'DENY','Content-Security-Policy':CSP});
function headers(res,type){for(const[k,v]of Object.entries(HEADERS))res.setHeader(k,v);if(type)res.setHeader('Content-Type',type);}
function bootstrapRequestStatus(req){
 try{
  if(req.url!=='/api/recovery-bootstrap'||req.headers?.host!==new URL(FIXED.origin).host||req.headers.origin!==undefined&&req.headers.origin!==FIXED.origin||req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return 404;
  if(req.method!=='GET')return 405;
  if(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'||req.headers['transfer-encoding']!==undefined)return 400;
  if('body'in req){const d=Object.getOwnPropertyDescriptor(req,'body');if(!d||!Object.hasOwn(d,'value')||d.value!==undefined)return 400;}
  return 200;
 }catch{return 400;}
}
module.exports={FIXED,ENV,FIELDS,CSP,HEADERS,exact,loadRecoveryComposition,headers,bootstrapRequestStatus};
