'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RackCommandQueueData=api;})(globalThis,function(){
 const VERSION='rr-command-queue-v1',UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,CASE=/^case_[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
 const fail=()=>{throw Error('Invalid private queue data');};
 function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.slice().sort().join(','))fail();return v;}
 function id(v){if(typeof v!=='string'||!UUID.test(v)||v==='00000000-0000-0000-0000-000000000000')fail();return v;}
 function ref(kind,v){if(kind==='orders')return id(v);if(kind!=='cases'||typeof v!=='string'||!CASE.test(v))fail();return v;}
 function stamp(v,now){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>now+1000)fail();return v;}
 function ackCommand(v){exact(v,['requestId','caseRef','orderRef','generation','evidenceVersion']);id(v.requestId);ref('cases',v.caseRef);id(v.orderRef);if(!Number.isSafeInteger(v.generation)||v.generation<1||!HASH.test(v.evidenceVersion))fail();return {...v};}
 function ack(v,ctx){exact(v,['ownerId','caseRef','orderRef','generation','evidenceVersion','firstRequestId','acknowledgedAt']);ackCommand({requestId:v.firstRequestId,...Object.fromEntries(['caseRef','orderRef','generation','evidenceVersion'].map(k=>[k,v[k]]))});if(v.ownerId!==ctx.ownerId)fail();stamp(v.acknowledgedAt,ctx.now);return v;}
 function item(v,kind,ctx){
  if(kind==='orders'){
   exact(v,['orderRef','state','riskStatus','refundState','totalCents','observedAt','holdRequired']);id(v.orderRef);
   if(!['reserved','checkout_open','payment_pending','paid','expired','review','payment_failed','cancelled'].includes(v.state)||!['pending','clear','review','blocked'].includes(v.riskStatus)||!['none','pending','partial','refunded','failed','review'].includes(v.refundState)||!Number.isSafeInteger(v.totalCents)||v.totalCents<0||v.totalCents>1000000000)fail();
  }else{
   exact(v,['caseRef','orderRef','kind','status','requiresResponse','dueBy','observedAt','holdRequired','generation','evidenceVersion','acknowledgement']);
   ackCommand({requestId:v.orderRef,...Object.fromEntries(['caseRef','orderRef','generation','evidenceVersion'].map(k=>[k,v[k]]))});
   if(!['dispute','early_fraud_warning'].includes(v.kind)||!['warning_received','warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','appeal_needs_response','appeal_under_review','won','lost','prevented','conflicting_evidence'].includes(v.status)||typeof v.requiresResponse!=='boolean'||v.dueBy!==null&&(typeof v.dueBy!=='string'||!Number.isFinite(Date.parse(v.dueBy))))fail();
   if(v.acknowledgement!==null){ack(v.acknowledgement,ctx);for(const k of ['caseRef','orderRef','generation','evidenceVersion'])if(v[k]!==v.acknowledgement[k])fail();}
  }
  if(v.holdRequired!==true)fail();stamp(v.observedAt,ctx.now);return v;
 }
 function validate(v,ctx){
  exact(v,['version','test','live','releaseEnabled','environmentId','ownerId','sessionRef','nonce','observedAt','operation','result']);
  if(v.version!==VERSION||v.test!==true||v.live!==false||v.releaseEnabled!==false||v.environmentId!=='acceptance-v1'||v.ownerId!==ctx.ownerId||v.sessionRef!==ctx.sessionRef||v.nonce!==ctx.nonce||v.operation!==ctx.operation||!Number.isSafeInteger(v.observedAt)||v.observedAt<ctx.started||v.observedAt>ctx.now+1000||ctx.now<ctx.started||ctx.now-ctx.started>=15000)fail();
  const r=v.result;
  if(v.operation==='list'){
   const keys=['kind','filter','revision','items','hasMore',ctx.wire?'nextCursor':'nextAfter'];exact(r,keys);
   if(r.kind!==ctx.kind||r.filter!==ctx.filter||!HASH.test(r.revision)||!Array.isArray(r.items)||r.items.length>25||typeof r.hasMore!=='boolean')fail();
   let last=ctx.after||'';for(const x of r.items){item(x,r.kind,ctx);const key=x[r.kind==='orders'?'orderRef':'caseRef'];if(key<=last)fail();last=key;if(r.filter==='held'&&['expired','payment_failed','cancelled'].includes(x.state)||r.filter==='attention'&&!x.requiresResponse&&x.status!=='conflicting_evidence')fail();}
   if(ctx.revision&&r.revision!==ctx.revision)fail();const next=r[ctx.wire?'nextCursor':'nextAfter'];if(r.hasMore?(r.items.length!==25||typeof next!=='string'||(ctx.wire?!/^[A-Za-z0-9_.-]{1,2048}$/.test(next):next!==last)):next!==null)fail();
  }else if(v.operation==='lookup'){
   exact(r,['kind','ref','item']);if(r.kind!==ctx.kind||r.ref!==ctx.ref)fail();if(r.item!==null){item(r.item,r.kind,ctx);if(r.item[r.kind==='orders'?'orderRef':'caseRef']!==r.ref)fail();}
  }else{
   exact(r,['requestId','acknowledgement','isCurrent']);if(r.requestId!==ctx.requestId||typeof r.isCurrent!=='boolean'||r.acknowledgement===null&&r.isCurrent)fail();
   if(r.acknowledgement!==null){ack(r.acknowledgement,ctx);if(ctx.command)for(const k of ['caseRef','orderRef','generation','evidenceVersion'])if(r.acknowledgement[k]!==ctx.command[k])fail();}
   if(v.operation==='ack'&&r.acknowledgement===null)fail();
  }
  return v;
 }
 function cached(r){const h=r.headers;if(!h?.get)return true;const age=h.get('age');return r.redirected===true||h.get('location')!==null||age!==null&&age!=='0'||['x-cache','cf-cache-status','x-vercel-cache'].some(k=>h.get(k)!==null&&!['MISS','BYPASS','DYNAMIC'].includes(h.get(k).toUpperCase()))||!/\bno-store\b/i.test(h.get('cache-control')||'')||/\b(public|immutable|stale-if-error|stale-while-revalidate)\b/i.test(h.get('cache-control')||'')||(h.get('cache-control')||'').split(',').some(v=>/\b(?:s-maxage|max-age)\b/i.test(v)&&!/^\s*(?:s-maxage|max-age)\s*=\s*(?:0|"0")\s*$/i.test(v));}
 return Object.freeze({VERSION,id,ref,exact,ackCommand,validate,cached});
});
