'use strict';
(()=>{
 const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 let config,emailSignin,token=null,member=null,busy=false,authVersion=0,renderVersion=0,refundWidgets=[];
 const callback=new URLSearchParams(location.search).get('code');
 if(callback||location.hash)history.replaceState(null,'',location.pathname);
 const note=text=>{$('notice').textContent=text;};
 function controls(){
  const signed=!!token;$('signin').hidden=signed;$('signed-in').hidden=!signed;
  $('checkout').disabled=!signed||busy;$('refresh').disabled=!signed||busy;$('login').disabled=!config||busy;$('email-link').disabled=!config||busy;
  for(const update of refundWidgets)update(!signed||busy);
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
 async function orders(){
  const version=++renderVersion,owner=member,authorization=token;
  const [result,access]=await Promise.all([api('orders',{},authorization),api('refund-access',{},authorization).catch(()=>null)]);
  if(version!==renderVersion||owner!==member||authorization!==token)return false;
  const rows=result.orders;if(!Array.isArray(rows))throw Error('Invalid test order list');
  let refunds=null;
  if(access?.test===true&&access.allowed===true){refunds=createTestRefundRequests({storage:localStorage,memberId:owner,request:(action,options)=>{if(owner!==member||authorization!==token)throw Error('Sign in again before checking this request');return api(action,options,authorization);}});}
  $('orders').replaceChildren();refundWidgets=[];
  if(!rows.length){const p=document.createElement('p');p.textContent='No test orders yet.';$('orders').append(p);return true;}
  for(const o of rows){
   const card=document.createElement('article');card.className='order';const title=document.createElement('strong');title.textContent=o.buyer_id===owner?'Your purchase':'Your sale';
   const state=document.createElement('p'),labels={reserved:'Reserved — preparing checkout',checkout_open:'Awaiting payment',payment_pending:'Payment processing',payment_failed:'Payment failed',paid:'Payment confirmed — fulfillment on hold',expired:'Checkout expired',review:'Payment needs review'};state.textContent=labels[o.state]||'Awaiting confirmation';
   const total=document.createElement('p');total.textContent=o.total_cents==null?'Total is being calculated':money(o.total_cents);const ref=document.createElement('p');ref.className='small';ref.textContent='Order '+o.id;card.append(title,state,total,ref);
   if(o.refund_state&&o.refund_state!=='none'){
    const refund=document.createElement('p');refund.className='small';const labels={pending:'Test refund processing',partial:'Partial test refund confirmed',refunded:'Full test refund confirmed',failed:'Test refund failed or cancelled',review:'Test refund needs review — amounts await reconciliation'};refund.textContent=labels[o.refund_state]||'Test refund awaiting review';
    if(o.refund_state!=='review'){
     if(Number.isSafeInteger(o.refunded_cents)&&o.refunded_cents>0)refund.textContent+=' · Refunded '+money(o.refunded_cents);
     if(Number.isSafeInteger(o.refund_pending_cents)&&o.refund_pending_cents>0)refund.textContent+=' · Pending '+money(o.refund_pending_cents);
    }card.append(refund);
   }
   if(refunds)refundPanel(card,o,refunds);$('orders').append(card);
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
 $('logout').addEventListener('click',()=>{authVersion++;renderVersion++;token=null;member=null;busy=false;refundWidgets=[];sessionStorage.removeItem('rr-private-test-session');$('identity').textContent='';$('orders').replaceChildren();note('Signed out of the private test area.');controls();});
 $('refresh').addEventListener('click',()=>operation(async version=>{await orders();if(version===authVersion)note('Orders refreshed from the test database.');}));
 $('checkout').addEventListener('click',()=>operation(async version=>{
  const key='rr-private-test-order-'+member;let orderId=sessionStorage.getItem(key);if(!orderId){orderId=crypto.randomUUID();sessionStorage.setItem(key,orderId);}
  note('Reserving the test item and calculating the total…');const data=await api('checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,listingId:config.listing.id,to:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}})});
  if(version!==authVersion)return;await orders();if(version!==authVersion)return;
  if(data.url){const u=new URL(data.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination');location.assign(u.href);}else note('This order already has a payment result. Check the order list.');
 }));
 (async()=>{try{
  config=await api('config');emailSignin=createTestEmailSignin({publishableKey:config.publishableKey,storage:localStorage});if(callback){await acceptSession(await emailSignin.complete(callback));controls();return;}
  let saved;try{saved=JSON.parse(sessionStorage.getItem('rr-private-test-session'));}catch{}
  if(saved?.token&&saved?.member){token=saved.token;member=saved.member;const version=authVersion;$('identity').textContent=saved.email||'Staging member';try{await orders();}catch{if(version===authVersion){token=null;member=null;sessionStorage.removeItem('rr-private-test-session');}}if(version!==authVersion)return;}
  note(new URLSearchParams(location.search).get('view')==='cancel'?'Checkout was cancelled. The item remains reserved until Stripe confirms expiry.':config.notice);controls();
 }catch(e){note(e.message);controls();}})();
})();
