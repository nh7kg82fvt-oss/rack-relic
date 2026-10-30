/* Rack Relic: deterministic guidance. No AI, network requests or stored intake data. */
(function(root){
  'use strict';
  const topics={
    listing:{label:'Suspicious or misleading listing',title:'Report the listing for review',steps:['Open the item and choose Report listing. Sign in if asked, then return to the item and submit your report.','Describe the specific mismatch, suspect detail or prohibited item. Keep the listing link and screenshots for your records.','A report does not prove wrongdoing or automatically remove an item. Check My reports for its status.'],link:'/reports',linkLabel:'View my submitted reports'},
    message:{label:'Unsafe message or payment request',title:'Keep the conversation safe',steps:['Do not send money, sign-in codes, card details or identity documents to another member. Checkout is closed during preview.','Use Block member in the conversation to stop further messages from that member.','Keep the message date, member name and relevant text. Email support if review is needed; do not include unrelated private conversations.'],link:'/messages',linkLabel:'Open my messages'},
    account:{label:'Sign-in or account concern',title:'Protect your account access',steps:['Request a sign-in link from the Rack Relic account page. Never forward it to someone else.','If you suspect someone has accessed your email, secure that email account first using its own security settings.','Tell support what happened and when. Never include passwords, sign-in links, recovery codes or identity documents.'],link:'/account',linkLabel:'Open my account'},
    order:{label:'Order, delivery, return or refund',title:'Check the purchase before taking action',steps:['Rack Relic checkout is not open. We are not accepting orders or taking payments in this preview.','If someone claims a Rack Relic payment is required, do not pay through their link. Contact support and your payment provider if you already sent money.','Future order dispute deadlines, refund amounts and return-shipping responsibilities will be published before checkout opens. This helper cannot issue a refund or open an order dispute.'],link:'/support',linkLabel:'Read preview help'},
    seller:{label:'Prepare a safer listing',title:'Give buyers the details they need',steps:['Only list items you own and may sell. Counterfeit, replica and unauthorized copies are prohibited, even when disclosed.','Photograph the actual item, labels and flaws. Include measurements, condition, repairs and what is included. Do not expose addresses or private documents in photos.','Save a private account draft and review every photo. Do not accept payment or ship an order during preview. Rack Relic does not authenticate every item.'],link:'/seller-guide',linkLabel:'Open the seller guide'},
    privacy:{label:'Privacy or personal information',title:'Keep sensitive information out of messages',steps:['Do not put your address, ID, financial details or sign-in information in public listings, photos or your profile.','For a privacy request, tell support which Rack Relic account or content is involved and what you want reviewed.','Do not attach identity documents or payment information to the initial email. Support can explain any necessary next step.'],link:'/tracking-privacy',linkLabel:'Read privacy information'}
  };
  function listingPath(value){
    const raw=String(value||'').trim();if(!raw)return null;
    let u;try{u=new URL(raw,'https://www.rackrelic.com');}catch{return null;}
    if(u.protocol!=='https:'||!['www.rackrelic.com','rackrelic.com'].includes(u.hostname)||u.port||u.username||u.password)return null;
    const m=u.pathname.match(/^\/listing\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    return m?'/listing/'+m[1].toLowerCase():null;
  }
  function guide(key,value){
    if(!Object.prototype.hasOwnProperty.call(topics,key))throw new Error('Choose a help topic.');
    const topic=topics[key],path=listingPath(value);
    if(String(value||'').trim()&&!path)throw new Error('Use a Rack Relic item link, such as https://www.rackrelic.com/listing/ followed by its item ID. Leave this empty if it does not apply.');
    const link=key==='listing'&&path?path+'/report':topic.link;
    const body=['Hello Rack Relic support,','', 'Topic: '+topic.label,path?'Listing: https://www.rackrelic.com'+path:'','', 'What happened and when: [add a short description]', 'Relevant member name, if any: [add only if needed]','', 'Please review this concern. I understand this email draft has not submitted a listing report or an order dispute.','', 'Do not include passwords, codes, card details, identity documents or unrelated private information.'].filter((line,i,all)=>line!==''||all[i-1]!=='').join('\n');
    return {...topic,link,linkLabel:key==='listing'&&path?'Open this listing’s report form':topic.linkLabel,body,mailto:'mailto:support@rackrelic.com?subject='+encodeURIComponent('Rack Relic help: '+topic.label)+'&body='+encodeURIComponent(body)};
  }
  const api={topics,listingPath,guide};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root.document)return;
  root.RackSafetyHelp=api;
  const form=root.document.getElementById('safety-helper');if(!form)return;
  const select=form.querySelector('select'),input=form.querySelector('input'),error=root.document.getElementById('helper-error'),result=root.document.getElementById('helper-result');
  Object.entries(topics).forEach(([key,topic])=>{const o=root.document.createElement('option');o.value=key;o.textContent=topic.label;select.append(o);});
  function clear(){result.hidden=true;result.replaceChildren();error.textContent='';}
  select.addEventListener('change',clear);input.addEventListener('input',clear);
  form.addEventListener('submit',event=>{
    event.preventDefault();clear();let data;try{data=guide(select.value,input.value);}catch(e){error.textContent=e.message;return;}
    const el=(tag,text)=>{const n=root.document.createElement(tag);n.textContent=text;return n;};
    const title=el('h3',data.title),list=el('ol');data.steps.forEach(step=>list.append(el('li',step)));
    const next=el('a',data.linkLabel);next.href=data.link;next.className='action';
    const email=el('a','Prepare an email to support');email.href=data.mailto;email.className='action secondary';
    const note=el('p','Nothing has been submitted. The email link opens your mail app with an editable draft; you must send it yourself. A listing report is submitted only through its report form.');
    const preview=root.document.createElement('details');preview.append(el('summary','View or copy the support email draft'));
    const draft=el('textarea',data.body);draft.value=data.body;draft.readOnly=true;draft.rows=10;draft.setAttribute('aria-label','Support email draft');preview.append(draft);
    result.append(title,list,next,email,note,preview);result.hidden=false;result.focus();
  });
})(typeof window==='undefined'?globalThis:window);
