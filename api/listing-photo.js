'use strict';
const {serverConfig}=require('../server/photo_production_config.cjs');
const {protectedPhotoReader}=require('../server/protected_photo_reader.cjs');
const {createListingPhotoHandler}=require('../server/listing_photo_delivery.cjs');
function createProductionApi(env,fetchImpl=globalThis.fetch){
 const cfg=serverConfig(env);
 const handler=cfg?createListingPhotoHandler({projectUrl:cfg.url,publicKey:cfg.publicKey,readObject:protectedPhotoReader(cfg,fetchImpl),fetchImpl}):createListingPhotoHandler();
 return (req,res)=>{
  let url;
  try{const u=new URL(req.url,'https://photo.invalid');const direct=/^\/api\/listing-photo\/([0-9a-f-]{36})$/.exec(u.pathname);
   if(direct&&!u.search)url='/api/listing-photo/'+direct[1];
   else if(u.pathname==='/api/listing-photo'&&u.searchParams.size===1&&u.searchParams.has('id'))url='/api/listing-photo/'+u.searchParams.get('id');
  }catch{}
  return handler({method:req.method,url:url||'/invalid',headers:req.headers},res);
 };
}
module.exports=(req,res)=>createProductionApi(process.env)(req,res);
module.exports.createProductionApi=createProductionApi;
