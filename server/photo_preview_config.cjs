'use strict';
const STAGE='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const BRANCH='preview/photo-delivery-boundary';
function publicConfig(env){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==BRANCH||env.RACK_RELIC_PHOTO_PROJECT_URL!==STAGE||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.RACK_RELIC_PHOTO_PUBLIC_KEY||''))return null;
 return {url:STAGE,publicKey:env.RACK_RELIC_PHOTO_PUBLIC_KEY};
}
function serverConfig(env){
 const pub=publicConfig(env);if(!pub)return null;
 const key=env.RACK_RELIC_PHOTO_SERVER_KEY;
 // Opaque existing key only; never decode JWT claims or accept browser keys.
 if(typeof key!=='string'||!(/^sb_secret_[A-Za-z0-9_-]+$/.test(key)||/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)))return null;
 return {...pub,serverKey:key};
}
module.exports={publicConfig,serverConfig};
