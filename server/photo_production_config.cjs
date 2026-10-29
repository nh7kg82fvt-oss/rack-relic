'use strict';
const PRODUCTION='https://zrfztnbyynrdzfeblkeq.supabase.co';
function serverConfig(env){
 if(env.VERCEL_ENV!=='production'||env.VERCEL_GIT_COMMIT_REF!=='main'||env.SUPABASE_URL!==PRODUCTION)return null;
 const publicKey=env.SUPABASE_PUBLISHABLE_KEY,serverKey=env.SUPABASE_SECRET_KEY;
 if(typeof publicKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey))return null;
 if(typeof serverKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(serverKey))return null;
 return {url:PRODUCTION,publicKey,serverKey};
}
module.exports={serverConfig};
