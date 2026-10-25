/* Startup diagnostic only: no Auth client, email entry, session write or retry. */
(async()=>{
'use strict';
const ORIGIN='https://rack-relic-git-preview-photo-delivery-boundary-rack-relic.vercel.app';
const STAGE='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
if(location.origin!==ORIGIN||location.pathname!=='/404.html'||location.search||window.RRPreviewAuth)return {status:'not-installed-retire-old-document-first'};
if(location.hash){try{history.replaceState(null,'',ORIGIN+'/404.html')}catch{}return {status:'diagnostic-callback-disabled'};}
let blockedRequest=null,reason=null,state='startup-diagnostic-loading';const phase='startup-diagnostic';
let role=null,recordedEmailAttempts=null,recordedAuthRequests=null,ledgerState='unreadable';
try{const raw=localStorage.getItem('rr-preview-auth-bootstrap-v1');ledgerState=raw===null?'absent':'present';if(raw!==null){const m=JSON.parse(raw);if(m.role==='buyer'||m.role==='seller')role=m.role;if(Number.isInteger(m.emailAttempts)&&m.emailAttempts>=0&&m.emailAttempts<=2)recordedEmailAttempts=m.emailAttempts;if(Number.isInteger(m.requests)&&m.requests>=0&&m.requests<=8)recordedAuthRequests=m.requests;}}catch{}
function status(){const value={status:state,reason,diagnosticOnly:true,blockedRequest,role,recordedEmailAttempts,recordedAuthRequests,ledgerState,diagnosticAuthRequests:0,diagnosticEmails:0,sessionWrites:0,historicalTrafficVerified:false};const target=document.getElementById?.('preview-auth-status');if(target)target.textContent='Startup diagnostic only: '+state+'. No sign-in request is enabled.';return value}
function safeRequestLocation(input){
 try{
  const raw=typeof input==='string'?input:input instanceof URL?String(input):input?.url;
  if(typeof raw!=='string')return {host:'unclassified',path:'unclassified'};
  const url=new URL(raw,ORIGIN);
  const hosts=new Set([new URL(ORIGIN).hostname,new URL(STAGE).hostname,'vercel.live','vercel.com','cdn.jsdelivr.net']);
  if(!['https:','http:'].includes(url.protocol)||!hosts.has(url.hostname))return {host:'unclassified',path:'redacted'};
  const exact=new Set(['/404.html','/preview-auth-bootstrap.js','/staging-config.js','/favicon.ico','/auth/v1/otp','/auth/v1/user','/auth/v1/token','/auth/v1/signup','/auth/v1/logout','/auth/v1/verify']);
  if(exact.has(url.pathname))return {host:url.hostname,path:url.pathname};
  const parts=new Set(['api','live','state','toolbar','feedback','feedback.js','favicon.ico','_next','_next-live','_vercel','insights','speed-insights','script.js','reload','config','flags','init','notifications','activity','deployment','v1','v2','v3','auth','user','token','verify','otp','session','ping','health','register','events','stream']);
  return {host:url.hostname,path:url.pathname.split('/').map(part=>part===''?'':parts.has(part)?part:'<redacted>').join('/')};
 }catch{return {host:'unclassified',path:'redacted'}}
}
function captureBlocked(input,options){
 if(blockedRequest)return;
 let method='UNKNOWN';try{const m=String(options?.method||input?.method||'GET').toUpperCase();if(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(m))method=m}catch{}
 const initiators=[];
 for(const raw of (new Error('blocked request').stack||'').match(/https?:\/\/[^\s)]+/g)||[]){
  const item=safeRequestLocation(raw.replace(/:\d+:\d+$/,''));
  if(item.host!=='unclassified'&&item.path!=='/preview-auth-bootstrap.js'&&!initiators.some(x=>x.host===item.host&&x.path===item.path))initiators.push(item);
 }
 blockedRequest={time:new Date().toISOString(),method,...safeRequestLocation(input),initiators:initiators.slice(0,3),phase,nativeFetchInvoked:false};
}

window.fetch=async(input,options)=>{captureBlocked(input,options);reason=reason||'unexpected-background-fetch';state='stopped';status();throw Error('PREVIEW_STARTUP_REQUEST_BLOCKED')};
for(const name of ['XMLHttpRequest','WebSocket','EventSource'])window[name]=class{constructor(){reason=reason||'unexpected-network';state='stopped';status();throw Error('PREVIEW_STARTUP_REQUEST_BLOCKED')}};
Object.defineProperty(navigator,'sendBeacon',{configurable:true,value:()=>{reason=reason||'unexpected-network';state='stopped';status();return false}});
window.RRPreviewAuth=Object.freeze({status,start:async()=>({...status(),status:'diagnostic-only-auth-disabled'})});
window.RRPreviewBlockedFetch=Object.freeze({get:()=>blockedRequest?JSON.parse(JSON.stringify(blockedRequest)):null});
async function asset(src){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('STARTUP_ASSET_UNAVAILABLE'));document.head.append(s)})}
try{await asset('/staging-config.js');const c=window.RACK_RELIC_STAGING_CONFIG;if(c?.url!==STAGE||typeof c.publicKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publicKey))throw Error('CONFIG_UNAVAILABLE');await asset('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');if(!reason)state='startup-diagnostic-ready';}
catch{reason=reason||'startup-assets-unavailable';state='stopped'}
return status();
})()
