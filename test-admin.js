'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else{root.RackRelicAdminOverview=api;if(root.document)api.mount({document:root.document,window:root,fetchImpl:root.fetch.bind(root),storage:root.sessionStorage,environments:root.RackRelicTestEnvironments});}
})(globalThis,function(){
 const reserveRead=typeof module==='object'&&module.exports?require('./test-reserve-read.js'):globalThis.RackRelicReserveRead;
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
  if(value.reserve!==undefined)expected.reserve=reserveRead.validate(value.reserve,{environmentId,now});
  return expected;
 }
 function adminAttention(value,{environmentId,now=Date.now()}={}){
  const data=validateAdminOverview(value,{environmentId,now}),items=[];
  const steps={deadline_reached:'Keep the money on hold. Ask for help reviewing the Stripe case and its response options now.',deadline_soon:'Keep the money on hold. Arrange a review of the Stripe case before the recorded deadline.',deadline_unknown:'Check the case in Stripe through authorized access. A missing deadline does not mean there is no deadline.',response_required:'Arrange a review of the Stripe case and record who will respond before the deadline.',case_conflict:'Keep the money on hold until the conflicting records have been checked.',alert_delivery:'Check the cases on this page and have alert delivery checked. Do not wait for an email that may not arrive.',case_coverage:'Have the remaining cases checked through authorized access before relying on this list.',order_coverage:'Have the remaining order records checked through authorized access.',source_missing:'Have this connection and its latest records checked before making a decision.',source_stale:'Have the latest information checked directly; refreshing this page alone will not update the service.',website_coverage:'Use authorized Vercel access to check website errors if there is a problem.',backup_coverage:'Complete and verify a recovery test before relying on backups for launch.'};
  const add=(kind,priority,message,details={})=>items.push({kind,priority,message,nextStep:steps[kind],...details});
  for(const c of data.cases){
   if(c.requiresResponse){
    const remaining=c.dueBy===null?null:Date.parse(c.dueBy)-now;
    const kind=remaining===null?'deadline_unknown':remaining<=0?'deadline_reached':remaining<=86400000?'deadline_soon':'response_required';
    const priority=remaining===null?2:remaining<=0?0:remaining<=86400000?1:3;
    const message=remaining===null?'Response required; no deadline was provided. Check the provider case.':remaining<=0?'Response deadline reached or overdue. Review this case now.':remaining<=86400000?'Response due within 24 hours. Review this case.':'Response required. Review the recorded deadline.';
    add(kind,priority,message,{caseRef:c.caseRef,dueBy:c.dueBy});
   }
   if(c.status==='conflicting_evidence')add('case_conflict',2,'Conflicting case evidence needs review; money stays held.',{caseRef:c.caseRef,dueBy:null});
  }
  if(data.counts.alertDeliveryGaps>0)add('alert_delivery',2,data.counts.alertDeliveryGaps+(data.counts.alertDeliveryGaps===1?' case alert has':' case alerts have')+' no confirmed delivery. Do not assume a notification reached you.');
  if(data.hasMoreCases)add('case_coverage',3,'More cases are not shown here. The deadlines on this page are not a complete list.');
  if(data.hasMoreOrders)add('order_coverage',3,'More orders are not shown here. This is a recent-order summary.');
  const names={stripe:'Payments and disputes',sellers:'Seller verification',shipping:'Shipping updates'};
  for(const [key,name]of Object.entries(names)){
   const s=data.sources[key];
   if(s.state==='not_recorded')add('source_missing',4,name+': no information recorded yet. Current status is unknown.');
   else if(s.state==='stale')add('source_stale',4,name+': the last saved update is more than five minutes old.');
  }
  if(data.sources.vercel.state==='unavailable')add('website_coverage',4,'Website health is not checked by this page yet.');
  if(data.sources.backups.state==='unavailable')add('backup_coverage',4,'Backup recovery has not been verified here yet.');
  const due=item=>typeof item.dueBy==='string'?Date.parse(item.dueBy):Infinity;
  items.sort((a,b)=>a.priority-b.priority||due(a)-due(b)||String(a.caseRef||'').localeCompare(String(b.caseRef||'')));
  return items;
 }
 function mount({document,window,fetchImpl,storage,environments,workModule=window.RackRelicAdminWork,setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window),clock=Date.now}={}){
  const $=id=>document.getElementById(id),notice=text=>{$('notice').textContent=text;};
  let config=null,key=null,timer=null,controller=null,generation=0,pending=false,focused=typeof document.hasFocus==='function'?document.hasFocus():true,destroyed=false,sessionRaw=null,workClient=null,workRoot=null,layoutReady=false;
  const visible=()=>!destroyed&&focused&&document.hidden!==true&&document.visibilityState!=='hidden';
  function clearData(){workClient?.destroy();workClient=null;workRoot?.replaceChildren();workRoot=null;layoutReady=false;$('overview').hidden=true;for(const id of ['attention','counts','sources','orders','cases','reserve-read'])$(id)?.replaceChildren();$('overview').replaceChildren();$('as-of').textContent='';if($('page-title'))$('page-title').textContent='Sign in to Rack Command';}
  function stop(){generation++;if(timer!==null){clearTimer(timer);timer=null;}if(controller){controller.abort();controller=null;}pending=false;$('refresh').disabled=true;clearData();}
  function readSession(){if(!key)return null;try{const raw=storage.getItem(key);if(typeof raw!=='string'||raw.length>16384)return null;const saved=JSON.parse(raw);if(typeof saved?.token!=='string'||!/^\S{1,8192}$/.test(saved.token)||!UUID.test(saved.member||''))return null;return {raw,token:saved.token,member:saved.member};}catch{return null;}}
  function signedOut(message,remove=false){stop();if(remove&&key)try{storage.removeItem(key);}catch{}sessionRaw=null;$('logout').hidden=true;$('signin-link').hidden=false;notice(message||'Sign in above with your practice owner account to open your control center.');}
  function schedule(){if(visible()&&readSession()&&timer===null)timer=setTimer(()=>{timer=null;void refresh();},30000);}
  function current(version,raw){if(generation!==version||!visible())return false;if(readSession()?.raw!==raw){stop();sessionRaw=null;notice('Your sign-in changed. Private information has been hidden.');return false;}return true;}
  const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
  const format=value=>value===null?'Not recorded':new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles',timeZoneName:'short'}).format(new Date(value));
  const orderLabels={reserved:'Checkout being prepared',checkout_open:'Checkout open',payment_pending:'Waiting for payment confirmation',paid:'Practice payment recorded',expired:'Checkout expired',review:'Order needs review',payment_failed:'Payment failed',cancelled:'Order cancelled'};
  const riskLabels={pending:'Payment checks pending',clear:'No risk flag in the last saved check',review:'Payment review needed',blocked:'Payment flagged — keep on hold'};
  const refundLabels={none:'No refund recorded',pending:'Waiting for refund confirmation',partial:'Partial refund recorded',refunded:'Full refund recorded',failed:'Refund failed — review needed',review:'Refund needs review'};
  const caseLabels={warning_received:'Fraud warning received',warning_needs_response:'Fraud warning needs a response',warning_under_review:'Fraud warning under review',warning_closed:'Fraud warning closed',needs_response:'Response needed',under_review:'Stripe is reviewing the dispute',appeal_needs_response:'Appeal needs a response',appeal_under_review:'Appeal under review',won:'Dispute outcome: won',lost:'Dispute outcome: lost',prevented:'Dispute reported as prevented',conflicting_evidence:'Records disagree — review needed'};
  function reference(label,value){const el=document.createElement('details'),summary=text('summary',label+' '+value.replace(/^case_/,'').slice(0,8));el.append(summary,text('p','Full reference: '+value));return el;}
  function recordLink(label,target){const a=text('a',label);a.href='#'+target;return a;}
  function draftButton(record){
   if(config.workEnabled!==true||typeof workClient?.startFromRecord!=='function')return null;
   const version=generation,raw=sessionRaw,button=text('button','Draft follow-up');button.type='button';
   button.addEventListener('click',()=>{if(!current(version,raw))return;workClient?.startFromRecord(record);window.location.hash='work-heading';});return button;
  }
  function layout(){
   const el=(tag,id,value)=>{const node=document.createElement(tag);if(id)node.id=id;if(value)node.textContent=value;return node;};
   const content=el('div','workspace-content');
   const section=(title,id)=>{const node=el('section');node.className='card';node.append(el('h2',null,title));if(id)node.append(el('div',id));content.append(node);return node;};
   const links=el('nav');links.className='rack-navigation';links.setAttribute?.('aria-label','Control center sections');for(const [label,id]of [['Needs attention','attention-heading'],['Follow-up work','work-heading'],['Seller money held','reserve-heading'],['Orders at a glance','counts-heading'],['People','people-heading'],['Companies and connections','sources-heading'],['Recent orders','orders-heading'],['Disputes and reviews','cases-heading']]){const a=el('a',null,label);a.href='#'+id;links.append(a);}$('overview').append(links,content);
   const help=el('details');help.append(el('summary',null,'How to use your control center'),el('p',null,'1. Read the items needing attention.  2. Check the related order or case.  3. Follow its next step. Payment information is view-only: this page cannot approve payments, issue refunds or pay sellers.'));content.append(help);
   const attention=section('Needs your attention');attention.children[0].id='attention-heading';attention.append(el('ul','attention'));
   const work=section('Your follow-up work');work.children[0].id='work-heading';if(!workRoot){workRoot=el('div','work-tools');if(config.workEnabled!==true)workRoot.append(el('p',null,'Your follow-up tools are being prepared for activation. They are not connected to this website yet.'));}work.append(workRoot);
   const reserve=section('Seller money owed and held');reserve.children[0].id='reserve-heading';const reserveRoot=el('div','reserve-read');reserve.append(reserveRoot);
   const counts=section('Orders at a glance');counts.children[0].id='counts-heading';counts.append(el('dl','counts'));
   const people=section('Customers and sellers');people.children[0].id='people-heading';people.append(el('p',null,'Live customer and seller profiles are not loaded into this practice view yet. Their details must come from Rack Relic\'s verified records; CCP contacts are kept separate.'));
   const sources=section('Companies, connections and last updates');sources.children[0].id='sources-heading';sources.append(el('div','sources'));
   for(const [title,note,rows,headings]of [['Recent orders','order-note','orders',['Order','What is happening','Buyer total','Last update']],['Disputes and payment reviews','case-note','cases',['Case and order','What is happening','Response deadline','Last update']]]){
    const node=section(title),table=el('table'),thead=el('thead'),tr=el('tr'),wrap=el('div');node.children[0].id=rows+'-heading';wrap.className='table';for(const label of headings)tr.append(el('th',null,label));thead.append(tr);table.append(thead,el('tbody',rows));wrap.append(table);node.append(el('p',note),wrap);
   }
  }
  function render(data,now){
   if(!layoutReady){clearData();layout();layoutReady=true;}else for(const id of ['attention','counts','sources','orders','cases','reserve-read'])$(id).replaceChildren();if($('page-title'))$('page-title').textContent='Rack Command';$('overview').hidden=false;$('signin-link').hidden=true;$('as-of').textContent='Records last updated: '+format(data.observedAt)+'. Each connection below shows its own last saved update.';
   if(config.workEnabled===true){
    if(!workClient&&typeof workModule?.mount==='function'){const boundGeneration=generation,boundSession=sessionRaw;workClient=workModule.mount({root:workRoot,document,window,fetchImpl,storage,environmentId:config.environmentId,clock,session:()=>{const s=readSession();return visible()&&generation===boundGeneration&&s?.raw===boundSession?{token:s.token,member:s.member}:null;},onAccessLost:()=>{if(current(boundGeneration,boundSession))signedOut('Your owner access could not be confirmed. Sign in again using Practice sign-in above.',true);}});}
    if(workClient)void workClient.refresh();else{workRoot.replaceChildren();workRoot.append(text('p','Follow-up tools could not be opened. Ask for help checking their setup.'));}
   }
   for(const item of adminAttention(data,{environmentId:config.environmentId,now})){const li=document.createElement('li');li.className='attention-item '+(item.priority===0?'urgent':item.priority<=2?'review':'setup');li.append(text('strong',item.priority===0?'Act now':item.priority===1?'Due soon':item.priority<=3?'Needs review':'Setup needed'),text('p',item.message));if(item.caseRef)li.append(reference('Case',item.caseRef));if(item.dueBy)li.append(text('p','Recorded deadline: '+format(item.dueBy)));li.append(text('p','Next step: '+item.nextStep));const target=item.caseRef?'case-'+item.caseRef:['case_coverage','alert_delivery'].includes(item.kind)?'cases-heading':item.kind==='order_coverage'?'orders-heading':'sources-heading';li.append(recordLink(item.caseRef?'View this case':target==='cases-heading'?'View cases':target==='orders-heading'?'View orders':'View connections',target));$('attention').append(li);}
   const reserve=config.reserveReadEnabled===true&&config.reserveReadVersion===reserveRead.VERSION?(data.reserve||reserveRead.coverage('source_old',{now,environmentId:config.environmentId})):reserveRead.coverage(config.reserveReadVersion===undefined?'source_old':'disabled',{now,environmentId:config.environmentId});
   reserveRead.render($('reserve-read'),document,reserve,{now,environmentId:config.environmentId});
   const labels={orders:'Practice orders',paidOrders:'Practice payments recorded',heldOrders:'Orders still on hold',sellers:'Practice seller accounts',openCases:'Cases needing a response or review',alertDeliveryGaps:'Alerts not confirmed as delivered'};
   for(const k of countKeys)$('counts').append(text('dt',labels[k]),text('dd',String(data.counts[k])));
   const names={database:'Orders and records · Supabase',stripe:'Payments and disputes · Stripe',sellers:'Seller verification · Stripe',shipping:'Shipping updates · Shippo',vercel:'Website · Vercel',backups:'Backups and recovery'};
   for(const [k,s]of Object.entries(data.sources)){const card=document.createElement('article');card.className='card';card.append(text('h3',names[k]));let description;
    if(k==='database')description='Practice records loaded. This does not check the other services directly.';
    else if(k==='vercel')description='Not checked here yet. Website errors and availability are not connected to this page.';
    else if(k==='backups')description='Not verified yet. A backup plan alone does not prove that records and photos can be restored.';
    else description=s.state==='not_recorded'?'No information recorded yet. Current status is unknown.':s.state==='stale'?'Last saved update is more than five minutes old. Current status is unknown.':'Recent practice information is saved. The service itself has not been checked directly.';
    card.append(text('p',description),text('p','Last saved update: '+format(s.observedAt)));const shortcut=k==='database'?['Open Rack test database','https://supabase.com/dashboard/project/tzymapahsfiyhgilsmxl']:k==='backups'?['Open private photo archive','https://dash.cloudflare.com/7a3ed4f82692abebebc6447e5f5e217c/r2/default/buckets/rack-relic-private-photo-archive']:null;if(shortcut&&config.environmentId==='acceptance-v1'){const link=text('a',shortcut[0]);link.href=shortcut[1];link.target='_blank';link.rel='noopener noreferrer';card.append(link);}if(k==='vercel'&&s.revision){const details=document.createElement('details');details.append(text('summary','Technical details'),text('p','Practice website version: '+s.revision));card.append(details);}$('sources').append(card);
   }
   for(const [name,description]of [['Domain name · GoDaddy','Manages Rack Relic\'s domain name. Domain and billing status are not checked here yet.'],['Rack Relic email · Microsoft 365','Rack Relic\'s mailbox is not connected to this control center yet. No CCP mailbox is used.']]){const card=document.createElement('article');card.className='card';card.append(text('h3',name),text('p',description));$('sources').append(card);}
   for(const o of data.orders){const row=document.createElement('tr');row.id='order-'+o.orderRef;const ref=text('td',''),status=text('td','');ref.append(reference('Order',o.orderRef));const draft=draftButton({kind:'order',ref:o.orderRef});if(draft)ref.append(draft);for(const line of [orderLabels[o.state],riskLabels[o.riskStatus],refundLabels[o.refundState],'Seller money stays on hold'])status.append(text('p',line));row.append(ref,status,text('td',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(o.totalCents/100)),text('td',format(o.observedAt)));$('orders').append(row);}
   for(const c of data.cases){const row=document.createElement('tr');row.id='case-'+c.caseRef;const ref=text('td',''),status=text('td','');ref.append(reference('Case',c.caseRef),reference('Order',c.orderRef));if(data.orders.some(o=>o.orderRef===c.orderRef))ref.append(recordLink('View related order','order-'+c.orderRef));const draft=draftButton({kind:'case',ref:c.caseRef,orderRef:c.orderRef});if(draft)ref.append(draft);status.append(text('p',c.kind==='dispute'?'Bank dispute':'Early fraud warning'),text('p',caseLabels[c.status]),text('p',c.requiresResponse?'A response is needed. Seller money stays on hold.':'Seller money stays on hold.'));row.append(ref,status,text('td',c.dueBy===null?'No deadline recorded — check the case':format(c.dueBy)),text('td',format(c.observedAt)));$('cases').append(row);}
   $('order-note').textContent=data.hasMoreOrders?'Showing the latest 15 orders. More orders are not shown here.':data.orders.length?'Practice orders only.':'No practice orders yet. This does not show live sales.';
   $('case-note').textContent=data.hasMoreCases?'Showing up to 10 priority cases. More cases need checking before you rely on this list.':data.cases.length?'A closed case does not automatically release seller money.':'No practice cases recorded. Live disputes are not verified by this page.';
   notice('Your practice control center is open. Real payments and seller payouts are off.');
  }
  async function refresh(){
   if(!config||!visible()||pending)return;
   const session=readSession();if(!session){signedOut();return;}
   if(sessionRaw!==null&&sessionRaw!==session.raw)stop();sessionRaw=session.raw;
   if(timer!==null){clearTimer(timer);timer=null;}pending=true;const version=generation,raw=session.raw;controller=new AbortController();const active=controller;$('refresh').disabled=true;$('logout').hidden=false;notice('Checking authorized test records…');
   try{const response=await fetchImpl('/api/test-admin?action=overview',{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.any([active.signal,AbortSignal.timeout(20000)]),headers:{Authorization:'Bearer '+session.token}});
    if(!current(version,raw))return;
    if(response.status===401||response.status===403){signedOut('Your owner access could not be confirmed. Sign in again using Practice sign-in above.',true);return;}
    if(!response.ok||cached(response))throw Error('Private overview is unavailable; provider status remains unknown.');
    const data=await response.json();if(!current(version,raw))return;const now=clock();render(validateAdminOverview(data,{environmentId:config.environmentId,now}),now);
   }catch{if(current(version,raw)){clearData();notice('We could not load your latest information. Private details have been hidden. Try Refresh now; the current status of Stripe and shipping is unknown.');}}
   finally{if(generation===version){pending=false;if(controller===active)controller=null;$('refresh').disabled=!visible()||!readSession();schedule();}}
  }
  async function start(){
   try{const response=await fetchImpl('/api/test-admin?action=config',{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||cached(response))throw Error('Unavailable configuration');const value=await response.json();if(destroyed)return;
    const row=Array.isArray(environments)?environments.find(e=>e.id===value.environmentId&&e.projectUrl===value.projectUrl&&e.returnUrl===value.returnUrl):null;
    if(value.test!==true||value.live!==false||value.workEnabled!==undefined&&typeof value.workEnabled!=='boolean'||value.reserveReadEnabled!==undefined&&typeof value.reserveReadEnabled!=='boolean'||value.reserveReadEnabled===true&&(value.environmentId!=='acceptance-v1'||value.reserveReadVersion!==reserveRead.VERSION)||!row||window.location?.origin!==new URL(row.returnUrl).origin)throw Error('Unapproved test environment');
    config=value;key='rr-private-test-session'+(row.id==='acceptance-v1'?':acceptance-v1':'');$('signin-link').href=row.returnUrl;await refresh();if(!readSession())signedOut();
   }catch{signedOut('This practice control center is not ready to open yet. Ask for help checking its setup.');}
  }
  function cached(response){const age=response.headers?.get('age');return age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase()));}
  $('refresh').addEventListener('click',()=>void refresh());$('logout').addEventListener('click',()=>signedOut('Signed out. Private overview cleared.',true));
  const visibility=()=>{if(!visible()){stop();notice('Overview paused while this page is hidden.');}else void refresh();};
  const blur=()=>{focused=false;stop();notice('Overview paused while this window is inactive.');},focus=()=>{focused=true;void refresh();};
  const storageChange=e=>{if(e.key===key&&readSession()?.raw!==sessionRaw){stop();sessionRaw=null;void refresh();}};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);window.addEventListener('focus',focus);window.addEventListener('storage',storageChange);
  void start();return {refresh,destroy(){destroyed=true;stop();document.removeEventListener?.('visibilitychange',visibility);window.removeEventListener?.('blur',blur);window.removeEventListener?.('focus',focus);window.removeEventListener?.('storage',storageChange);}};
 }
 return Object.freeze({sanitizeAdminSnapshot,projectAdminOverview,validateAdminOverview,adminAttention,mount});
});
