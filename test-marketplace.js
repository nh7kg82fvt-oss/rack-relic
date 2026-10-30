'use strict';
(()=>{
 const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 let config,token=null,member=null,busy=false;
 const note=text=>{$('notice').textContent=text;};
 function controls(){const signed=!!token;$('signin').hidden=signed;$('signed-in').hidden=!signed;$('checkout').disabled=!signed||busy;$('refresh').disabled=!signed||busy;$('login').disabled=!config||busy;}
 async function api(action,options={}){const r=await fetch('/api/test-marketplace?action='+action,{cache:'no-store',...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});const data=await r.json();if(!r.ok)throw Error(data.error||'Test request failed');return data;}
 async function orders(){
  const {orders}=await api('orders');$('orders').replaceChildren();
  if(!orders.length){const p=document.createElement('p');p.textContent='No test orders yet.';$('orders').append(p);return;}
  for(const o of orders){const card=document.createElement('article');card.className='order';const title=document.createElement('strong');title.textContent=o.buyer_id===member?'Your purchase':'Your sale';const state=document.createElement('p');const labels={reserved:'Reserved — preparing checkout',checkout_open:'Awaiting payment',payment_pending:'Payment processing',payment_failed:'Payment failed',paid:'Payment confirmed — fulfillment on hold',expired:'Checkout expired',review:'Payment needs review'};state.textContent=labels[o.state]||'Awaiting confirmation';const total=document.createElement('p');total.textContent=o.total_cents==null?'Total is being calculated':money(o.total_cents);const ref=document.createElement('p');ref.className='small';ref.textContent='Order '+o.id;card.append(title,state,total,ref);$('orders').append(card);}
 }
 $('signin').addEventListener('submit',async e=>{e.preventDefault();busy=true;controls();try{
  const r=await fetch(config.projectUrl+'/auth/v1/token?grant_type=password',{method:'POST',cache:'no-store',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('password').value})});$('password').value='';const session=await r.json();if(!r.ok||!session.access_token||!session.user?.id)throw Error('Sign-in failed. Use your existing staging account.');token=session.access_token;member=session.user.id;sessionStorage.setItem('rr-private-test-session',JSON.stringify({token,member,email:session.user.email}));$('identity').textContent=session.user.email;await orders();note('Signed in. Ready for a test purchase.');
 }catch(e){note(e.message);}finally{$('password').value='';busy=false;controls();}});
 $('logout').addEventListener('click',()=>{token=null;member=null;sessionStorage.removeItem('rr-private-test-session');$('orders').replaceChildren();note('Signed out of the private test area.');controls();});
 $('refresh').addEventListener('click',async()=>{try{await orders();note('Orders refreshed from the test database.');}catch(e){note(e.message);}});
 $('checkout').addEventListener('click',async()=>{
  busy=true;controls();try{const key='rr-private-test-order-'+member;let orderId=sessionStorage.getItem(key);if(!orderId){orderId=crypto.randomUUID();sessionStorage.setItem(key,orderId);}
   note('Reserving the test item and calculating the total…');const data=await api('checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,listingId:config.listing.id,to:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}})});
   await orders();if(data.url){const u=new URL(data.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination');location.assign(u.href);}else note('This order already has a payment result. Check the order list.');
  }catch(e){note(e.message+' Your existing order reference has been kept.');}finally{busy=false;controls();}
 });
 (async()=>{try{config=await api('config');let saved;try{saved=JSON.parse(sessionStorage.getItem('rr-private-test-session'));}catch{}if(saved?.token&&saved?.member){token=saved.token;member=saved.member;$('identity').textContent=saved.email||'Staging member';try{await orders();}catch{token=null;member=null;sessionStorage.removeItem('rr-private-test-session');}}
  note(new URLSearchParams(location.search).get('view')==='cancel'?'Checkout was cancelled. The item remains reserved until Stripe confirms expiry.':config.notice);controls();
 }catch(e){note(e.message);}})();
})();
