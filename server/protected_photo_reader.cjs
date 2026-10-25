'use strict';
function protectedPhotoReader(config,fetchImpl=globalThis.fetch){
 if(!config||config.url!=='https://zvtaqzcqfdjpuwnlpzln.supabase.co')throw Error('Staging reader unavailable');
 const key=config.serverKey;
 return async function readObject({bucket,path,signal}){
  if(bucket!=='listing-photos'||typeof path!=='string'||!/^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(jpg|jpeg|png|webp)$/.test(path)||signal?.aborted)throw Error('Photo unavailable');
  // Same API-key/Bearer transport used by official supabase-js Storage fetch.
  // Caller Authorization is deliberately not accepted by this adapter.
  return fetchImpl(config.url+'/storage/v1/object/listing-photos/'+path.split('/').map(encodeURIComponent).join('/'),{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key},cache:'no-store',redirect:'error',signal});
 };
}
module.exports={protectedPhotoReader};
