'use strict';
const ORIGIN='https://rack-relic-git-codex-recovery-readiness-20261117-rack-relic.vercel.app';
module.exports=function(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 const key=process.env.RACK_RECOVERY_RESET_PUBLIC_KEY;
 let valid=false;
 try{const p=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));valid=p.role==='anon'&&p.ref==='xkxolhgafjadpknsfqqw';}catch{}
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='codex/recovery-readiness-20261117'||req.method!=='GET'||req.url!=='/api/recovery-reset-config'||req.headers.host!==new URL(ORIGIN).host||!valid){res.statusCode=404;return res.end('{}');}
 res.end(JSON.stringify({project:'https://xkxolhgafjadpknsfqqw.supabase.co',ownerId:'68f2c873-2d5d-4069-9afb-81b2896cd94b',email:'wayne@rackrelic.com',publicKey:key}));
};
