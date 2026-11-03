'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else{root.RackRelicAdminOverview=api;if(root.document)api.mount({document:root.document,window:root,fetchImpl:root.fetch.bind(root),storage:root.sessionStorage,environments:root.RackRelicTestEnvironments});}
})(globalThis,function(){
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
 function source(kind,observedAt,now){return {kind,observedAt,state:observedAt===null?'not_recorded':now-Date.parse(observedAt)>300000?'stale':'stored_evidence',health:'unverified'};}
 function projectAdminOverview(raw,{environmentId,revision,now=Date.now()}={}){
  if(!['legacy','acceptance-v1'].includes(environmentId))throw Error('Approved test environment required');
  const s=sanitizeAdminSnapshot(raw,{now});
  return {...s,environmentId,sources:{
   database:{kind:'supabase_snapshot',state:'snapshot',observedAt:s.observedAt,health:'unverified'},
   stripe:source('stored_sandbox_events',s.sources.stripeObservedAt,now),
   sellers:source('stored_sandbox_verification',s.sources.sellerObservedAt,now),
   shipping:source('stored_sample_tracking',s.sources.shippingObservedAt,now),
   vercel:{kind:'deployment_metadata_only',state:'unavailable',observedAt:null,health:'unverified',revision:typeof revision==='string'&&/^[a-f0-9]{40}$/.test(revision)?revision:null},
   backups:{kind:'restore_acceptance',state:'unavailable',observedAt:null,health:'unverified'}
  }};
 }
 function validateAdminOverview(value,{environmentId,now=Date.now()}={}){
  if(value?.environmentId!==environmentId)throw Error('Overview environment mismatch');
  const s=sanitizeAdminSnapshot({...value,sources:{stripeObservedAt:value.sources?.stripe?.observedAt,sellerObservedAt:value.sources?.sellers?.observedAt,shippingObservedAt:value.sources?.shipping?.observedAt}},{now});
  const expected=projectAdminOverview(s,{environmentId,revision:value.sources?.vercel?.revision,now});
  for(const [key,source]of Object.entries(expected.sources)){
   const provided=value.sources?.[key];if(!provided)throw Error('Invalid source classification');
   for(const field of Object.keys(source)){
    if(field==='state'&&['stripe','sellers','shipping'].includes(key)&&['stored_evidence','stale'].includes(source.state)&&['stored_evidence','stale'].includes(provided.state)){if(provided.state==='stale')source.state='stale';continue;}
    if(provided[field]!==source[field])throw Error('Invalid or stale source classification');
   }
  }
  return expected;
 }
 function mount({document,window,fetchImpl,storage,environments,setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window),clock=Date.now}={}){
  const $=id=>document.getElementById(id),notice=text=>{$('notice').textContent=text;};
  let config=null,key=null,timer=null,controller=null,generation=0,pending=false,focused=typeof document.hasFocus==='function'?document.hasFocus():true,destroyed=false,sessionRaw=null;
  const visible=()=>!destroyed&&focused&&document.hidden!==true&&document.visibilityState!=='hidden';
  function clearData(){$('overview').hidden=true;for(const id of ['counts','sources','orders','cases'])$(id)?.replaceChildren();$('overview').replaceChildren();$('as-of').textContent='';if($('page-title'))$('page-title').textContent='Private access required';}
  function stop(){generation++;if(timer!==null){clearTimer(timer);timer=null;}if(controller){controller.abort();controller=null;}pending=false;$('refresh').disabled=true;clearData();}
  function readSession(){if(!key)return null;try{const raw=storage.getItem(key);if(typeof raw!=='string'||raw.length>16384)return null;const saved=JSON.parse(raw);if(typeof saved?.token!=='string'||!/^\S{1,8192}$/.test(saved.token)||!UUID.test(saved.member||''))return null;return {raw,token:saved.token};}catch{return null;}}
  function signedOut(message,remove=false){stop();if(remove&&key)try{storage.removeItem(key);}catch{}sessionRaw=null;$('logout').hidden=true;notice(message||'Sign in through the private test page to view this overview.');}
  function schedule(){if(visible()&&readSession()&&timer===null)timer=setTimer(()=>{timer=null;void refresh();},30000);}
  function current(version,raw){if(generation!==version||!visible())return false;if(readSession()?.raw!==raw){stop();sessionRaw=null;notice('Sign-in changed. Private overview cleared.');return false;}return true;}
  const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
  const format=value=>value===null?'Not recorded':new Date(value).toLocaleString();
  function layout(){
   const el=(tag,id,value)=>{const node=document.createElement(tag);if(id)node.id=id;if(value)node.textContent=value;return node;};
   const section=(title,id)=>{const node=el('section');node.className='card';node.append(el('h2',null,title));if(id)node.append(el('div',id));$('overview').append(node);return node;};
   section('Saved test activity').append(el('dl','counts'));section('Source observations').append(el('div','sources'));
   for(const [title,note,rows,headings]of [['Recent test orders','order-note','orders',['Order reference','Saved state','Saved total','Last record update']],['Saved dispute and fraud cases','case-note','cases',['Case / order reference','Saved status','Response deadline','Last observation']]]){
    const node=section(title),table=el('table'),thead=el('thead'),tr=el('tr');for(const label of headings)tr.append(el('th',null,label));thead.append(tr);table.append(thead,el('tbody',rows));node.append(el('p',note),table);
   }
  }
  function render(data){
   clearData();layout();if($('page-title'))$('page-title').textContent='Rack Relic owner overview';$('overview').hidden=false;$('as-of').textContent='Database snapshot: '+format(data.observedAt)+'. Provider times below are saved observations, not current provider health.';
   const labels={orders:'Test orders',paidOrders:'Orders marked paid in test mode',heldOrders:'Orders with exposure still held',sellers:'Test seller bindings',openCases:'Cases needing response or review',alertDeliveryGaps:'Unconfirmed case alerts'};
   for(const k of countKeys)$('counts').append(text('dt',labels[k]),text('dd',String(data.counts[k])));
   const names={database:'Supabase records',stripe:'Stripe test payments and cases',sellers:'Stripe test seller checks',shipping:'Shippo sample tracking',vercel:'Website deployment',backups:'Backup recovery acceptance'};
   for(const [k,s]of Object.entries(data.sources)){const card=document.createElement('article');card.className='card';card.append(text('h3',names[k]));let description;
    if(k==='database')description='Private database snapshot read. This is not a provider availability check.';
    else if(k==='vercel')description=s.revision?'Preview revision '+s.revision.slice(0,12)+'. Vercel service status and logs unavailable.':'Vercel service status and logs unavailable.';
    else if(k==='backups')description='Hosted backup and restore evidence unavailable.';
    else description=s.state==='not_recorded'?'No saved observation. Current provider status is unknown.':s.state==='stale'?'Saved observation is older than five minutes. Current provider status is unknown.':'Recent saved test evidence. Current provider status is unverified.';
    card.append(text('p',description),text('p','Last source observation: '+format(s.observedAt)));$('sources').append(card);
   }
   for(const o of data.orders){const row=document.createElement('tr');row.append(text('td',o.orderRef),text('td',o.state.replaceAll('_',' ')+' · risk '+o.riskStatus+' · refund '+o.refundState+' · money held'),text('td',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(o.totalCents/100)),text('td',format(o.observedAt)));$('orders').append(row);}
   for(const c of data.cases){const row=document.createElement('tr');row.append(text('td',c.caseRef+' / '+c.orderRef),text('td',c.status.replaceAll('_',' ')+(c.requiresResponse?' · response required':'')+' · money held'),text('td',c.dueBy===null?'No deadline provided':format(c.dueBy)),text('td',format(c.observedAt)));$('cases').append(row);}
   $('order-note').textContent=data.hasMoreOrders?'Showing the latest 15 orders. Additional records remain in the private database.':data.orders.length?'Saved test orders only.':'No saved test orders.';
   $('case-note').textContent=data.hasMoreCases?'Showing up to 10 priority cases. This overview is not the complete deadline queue.':data.cases.length?'Cases remain held even when the provider reports closure.':'No saved cases. This does not establish live dispute coverage.';
   notice('Authorized owner test overview. Real payments and seller payouts remain closed.');
  }
  async function refresh(){
   if(!config||!visible()||pending)return;
   const session=readSession();if(!session){signedOut();return;}
   if(sessionRaw!==null&&sessionRaw!==session.raw)stop();sessionRaw=session.raw;
   if(timer!==null){clearTimer(timer);timer=null;}pending=true;const version=generation,raw=session.raw;controller=new AbortController();const active=controller;$('refresh').disabled=true;$('logout').hidden=false;notice('Checking authorized test records…');
   try{const response=await fetchImpl('/api/test-admin?action=overview',{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.any([active.signal,AbortSignal.timeout(20000)]),headers:{Authorization:'Bearer '+session.token}});
    if(!current(version,raw))return;
    if(response.status===401||response.status===403){signedOut('Owner access is unavailable. Sign in again through the private test page.',true);return;}
    if(!response.ok||cached(response))throw Error('Private overview is unavailable; provider status remains unknown.');
    const data=await response.json();if(!current(version,raw))return;render(validateAdminOverview(data,{environmentId:config.environmentId,now:clock()}));
   }catch{if(current(version,raw)){clearData();notice('Private overview is unavailable. Saved data is cleared; provider health is unknown.');}}
   finally{if(generation===version){pending=false;if(controller===active)controller=null;$('refresh').disabled=!visible()||!readSession();schedule();}}
  }
  async function start(){
   try{const response=await fetchImpl('/api/test-admin?action=config',{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||cached(response))throw Error('Unavailable configuration');const value=await response.json();if(destroyed)return;
    const row=Array.isArray(environments)?environments.find(e=>e.id===value.environmentId&&e.projectUrl===value.projectUrl&&e.returnUrl===value.returnUrl):null;
    if(value.test!==true||value.live!==false||!row||window.location?.origin!==new URL(row.returnUrl).origin)throw Error('Unapproved test environment');
    config=value;key='rr-private-test-session'+(row.id==='acceptance-v1'?':acceptance-v1':'');$('signin-link').href=row.returnUrl;await refresh();if(!readSession())signedOut();
   }catch{signedOut('The private overview environment is unavailable.');}
  }
  function cached(response){const age=response.headers?.get('age');return age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase()));}
  $('refresh').addEventListener('click',()=>void refresh());$('logout').addEventListener('click',()=>signedOut('Signed out. Private overview cleared.',true));
  const visibility=()=>{if(!visible()){stop();notice('Overview paused while this page is hidden.');}else void refresh();};
  const blur=()=>{focused=false;stop();notice('Overview paused while this window is inactive.');},focus=()=>{focused=true;void refresh();};
  const storageChange=e=>{if(e.key===key&&readSession()?.raw!==sessionRaw){stop();sessionRaw=null;void refresh();}};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);window.addEventListener('focus',focus);window.addEventListener('storage',storageChange);
  void start();return {refresh,destroy(){destroyed=true;stop();document.removeEventListener?.('visibilitychange',visibility);window.removeEventListener?.('blur',blur);window.removeEventListener?.('focus',focus);window.removeEventListener?.('storage',storageChange);}};
 }
 return Object.freeze({sanitizeAdminSnapshot,projectAdminOverview,validateAdminOverview,mount});
});
