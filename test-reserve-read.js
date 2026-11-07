'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RackRelicReserveRead=api;})(globalThis,function(){
 const VERSION='rr-owner-reserve-read-v1',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const states=['disabled','source_old','schema_missing','not_installed','unavailable','stale','stored_context'];
 const flags={test:true,live:false,holdRequired:true,releaseEnabled:false,refundDispatchEnabled:false,closeGlobalClaim:false,taxAccountingAccepted:false,funding:'unverified'};
 const safeNow=n=>{if(!Number.isSafeInteger(n))throw Error('Trusted reserve clock required');};
 const date=(s,now)=>{if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s))||Date.parse(s)>now+30000)throw Error('Invalid reserve observation');return s;};
 function coverage(state,{now=Date.now(),environmentId='acceptance-v1'}={}){safeNow(now);if(!states.includes(state)||state==='stored_context')throw Error('Known reserve coverage required');return {...flags,version:VERSION,environmentId,coverage:state,observedAt:new Date(now).toISOString(),hasMore:false,rows:[]};}
 function rows(input,now){
  if(!Array.isArray(input)||input.length>10)throw Error('Bounded reserve rows required');
  const seen=new Set();return input.map(r=>{
   if(!UUID.test(r?.orderRef||'')||seen.has(r.orderRef)||typeof r.booked!=='boolean'||typeof r.current!=='boolean')throw Error('Invalid reserve row');seen.add(r.orderRef);
   const money=['acceptedReserveCents','actualCostCents','unusedReserveOwedCents'];
   if(r.booked){if(money.some(k=>!Number.isSafeInteger(r[k])||r[k]<0||r[k]>20000)||r.actualCostCents+r.unusedReserveOwedCents!==r.acceptedReserveCents)throw Error('Invalid saved reserve liability');date(r.recordedAt,now);}
   else if(r.current||r.recordedAt!==null||money.some(k=>r[k]!==null))throw Error('Missing reserve is unknown, not zero');
   return {orderRef:r.orderRef,state:!r.booked?'not_recorded':r.current?'recorded_current':'held_stale',recordedAt:r.recordedAt,acceptedReserveCents:r.acceptedReserveCents,actualCostCents:r.actualCostCents,unusedReserveOwedCents:r.unusedReserveOwedCents};
  });
 }
 function fromRpc(raw,{now=Date.now()}={}){
  safeNow(now);if(raw?.version!==VERSION)return coverage('source_old',{now});
  for(const [k,v]of Object.entries(flags))if(raw[k]!==v)throw Error('Held unfunded test reserve context required');
  const stamp=date(raw.observedAt,now);if(now-Date.parse(stamp)>60000)return coverage('stale',{now});
  if(['not_installed','schema_missing'].includes(raw.schemaState))return coverage(raw.schemaState,{now});
  if(raw.schemaState!=='available'||typeof raw.hasMore!=='boolean')throw Error('Reserve schema coverage required');
  return {...flags,version:VERSION,environmentId:'acceptance-v1',coverage:'stored_context',observedAt:stamp,hasMore:raw.hasMore,rows:rows(raw.rows,now)};
 }
 function validate(value,{now=Date.now(),environmentId='acceptance-v1'}={}){
  safeNow(now);if(value?.version!==VERSION||value.environmentId!==environmentId||!states.includes(value.coverage))throw Error('Reserve view version/environment mismatch');
  for(const [k,v]of Object.entries(flags))if(value[k]!==v)throw Error('Reserve view cannot grant financial authority');
  date(value.observedAt,now);if(now-Date.parse(value.observedAt)>60000)throw Error('Stale reserve server snapshot');
  if(value.coverage!=='stored_context'){
   if(!Array.isArray(value.rows)||value.rows.length!==0||value.hasMore!==false)throw Error('Unavailable coverage cannot carry money');
   return coverage(value.coverage,{now,environmentId});
  }
  if(typeof value.hasMore!=='boolean'||!Array.isArray(value.rows))throw Error('Bounded reserve view required');
  const raw=value.rows.map(r=>{if(!['not_recorded','recorded_current','held_stale'].includes(r?.state))throw Error('Server reserve state required');return {...r,booked:r.state!=='not_recorded',current:r.state==='recorded_current'};});
  return {...flags,version:VERSION,environmentId,coverage:value.coverage,observedAt:value.observedAt,hasMore:value.hasMore,rows:rows(raw,now)};
 }
 function render(root,document,value,{now=Date.now(),environmentId='acceptance-v1'}={}){
  root.replaceChildren();const data=validate(value,{now,environmentId});
  const p=text=>{const el=document.createElement('p');el.textContent=text;root.append(el);};
  p('Seller money stays held. Amounts owed are not proof of available cash or funded reserves. This view cannot book entries, pay a seller, refund a buyer or clear a hold.');
  const missing={disabled:'The reserve view is off. Its setup has not been accepted.',source_old:'This website or database source does not provide the reserve view yet.',schema_missing:'The required reserve read schema is unavailable. No balance can be confirmed.',not_installed:'Reserve accounting is not installed in this practice database.',unavailable:'Reserve records could not be checked. Current amounts are unknown.',stale:'The server returned old reserve information. Current amounts are unknown.'};
  if(data.coverage!=='stored_context'){p(missing[data.coverage]);return;}
  p('Stored practice accounting only. Bank funds, provider invoice completeness and tax settlement are not verified here.');
  if(!data.rows.length)p('No practice reserve records are shown. Zero orders or notes does not prove there are no liabilities or that reserves are funded.');
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
  for(const r of data.rows){const article=document.createElement('article');const line=t=>{const e=document.createElement('p');e.textContent=t;article.append(e);};
   line('Order '+r.orderRef.slice(0,8));
   if(r.state==='not_recorded')line('Unused seller reserve owed: not recorded. Do not treat this as $0.');
   else {line((r.state==='held_stale'?'Previously recorded unused reserve owed: ':'Recorded unused reserve owed: ')+money(r.unusedReserveOwedCents)+'. Money remains held.');
    line('Accepted retained maximum: '+money(r.acceptedReserveCents)+'; recorded actual seller costs: '+money(r.actualCostCents)+'.');
    line(r.state==='held_stale'?'Facts changed or review evidence is missing. This historical amount needs reconciliation; it is not a current payable balance.':'Stored facts matched at the server read. This does not authorize release or establish funded reserves.');}
   root.append(article);
  }
  if(data.hasMore)p('Only the latest 10 practice orders are shown. Other liabilities may not be included.');
 }
 return Object.freeze({VERSION,coverage,fromRpc,validate,render});
});
