'use strict';
const {createRecoveryHost}=require('../frozen/package/server/recovery_host.cjs');
const {loadRecoveryComposition,headers}=require('../server/recovery-env-binding.cjs');
function createHandler({environment=process.env,clock=Date.now,monotonicClock=()=>performance.now(),fetchImpl=globalThis.fetch}={}){
 let host=null,fingerprint=null,closed=false;
 return async function handle(req,res){
  const original=res?.setHeader;
  if(typeof original!=='function'){try{res?.destroy();}catch{}return;}
  function outboundHeader(name,value){
   // The frozen host validates its own buffered header map first. Only at
   // the actual response boundary do we request no intermediary transforms.
   if(typeof name==='string'&&name.toLowerCase()==='cache-control'&&value==='private, no-store, max-age=0')value+=', no-transform';
   return original.call(this,name,value);
  }
  try{
  res.setHeader=outboundHeader;
  headers(res,'application/json; charset=utf-8');
  const deny=()=>{if(!res.destroyed&&!res.writableEnded){res.statusCode=404;res.end('{"error":"Recovered records remain held"}');}};
  if(closed){deny();return;}
  const binding=loadRecoveryComposition({environment,clock});
  if(!binding){if(host){host.close();closed=true;}deny();return;}
  if(host&&binding.fingerprint!==fingerprint){host.close();closed=true;deny();return;}
  // An early/pre-window request creates no permanently unconfigured host.
  if(!host){host=createRecoveryHost({...binding.host,clock,monotonicClock,fetchImpl});fingerprint=binding.fingerprint;if(!host.configured){closed=true;deny();return;}}
  return await host.handle(req,res);
  }catch{try{res.destroy();}catch{}}
  finally{if(res.setHeader===outboundHeader)res.setHeader=original;}
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.config={api:{bodyParser:false}};
