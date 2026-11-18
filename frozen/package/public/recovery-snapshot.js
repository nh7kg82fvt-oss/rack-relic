'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RackRecoverySnapshot=api;})(globalThis,function(){
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const CASE=/^case_[a-f0-9]{32}$/;
 const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
 const countKeys=['orders','paidOrders','heldOrders','sellers','openCases','alertDeliveryGaps'];
 const states=['reserved','checkout_open','payment_pending','paid','expired','review','payment_failed','cancelled'];
 const caseStates=['warning_received','warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','appeal_needs_response','appeal_under_review','won','lost','prevented','conflicting_evidence'];
 const date=(value,now,nullable=false)=>{if(nullable&&value===null)return null;if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now+30000)throw Error('Invalid source observation');return value;};
 const number=value=>{if(!Number.isSafeInteger(value)||value<0||value>1000000000)throw Error('Invalid overview count');return value;};
 function sanitizeAdminSnapshot(raw,{now=Date.now()}={}){
  if(raw?.test!==true||raw.live!==false||raw.releaseEnabled!==false||!Number.isSafeInteger(now))throw Error('Private test overview required');
  const observedAt=date(raw.observedAt,now);if(now-Date.parse(observedAt)>60000)throw Error('Stale database snapshot');
  const counts=Object.fromEntries(countKeys.map(k=>[k,number(raw.counts?.[k])]));
  if(counts.paidOrders>counts.orders||counts.heldOrders>counts.orders||!Array.isArray(raw.orders)||raw.orders.length>15||!Array.isArray(raw.cases)||raw.cases.length>10||raw.orders.length+raw.cases.length>25||typeof raw.hasMoreOrders!=='boolean'||typeof raw.hasMoreCases!=='boolean')throw Error('Bounded overview required');
  const orders=raw.orders.map(o=>{if(!UUID.test(o?.orderRef||'')||!states.includes(o.state)||!['pending','clear','review','blocked'].includes(o.riskStatus)||!['none','pending','partial','refunded','failed','review'].includes(o.refundState)||o.holdRequired!==true)throw Error('Invalid order overview');const totalCents=number(o.totalCents);if(totalCents>30000000)throw Error('Invalid order total');return {orderRef:o.orderRef,state:o.state,riskStatus:o.riskStatus,refundState:o.refundState,totalCents,observedAt:date(o.observedAt,now),holdRequired:true};});
  const cases=raw.cases.map(c=>{if(!CASE.test(c?.caseRef||'')||!UUID.test(c.orderRef||'')||!['dispute','early_fraud_warning'].includes(c.kind)||!caseStates.includes(c.status)||typeof c.requiresResponse!=='boolean'||c.holdRequired!==true)throw Error('Invalid case overview');return {caseRef:c.caseRef,orderRef:c.orderRef,kind:c.kind,status:c.status,requiresResponse:c.requiresResponse,dueBy:c.dueBy===null?null:deadline(c.dueBy),observedAt:date(c.observedAt,now),holdRequired:true};});
  if(new Set(orders.map(o=>o.orderRef)).size!==orders.length||new Set(cases.map(c=>c.caseRef)).size!==cases.length)throw Error('Duplicate overview reference');
  const sources={stripeObservedAt:date(raw.sources?.stripeObservedAt,now,true),sellerObservedAt:date(raw.sources?.sellerObservedAt,now,true),shippingObservedAt:date(raw.sources?.shippingObservedAt,now,true)};
  return {test:true,live:false,releaseEnabled:false,observedAt,counts,orders,cases,hasMoreOrders:raw.hasMoreOrders,hasMoreCases:raw.hasMoreCases,sources};
 }
 function deadline(value){if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid case deadline');return value;}

return Object.freeze({sanitizeAdminSnapshot});
});
