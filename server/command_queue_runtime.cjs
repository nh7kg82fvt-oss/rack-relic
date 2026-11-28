'use strict';
const data=require('../command-queue-data.js');
const {enabled,createQueueRepository}=require('./command_queue_repository.cjs');
const {TEST_ENVIRONMENTS}=require('./test_environment_registry.cjs');
async function readCommand(req){
 const parse=b=>{if(b.length>2048)throw Error('size');const raw=new TextDecoder('utf-8',{fatal:true}).decode(b);
  const keys=[...raw.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)].map(m=>JSON.parse('"'+m[1]+'"'));
  if(new Set(keys).size!==keys.length)throw Error('duplicate');return JSON.parse(raw);};
 if(req.body!==undefined){if(typeof req.body!=='string'&&!Buffer.isBuffer(req.body))throw Error('Raw body required');return parse(Buffer.from(req.body));}
 if(typeof req[Symbol.asyncIterator]!=='function')throw Error('body');let timer,closed=false;
 try{return await Promise.race([(async()=>{let size=0;const chunks=[];for await(const b of req){if(closed||(size+=b.length)>2048)throw Error('size');chunks.push(Buffer.from(b));}if(closed)throw Error('expired');return parse(Buffer.concat(chunks));})(),new Promise((_,reject)=>{timer=setTimeout(()=>{closed=true;req.destroy?.();reject(Error('timeout'));},5000);})]);}
 finally{closed=true;clearTimeout(timer);}
}
async function handleQueue({req,res,env,fetchImpl,clock,commandSession}){
 const send=(status,v)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 if(!enabled(env,commandSession)){send(404,{error:'Not found'});return;}
 let input;
 try{
  const q=new URL(req.url,'https://example.invalid').searchParams,op=q.get('op');
  const extra=op==='list'?['kind','filter','cursor']:op==='lookup'?['kind','ref']:op==='receipt'?['requestId']:op==='ack'?[]:null;
  if(!extra||[...q.keys()].some(k=>!['action','op','nonce',...extra].includes(k)||q.getAll(k).length!==1)||q.get('action')!=='queue')throw 0;
  if(req.method!==(op==='ack'?'POST':'GET')){res.setHeader('Allow',op==='ack'?'POST':'GET');send(405,{error:'Method not allowed'});return;}
  data.id(q.get('nonce'));input={operation:op,nonce:q.get('nonce')};
  if(op==='list'||op==='lookup'){input.kind=q.get('kind');if(!['orders','cases'].includes(input.kind))throw 0;}
  if(op==='list'){input.filter=q.get('filter');if(!['all',input.kind==='orders'?'held':'attention'].includes(input.filter))throw 0;input.cursor=q.has('cursor')?q.get('cursor'):null;if(input.cursor!==null&&!/^[\w.-]{1,2048}$/.test(input.cursor))throw 0;}
  if(op==='lookup')input.ref=data.ref(input.kind,q.get('ref'));
  if(op==='receipt')input.requestId=data.id(q.get('requestId'));
  if(op==='ack'){
   if(req.headers?.origin!==TEST_ENVIRONMENTS.acceptance.previewOrigin||req.headers?.['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin'){send(403,{error:'Open this action from Rack Command'});return;}
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type']||'')){send(415,{error:'JSON required'});return;}
   const len=req.headers?.['content-length'];if(len!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>2048)){send(413,{error:'Request too large'});return;}
   // A bounded raw body preserves duplicate detection. Reject duplicate
   // JSON member spellings before parsing; this command permits only scalars.
   if(req.body!==undefined){if(typeof req.body!=='string'&&!Buffer.isBuffer(req.body))throw 0;}
   const parsed=await readCommand(req);
   input.command=data.ackCommand(parsed);input.requestId=input.command.requestId;
  }
 }catch{send(400,{error:'Invalid private queue request'});return;}
 try{
  const session=await commandSession.resolve(req,res);res.setHeader('X-Rack-Command-Session',session.sessionRef);
  const repo=createQueueRepository({env,fetchImpl,clock});
  const value=await repo.run({...input,authorization:'Bearer '+session.access});
  if(value.sessionRef!==session.sessionRef)throw Object.assign(Error(),{status:403});send(200,value);
 }catch(e){const status=[400,401,403,409].includes(e.status)?e.status:503;send(status,{error:input.operation==='ack'?'Acknowledgement unconfirmed. Check the original request; do not send a replacement.':'Private queue unavailable. Refresh after checking access.',code:e.code||'unavailable'});}
}
module.exports={handleQueue};
