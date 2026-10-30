/* Rack Relic guided help: local answers only; no chat data or third-party service. */
(() => {
  'use strict';
  if (document.getElementById('rack-guided-help')) return;
  const host = document.createElement('div');
  host.id = 'rack-guided-help';
  document.body.appendChild(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `
    <style>
      :host{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:900;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#20201f}
      *{box-sizing:border-box}button,a{font:inherit}button{cursor:pointer}
      button:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:3px solid #79559c;outline-offset:3px}
      .narrow-label{display:none}@media(max-width:600px){.wide-label{display:none}.narrow-label{display:inline}.launcher{padding:10px 14px!important}}
      .launcher{border:1px solid #20201f;border-radius:30px;padding:12px 19px;background:#e5d7fa;color:#20201f;box-shadow:0 4px 18px #0002}
      .panel{width:min(370px,calc(100vw - 32px));max-height:min(620px,calc(100dvh - 110px));overflow:auto;background:#faf9f6;border:1px solid #c6b4df;border-radius:18px;box-shadow:0 8px 35px #0003;padding:20px;margin-bottom:12px}
      [hidden]{display:none!important}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:20px;margin:0}.close{background:transparent;border:0;border-radius:8px;min-width:44px;min-height:44px;font-size:26px}
      .intro{font-size:14px;color:#57534e;margin:8px 0 16px}.topics{display:grid;gap:8px}.topic{background:white;border:1px solid #c6b4df;border-radius:10px;text-align:left;padding:10px 12px;color:#20201f;min-height:44px}.topic[aria-pressed=true]{background:#eee7fa;border-color:#79559c}
      .answer{margin-top:16px;border-top:1px solid #ddd;padding-top:14px}.answer p{margin:0 0 12px}a{color:#553978;text-underline-offset:3px}.contact{font-size:14px;border-top:1px solid #ddd;padding-top:12px;margin-bottom:0;overflow-wrap:anywhere}
    </style>
    <section class="panel" id="help-panel" aria-labelledby="help-title" hidden>
      <div class="top"><h2 id="help-title">Rack Relic help</h2><button class="close" aria-label="Close help">×</button></div>
      <p class="intro">Guided FAQ · Choose a topic for an instant answer. This is not live chat.</p>
      <div class="topics" aria-label="Help topics"></div>
      <div class="answer" role="status" aria-live="polite" aria-atomic="true"></div>
      <p class="contact">Still need help? <a href="mailto:support@rackrelic.com">Email support@rackrelic.com</a>. Do not send passwords, payment-card details or identity documents.</p>
    </section>
    <button class="launcher" aria-expanded="false" aria-controls="help-panel" aria-label="Rack Relic help"><span class="wide-label">Questions? Get help</span><span class="narrow-label">Help</span></button>`;
  const topics = [
    ['Buying & launch','Rack Relic is in preview. Checkout, payments and payouts are not available yet. Illustrated demo items are not inventory for sale. A launch date has not been announced here.','Read preview help','/support'],
    ['Selling & listing drafts','Sign in to save a private account draft with up to six photos. Older local drafts stay on this device. Saving a draft does not publish it, buy an item or reserve inventory.','Prepare a listing','/sell'],
    ['Photos, sizing & condition','Use clear photos and accurate sizing and condition details. Our seller guide walks through preparing a listing before it goes live.','Open the seller guide','/seller-guide'],
    ['Sign-in help','Open your account to request a sign-in link. If a link is expired or invalid, request a new one. Never share your sign-in link or password.','Open account','/account'],
    ['Fees','When buying opens, the buyer platform fee will be 4% of the item price, with no fixed-dollar fee. Shipping and applicable tax are separate. Sellers bear actual payment-processing costs; the processor and rate are not yet confirmed.','Read fee details','/support'],
    ['Safety, reports & suspicious messages','Get a checklist for a suspicious listing, unsafe message, account concern or privacy request. The helper prepares your next steps; it does not submit a report or make a refund decision.','Open safety & help','/safety'],
    ['Privacy & contacting us','For questions or privacy requests, email support@rackrelic.com. Selecting a topic here does not send a message, submit a report or start a return or refund request.','Privacy and tracking information','/tracking-privacy']
  ];
  const panel=root.querySelector('.panel'), launcher=root.querySelector('.launcher'), answer=root.querySelector('.answer');
  topics.forEach(([label,text,linkLabel,href])=>{
    const button=document.createElement('button');
    button.type='button'; button.className='topic'; button.textContent=label; button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{
      root.querySelectorAll('.topic').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      const p=document.createElement('p');p.textContent=text;
      const link=document.createElement('a');link.href=href;link.textContent=linkLabel;link.setAttribute('data-policy-document','');
      answer.replaceChildren(p,link);
    });
    root.querySelector('.topics').appendChild(button);
  });
  const close=()=>{panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus();};
  launcher.addEventListener('click',()=>{
    if(!panel.hidden){close();return;}
    panel.hidden=false;launcher.setAttribute('aria-expanded','true');root.querySelector('.close').focus();
  });
  root.querySelector('.close').addEventListener('click',close);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close();}});
})();
