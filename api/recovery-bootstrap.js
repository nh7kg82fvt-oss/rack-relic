'use strict';
const {loadRecoveryComposition,headers,bootstrapRequestStatus}=require('../server/recovery-env-binding.cjs');
const {renderBootstrap}=require('../server/recovery-browser-bridge.cjs');
function createHandler({environment=process.env,clock=Date.now}={}){
 return function handle(req,res){
  try{
   headers(res,'application/javascript; charset=utf-8');
   const status=bootstrapRequestStatus(req);if(status!==200){res.statusCode=status;if(status===405)res.setHeader('Allow','GET');res.end('/* Recovery rehearsal remains closed. */\n');return;}
   const binding=loadRecoveryComposition({environment,clock});
   // Closed deployments load a harmless script without enabling any action.
   res.statusCode=200;res.end(binding?renderBootstrap(binding.browser):'/* Recovery rehearsal remains closed. */\n');
  }catch{try{res.statusCode=404;res.end('/* Recovery rehearsal remains closed. */\n');}catch{try{res.destroy();}catch{}}}
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.config={api:{bodyParser:false}};
