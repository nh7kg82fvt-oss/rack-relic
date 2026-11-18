'use strict';
const {exact}=require('./recovery-env-binding.cjs');
function safeScriptJson(value){return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026','\u2028':'\\u2028','\u2029':'\\u2029'}[c]));}
// Standalone browser program: serialized from this reviewed function, never eval input.
function installRecoveryBootstrap(config){
 'use strict';
 const root=globalThis,guard='__RACK_RECOVERY_PRIVATE_BOOTSTRAP_V1__';
 if(Object.prototype.hasOwnProperty.call(root,guard))return;
 Object.defineProperty(root,guard,{value:true,writable:false,configurable:false});
 const win=root.window,doc=root.document,coordinator=root.RackRecoveryCoordinator;
 if(!win||!doc||typeof win.fetch!=='function'||!coordinator||typeof coordinator.install!=='function'||!config||config.enabled!==true||win.location?.origin!==config.enrollment?.origin)return;
 const origin='https://rack-relic-git-codex-recovery-readiness-20261117-rack-relic.vercel.app',dataUrl=origin+'/api/recovery-readonly',auth='https://xkxolhgafjadpknsfqqw.supabase.co/auth/v1';
 if(config.enrollment.origin!==origin)return;
 const nativeFetch=win.fetch.bind(win);let dataAttempted=false;
 function fail(){return Promise.reject(new Error('Recovery transport remains held'));}
 function safeHeaders(value,allowed){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;
  for(const name of Reflect.ownKeys(value)){
   if(typeof name!=='string'||!allowed.includes(name.toLowerCase()))return false;
   const d=Object.getOwnPropertyDescriptor(value,name);
   if(!d?.enumerable||!Object.prototype.hasOwnProperty.call(d,'value')||typeof d.value!=='string'||d.value.length>16384||/[\r\n\0]/.test(d.value))return false;
  }
  return true;
 }
 function transport(url,init){
  try{
   if(typeof url!=='string'||!init||init.credentials!=='omit'||init.cache!=='no-store'||init.redirect!=='error')return fail();
   if(url===dataUrl){
    if(dataAttempted||init.method!=='GET'||init.body!==undefined||!safeHeaders(init.headers,['accept','authorization']))return fail();
    dataAttempted=true;
    // Frozen view/bootstrap still validate omit. Only this exact same-origin
    // outbound request may carry the browser's existing Vercel protection cookie.
    return nativeFetch(url,{...init,credentials:'same-origin'});
   }
   const method=url===auth+'/token?grant_type=password'?'POST':url===auth+'/user'?'GET':url===auth+'/logout?scope=local'?'POST':null;
   if(method===null||init.method!==method||!safeHeaders(init.headers,['apikey','authorization','accept','content-type'])||method==='GET'&&init.body!==undefined||url===auth+'/logout?scope=local'&&init.body!==undefined)return fail();
   return nativeFetch(url,init);
  }catch{return fail();}
 }
 coordinator.install({document:doc,window:win,enabled:true,enrollment:config.enrollment,publishableKey:config.publishableKey,fetchImpl:transport});
}
function renderBootstrap(browser){
 const keys=['version','projectRef','ownerId','email','origin','branch','revision','notBefore','expiresAt'];
 if(!exact(browser,['enabled','enrollment','publishableKey'])||browser.enabled!==true||!exact(browser.enrollment,keys))throw Error('Public recovery projection required');
 const publicValue={enabled:true,enrollment:Object.fromEntries(keys.map(k=>[k,browser.enrollment[k]])),publishableKey:browser.publishableKey};
 return "'use strict';\n("+installRecoveryBootstrap.toString()+')('+safeScriptJson(publicValue)+');\n';
}
module.exports={safeScriptJson,renderBootstrap,installRecoveryBootstrap};
