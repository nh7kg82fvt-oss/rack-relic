'use strict';
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./command-queue-data.js'):root.RackCommandQueueData);if(typeof module==='object'&&module.exports)module.exports=api;else root.RackCommandQueue=api;})(globalThis,function(data){
 function mount({root,document,window,fetchImpl,storage,session,clock=Date.now,onAccessLost=()=>{}}){
  const initial=session();if(!initial)return {destroy(){},lookup(){}};
  const ownerId=initial.member,sessionRef=initial.sessionRef,storageKey='rr-command-ack-request-v1:'+ownerId;
  let closed=false,busy=false,controller=null,seq=0,expiry=null,pendingId=null,blocked=false,currentDetail=null,detailAt=0;
  const create=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const tools=create('div'),notice=create('p'),list=create('div'),detail=create('div');notice.setAttribute?.('role','status');
  const kind=create('select');for(const [value,label]of [['cases','Cases'],['orders','Orders']]){const n=create('option',label);n.value=value;kind.append(n);}kind.value='cases';
  const filter=create('select');function filters(){filter.replaceChildren();for(const [value,label]of [['all','All saved records'],[kind.value==='orders'?'held':'attention',kind.value==='orders'?'Held orders':'Cases needing attention']]){const n=create('option',label);n.value=value;filter.append(n);}filter.value='all';}filters();
  const ref=create('input');ref.type='text';ref.maxLength=64;ref.setAttribute?.('aria-label','Exact order or case reference');
  const button=(label,fn)=>{const b=create('button',label);b.type='button';b.addEventListener('click',()=>void fn());return b;};
  const more=button('Next page',()=>load(nextCursor)),fresh=button('Load queue',()=>load()),find=button('Open exact reference',()=>lookup(kind.value,ref.value)),check=button('Check original acknowledgement',()=>receipt());let nextCursor=null;
  kind.addEventListener('change',()=>{filters();clear();});filter.addEventListener('change',clear);
  tools.append(kind,filter,fresh,ref,find,more,check);root.append(create('p','Saved practice records only. Acknowledging a case records responsibility for that evidence; it does not resolve the case, confirm email delivery, stop deadlines or release money.'),tools,notice,list,detail);more.disabled=true;
  try{pendingId=storage.getItem(storageKey);if(pendingId!==null)data.id(pendingId);}catch{blocked=true;pendingId=null;}
  function live(){const s=session();return !closed&&s?.member===ownerId&&s?.sessionRef===sessionRef;}
  function clear(){seq++;controller?.abort();controller=null;busy=false;currentDetail=null;detailAt=0;nextCursor=null;more.disabled=true;list.replaceChildren();detail.replaceChildren();ref.value='';if(expiry!==null)window.clearTimeout(expiry);expiry=null;}
  function age(){if(expiry!==null)window.clearTimeout(expiry);expiry=window.setTimeout(()=>{clear();notice.textContent='Saved view expired. Load the queue again.';},60000);}
  async function request(op,fields={},command=null){
   if(!live()||busy)return null;busy=true;const n=++seq,started=clock(),mono=performance.now();controller=new AbortController();const active=controller;
   const signal=AbortSignal.any([active.signal,AbortSignal.timeout(15000)]);
   async function wait(p){let f;try{return await Promise.race([p,new Promise((_,reject)=>{f=()=>reject(Error('expired'));signal.addEventListener('abort',f,{once:true});if(signal.aborted)f();})]);}finally{signal.removeEventListener('abort',f);}}
   const nonce=window.crypto.randomUUID();const q=new URLSearchParams({action:'queue',op,nonce,...fields});const url='/api/command-center?'+q;
   try{
    const r=await wait(fetchImpl(url,{method:command?'POST':'GET',cache:'no-store',redirect:'error',credentials:'same-origin',signal,headers:command?{'Content-Type':'application/json'}:{},...(command?{body:JSON.stringify(command)}:{})}));
    if(!live()||seq!==n||active.signal.aborted)return null;
    if([401,403].includes(r.status)){clear();onAccessLost();return null;}
    if(!r.ok||r.headers?.get('X-Rack-Command-Session')!==sessionRef||data.cached(r))throw Error();
    if(!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||'')||!r.body?.getReader)throw Error();
    const reader=r.body.getReader(),parts=[];let size=0;try{for(;;){const chunk=await wait(reader.read());if(chunk.done)break;if((size+=chunk.value.length)>65536)throw Error();parts.push(chunk.value);}}finally{Promise.resolve(reader.cancel()).catch(()=>{});}
    const bytes=new Uint8Array(size);let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!live()||seq!==n||active.signal.aborted)return null;
    if(performance.now()-mono>=15000)throw Error();
    const value=data.validate(raw,{ownerId,sessionRef,nonce,operation:op,started,now:clock(),wire:true,...fields,requestId:command?.requestId||fields.requestId,command});age();return value.result;
   }catch{if(live()&&seq===n){list.replaceChildren();detail.replaceChildren();currentDetail=null;nextCursor=null;more.disabled=true;notice.textContent=op==='ack'?'Acknowledgement unconfirmed. Check the original request. Do not send a replacement.':'Could not load fresh authorized records. Load again; an unconfirmed acknowledgement still needs its original request checked.';}return null;}
   finally{if(seq===n){busy=false;controller=null;}}
  }
  function showItem(v,k){const node=create('article');node.append(create('p',(k==='orders'?'Order ':'Case ')+v[k==='orders'?'orderRef':'caseRef']));
   if(k==='orders')node.append(create('p','Saved state: '+v.state+'; risk: '+v.riskStatus+'; refund: '+v.refundState),create('p','Saved order amount: $'+(v.totalCents/100).toFixed(2)),create('p','This saved amount does not verify that shipping and tax are included. Check the complete buyer total in the approved order evidence.'));
   else node.append(create('p','Saved case: '+v.status+(v.requiresResponse?' · Response still required.':'')),create('p','Recorded deadline: '+(v.dueBy===null?'Not recorded':v.dueBy)),create('p',v.acknowledgement?'Acknowledged for this evidence at '+v.acknowledgement.acknowledgedAt:'This evidence needs owner acknowledgement.'));
   node.append(create('p','Source last updated: '+v.observedAt+'. Seller money remains held.'));return node;}
  async function load(cursor=null){const k=kind.value,f=filter.value;list.replaceChildren();detail.replaceChildren();currentDetail=null;more.disabled=true;
   const r=await request('list',{kind:k,filter:f,...(cursor?{cursor}:{})});if(!r)return;
   nextCursor=r.nextCursor;for(const v of r.items){const n=showItem(v,k);n.append(button('Open record',()=>lookup(k,v[k==='orders'?'orderRef':'caseRef'])));list.append(n);}more.disabled=!nextCursor;notice.textContent='Showing '+r.items.length+' saved records.'+(r.hasMore?' More records are available.':' End of this queue.');}
  async function lookup(k,id){try{data.ref(k,id);}catch{notice.textContent='Enter the exact opaque order or case reference.';return;}clear();
   const r=await request('lookup',{kind:k,ref:id});if(!r)return;notice.textContent=r.item?'Exact saved record loaded.':'No matching saved record.';if(!r.item)return;
   currentDetail=r.item;detailAt=clock();const node=showItem(r.item,k);if(k==='cases'){node.append(button('View related order',()=>lookup('orders',r.item.orderRef)));const b=button('I saw this evidence and take responsibility',()=>acknowledge());b.disabled=!!r.item.acknowledgement||!!pendingId||blocked;node.append(b);}detail.append(node);}
  async function acknowledge(){
   if(!live()||busy||blocked||pendingId||!currentDetail?.caseRef||currentDetail.acknowledgement||clock()<detailAt||clock()-detailAt>=60000)return;
   const c=data.ackCommand({requestId:window.crypto.randomUUID(),caseRef:currentDetail.caseRef,orderRef:currentDetail.orderRef,generation:currentDetail.generation,evidenceVersion:currentDetail.evidenceVersion});
   // Persist only the opaque original request, before the write. Keep it through
   // reload/signout/pause/UNKNOWN; never persist private case or session details.
   try{storage.setItem(storageKey,c.requestId);if(storage.getItem(storageKey)!==c.requestId)throw Error();pendingId=c.requestId;}catch{blocked=true;notice.textContent='Cannot preserve the original request safely. Acknowledgement was not sent.';return;}
   detail.replaceChildren();currentDetail=null;const r=await request('ack',{},c);if(r)finishReceipt(r);
  }
  function finishReceipt(r){if(r.acknowledgement){try{storage.removeItem(storageKey);pendingId=null;}catch{blocked=true;}
   notice.textContent='Original acknowledgement recorded at '+r.acknowledgement.acknowledgedAt+'. '+(r.isCurrent?'This exact evidence was acknowledged.':'Newer evidence still needs attention.')+' Holds and deadlines are unchanged.';
  }else notice.textContent='Original request is not confirmed. It remains held for review; no replacement acknowledgement will be sent.';}
  async function receipt(){if(!pendingId){notice.textContent=blocked?'Original request storage needs review.':'No unconfirmed acknowledgement on this device.';return;}const r=await request('receipt',{requestId:pendingId});if(r)finishReceipt(r);}
  void (pendingId?receipt():load());
  return Object.freeze({lookup,load,acknowledge,receipt,destroy(){closed=true;clear();tools.replaceChildren();notice.textContent='';root.replaceChildren();}});
 }
 return Object.freeze({mount});
});
