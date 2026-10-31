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
  for(const update of refundWidgets)update(!signed||busy);
  for(const update of checkoutWidgets)update(!signed||busy);
 }
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
   const p=document.createElement('p');p.className='small';p.textContent='Test prices received. Checkout still uses simulated shipping. No postage was purchased.';$('shipping-test-results').append(p);
  }));$('shipping-test-controls').replaceChildren();$('shipping-test-controls').append(button);
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
  $('refund-review').hidden=true;$('refund-review-rows').replaceChildren();
  const [result,access]=await Promise.all([api('orders',{},authorization),api('refund-access',{},authorization).catch(()=>null)]);
  if(version!==renderVersion||owner!==member||authorization!==token)return false;
  const rows=result.orders;if(!Array.isArray(rows))throw Error('Invalid test order list');
  let refunds=null;
  if(access?.test===true&&access.allowed===true){refunds=createTestRefundRequests({storage:localStorage,memberId:owner,request:(action,options)=>{if(owner!==member||authorization!==token)throw Error('Sign in again before checking this request');return api(action,options,authorization);}});}
  $('orders').replaceChildren();refundWidgets=[];checkoutWidgets=[];
  if(refunds)shippingPanel();
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
   if(refunds)refundPanel(card,o,refunds);
   if(refunds&&o.state==='paid')feePanel(card,o);
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
 $('logout').addEventListener('click',()=>{authVersion++;renderVersion++;token=null;member=null;busy=false;refundWidgets=[];checkoutWidgets=[];sessionStorage.removeItem('rr-private-test-session');$('identity').textContent='';$('orders').replaceChildren();$('refund-review').hidden=true;$('refund-review-rows').replaceChildren();$('shipping-test').hidden=true;$('shipping-test-results').replaceChildren();$('shipping-test-controls').replaceChildren();note('Signed out of the private test area.');controls();});
 $('refresh').addEventListener('click',()=>operation(async version=>{await orders();if(version===authVersion)note('Orders refreshed from the test database.');}));
 $('checkout').addEventListener('click',()=>operation(async version=>{
  const key=checkoutKey(member);let orderId=savedCheckout(member);
  if(!orderId)orderId=crypto.randomUUID();sessionStorage.setItem(key,orderId);
  note('Reserving the test item and calculating the total…');const data=await api('checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,listingId:config.listing.id,to:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}})});
  if(version!==authVersion)return;await orders();if(version!==authVersion)return;
  if(data.url){const u=new URL(data.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination');location.assign(u.href);}else note('This order already has a payment result. Check the order list.');
 }));
 (async()=>{try{
  config=await api('config');$('fixture-title').textContent=config.listing?.title||'Synthetic test jacket';emailSignin=createTestEmailSignin({publishableKey:config.publishableKey,storage:localStorage});if(callback){await acceptSession(await emailSignin.complete(callback));controls();return;}
  let saved;try{saved=JSON.parse(sessionStorage.getItem('rr-private-test-session'));}catch{}
  if(saved?.token&&saved?.member){token=saved.token;member=saved.member;const version=authVersion;$('identity').textContent=saved.email||'Staging member';try{await orders();}catch{if(version===authVersion){token=null;member=null;sessionStorage.removeItem('rr-private-test-session');}}if(version!==authVersion)return;}
  note(new URLSearchParams(location.search).get('view')==='cancel'?'Checkout was cancelled. The item remains reserved until Stripe confirms expiry.':config.notice);controls();
 }catch(e){note(e.message);controls();}})();
})();
