'use strict';
(function(root){
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 function createTestRefundRequests({storage,memberId,request,uuid=()=>crypto.randomUUID()}={}){
  if(!UUID.test(memberId||'')||!storage?.getItem||!storage?.setItem||typeof request!=='function')throw Error('Refund recovery unavailable');
  const key=orderId=>{if(!UUID.test(orderId||''))throw Error('Invalid order reference');return 'rr-private-test-refunds-v1:'+memberId+':'+orderId;};
  function load(orderId){
   const raw=storage.getItem(key(orderId));if(raw===null)return {version:1,current:null,history:[]};
   let data;try{data=JSON.parse(raw);}catch{throw Error('Saved refund reference needs review; do not create a replacement');}
   const q=data?.current;
   if(data?.version!==1||!Array.isArray(data.history)||q&&(!UUID.test(q.requestId||'')||q.orderId!==orderId||!Number.isSafeInteger(q.amountCents)||q.amountCents<1||!Number.isSafeInteger(q.baselineCents)||q.baselineCents<0||!['prepared','dispatched','known'].includes(q.phase)))throw Error('Saved refund reference needs review; do not create a replacement');
   return data;
  }
  function save(orderId,data){const raw=JSON.stringify(data);storage.setItem(key(orderId),raw);if(storage.getItem(key(orderId))!==raw)throw Error('Could not keep the refund reference; nothing was sent');}
  function match(result,q){if(result?.test!==true||result.requestId!==q.requestId||result.orderId!==q.orderId||result.amountCents!==q.amountCents||result.state!=='request_recorded')throw Error('Refund response needs review; keep the same reference');}
  async function recover(orderId){
   const data=load(orderId),q=data.current;if(!q||q.phase==='prepared')throw Error('No dispatched refund reference to check');
   const result=await request('refund&requestId='+encodeURIComponent(q.requestId));match(result,q);
   // Read-only recovery never claims that the signed financial receipt arrived.
   save(orderId,{...data,current:{...q,phase:'known'}});return result;
  }
  return Object.freeze({
   current(orderId){const q=load(orderId).current;return q?Object.freeze({...q}):null;},
   prepare({orderId,amountCents,baselineCents=0}){
    if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>30000000||!Number.isSafeInteger(baselineCents)||baselineCents<0)throw Error('Enter a valid test refund amount');
    const data=load(orderId);if(data.current){if(data.current.amountCents!==amountCents)throw Error('Keep the saved refund amount and reference');return Object.freeze({...data.current});}
    const requestId=uuid();if(!UUID.test(requestId||''))throw Error('Could not create a refund reference');
    const q={requestId,orderId,amountCents,baselineCents,phase:'prepared'};save(orderId,{...data,current:q});return Object.freeze({...q});
   },
   async submit(orderId){
    const data=load(orderId),q=data.current;if(!q)throw Error('Prepare a refund first');
    if(q.phase!=='prepared')return recover(orderId);
    // Persist BEFORE dispatch. A lost response or reload can only use GET.
    save(orderId,{...data,current:{...q,phase:'dispatched'}});
    const result=await request('refund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:q.requestId,orderId:q.orderId,amountCents:q.amountCents})});match(result,q);
    save(orderId,{...data,current:{...q,phase:'known'}});return result;
   },
   recover,
   discardPrepared(orderId){
    const data=load(orderId),q=data.current;
    if(!q||q.phase!=='prepared')throw Error('A dispatched refund must keep its saved reference');
    save(orderId,{...data,current:null,history:[...data.history,{...q,phase:'not_sent'}]});
   },
   finish(order){
    const data=load(order?.id),q=data.current;
    if(!q||q.phase!=='known'||!['partial','refunded'].includes(order.refund_state)||order.refund_pending_cents!==0||!Number.isSafeInteger(order.refunded_cents)||order.refunded_cents<q.baselineCents+q.amountCents)throw Error('Wait for the signed refund confirmation before another request');
    save(order.id,{...data,current:null,history:[...data.history,{...q,phase:'confirmed'}]});
   }
  });
 }
 if(typeof module==='object'&&module.exports)module.exports={createTestRefundRequests};else root.createTestRefundRequests=createTestRefundRequests;
})(typeof globalThis==='object'?globalThis:this);
