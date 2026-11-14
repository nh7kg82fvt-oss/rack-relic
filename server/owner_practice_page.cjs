'use strict';
const {createHash}=require('node:crypto');
const {TEST_ENVIRONMENTS}=require('./test_environment_registry.cjs');
const ENV=TEST_ENVIRONMENTS.acceptance,PATH='/api/test-marketplace';
const ACTIONS=Object.freeze(['observe','refresh']);
const SCRIPT=`'use strict';
(()=>{
 const forms=Array.from(document.querySelectorAll('form[data-seller-action]'));
 const note=document.getElementById('action-status');
 let stale=false;
 function hold(message){stale=true;for(const form of forms){form.querySelector('button').disabled=true;form.reset();}note.textContent=message;}
 for(const form of forms){form.addEventListener('submit',event=>{
  if(stale||document.documentElement.dataset.actions!=='connected'){event.preventDefault();hold('Seller actions are held. Reopen this page from Rack Command.');return;}
  stale=true;for(const row of forms)row.querySelector('button').disabled=true;
  note.textContent='Checking the current sign-in and setup. No result is confirmed yet.';
 });}
 window.addEventListener('pagehide',()=>hold('This page is no longer current. Reopen it from Rack Command.'));
 window.addEventListener('pageshow',event=>{if(event.persisted)hold('This saved page is no longer current. Reopen it from Rack Command.');});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')hold('This page is no longer current. Reopen it from Rack Command.');});
})();`;
const STYLE=`:root{font-family:system-ui,sans-serif;color:#1f2520;background:#f4f4ed}body{margin:0;padding:32px 20px}main{max-width:650px;margin:0 auto;background:#fff;padding:32px;border:1px solid #d9ddd3;border-radius:14px}h1{font-size:1.7rem;line-height:1.2}p{line-height:1.55}.label{font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#52604e}.hold{border-left:4px solid #9c8655;background:#faf7ee;padding:14px 18px}form{margin:16px 0}button,a{font:inherit}button{padding:11px 17px;border:1px solid #53634f;border-radius:7px;background:#263b29;color:white}button:disabled{background:#eceee8;color:#646c60;border-color:#c8cec2}a{color:#294b2f}.small{font-size:.9rem;color:#50594e}`;
const digest=value=>createHash('sha256').update(value).digest('base64');
const CSP="default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.stripe.com; connect-src 'none'; script-src 'sha256-"+digest(SCRIPT)+"'; style-src 'sha256-"+digest(STYLE)+"'";
function html(connected,held=false){
 const disabled=connected&&!held?'':' disabled';
 return '<!doctype html><html lang="en" data-actions="'+(connected&&!held?'connected':'held')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional seller setup review | Rack Relic</title><style>'+STYLE+'</style></head><body><main><p class="label">Rack Relic · owner practice</p><h1>Review fictional seller setup</h1><p>This is an owner-operated fictional rehearsal. It does not confirm a real seller’s identity, eligibility or acceptance of seller terms.</p><p>Returning from Stripe does not confirm verification. The current owner sign-in, original account and provider evidence still need to be checked.</p><div class="hold"><strong>Payments remain closed.</strong><p>This page has not checked seller readiness, created an account or created a setup link.</p></div><p id="action-status" role="status" aria-live="polite">'+(held?'This action is held. No successful result is confirmed.':connected?'Choose an action to check the current owner sign-in and fictional setup.':'Seller actions are held while the owner sign-in and setup route is being reviewed.')+'</p><form method="post" action="'+PATH+'" data-seller-action><input type="hidden" name="action" value="observe"><button type="submit"'+disabled+'>Check fictional setup</button></form><form method="post" action="'+PATH+'" data-seller-action><input type="hidden" name="action" value="refresh"><button type="submit"'+disabled+'>Get a fresh setup link</button></form><p class="small">A fresh link is only for the original known fictional account. It does not create a replacement account or accept any terms.</p><p><a href="/api/command-center">Return to Rack Command</a></p></main><script>'+SCRIPT+'</script></body></html>';
}
function send(res,status,value){res.statusCode=status;res.end(value);}
function adapters(value){
 if(value===null)return null;
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==ACTIONS.length)return null;
 const copy={};for(const key of ACTIONS){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable||typeof descriptor.value!=='function')return null;copy[key]=descriptor.value;}
 return Object.freeze(copy);
}
// The optional POST handlers are trusted server adapters, not authentication
// proved by a function signature. There is no adapter implementation here.
function createClosedSellerReturnView({enabled=false,postActions=null}={}){
 const actions=adapters(postActions),connected=actions!==null;
 async function handler(req,res){
  for(const [key,value] of Object.entries({'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP}))res.setHeader(key,value);
  if(enabled!==true){send(res,404,'Not found');return;}
  // Reject every callback parameter. No URL/token/actor is accepted or reflected.
  // Exact raw origin-form also rejects empty query/fragment delimiters, URL
  // normalization aliases and absolute URLs without ever parsing their data.
  if(req.url!==PATH){send(res,400,html(false,true));return;}
  if(req.method==='GET'){send(res,200,html(connected));return;}
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');send(res,405,html(false,true));return;}
  if(!connected){send(res,503,html(false,true));return;}
  if(req.headers?.origin!==ENV.previewOrigin||req.headers?.['sec-fetch-site']!=='same-origin'){send(res,403,html(false,true));return;}
  if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=UTF-8)?$/i.test(req.headers?.['content-type']||'')){send(res,415,html(false,true));return;}
  let action;
  try{
   const reader=req[Symbol.asyncIterator](),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000),parts=[];let size=0;
   try{for(;;){let abort;const next=await Promise.race([reader.next(),new Promise((_,reject)=>{abort=()=>reject(Error('Held'));controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();})]).finally(()=>controller.signal.removeEventListener('abort',abort));if(next.done)break;const bytes=Buffer.from(next.value);if((size+=bytes.length)>32)throw Error('Held');parts.push(bytes);}action=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));}
   finally{clearTimeout(timer);controller.abort();try{Promise.resolve(reader.return?.()).catch(()=>{});}catch{}}
   if(!['action=observe','action=refresh'].includes(action))throw Error('Held');
   // Identity, current-session evidence, one-attempt grant, original binding,
   // confidential redirect custody and finite execution belong to this port.
   // The browser supplies only this fixed action, never an actor or secret URL.
   await actions[action.slice(7)](Object.freeze({request:req,response:res,action:action.slice(7)}));
   if(!res.headersSent&&!res.writableEnded)send(res,503,html(false,true));
  }catch{if(!res.headersSent&&!res.writableEnded)send(res,503,html(false,true));}
 }
 return Object.freeze({enabled:enabled===true,postActionsConnected:connected,handler});
}
module.exports=Object.freeze({createClosedSellerReturnView,ENV,PATH,SCRIPT});
