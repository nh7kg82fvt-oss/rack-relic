'use strict';
// Separate two-member password-first namespace. Existing Command is untouched.
// Decoded claims only deny; fixed live /user authenticates every use. The finite
// SQL dispatcher independently checks the current auth.sessions row pre/post.
const {U,hold,request}=require('./practice_io.cjs');
const ORIGIN='https://tzymapahsfiyhgilsmxl.supabase.co',PREFIX='__Host-rr-practice-',AGE=604800;
function createPracticeSession({publishableKey,ownerId,buyerId,fetchImpl,clock=Date.now}){
 function role(id){if(id===ownerId)return'owner';if(id===buyerId)return'buyer';hold();}
 function claims(access,allowExpired=false){if(typeof access!=='string'||access.length>3800||!/^\w[\w-]*\.[\w-]+\.[\w-]+$/.test(access))hold();let c;try{c=U.plain(JSON.parse(Buffer.from(access.split('.')[1],'base64url').toString('utf8')));}catch{hold();}role(c.sub);U.id(c.session_id);if(c.iss!==ORIGIN+'/auth/v1'||c.aud!=='authenticated'||c.role!=='authenticated'||c.is_anonymous!==false||!Number.isSafeInteger(c.exp)||!allowExpired&&c.exp*1000<=clock()||!Number.isSafeInteger(c.iat)||c.iat*1000>clock()+30000)hold();return c;}
 function cookie(req,name){const raw=req.headers?.cookie;if(raw===undefined)return null;if(typeof raw!=='string'||raw.length>16384)hold();const a=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith(PREFIX+name+'='));if(a.length>1)hold();const v=a[0]?.slice((PREFIX+name).length+1)??null;if(v!==null&&!/^[A-Za-z0-9_.-]{1,3800}$/.test(v))hold();return v;}
 function put(res,name,value,age){const previous=res.getHeader?.('Set-Cookie'),c=PREFIX+name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict'+(age===null?'':'; Max-Age='+age);res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[previous]:[]),c]);}
 function clear(res){for(const n of ['access','refresh','remember'])put(res,n,'',0);}
 async function auth(path,body,access,scope){const out=await request(fetchImpl,ORIGIN+'/auth/v1/'+path,{method:body===null?'GET':'POST',headers:{apikey:publishableKey,...(access?{Authorization:'Bearer '+access}:{}),...(body!==null?{'Content-Type':'application/json'}:{})},...(body!==null?{body:JSON.stringify(body)}:{})},scope,65536);out.bytes.fill(0);return out.value;}
 async function verify(access,scope){const c=claims(access),u=await auth('user',null,access,scope);if(u.id!==c.sub||u.aud!=='authenticated'||u.role!=='authenticated'||u.is_anonymous!==false||u.deleted_at!=null||u.banned_until!=null&&(!Number.isFinite(Date.parse(u.banned_until))||Date.parse(u.banned_until)>clock()))hold();claims(access);return{access,role:role(u.id),memberId:u.id,sessionId:c.session_id,expiresAt:c.exp*1000};}
 async function store(res,result,remember,scope,sessionId=null){if(typeof result.refresh_token!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(result.refresh_token))hold();const s=await verify(result.access_token,scope);if(sessionId!==null&&s.sessionId!==sessionId)hold();put(res,'access',s.access,remember?Math.min(AGE,Math.max(1,Math.floor((s.expiresAt-clock())/1000))):null);put(res,'refresh',result.refresh_token,remember?AGE:null);put(res,'remember',remember?'1':'0',remember?AGE:null);return s;}
 return Object.freeze({
  verifyAccess:verify,
  async login(input,res,scope){U.exact(U.plain(input),['email','password','remember']);if(typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email)||input.email.length>254||typeof input.password!=='string'||input.password.length<1||input.password.length>1024||typeof input.remember!=='boolean')hold();return store(res,await auth('token?grant_type=password',{email:input.email.trim().toLowerCase(),password:input.password},null,scope),input.remember,scope);},
  async resolve(req,res,scope){const access=cookie(req,'access');let originalSession=null;if(access){const c=claims(access,true);originalSession=c.session_id;if(c.exp*1000>clock())return verify(access,scope);}const refresh=cookie(req,'refresh');if(!refresh||!/^[A-Za-z0-9_-]{1,1024}$/.test(refresh))hold();return store(res,await auth('token?grant_type=refresh_token',{refresh_token:refresh},null,scope),cookie(req,'remember')==='1',scope,originalSession);},
  async logout(req,res,scope){let confirmed=false;try{const access=cookie(req,'access');if(access){claims(access);const r=await scope.wait(fetchImpl(ORIGIN+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:publishableKey,Authorization:'Bearer '+access},signal:scope.signal,redirect:'error',cache:'no-store'}));confirmed=r.status===204;}}catch{}clear(res);return confirmed;},
  clear
 });
}
module.exports={createPracticeSession,PREFIX};
