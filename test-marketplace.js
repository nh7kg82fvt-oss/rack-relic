'use strict';
(()=>{
 const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 let config,emailSignin,token=null,member=null,busy=false,authVersion=0,renderVersion=0,refundWidgets=[],checkoutWidgets=[];
 const callback=new URLSearchParams(location.search).get('code');
 if(callback||location.hash)history.replaceState(null,'',location.pathname);
 const note=text=>{$('notice').textContent=text;};
 function controls(){
  const signed=!!token;$('signin').hidden=signed;$('signed-in').hidden=!signed;
  $('checkout').disabled=!signed||busy;$('refresh').disabled=!signed||busy;$('login').disabled=!config||busy;$('email-link').disabled=!config||busy;
  $('seller-onboarding').hidden=!signed||config?.sellerOnboardingEnabled!==true;
  $('seller-status').disabled=!signed||busy;$('seller-start').disabled=!signed||busy;
  if(!signed)$('seller-result').textContent='';
  for(const update of refundWidgets)update(!signed||busy);
  for(const update of checkoutWidgets)update(!signed||busy);
 }
 async function sellerSetup(start){
  await operation(async version=>{
   $('seller-result').textContent='Checking test seller setup…';
   const d=await api('seller-onboarding',start?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{});
   if(version!==authVersion||!token)return;
   if(d.test!==true||d.transfersEnabled!==false||d.payoutsEnabled!==false)throw Error('Invalid seller status');
   $('seller-result').textContent=d.state==='provider_ready'?'Stripe test verification complete. Transfers and payouts remain disabled.':d.state==='needs_reconciliation'?'Account creation needs review. Do not start another account.':d.state==='verification_pending'?'Stripe is reviewing the test information.':'Test seller setup is incomplete.';
   if(start){const u=new URL(d.onboardingUrl);if(u.protocol!=='https:'||u.hostname!=='connect.stripe.com'||u.port||u.username||u.password||!u.pathname.startsWith('/setup/'))throw Error('Invalid Stripe onboarding link');location.assign(u.href);}
  });
 }
 $('seller-status').addEventListener('click',()=>void sellerSetup(false));
 $('seller-start').addEventListener('click',()=>void sellerSetup(true));
 const checkoutKey=owner=>'rr-private-test-order-'+owner+':'+config.listing.id;
 function savedCheckout(owner){
  return sessionStorage.getItem(checkoutKey(owner))||(config.listing.id==='73737373-7373-4373-8373-737373737373'?sessionStorage.getItem('rr-private-test-order-'+owner):null);
 }
 async function api(action,options={},authorization=token){
  const r=await fetch('/api/test-marketplace?action='+action,{cache:'no-store',signal:AbortSignal.timeout(20000),...options,headers:{...(authorization?{Authorization:'Bearer '+authorization}:{}),...options.headers}});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Test request failed');return data;
 }
 function cents(value){
  if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value))throw Error('Enter dollars and cents, such as 10.00');
  const [d,c='']=value.split('.');const n=Number(d)*100+Number(c.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<1)throw Error('Enter an amount above zero');return n;
 }
 async function operation(action){
  if(busy||!token)return;const version=authVersion;busy=true;controls();
  try{await action(version);}catch(e){if(version===authVersion)note(e.name==='TimeoutError'?'The request timed out. Keep the saved reference and check its status.':e.message);}
  finally{if(version===authVersion){busy=false;controls();}}
 }
 function issuePanel(card,o){
  if(config?.orderIssuesEnabled!==true||o.buyer_id!==member||!['paid','review'].includes(o.state))return;
  const owner=member,authorization=token,version=renderVersion;
  const current=()=>owner===member&&authorization===token&&version===renderVersion;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p');
  summary.textContent='Report a test order problem';status.textContent='Save a test report for review. This does not issue a refund, notify support or create buyer protection.';section.append(summary,status);
  let recorded=false;
  const labels={not_received:'Item not received',damaged:'Item arrived damaged',not_as_described:'Item significantly not as described'},buttons=[];
  const show=r=>{if(r?.test!==true||r.orderId!==o.id||!['not_reported','review_required'].includes(r.state)||r.state==='review_required'&&(!Object.hasOwn(labels,r.reason)||!Number.isFinite(Date.parse(r.reportedAt))))throw Error('Report status needs review');if(r.state==='review_required'){recorded=true;status.textContent='Test report saved: '+labels[r.reason]+'. Review required. No refund has been issued.';for(const b of buttons)b.disabled=true;}else status.textContent='No report saved for this test order.';};
  const action='order-issue&orderId='+encodeURIComponent(o.id);
  function add(label,reason){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;buttons.push(b);checkoutWidgets.push(disabled=>{b.disabled=disabled||recorded&&!!reason;});
   b.addEventListener('click',()=>operation(async auth=>{const existing=await api(action,{},authorization);if(!current()||auth!==authVersion)return;show(existing);if(!reason||existing.state==='review_required')return;const r=await api(action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})},authorization);if(!current()||auth!==authVersion)return;show(r);}));section.append(b);}
  add('Check saved report');for(const [reason,label] of Object.entries(labels))add(label,reason);card.append(section);
 }
 function issueThreadPanel(card,o){
  if(config?.issueResponsesEnabled!==true||!['paid','review'].includes(o.state)||![o.buyer_id,o.seller_id].includes(member))return;
  const owner=member,authorization=token,version=renderVersion,current=()=>version===renderVersion&&owner===member&&authorization===token;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p');summary.textContent='Test order issue updates';status.textContent='Check the saved buyer report and seller response. Suggested actions require review; no return or refund is authorized here.';section.append(summary,status);
  const labels={investigating:'Seller is checking the issue',propose_return:'Seller proposes a return for review',request_review:'Seller requests operator review'},reasons={not_received:'Item not received',damaged:'Item arrived damaged',not_as_described:'Item significantly not as described'};
  const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));let reported=false,responded=false;const buttons=[];
  function show(r){if(r?.test!==true||r.orderId!==o.id||!['not_reported','review_required'].includes(r.state))throw Error('Issue status needs confirmation');if(r.state==='not_reported'){reported=false;status.textContent='No buyer report is saved for this test order.';return;}
   if(!Object.hasOwn(reasons,r.reason)||!date(r.reportedAt)||r.acknowledgedAt!==null&&!date(r.acknowledgedAt)||r.sellerResponse!==null&&(!Object.hasOwn(labels,r.sellerResponse?.kind)||!date(r.sellerResponse.submittedAt)))throw Error('Issue status needs confirmation');reported=true;responded=!!r.sellerResponse;status.textContent=reasons[r.reason]+'. '+(r.sellerResponse?labels[r.sellerResponse.kind]+'. ':'Awaiting seller response. ')+(r.acknowledgedAt?'Acknowledged for follow-up. ':'Awaiting operator acknowledgment. ')+'The issue remains open. No refund or fulfillment release.';
  }
  const action='issue-thread&orderId='+encodeURIComponent(o.id);
  function add(label,response){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;const update=disabled=>{b.disabled=disabled||!!response&&(!reported||responded);};buttons.push(update);checkoutWidgets.push(update);update(busy);
   b.addEventListener('click',()=>operation(async auth=>{if(!current())return;const existing=await api(action,{},authorization);if(!current()||auth!==authVersion)return;show(existing);if(!response||!reported||responded)return;const r=await api(action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response})},authorization);if(!current()||auth!==authVersion)return;show(r);if(!responded||r.sellerResponse.kind!==response)throw Error('Check the saved seller response before trying again.');}));section.append(b);
  }
  add('Check order issue updates');if(owner===o.seller_id){add('I am checking this issue','investigating');add('Propose a return for review','propose_return');add('Request operator review','request_review');}card.append(section);
 }
 function refundPanel(card,o,client){
  const section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Operator test refund';section.append(summary);
  const explain=document.createElement('p');explain.className='small';explain.textContent='Sandbox only. Refund confirmation comes from Stripe’s signed notice. Fulfillment stays on hold.';section.append(explain);
  let saved;try{saved=client.current(o.id);}catch(e){const p=document.createElement('p');p.textContent=e.message;section.append(p);card.append(section);return;}
  section.open=!!saved;
  const refunded=Number.isSafeInteger(o.refunded_cents)?o.refunded_cents:0,remaining=o.total_cents-refunded-(o.refund_pending_cents||0);
  const eligible=['paid','review'].includes(o.state)&&o.refund_state!=='review'&&o.refund_pending_cents===0&&Number.isSafeInteger(remaining)&&remaining>0;
  if(!saved&&!eligible)return;
  const buttons=[],setDisabled=disabled=>{for(const control of buttons)control.disabled=disabled;};refundWidgets.push(setDisabled);
  if(!saved){
   const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),prepare=document.createElement('button');
   input.id='refund-amount-'+o.id;input.type='text';input.inputMode='decimal';input.autocomplete='off';input.required=true;input.value=(remaining/100).toFixed(2);label.htmlFor=input.id;label.textContent='Test refund amount (USD)';prepare.type='submit';prepare.textContent='Review test refund';buttons.push(input,prepare);form.append(label,input,prepare);
   form.addEventListener('submit',e=>{e.preventDefault();if(busy)return;operation(async version=>{const amountCents=cents(input.value);if(amountCents>remaining)throw Error('Amount exceeds the unrefunded total');client.prepare({orderId:o.id,amountCents,baselineCents:refunded});await orders();if(version===authVersion)note('Review the saved test refund amount before issuing it.');});});section.append(form);
  }else{
   const amount=document.createElement('p');amount.textContent='Saved request: '+money(saved.amountCents);const ref=document.createElement('p');ref.className='small';ref.textContent='Refund reference '+saved.requestId;section.append(amount,ref);
   if(saved.phase==='prepared'&&eligible){
    const issue=document.createElement('button');issue.type='button';issue.textContent='Issue '+money(saved.amountCents)+' test refund';buttons.push(issue);
    issue.addEventListener('click',()=>operation(async version=>{await client.submit(o.id);await orders();if(version===authVersion)note('Refund request recorded. The order updates after the signed notice; keep this reference.');}));section.append(issue);
   }else if(saved.phase!=='prepared'){
    const pending=document.createElement('p');pending.className='small';pending.textContent='This request was dispatched. Checking it retrieves the saved request and cannot issue another refund.';section.append(pending);
    const check=document.createElement('button');check.type='button';check.className='secondary';check.textContent='Check saved refund request';buttons.push(check);
    check.addEventListener('click',()=>operation(async version=>{await client.recover(o.id);await orders();if(version===authVersion)note('Saved refund request checked. Signed order notices remain the refund authority.');}));section.append(check);
    if(saved.phase==='known'&&eligible&&['partial','refunded'].includes(o.refund_state)&&refunded>=saved.baselineCents+saved.amountCents){
     const next=document.createElement('button');next.type='button';next.className='secondary';next.textContent='Prepare another test refund';buttons.push(next);
     next.addEventListener('click',()=>operation(async()=>{client.finish(o);await orders();}));section.append(next);
    }
   }else{const hold=document.createElement('p');hold.textContent='This order needs review before the prepared refund can be sent.';section.append(hold);}
   if(saved.phase==='prepared'){
    const change=document.createElement('button');change.type='button';change.className='secondary';change.textContent='Change amount before sending';buttons.push(change);
    change.addEventListener('click',()=>operation(async()=>{client.discardPrepared(o.id);await orders();}));section.append(change);
   }
  }
  card.append(section);
 }
 function issueRefundReviewPanel(card,o,client){
  if(config?.issueRefundReviewEnabled!==true||!['paid','review'].includes(o.state))return;
  const owner=member,authorization=token,version=renderVersion,current=()=>owner===member&&authorization===token&&version===renderVersion;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),check=document.createElement('button'),stage=document.createElement('button');summary.textContent='Issue refund readiness';status.textContent='Check confirmed refunds and outstanding requests before reviewing another refund. Return requirements and the support decision still need review.';check.type=stage.type='button';check.className=stage.className='secondary';check.textContent='Check issue refund readiness';stage.textContent='Prepare remaining test refund for review';stage.hidden=true;section.append(summary,status,check,stage);card.append(section);checkoutWidgets.push(disabled=>{check.disabled=disabled;stage.disabled=disabled;});
  const labels={not_reported:'No buyer report is saved for this order.',needs_reconciliation:'Refund evidence needs reconciliation. Keep every saved request reference.',pending:'A refund or saved request is still pending. Do not start another.',refunded:'The full refund is confirmed by payment notices. The issue still requires closure.',awaiting_acknowledgment:'A test operator must acknowledge the report before refund review.',available_for_review:'The remaining amount is available for operator review.'};
  async function readiness(){const r=publicTestIssueRefundReview(await api('issue-refund-review&orderId='+encodeURIComponent(o.id),{},authorization),o.id);if(r.state!=='not_reported'&&r.totalCents!==o.total_cents)throw Error('Order amount needs reconciliation');return r;}
  function show(r){status.textContent=labels[r.state]+(r.state==='not_reported'?'':' Confirmed: '+money(r.confirmedCents)+'. Remaining: '+money(r.remainingCents)+'.');stage.hidden=!r.canPrepare||!!client.current(o.id);if(r.canPrepare&&client.current(o.id))status.textContent+=' Continue with the existing saved refund reference.';}
  check.addEventListener('click',()=>operation(async auth=>{stage.hidden=true;const r=await readiness();if(!current()||auth!==authVersion)return;show(r);}));
  stage.addEventListener('click',()=>operation(async auth=>{
   if(!current())return;stage.hidden=true;if(client.current(o.id))throw Error('Keep the existing refund reference.');const r=await readiness();if(!current()||auth!==authVersion)return;show(r);if(!r.canPrepare)return;
   client.prepare({orderId:o.id,amountCents:r.remainingCents,baselineCents:r.confirmedCents});await orders();if(auth===authVersion&&owner===member)note('Remaining test refund saved for review. Check its amount in Operator test refund before issuing it. No refund was sent.');
  }));
 }
 function trackingPanel(card,o){
  if(config.trackingEnabled!==true)return;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p');summary.textContent='Sample shipment tracking';status.textContent='Check the saved sample status or refresh it from Shippo. Sample tracking does not establish real delivery or release seller funds.';section.append(summary,status);card.append(section);
  const labels={UNKNOWN:'Unknown',PRE_TRANSIT:'Before carrier acceptance',TRANSIT:'In transit',DELIVERED:'Delivered',RETURNED:'Returning to sender',FAILURE:'Delivery problem'};
  const version=renderVersion,owner=member,authorization=token,buttons=[];checkoutWidgets.push(disabled=>buttons.forEach(b=>b.disabled=disabled));
  for(const [label,method] of [['Load saved sample tracking','GET'],['Refresh sample tracking','POST']]){
   const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;buttons.push(b);section.append(b);
   b.addEventListener('click',()=>operation(async()=>{
    const r=await api(method==='GET'?'tracking&orderId='+o.id:'tracking',method==='POST'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})}:{},authorization);if(version!==renderVersion||owner!==member||authorization!==token)return;
    if(r.test!==true||r.orderId!==o.id||!['not_recorded','recorded'].includes(r.state)||r.labelPurchaseEnabled!==false||r.payoutAvailable!==false||typeof r.needsReview!=='boolean')throw Error('Sample tracking needs review. No delivery decision was made.');
    if(r.state==='not_recorded'){
     if(r.status!==null||r.providerStatus!==null||r.eventAt!==null||r.checkedAt!==null||r.needsReview!==false)throw Error('Invalid saved sample tracking');status.textContent='No sample tracking check has been saved.';return;
    }
    if(!Object.hasOwn(labels,r.status)||!Object.hasOwn(labels,r.providerStatus)||!Number.isSafeInteger(r.checkedAt)||r.checkedAt<1000000000000||r.eventAt!==null&&(!Number.isSafeInteger(r.eventAt)||r.eventAt<1000000000000||r.eventAt>r.checkedAt+30000))throw Error('Sample tracking needs review. No delivery decision was made.');
    status.textContent=r.needsReview?'Tracking update needs review. Last accepted test status: '+labels[r.status]+'. Latest provider test status: '+labels[r.providerStatus]+'.':'Carrier test status: '+labels[r.status]+'.';
   }));
  }
 }
 function protectionPanel(card,o){
  if(config?.sellerProtectionsEnabled!==true)return;
  const owner=member,authorization=token,version=renderVersion,current=()=>version===renderVersion&&owner===member&&authorization===token;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),list=document.createElement('ul');summary.textContent='Seller payment protections';status.textContent='Seller money stays held. Check the requirements still needed before release.';section.append(summary,status,list);
  const check=document.createElement('button');check.type='button';check.className='secondary';check.textContent='Check protection holds';checkoutWidgets.push(disabled=>{check.disabled=disabled;});section.append(check);
  check.addEventListener('click',()=>operation(async auth=>{if(!current())return;const value=await api('protection-review&orderId='+encodeURIComponent(o.id),{},authorization);if(!current()||auth!==authVersion)return;const r=RackRelicProtectionReview.publicProtectionReview(value,o.id);list.replaceChildren();if(r.policy){const policy=document.createElement('li');policy.textContent='Initial pilot: $100 complete order limit; one unsettled order across Rack Relic. Minimum two business days after verified delivery; operator review required.';list.append(policy);}for(const reason of r.blockers){const item=document.createElement('li');item.textContent=RackRelicProtectionReview.BLOCKERS[reason];list.append(item);}status.textContent='Seller money is held. No transfer or bank payout was created.';}));
  const label=document.createElement('label'),reason=document.createElement('select'),hold=document.createElement('button');reason.id='seller-hold-'+o.id;label.htmlFor=reason.id;label.textContent='Reason to stop further test sales';for(const [key,text] of Object.entries({suspicious_activity:'Suspicious activity',delivery_problem:'Delivery problem',verification_problem:'Verification problem'})){const option=document.createElement('option');option.value=key;option.textContent=text;reason.append(option);}hold.type='button';hold.className='secondary';hold.textContent='Hold seller for review';checkoutWidgets.push(disabled=>{hold.disabled=disabled;reason.disabled=disabled;});section.append(label,reason,hold);
  hold.addEventListener('click',()=>operation(async auth=>{if(!current())return;const r=await api('protection-hold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id,reason:reason.value})},authorization);if(!current()||auth!==authVersion)return;if(r?.test!==true||r.orderId!==o.id||r.held!==true||r.releaseEnabled!==false)throw Error('Hold needs confirmation. Keep seller funds on hold.');status.textContent='Seller held for review. Further test sales are blocked. Refreshing verification cannot clear this hold.';}));
  card.append(section);
 }
 function riskPanel(card,o){
  if(config.riskCheckEnabled!==true)return;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),button=document.createElement('button');summary.textContent='Test payment risk check';
  const labels={pending:'Risk evidence has not been checked.',clear:'Risk evidence is clear for label review.',review:'Payment risk is held for review.',blocked:'Payment risk blocks fulfillment.'};status.textContent=Object.hasOwn(labels,o.risk_status)?labels[o.risk_status]:'Payment risk needs review.';
  const explain=document.createElement('p');explain.className='small';explain.textContent='Refreshes Stripe test evidence. Existing review holds cannot be silently cleared. This does not generate a label or pay a seller.';button.type='button';button.className='secondary';button.textContent='Refresh test payment risk';section.append(summary,status,explain,button);card.append(section);
  const version=renderVersion,owner=member,authorization=token;checkoutWidgets.push(disabled=>button.disabled=disabled);
  button.addEventListener('click',()=>operation(async auth=>{
   const r=await api('risk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})},authorization);if(version!==renderVersion||owner!==member||authorization!==token)return;
   if(r.test!==true||r.orderId!==o.id||!['clear','review','blocked'].includes(r.riskStatus)||!Number.isSafeInteger(r.checkedAt)||r.checkedAt<Date.now()-300000||r.checkedAt>Date.now()+30000||r.labelGenerated!==false||r.payoutCreated!==false)throw Error('Risk evidence needs review. No label or payout was created.');
   await orders();if(auth===authVersion&&owner===member&&authorization===token)note(labels[r.riskStatus]+' No label or payout was created.');
  }));
 }
 function feePanel(card,o){
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p');summary.textContent='Original payment processing fee';status.textContent='Check the recorded fee or refresh its evidence from Stripe. This does not make a payout.';section.append(summary,status);
  const version=renderVersion,owner=member,authorization=token,current=()=>version===renderVersion&&owner===member&&authorization===token;
  const buttons=[];checkoutWidgets.push(disabled=>buttons.forEach(b=>b.disabled=disabled));
  for(const [label,method] of [['Load recorded fee','GET'],['Refresh fee from Stripe','POST']]){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;buttons.push(button);
   button.addEventListener('click',()=>operation(async()=>{
    const result=await api(method==='GET'?'fee&orderId='+o.id:'fee',method==='POST'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})}:{},authorization);
    if(!current())return;
    if(result.test!==true||result.orderId!==o.id||result.payoutAvailable!==false||!['recorded','not_recorded'].includes(result.state)||result.state==='recorded'&&(!Number.isSafeInteger(result.grossCents)||result.grossCents!==o.total_cents||!Number.isSafeInteger(result.feeCents)||result.feeCents<0||result.feeCents>result.grossCents||!Number.isSafeInteger(result.netCents)||result.netCents!==result.grossCents-result.feeCents))throw Error('Processing fee needs review. No payout was made.');
    status.textContent=result.state==='recorded'?'Original charge fee recorded: '+money(result.feeCents)+'. Charge net after this fee: '+money(result.netCents)+'.':'No original charge fee has been recorded yet.';
   }));section.append(button);
  }
  const explain=document.createElement('p');explain.className='small';explain.textContent='This records the original charge fee only. Refund costs, other provider fees, tax and seller amounts still need reconciliation. The charge net is not a seller payout balance.';section.append(explain);card.append(section);
 }
 function fulfillmentPanel(card,o){
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),button=document.createElement('button');summary.textContent='Shipping readiness';const ending=config.sampleLabelsEnabled===true?'This check does not generate a label.':'Label purchase remains disabled.';status.textContent='Check the saved shipping evidence and holds. '+ending;button.textContent='Check shipping readiness';button.type='button';button.className='secondary';section.append(summary,status,button);card.append(section);
  const version=renderVersion,owner=member,authorization=token;checkoutWidgets.push(disabled=>button.disabled=disabled);
  button.addEventListener('click',()=>operation(async()=>{
   const r=await api('fulfillment&orderId='+o.id,{},authorization);if(version!==renderVersion||owner!==member||authorization!==token)return;
   const labels={payment_unconfirmed:'Payment is not confirmed',risk_hold:'Payment risk review is on hold',refund_hold:'Refund review prevents fulfillment',snapshot_missing:'The original private shipping snapshot is missing',quote_expired:'The carrier quote has expired',job_held:'The shipping job is on hold'};
   if(r.test!==true||r.orderId!==o.id||r.labelPurchaseEnabled!==false||typeof r.snapshotStored!=='boolean'||!Array.isArray(r.holdReasons)||r.holdReasons.some(h=>!Object.hasOwn(labels,h))||new Set(r.holdReasons).size!==r.holdReasons.length||r.state!==(r.holdReasons.length?'held':'ready_for_review'))throw Error('Shipping readiness needs review. Label purchase remains disabled.');
   status.textContent=(r.snapshotStored?'Private shipping snapshot saved. ':'Private shipping snapshot not saved. ')+(r.holdReasons.length?r.holdReasons.map(h=>labels[h]).join('. ')+'. ':'Ready for label review. ')+ending;
  }));
 }
 function sampleLabelPanel(card,o){
  if(config.sampleLabelsEnabled!==true)return;
  const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p');summary.textContent='Operator sample shipping label';status.textContent='Free test label only. Payment, fresh risk review and refund checks must pass. Never valid postage.';section.append(summary,status);card.append(section);
  const version=renderVersion,owner=member,authorization=token,current=()=>version===renderVersion&&owner===member&&authorization===token,key='rr-private-test-label-'+owner+':'+o.id;
  const buttons=[],disable=disabled=>buttons.forEach(b=>b.disabled=disabled);checkoutWidgets.push(disable);
  let saved;try{const raw=localStorage.getItem(key);saved=raw?JSON.parse(raw):null;if(saved&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saved.requestId||'')||!['prepared','dispatched'].includes(saved.phase)))throw Error('Invalid saved sample reference');}catch{status.textContent='Saved sample reference needs review. Do not request another label.';return;}
  const eligible=o.state==='paid'&&o.risk_status==='clear'&&o.refund_state==='none'&&o.refunded_cents===0&&o.refund_pending_cents===0;
  const add=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.addEventListener('click',()=>operation(fn));buttons.push(b);section.append(b);};
  if(!saved){if(eligible)add('Prepare free sample label',async()=>{const ref={requestId:crypto.randomUUID(),phase:'prepared'};localStorage.setItem(key,JSON.stringify(ref));if(current())await orders();});return;}
  const reference=document.createElement('p');reference.className='small';reference.textContent='Sample reference '+saved.requestId;section.append(reference);section.open=true;
  const result=async(method)=>{
   const r=await api(method==='POST'?'sample-label':'sample-label&orderId='+o.id+'&requestId='+saved.requestId,method==='POST'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id,requestId:saved.requestId})}:{},authorization);if(!current())return;
   if(r.test!==true||r.orderId!==o.id||r.requestId!==saved.requestId||!['not_requested','outcome_unknown','processing','ready','failed'].includes(r.state)||r.state!=='ready'&&(r.labelUrl!==null||r.trackingNumber!==null))throw Error('Sample evidence needs review. Keep the same reference.');
   if(r.state==='not_requested'&&method==='GET'){saved.phase='prepared';localStorage.setItem(key,JSON.stringify(saved));await orders();note('No label dispatch is recorded. The same reference can be reviewed again.');return;}
   const messages={not_requested:'No dispatch recorded.',outcome_unknown:'Outcome unknown. Keep this reference and review Shippo before any further label request.',processing:'Sample is processing. Check this saved request again.',ready:'Sample label confirmed. This document is not valid postage.',failed:'Sample failed. Review the saved request; no automatic replacement will be issued.'};
   if(r.state==='ready'){
    let u;try{u=new URL(r.labelUrl);}catch{throw Error('Invalid sample document');}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!(/^shippo-delivery(?:-[a-z0-9-]+)?\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname)||u.hostname==='deliver.goshippo.com')||typeof r.trackingNumber!=='string'||!r.trackingNumber||r.trackingNumber.length>100)throw Error('Invalid sample document');
    const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open sample label — not valid postage';section.append(link);disable(true);
   }
   status.textContent=messages[r.state];
  };
  if(saved.phase==='prepared'&&eligible)add('Generate one free sample label',async()=>{saved.phase='dispatched';localStorage.setItem(key,JSON.stringify(saved));disable(true);try{await result('POST');}finally{if(current()){for(const b of buttons)b.hidden=true;add('Check saved sample label',()=>result('GET'));}}});
  else add('Check saved sample label',()=>result('GET'));
 }
 function shippingPanel(){
  $('shipping-test').hidden=false;$('shipping-test-results').replaceChildren();
  const version=renderVersion,owner=member,authorization=token,current=()=>version===renderVersion&&owner===member&&authorization===token;
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Check Shippo test prices';checkoutWidgets.push(disabled=>button.disabled=disabled);
  button.addEventListener('click',()=>operation(async()=>{
   $('shipping-test-results').replaceChildren();
   const result=await api('shipping-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},authorization);
   if(!current())return;
   if(result.test!==true||result.mode!=='carrier_connection_test'||result.postagePurchased!==false||result.checkoutChanged!==false||!Array.isArray(result.rates)||!result.rates.length||result.rates.length>100||result.rates.some(r=>r?.currency!=='USD'||!Number.isSafeInteger(r.amountCents)||r.amountCents<0||r.amountCents>100000||typeof r.carrier!=='string'||!r.carrier.trim()||r.carrier.length>100||typeof r.service!=='string'||!r.service.trim()||r.service.length>150))throw Error('Carrier test prices need review. No postage was purchased.');
   for(const r of result.rates){const p=document.createElement('p');p.textContent=r.carrier+' · '+r.service+' · '+money(r.amountCents);$('shipping-test-results').append(p);}
   const p=document.createElement('p');p.className='small';p.textContent=config.shippingMode==='shippo_test'?'Test prices received. New test checkouts calculate carrier prices separately for their destination. No postage was purchased.':'Test prices received. Checkout still uses simulated shipping. No postage was purchased.';$('shipping-test-results').append(p);
  }));$('shipping-test-controls').replaceChildren();$('shipping-test-controls').append(button);
 }
 async function loadIssueReview(version,owner,authorization){
  const current=()=>version===renderVersion&&owner===member&&authorization===token;
  try{
   const result=await api('issue-review',{},authorization);if(!current())return;
   const labels={not_received:'Item not received',damaged:'Item arrived damaged',not_as_described:'Item significantly not as described'},uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
   const responses={investigating:'Seller is checking the issue',propose_return:'Seller proposes a return for review',request_review:'Seller requests operator review'};
   const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
   if(result?.test!==true||typeof result.hasMore!=='boolean'||!Array.isArray(result.issues)||result.issues.length>100||result.issues.some(r=>!uuid.test(r?.orderId||'')||!Object.hasOwn(labels,r.reason)||!date(r.reportedAt)||r.acknowledgedAt!==null&&!date(r.acknowledgedAt)||r.sellerResponse!=null&&(!Object.hasOwn(responses,r.sellerResponse.kind)||!date(r.sellerResponse.submittedAt))))throw Error('Invalid report queue');
   $('issue-review-rows').replaceChildren();
   if(!result.issues.length){const p=document.createElement('p');p.textContent='No saved reports for your participating test orders.';$('issue-review-rows').append(p);}
   for(const r of result.issues){
    const card=document.createElement('article');card.className='order';const title=document.createElement('strong'),status=document.createElement('p'),ref=document.createElement('p');title.textContent=labels[r.reason];status.textContent=r.acknowledgedAt?'Acknowledged for follow-up — issue remains open.':'Awaiting operator acknowledgment';ref.textContent='Order '+r.orderId;ref.className='small';card.append(title,status,ref);if(r.sellerResponse){const response=document.createElement('p');response.textContent=responses[r.sellerResponse.kind]+'. The issue remains open.';card.append(response);}
    if(!r.acknowledgedAt){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='Acknowledge for follow-up';checkoutWidgets.push(disabled=>{b.disabled=disabled;});b.disabled=busy;
     b.addEventListener('click',()=>operation(async auth=>{if(!current())return;const ack=await api('issue-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:r.orderId})},authorization);if(!current()||auth!==authVersion)return;if(ack?.test!==true||ack.orderId!==r.orderId||ack.acknowledged!==true||!date(ack.acknowledgedAt))throw Error('Acknowledgment needs confirmation. Refresh the queue.');await loadIssueReview(version,owner,authorization);if(current())note('Test report acknowledged for follow-up. The issue remains open and fulfillment stays held.');}));card.append(b);
    }$('issue-review-rows').append(card);
   }
   if(result.hasMore){const p=document.createElement('p');p.textContent='Showing the first 100 reports. Additional records require review.';$('issue-review-rows').append(p);}
  }catch{if(current()){const p=document.createElement('p');p.textContent='Report review is temporarily unavailable. Refresh orders to check again.';$('issue-review-rows').replaceChildren();$('issue-review-rows').append(p);}}
 }
 async function loadRefundReview(version,owner,authorization){
  const current=()=>version===renderVersion&&owner===member&&authorization===token;
  try{
   const result=await api('refund-review',{},authorization);
   if(!current())return;
   const labels={needs_review:'Needs review — amounts await reconciliation',not_dispatched:'Prepared — no dispatch recorded',outcome_unknown:'Outcome unknown — keep the same request reference',awaiting_notice:'Request recorded — awaiting verified refund notice',processing:'Refund processing — no confirmed refund amount',confirmed:'Refund confirmed by verified notice',failed:'Refund failed or cancelled — review the order before another request'};
   if(result.test!==true||!Array.isArray(result.requests)||result.requests.length>100||typeof result.hasMore!=='boolean'||result.requests.some(q=>!Object.hasOwn(labels,q?.reviewState)||!Number.isSafeInteger(q.amountCents)||q.amountCents<1||typeof q.requestId!=='string'||typeof q.orderId!=='string'))throw Error('Refund review unavailable');
   $('refund-review-rows').replaceChildren();
   if(!result.requests.length){const empty=document.createElement('p');empty.textContent='No saved refund requests for your operator account.';$('refund-review-rows').append(empty);}
   for(const q of result.requests){
    const card=document.createElement('article');card.className='order';const status=document.createElement('strong');status.textContent=labels[q.reviewState];
    const amount=document.createElement('p');amount.textContent='Requested '+money(q.amountCents);
    const order=document.createElement('p');order.className='small';order.textContent='Order '+q.orderId;
    const ref=document.createElement('p');ref.className='small';ref.textContent='Refund reference '+q.requestId;card.append(status,amount,order,ref);$('refund-review-rows').append(card);
   }
   if(result.hasMore){const more=document.createElement('p');more.textContent='More records need review. This list shows the first 100 requests.';$('refund-review-rows').append(more);}
  }catch{
   if(!current())return;const unavailable=document.createElement('p');unavailable.textContent='Refund review is temporarily unavailable. Keep your saved references and refresh orders to check again.';$('refund-review-rows').replaceChildren();$('refund-review-rows').append(unavailable);
  }
 }
 async function orders(){
  const version=++renderVersion,owner=member,authorization=token;
  $('shipping-test').hidden=true;$('shipping-test-results').replaceChildren();$('shipping-test-controls').replaceChildren();
  $('issue-review').hidden=true;$('issue-review-rows').replaceChildren();
  $('refund-review').hidden=true;$('refund-review-rows').replaceChildren();
  const [result,access]=await Promise.all([api('orders',{},authorization),api('refund-access',{},authorization).catch(()=>null)]);
  if(version!==renderVersion||owner!==member||authorization!==token)return false;
  const rows=result.orders;if(!Array.isArray(rows))throw Error('Invalid test order list');
  let refunds=null;
  if(access?.test===true&&access.allowed===true){refunds=createTestRefundRequests({storage:localStorage,memberId:owner,request:(action,options)=>{if(owner!==member||authorization!==token)throw Error('Sign in again before checking this request');return api(action,options,authorization);}});}
  $('orders').replaceChildren();refundWidgets=[];checkoutWidgets=[];
  if(refunds)shippingPanel();
  if(refunds&&config?.issueReviewEnabled===true){$('issue-review').hidden=false;void loadIssueReview(version,owner,authorization);}
  if(refunds){$('refund-review').hidden=false;void loadRefundReview(version,owner,authorization);}
  if(!rows.length){const p=document.createElement('p');p.textContent='No test orders yet.';$('orders').append(p);return true;}
  for(const o of rows){
   const card=document.createElement('article');card.className='order';const title=document.createElement('strong');title.textContent=o.buyer_id===owner?'Your purchase':'Your sale';
   const state=document.createElement('p'),labels={reserved:'Reserved — preparing checkout',checkout_open:'Awaiting payment',payment_pending:'Payment processing',payment_failed:'Payment failed',paid:'Payment confirmed — fulfillment on hold',expired:'Checkout expired',cancelled:'Preparation cancelled — no payment session created',review:'Payment needs review'};state.textContent=labels[o.state]||'Awaiting confirmation';
   const total=document.createElement('p');total.hidden=o.state==='cancelled'&&o.total_cents==null;total.textContent=total.hidden?'':o.total_cents==null?'Total is being calculated':money(o.total_cents);const ref=document.createElement('p');ref.className='small';ref.textContent='Order '+o.id;card.append(title,state,total,ref);
   if(o.refund_state&&o.refund_state!=='none'){
    const refund=document.createElement('p');refund.className='small';const labels={pending:'Test refund processing',partial:'Partial test refund confirmed',refunded:'Full test refund confirmed',failed:'Test refund failed or cancelled',review:'Test refund needs review — amounts await reconciliation'};refund.textContent=labels[o.refund_state]||'Test refund awaiting review';
    if(o.refund_state!=='review'){
     if(Number.isSafeInteger(o.refunded_cents)&&o.refunded_cents>0)refund.textContent+=' · Refunded '+money(o.refunded_cents);
     if(Number.isSafeInteger(o.refund_pending_cents)&&o.refund_pending_cents>0)refund.textContent+=' · Pending '+money(o.refund_pending_cents);
    }card.append(refund);
   }
   issuePanel(card,o);issueThreadPanel(card,o);
   if(refunds){refundPanel(card,o,refunds);issueRefundReviewPanel(card,o,refunds);}
   if(refunds&&o.state==='paid'){feePanel(card,o);riskPanel(card,o);trackingPanel(card,o);}
   if(refunds)protectionPanel(card,o);
   if(refunds)fulfillmentPanel(card,o);
   if(refunds)sampleLabelPanel(card,o);
   if(o.buyer_id===owner&&o.state==='reserved'&&o.can_cancel_preparation===true){
    const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel checkout preparation';
    checkoutWidgets.push(disabled=>{cancel.disabled=disabled;});
    cancel.addEventListener('click',()=>operation(async auth=>{
     const latest=await api('orders');if(auth!==authVersion||owner!==member)return;
     const prepared=Array.isArray(latest.orders)?latest.orders.find(row=>row.id===o.id):null;
     if(!prepared||prepared.buyer_id!==owner||prepared.state!=='reserved'||prepared.can_cancel_preparation!==true)throw Error('Checkout may have started. Refresh orders before trying to cancel.');
     const result=await api('cancel-preparation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})});
     if(auth!==authVersion||owner!==member)return;
     if(result.test!==true||result.orderId!==o.id||result.state!=='cancelled')throw Error('Cancellation needs confirmation. Keep the saved order reference.');
     await orders();if(auth===authVersion)note('Checkout preparation cancelled. The previous order remains in your history.');
    }));card.append(cancel);
   }
   if(config?.listing?.id&&o.buyer_id===owner&&o.listing_id===config.listing.id&&['expired','payment_failed','cancelled'].includes(o.state)&&savedCheckout(owner)===o.id){
    const next=document.createElement('button');next.type='button';next.className='secondary';next.textContent='Prepare a new test checkout';
    checkoutWidgets.push(disabled=>{next.disabled=disabled;});
    next.addEventListener('click',()=>operation(async auth=>{
     const latest=await api('orders');if(auth!==authVersion||owner!==member)return;
     const closed=Array.isArray(latest.orders)?latest.orders.find(row=>row.id===o.id):null;
     if(!closed||closed.buyer_id!==owner||closed.listing_id!==config.listing.id||!['expired','payment_failed','cancelled'].includes(closed.state)||savedCheckout(owner)!==o.id)throw Error('The previous checkout needs confirmation. Refresh orders before starting again.');
     sessionStorage.setItem(checkoutKey(owner),crypto.randomUUID());
     await orders();if(auth===authVersion)note('The previous checkout is closed. Continue to checkout when you are ready for a new test order.');
    }));card.append(next);
   }
   $('orders').append(card);
  }
  controls();return true;
 }
 async function acceptSession(session){
  if(!session.access_token||!session.user?.id)throw Error('Sign-in failed. Use your existing test account.');
  const version=++authVersion;token=session.access_token;member=session.user.id;
  try{await orders();}catch(e){if(version===authVersion){token=null;member=null;sessionStorage.removeItem('rr-private-test-session');}throw e;}
  if(version!==authVersion||token!==session.access_token)return false;
  sessionStorage.setItem('rr-private-test-session',JSON.stringify({token,member,email:session.user.email}));$('identity').textContent=session.user.email;note('Signed in. Ready for a test purchase.');return true;
 }
 $('email-link').addEventListener('click',async()=>{
  if(busy||!$('email').reportValidity())return;busy=true;controls();
  try{await emailSignin.send($('email').value);note('Sign-in link requested. Check your email and open the newest link in this same Chrome profile.');}
  catch(e){note(e.message);}finally{busy=false;controls();}
 });
 $('signin').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;controls();try{
  const r=await fetch(config.projectUrl+'/auth/v1/token?grant_type=password',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('password').value})});$('password').value='';const session=await r.json();if(!r.ok)throw Error('Sign-in failed. Try the email sign-in link instead.');await acceptSession(session);
 }catch(e){note(e.name==='TimeoutError'?'Sign-in did not respond. Please try again.':e.message);}finally{$('password').value='';busy=false;controls();}});
 $('logout').addEventListener('click',()=>{authVersion++;renderVersion++;token=null;member=null;busy=false;refundWidgets=[];checkoutWidgets=[];sessionStorage.removeItem('rr-private-test-session');$('identity').textContent='';$('orders').replaceChildren();$('issue-review').hidden=true;$('issue-review-rows').replaceChildren();$('refund-review').hidden=true;$('refund-review-rows').replaceChildren();$('shipping-test').hidden=true;$('shipping-test-results').replaceChildren();$('shipping-test-controls').replaceChildren();note('Signed out of the private test area.');controls();});
 $('refresh').addEventListener('click',()=>operation(async version=>{await orders();if(version===authVersion)note('Orders refreshed from the test database.');}));
 $('checkout').addEventListener('click',()=>operation(async version=>{
  const key=checkoutKey(member);let orderId=savedCheckout(member);
  if(!orderId)orderId=crypto.randomUUID();sessionStorage.setItem(key,orderId);
  note('Reserving the test item and calculating the total…');const data=await api('checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,listingId:config.listing.id,to:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}})});
  if(version!==authVersion)return;await orders();if(version!==authVersion)return;
  if(data.url){const u=new URL(data.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination');location.assign(u.href);}else note('This order already has a payment result. Check the order list.');
 }));
 (async()=>{try{
  config=await api('config');$('fixture-title').textContent=config.listing?.title||'Synthetic test jacket';
  if(config.shippingMode==='shippo_test'){
   $('test-intro').textContent='Use your existing staging account. This separate test area uses a synthetic jacket, Shippo test shipping prices and Stripe’s test tax calculation. Nothing here purchases real postage or pays a seller.';
   $('shipping-caption').textContent='Buyer fee: $1.00 · Shipping calculated by Shippo in test mode. Tax calculated for the Seattle test destination below.';
   $('shipping-test-description').textContent='Checks Shippo with a separate synthetic 10 × 8 × 2 inch, 1 lb parcel from Seattle to New York. These prices may differ from live prices and from the destination-specific quote used in a checkout. No postage is purchased.';
  }
  emailSignin=createTestEmailSignin({publishableKey:config.publishableKey,storage:localStorage});if(callback){await acceptSession(await emailSignin.complete(callback));controls();return;}
  let saved;try{saved=JSON.parse(sessionStorage.getItem('rr-private-test-session'));}catch{}
  if(saved?.token&&saved?.member){token=saved.token;member=saved.member;const version=authVersion;$('identity').textContent=saved.email||'Staging member';try{await orders();}catch{if(version===authVersion){token=null;member=null;sessionStorage.removeItem('rr-private-test-session');}}if(version!==authVersion)return;}
  note(new URLSearchParams(location.search).get('view')==='cancel'?'Checkout was cancelled. The item remains reserved until Stripe confirms expiry.':config.notice);controls();
 }catch(e){note(e.message);controls();}})();
})();
