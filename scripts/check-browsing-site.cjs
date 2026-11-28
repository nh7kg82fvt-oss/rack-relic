'use strict';
// Public GETs only: no cookies, account tokens, forms or database writes.
const checks=[['/','Rack Relic'],['/shop','Marketplace preview'],['/sell/new','listing-name'],['/account','account-status'],['/messages','message-status'],['/reports','report'],['/support','Checkout'],['/seller-guide','six photos'],['/safety','Do not send money'],['/privacy','Rack Relic LLC'],['/community-guidelines','Checkout is disabled'],['/manifest.webmanifest','Payments are not enabled']];
const maxBytes=2*1024*1024;
function siteOrigin(origin){
 const target=new URL(origin);
 if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error('Use one HTTPS site origin');
 return target;
}
function validatePage(path,text,type){
 const expected=checks.find(c=>c[0]===path)?.[1];
 const manifest=path==='/manifest.webmanifest';
 if(!(manifest?/^application\/(?:manifest\+)?json\b/i:/^text\/html\b/i).test(type))throw Error('Unexpected content type');
 if(!expected||!text.includes(expected))throw Error('Expected preview content missing');
 if(manifest){const data=JSON.parse(text);if(!data.name||!data.start_url)throw Error('Incomplete web manifest');}
 if(path==='/'){
  const cards=[...text.matchAll(/<article\b[^>]*class="item"[^>]*data-demo-description="([^"]+)"/g)];
  if(cards.length!==12||cards.some(c=>!c[1].startsWith('Fictional')))throw Error('Fictional demo inventory labels missing');
  if(!text.includes('Demo — not for sale')||!text.includes('Buy — available at launch'))throw Error('Demo or closed-checkout notice missing');
  // Check the source guard too; a notice alone does not disable a control.
  if(!/buy\.disabled\s*=\s*true/.test(text)||/buy\.disabled\s*=\s*false/.test(text))throw Error('Closed-checkout button guard missing');
 }
 if(['/privacy','/community-guidelines'].includes(path)&&/clearchoicepayments|Clear Choice Payments/i.test(text))throw Error('Company separation check failed');
}
function scriptPaths(html,target){
 const paths=new Set();
 for(const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)){
  const url=new URL(match[1],target);
  // External libraries are outside this bounded, same-origin monitor.
  if(url.origin===target.origin){
   if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('.js'))throw Error('Unexpected local script URL');
   paths.add(url.pathname);
  }
 }
 if(!paths.has('/navigation.js'))throw Error('Navigation script missing');
 if(paths.size>20)throw Error('Too many public scripts to check');
 return [...paths];
}
async function readPublic(url,fetchImpl){
 const response=await fetchImpl(url,{redirect:'manual',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
 if(response.status!==200)throw Error('HTTP '+response.status);
 const reader=response.body?.getReader();if(!reader)throw Error('Missing response body');
 let bytes=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('Response exceeds public-check size limit');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel();}
 return {text,type:response.headers.get('content-type')||''};
}
async function run(origin,{fetchImpl=fetch,log=console.log}={}){
 const target=siteOrigin(origin);let failed=0,home=null;
 for(const [path] of checks){try{const {text,type}=await readPublic(new URL(path,target),fetchImpl);validatePage(path,text,type);if(path==='/')home=text;log('PASS '+path);}catch(e){failed++;log('FAIL '+path+' — '+e.message);}}
 let assets=0;
 if(home!==null){
  try{const paths=scriptPaths(home,target);assets=paths.length;
   for(const path of paths){try{const {text,type}=await readPublic(new URL(path,target),fetchImpl);if(!/^(?:text|application)\/(?:javascript|x-javascript|ecmascript)\b/i.test(type)||!text.trim())throw Error('Missing JavaScript asset');log('PASS asset '+path);}catch(e){failed++;log('FAIL asset '+path+' — '+e.message);}}
  }catch(e){failed++;log('FAIL script inventory — '+e.message);}
 }
 log(`${checks.length} public routes and ${assets} local scripts checked; ${failed} failures. No signed-in or database-write checks were performed.`);
 return failed;
}
module.exports={checks,siteOrigin,validatePage,scriptPaths,readPublic,run};
if(require.main===module)run(process.argv[2]||'https://www.rackrelic.com').then(failed=>{process.exitCode=failed?1:0;}).catch(e=>{console.error('Public site check failed: '+e.message);process.exitCode=1;});
