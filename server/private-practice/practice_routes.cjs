'use strict';
// Only the fixed new practice fields are considered. Import performs no I/O.
const fs=require('node:fs'),path=require('node:path');
const {createPracticeHostFromConfig,NAMES:HOST_NAMES}=require('./practice_host_config.cjs');
const {createPracticeRefundHostFromConfig}=require('./refund_host_config.cjs');
const ORIGIN='https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app',BRANCH='codex/prelaunch-seller-protections',PAGE='/api/payment-tax-practice-page',PROJECT='https://tzymapahsfiyhgilsmxl.supabase.co',ACCOUNT='acct_1UXdWBGppSOhWnq8';
const CONNECTION=Object.freeze(['RACK_RELIC_TEST_SUPABASE_URL','RACK_RELIC_TEST_STRIPE_ACCOUNT','RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY','RACK_RELIC_TEST_SUPABASE_SERVER_KEY']);
const PURCHASE_NAMES=Object.freeze([...HOST_NAMES.filter(n=>!['RACK_PRACTICE_SUPABASE_PUBLISHABLE_KEY','RACK_PRACTICE_SUPABASE_SERVER_KEY'].includes(n)),...CONNECTION]);
function namedConfiguration(config){
 const values={};try{const read=name=>{if(config===undefined)return process.env[name];const d=Object.getOwnPropertyDescriptor(config,name);if(d===undefined)return undefined;if(!Object.hasOwn(d,'value')||typeof d.value!=='string')throw Error();return d.value;};values.RACK_PRACTICE_ENABLED=read('RACK_PRACTICE_ENABLED');if(values.RACK_PRACTICE_ENABLED!=='true')return values;values.VERCEL_ENV=read('VERCEL_ENV');values.VERCEL_GIT_COMMIT_REF=read('VERCEL_GIT_COMMIT_REF');if(values.VERCEL_ENV!=='preview'||values.VERCEL_GIT_COMMIT_REF!==BRANCH)return values;if(read(CONNECTION[0])!==PROJECT||read(CONNECTION[1])!==ACCOUNT)return{};for(const name of PURCHASE_NAMES){if(Object.hasOwn(values,name)||CONNECTION.includes(name))continue;const value=read(name);if(typeof value==='string')values[name]=value;}values.RACK_PRACTICE_SUPABASE_PUBLISHABLE_KEY=read(CONNECTION[2]);values.RACK_PRACTICE_SUPABASE_SERVER_KEY=read(CONNECTION[3]);return values;}catch{return{};}
}
const REFUND_NAMES=Object.freeze(['RACK_PRACTICE_REFUND_ENABLED','RACK_PRACTICE_REFUND_PLAN_JSON','RACK_PRACTICE_STRIPE_REFUND_KEY','RACK_PRACTICE_STRIPE_REVERSAL_KEY']);
const NAMES=Object.freeze([...PURCHASE_NAMES,...REFUND_NAMES]);
function refundConfiguration(config){
 const values={};try{const read=name=>{if(config===undefined)return process.env[name];const d=Object.getOwnPropertyDescriptor(config,name);if(d===undefined)return undefined;if(!Object.hasOwn(d,'value')||typeof d.value!=='string')throw Error();return d.value;};if(read('RACK_PRACTICE_ENABLED')!=='true'||read('RACK_PRACTICE_REFUND_ENABLED')!=='true')return values;values.RACK_PRACTICE_REFUND_ENABLED='true';values.VERCEL_ENV=read('VERCEL_ENV');values.VERCEL_GIT_COMMIT_REF=read('VERCEL_GIT_COMMIT_REF');if(values.VERCEL_ENV!=='preview'||values.VERCEL_GIT_COMMIT_REF!==BRANCH||read(CONNECTION[0])!==PROJECT||read(CONNECTION[1])!==ACCOUNT)return{};for(const name of ['RACK_PRACTICE_REFUND_PLAN_JSON','RACK_PRACTICE_STRIPE_READ_KEY','RACK_PRACTICE_STRIPE_REFUND_KEY','RACK_PRACTICE_STRIPE_REVERSAL_KEY']){const value=read(name);if(typeof value==='string')values[name]=value;}values.RACK_PRACTICE_SUPABASE_PUBLISHABLE_KEY=read(CONNECTION[2]);values.RACK_PRACTICE_SUPABASE_SERVER_KEY=read(CONNECTION[3]);return values;}catch{return{};}
}
function createPracticeRoutes({config,local={}}={}){
 let host=null,refundHost=null,closed=false,expiresAt=0;
 function current(){if(closed)return null;if(host===null){const values=namedConfiguration(config);host=createPracticeHostFromConfig(values,local);if(host.ready===true)try{expiresAt=JSON.parse(values.RACK_PRACTICE_PROFILE_JSON).expiresAt;}catch{expiresAt=0;}}return host;}
 function deny(res,code=404){res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('CDN-Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.statusCode=code;res.end(code===405?'Method not allowed':'Not found');}
 async function api(req,res){const h=current();if(h===null)return createPracticeHostFromConfig()(req,res);return h(req,res);}
 async function refund(req,res){if(closed)return createPracticeRefundHostFromConfig()(req,res);if(refundHost===null)refundHost=createPracticeRefundHostFromConfig(refundConfiguration(config),local);return refundHost(req,res);}
 async function page(req,res){
  let u;try{u=new URL(req.url,ORIGIN);}catch{deny(res);return;}
  if(u.origin!==ORIGIN||u.pathname!==PAGE||u.search||u.hash||req.headers?.host!==new URL(ORIGIN).host||req.headers?.origin!==undefined&&req.headers.origin!==ORIGIN||req.headers?.['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])){deny(res);return;}
  const h=current();if(h===null||h.ready!==true||!Number.isSafeInteger(expiresAt)||(local.clock??Date.now)()>=expiresAt){deny(res);return;}if(req.method!=='GET'){deny(res,405);return;}
  let html;try{html=fs.readFileSync(path.join(__dirname,'payment-tax-practice.html'));}catch{deny(res);return;}
  for(const[k,v]of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(k,v);
  res.statusCode=200;res.end(html);
 }
 function close(){closed=true;host?.close();refundHost?.close();host=null;refundHost=null;}
 return Object.freeze({api,page,refund,close});
}
const defaults=createPracticeRoutes();
module.exports={createPracticeRoutes,api:defaults.api,page:defaults.page,refund:defaults.refund,PAGE,NAMES};
