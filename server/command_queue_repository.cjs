'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const data=require('../command-queue-data.js');
const {createCommandOwnerSessionReader}=require('./command_owner_session_reader.cjs');
const {TEST_ENVIRONMENTS}=require('./test_environment_registry.cjs');
const E=TEST_ENVIRONMENTS.acceptance;
const RPC='rr_test_command_queue';
class QueueError extends Error{constructor(code='unavailable',status=503){super(code);this.code=code;this.status=status;}}
function configured(env){
 const owner=env.RACK_RELIC_TEST_ADMIN_OWNER_ID,members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(','),ops=(env.RACK_RELIC_TEST_REFUND_OPERATOR_IDS||'').split(',');
 try{data.id(owner);members.forEach(data.id);ops.forEach(data.id);}catch{return false;}
 return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF===E.branch&&env.RACK_RELIC_TEST_SUPABASE_URL===E.projectUrl&&env.RACK_RELIC_TEST_STRIPE_ACCOUNT===E.accountId&&env.RACK_RELIC_COMMAND_QUEUE_ACK_ENABLED==='true'&&env.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED==='true'&&env.RACK_RELIC_TEST_REFUNDS_ENABLED==='true'&&env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED==='true'&&members.length===2&&new Set(members).size===2&&members.includes(owner)&&ops.length>=1&&ops.length<=2&&new Set(ops).size===ops.length&&ops.includes(owner)&&ops.every(x=>members.includes(x));
}
function enabled(env,commandSession){return !!commandSession?.config&&configured(env);}

function createQueueRepository({env,fetchImpl,clock=Date.now,mono=()=>performance.now()}){
 const ownerId=env.RACK_RELIC_TEST_ADMIN_OWNER_ID,key=env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY;
 const reader=createCommandOwnerSessionReader({projectUrl:E.projectUrl,ownerId,serverKey:key,fetchImpl,clock,monotonicClock:mono});
 const mac=s=>createHmac('sha256',key).update('rr-command-queue-cursor-v1\0').update(s).digest();
 function cursor(token,ctx){if(!token)return null;try{
  if(typeof token!=='string'||token.length>2048||!/^[-\w]+\.[-\w]+$/.test(token))throw 0;
  const [s,t]=token.split('.'),a=Buffer.from(t,'base64url'),b=mac(s);if(a.toString('base64url')!==t||a.length!==b.length||!timingSafeEqual(a,b))throw 0;
  const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(s,'base64url')));data.exact(v,['version','ownerId','sessionRef','kind','filter','revision','after','issued','expires']);
  for(const k of ['ownerId','sessionRef','kind','filter'])if(v[k]!==ctx[k])throw 0;
  if(v.version!==data.VERSION||!Number.isSafeInteger(v.issued)||v.issued>clock()||v.expires!==v.issued+60000||v.expires<=clock()||!/^[a-f0-9]{64}$/.test(v.revision))throw 0;data.ref(v.kind,v.after);return v;
 }catch{throw new QueueError('invalid_cursor',400);}}
 function encode(v){const s=Buffer.from(JSON.stringify(v)).toString('base64url');return s+'.'+mac(s).toString('base64url');}
 async function run({authorization,operation,nonce,kind,filter,ref,requestId,command,cursor:token,signal}){
  if(!configured(env)||!reader.ready)throw new QueueError('closed',404);data.id(nonce);
  const started=clock(),m=mono(),abort=new AbortController();let sent=false;
  const cancel=()=>abort.abort(),timer=setTimeout(cancel,15000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const check=()=>{if(abort.signal.aborted||clock()<started||clock()-started>=15000||mono()<m||mono()-m>=15000)throw new QueueError(sent&&operation==='ack'?'unknown':'timeout');};
  async function wait(p){check();let f;try{return await Promise.race([p,new Promise((_,reject)=>{f=()=>reject(new QueueError(sent&&operation==='ack'?'unknown':'timeout'));abort.signal.addEventListener('abort',f,{once:true});if(abort.signal.aborted)f();})]);}finally{abort.signal.removeEventListener('abort',f);}}
  try{
   const before=await wait(reader.verify(authorization,{signal:abort.signal}));check();
   const ctx={ownerId,sessionRef:before.sessionRef,kind,filter,operation,nonce,started,now:clock(),ref,requestId,command};
   const bound=cursor(token,ctx);if(bound){ctx.after=bound.after;ctx.revision=bound.revision;}
   const args=operation==='list'?{kind,filter,after:bound?.after??null,revision:bound?.revision??null}:operation==='lookup'?{kind,ref}:operation==='ack'?command:{requestId};
   const url=E.projectUrl+'/rest/v1/rpc/'+RPC;
   const payload={p_owner:ownerId,p_session:before.sessionRef,p_token_exp:before.expiresAt/1000,p_nonce:nonce,p_operation:operation,p_args:args};
   const response=await wait(Promise.resolve().then(()=>{check();sent=true;return fetchImpl(url,{method:'POST',cache:'no-store',redirect:'error',signal:abort.signal,headers:{apikey:key,'Content-Type':'application/json','Accept-Encoding':'identity','Cache-Control':'no-store'},body:JSON.stringify(payload)});}));check();
   if(response.url!==url||response.redirected!==false||data.cached(response)||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')||!response.body?.getReader)throw new QueueError();
   const date=Date.parse(response.headers.get('date')||''),len=response.headers.get('content-length'),enc=response.headers.get('content-encoding');
   if(!Number.isFinite(date)||Math.abs(date-clock())>30000||enc!==null&&enc!=='identity'||len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>65536))throw new QueueError();
   const stream=response.body.getReader(),parts=[];let size=0;try{for(;;){const n=await wait(stream.read());check();if(n.done)break;if(!(n.value instanceof Uint8Array)||(size+=n.value.length)>65536)throw new QueueError();parts.push(Buffer.from(n.value));}}finally{Promise.resolve(stream.cancel()).catch(()=>{});}
   if(len!==null&&Number(len)!==size)throw new QueueError();const bytes=Buffer.concat(parts);let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);parts.forEach(b=>b.fill(0));}
   const after=await wait(reader.verify(authorization,{signal:abort.signal}));check();if(after.member!==before.member||after.sessionRef!==before.sessionRef)throw new QueueError('access_changed',403);
   if(response.status!==200){if(response.status===400&&['Queue revision changed','Case evidence changed','Acknowledgement request conflict'].includes(raw?.message))throw new QueueError(raw.message==='Queue revision changed'?'restart_page':raw.message==='Case evidence changed'?'stale_evidence':'request_conflict',409);throw new QueueError();}
   data.validate(raw,{...ctx,now:clock()});
   if(operation==='list'){const r=raw.result,issued=clock();r.nextCursor=r.hasMore?encode({version:data.VERSION,ownerId,sessionRef:before.sessionRef,kind,filter,revision:r.revision,after:r.nextAfter,issued,expires:issued+60000}):null;delete r.nextAfter;}
   check();return raw;
  }catch(e){if(sent&&operation==='ack'&&![400,409].includes(e.status))throw new QueueError('unknown',e.status===401||e.status===403?e.status:503);throw e;}
  finally{clearTimeout(timer);abort.abort();signal?.removeEventListener('abort',cancel);}
 }
 return Object.freeze({run});
}
module.exports={enabled,createQueueRepository,QueueError,RPC};
