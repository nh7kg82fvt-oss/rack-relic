'use strict';
// Read-only public HTTP checks. No account token, cookies, messages or database writes.
const origin=process.argv[2]||'https://www.rackrelic.com';
const target=new URL(origin);if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error('Use one HTTPS site origin');
const checks=[['/','Rack Relic'],['/shop','Marketplace preview'],['/sell/new','listing-name'],['/account','account-status'],['/messages','message-status'],['/reports','report'],['/support','Checkout'],['/seller-guide','six photos'],['/safety','Do not send money'],['/privacy','Rack Relic LLC'],['/community-guidelines','Checkout is disabled'],['/manifest.webmanifest','Payments are not enabled']];
(async()=>{
 let failed=0;
 for(const [path,expected] of checks){
  try{
   const response=await fetch(new URL(path,target),{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(response.status!==200)throw Error('HTTP '+response.status);
   const type=response.headers.get('content-type')||'';if(!/text\/html|application\/(?:manifest\+)?json/.test(type))throw Error('Unexpected content type');
   const text=await response.text();if(!text.includes(expected))throw Error('Expected preview content missing');
   if(path==='/'&&(!text.includes('Demo — not for sale')||!text.includes('Buy — available at launch')))throw Error('Demo or closed-checkout notice missing');
   if(path.startsWith('/policies')||['/privacy','/community-guidelines'].includes(path)){if(/clearchoicepayments|Clear Choice Payments/i.test(text))throw Error('Company separation check failed');}
   console.log('PASS '+path);
  }catch(e){failed++;console.log('FAIL '+path+' — '+e.message);}
 }
 console.log(`${checks.length-failed}/${checks.length} public browsing checks passed. No signed-in or database-write checks were performed.`);process.exitCode=failed?1:0;
})().catch(()=>{console.error('Public site check failed');process.exitCode=1;});
