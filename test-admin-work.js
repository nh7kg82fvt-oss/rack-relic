'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.RackRelicAdminWork=api;
})(globalThis,function(){
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
 const CURSOR=/^[A-Za-z0-9_-]{1,256}$/;
 const SERVICES=Object.freeze({stripe:'Payments — Stripe',shippo:'Shipping — Shippo',supabase:'Saved records — Supabase',vercel:'Website hosting — Vercel',backups:'Backups and recovery',website:'Website'});
 const STATUSES=Object.freeze({open:'To do',in_review:'Working on it',waiting:'Waiting for something',complete:'Finished'});
 const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
 const text=(value,max,min=0)=>typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
 const titleText=value=>text(value,120,1)&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
 function timestamp(value,now){if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now+30000)throw Error('Invalid follow-up time');return value;}
 function validateItem(value,now){
  if(!exact(value,['id','service','title','note','status','version','createdAt','updatedAt'])||!UUID.test(value.id)||!Object.hasOwn(SERVICES,value.service)||!Object.hasOwn(STATUSES,value.status)||!titleText(value.title)||!text(value.note,2000)||!Number.isSafeInteger(value.version)||value.version<1||value.version>1000000000)throw Error('Invalid follow-up record');
  const createdAt=timestamp(value.createdAt,now),updatedAt=timestamp(value.updatedAt,now);if(Date.parse(createdAt)>Date.parse(updatedAt))throw Error('Invalid follow-up history');
  return {id:value.id,service:value.service,title:value.title,note:value.note,status:value.status,version:value.version,createdAt,updatedAt};
 }
 function validateWork(value,{now=Date.now(),cursor=null,seenCursors=[]}={}){
  if(!Number.isSafeInteger(now)||cursor!==null&&(typeof cursor!=='string'||!CURSOR.test(cursor))||!exact(value,['test','live','releaseEnabled','observedAt','items','hasMore','nextCursor'])||value.test!==true||value.live!==false||value.releaseEnabled!==false||typeof value.hasMore!=='boolean'||!Array.isArray(value.items)||value.items.length>25)throw Error('Private practice follow-up required');
  const observedAt=timestamp(value.observedAt,now);if(now-Date.parse(observedAt)>60000)throw Error('Old follow-up list');
  const items=value.items.map(v=>validateItem(v,now));if(new Set(items.map(v=>v.id)).size!==items.length)throw Error('Duplicate follow-up record');
  if(value.hasMore?(typeof value.nextCursor!=='string'||!CURSOR.test(value.nextCursor)||!items.length||value.nextCursor===cursor||seenCursors.includes(value.nextCursor)):value.nextCursor!==null)throw Error('Invalid follow-up page');
  return {test:true,live:false,releaseEnabled:false,observedAt,items,hasMore:value.hasMore,nextCursor:value.nextCursor};
 }
 function validateReceipt(value,marker,{now=Date.now(),payload=null}={}){
  if(!Number.isSafeInteger(now)||value?.test!==true||value.live!==false||value.releaseEnabled!==false||value.requestId!==marker.requestId)throw Error('Unmatched save confirmation');
  if(value.state==='unconfirmed'){
   if(!exact(value,['test','live','releaseEnabled','requestId','state']))throw Error('Invalid save confirmation');
   return {state:'unconfirmed'};
  }
  if(!exact(value,['test','live','releaseEnabled','item','requestId','replayed'])||typeof value.replayed!=='boolean')throw Error('Invalid save confirmation');
  const item=validateItem(value.item,now);if(item.id!==marker.itemId)throw Error('Different follow-up confirmation');
  if(payload&&(item.version!==payload.version+1||['service','title','note','status'].some(k=>item[k]!==payload[k])))throw Error('Different save contents');
  return {state:'confirmed',item};
 }
 function mount({root,document,window,fetchImpl,storage,session,environmentId,onAccessLost=()=>{},clock=Date.now}={}){
  if(!root||typeof session!=='function'||!['acceptance-v1','legacy'].includes(environmentId))throw Error('Private follow-up owner context required');
  const owner=session();if(!UUID.test(owner?.member||'')||typeof owner.token!=='string'||!/^\S{1,8192}$/.test(owner.token))throw Error('Private follow-up owner session required');
  const markerKey='rr-private-admin-work-pending:'+environmentId+':'+owner.member;
  let destroyed=false,generation=0,active=null,busy=false,loaded=false,lastReadAt=null,marker=null,payload=null,markerInvalid=false,items=[],editing=null,requireReload=false,versionConflict=false;
  let pageCursor=null,nextCursor=null;const visitedPages=new Map();
  const controls=[],editButtons=[];
  const el=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
  const notice=el('p');notice.setAttribute?.('role','status');notice.setAttribute?.('aria-live','polite');
  const list=el('div'),coverage=el('p'),editingHint=el('p','Adding a new follow-up.'),form=el('form'),service=el('select'),title=el('input'),note=el('textarea'),status=el('select');
  const save=el('button','Save follow-up'),newItem=el('button','Start a new follow-up'),check=el('button','Check the same save'),retry=el('button','Retry the same save');
  const nextPage=el('button','Next page'),firstPage=el('button','Back to first page');nextPage.type=firstPage.type='button';
  save.type='submit';newItem.type=check.type=retry.type='button';title.type='text';title.maxLength=120;title.required=true;note.maxLength=2000;note.rows=4;
  for(const [value,label]of Object.entries(SERVICES)){const option=el('option',label);option.value=value;service.append(option);}
  for(const [value,label]of Object.entries(STATUSES)){const option=el('option',label);option.value=value;status.append(option);}
  service.value='website';status.value='open';title.value='';note.value='';
  const label=(caption,input)=>{const n=el('label',caption);n.append(input);form.append(n);};
  label('Which part of Rack Relic?',service);label('What needs doing?',title);label('Private note (optional)',note);label('Progress',status);form.append(save,newItem);
  root.append(el('p','Keep private setup notes and next steps here. Saving or finishing a follow-up does not change payments, shipping, refunds or seller payouts.'),el('p','Keep passwords and payment details out of notes.'),notice,check,retry,editingHint,form,coverage,firstPage,nextPage,list);
  controls.push(service,title,note,status,save,newItem);
  const setNotice=value=>{notice.textContent=value;};
  const sameSession=()=>{const current=session();return current?.token===owner.token&&current?.member===owner.member;};
  function alive(version){if(destroyed||version!==generation)return false;if(!sameSession()){destroy();return false;}return true;}
  function updateControls(){const locked=destroyed||busy||!loaded||marker!==null||markerInvalid||requireReload;for(const n of controls)n.disabled=locked;save.disabled=locked||versionConflict;for(const n of editButtons)n.disabled=locked;check.hidden=marker===null||markerInvalid;check.disabled=busy||destroyed;retry.hidden=marker===null||payload===null||markerInvalid;retry.disabled=busy||destroyed;nextPage.disabled=locked||nextCursor===null||visitedPages.size>=100;firstPage.disabled=destroyed||busy||marker!==null||markerInvalid||pageCursor===null;}
  function resetPages(){pageCursor=null;nextCursor=null;visitedPages.clear();}
  function resetAfterSave(){editing=null;versionConflict=false;title.value='';note.value='';status.value='open';editingHint.textContent='Adding a new follow-up.';resetPages();}
  function cached(response){const age=response.headers?.get('age');return age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase()));}
  function readMarker(){
   try{const raw=storage.getItem(markerKey);if(raw===null)return;if(typeof raw!=='string'||raw.length>1024)throw Error('Invalid pending save');const m=JSON.parse(raw);
    if(!exact(m,['version','environmentId','member','requestId','itemId'])||m.version!==1||m.environmentId!==environmentId||m.member!==owner.member||!UUID.test(m.requestId)||!UUID.test(m.itemId))throw Error('Invalid pending save');marker=m;
   }catch{markerInvalid=true;setNotice('A previous save needs help checking before another change can be made. Its private note has not been stored in this browser.');}
  }
  function persistMarker(m){try{storage.setItem(markerKey,JSON.stringify(m));if(storage.getItem(markerKey)!==JSON.stringify(m))throw Error('Save marker not retained');return true;}catch{return false;}}
  function clearMarker(){try{storage.removeItem(markerKey);if(storage.getItem(markerKey)!==null)throw Error('Save marker remains');marker=null;payload=null;return true;}catch{setNotice('The save was confirmed, but this browser could not clear its pending-save record. Ask for help before making another change.');return false;}}
  function startRequest(){if(destroyed||busy||!sameSession()){if(!destroyed&&!sameSession())destroy();return null;}busy=true;active=new AbortController();updateControls();return {version:generation,signal:AbortSignal.any([active.signal,AbortSignal.timeout(20000)])};}
  function endRequest(version){if(!alive(version))return;busy=false;active=null;updateControls();}
  async function readResponse(response,version){
   if(!alive(version))return null;
   if(response.status===401||response.status===403){destroy();onAccessLost();return null;}
   if(cached(response))throw Error('Cached follow-up response');
   return response;
  }
  function renderList(data){
   items=data.items;list.replaceChildren();editButtons.length=0;
   for(const item of items){const card=el('article');card.className='card';card.append(el('h3',item.title),el('p',SERVICES[item.service]+' · '+STATUSES[item.status]));if(item.note){const paragraph=el('p',item.note);paragraph.style&&(paragraph.style.whiteSpace='pre-wrap');card.append(paragraph);}card.append(el('p','Last saved: '+new Date(item.updatedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'})));const edit=el('button','Edit this follow-up');edit.type='button';edit.addEventListener('click',()=>{if(destroyed||busy||marker||markerInvalid||!loaded||requireReload)return;editing=item;versionConflict=false;service.value=item.service;title.value=item.title;note.value=item.note;status.value=item.status;editingHint.textContent='Editing saved follow-up: '+item.title;setNotice('Editing the latest saved follow-up. Changes stay in this form until you save.');updateControls();});editButtons.push(edit);card.append(edit);list.append(card);}
   if(!items.length)list.append(el('p','No follow-up work has been saved yet.'));
   nextCursor=data.nextCursor;coverage.textContent=(data.hasMore?'More follow-ups are available on the next page. This is not the complete list.':pageCursor===null?'These are your saved practice follow-ups.':'This is the last page in this view.')+' New or changed work can move between pages; return to the first page to check the newest records.'+(visitedPages.size>=100?' This view reached its page limit. Return to the first page to start a new check.':'');
  }
  async function refresh(){
   if(destroyed||busy)return;if(markerInvalid){updateControls();return;}if(marker)return reconcile();
   const request=startRequest();if(!request)return;
   try{let response=await fetchImpl('/api/test-admin?action=work'+(pageCursor===null?'':'&cursor='+encodeURIComponent(pageCursor)),{method:'GET',cache:'no-store',redirect:'error',signal:request.signal,headers:{Authorization:'Bearer '+owner.token}});response=await readResponse(response,request.version);if(!response)return;if(!response.ok)throw Error('Follow-up list unavailable');const raw=await response.json();if(!alive(request.version))return;const data=validateWork(raw,{now:clock(),cursor:pageCursor,seenCursors:[...visitedPages.keys()].filter(Boolean)});
    const otherIds=new Set([...visitedPages].filter(([cursor])=>cursor!==(pageCursor||'')).flatMap(([,ids])=>ids));if(data.items.some(item=>otherIds.has(item.id)))throw Error('Follow-up records moved between pages');visitedPages.set(pageCursor||'',data.items.map(item=>item.id));renderList(data);loaded=true;lastReadAt=Date.parse(data.observedAt);requireReload=false;setNotice(versionConflict?'The latest list is loaded. Your unsaved form is preserved. Choose “Edit this follow-up” to load its current version before saving.':'Follow-ups loaded. You can add a note or edit saved work.');}
   catch{if(alive(request.version)){loaded=false;nextCursor=null;list.replaceChildren();coverage.textContent='';setNotice('Follow-ups could not be checked, or records changed between pages. Your unsaved form is still here. Return to the first page or refresh the control center before saving.');}}
   finally{endRequest(request.version);}
  }
  async function reconcile(){
   if(!marker||markerInvalid||destroyed||busy)return;const request=startRequest();if(!request)return;let confirmed=false;
   try{let response=await fetchImpl('/api/test-admin?action=work&requestId='+encodeURIComponent(marker.requestId),{method:'GET',cache:'no-store',redirect:'error',signal:request.signal,headers:{Authorization:'Bearer '+owner.token}});response=await readResponse(response,request.version);if(!response)return;if(!response.ok)throw Error('Save check unavailable');const raw=await response.json();if(!alive(request.version))return;const receipt=validateReceipt(raw,marker,{now:clock(),payload});
    if(receipt.state==='unconfirmed'){setNotice(payload?'We cannot confirm that save yet. Check the same save, or retry that exact save. Do not create a replacement.':'We cannot confirm the previous save. Ask for help checking its request before creating another follow-up.');}
    else if(clearMarker()){confirmed=true;loaded=false;resetAfterSave();setNotice('Your save is confirmed. Checking the latest follow-ups…');}
   }catch{if(alive(request.version))setNotice('The save still needs checking. Do not create a replacement follow-up. Use “Check the same save” or ask for help.');}
   finally{endRequest(request.version);}
   if(confirmed&&!destroyed)await refresh();
  }
  async function sendPayload(){
   if(!marker||!payload||markerInvalid||destroyed||busy)return;const request=startRequest();if(!request)return;let confirmed=false,conflict=false;
   try{let response=await fetchImpl('/api/test-admin?action=work',{method:'POST',cache:'no-store',redirect:'error',signal:request.signal,headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});response=await readResponse(response,request.version);if(!response)return;
    const raw=await response.json();if(!alive(request.version))return;
    if(response.status===409&&raw?.code==='version_conflict'){if(clearMarker()){loaded=false;requireReload=true;versionConflict=true;conflict=true;resetPages();setNotice('This follow-up changed since you opened it. Your unsaved form is preserved. Check the latest saved version before editing again.');}}
    else{if(!response.ok)throw Error('Save outcome not confirmed');const receipt=validateReceipt(raw,marker,{now:clock(),payload});if(receipt.state!=='confirmed')throw Error('Save outcome not confirmed');if(clearMarker()){confirmed=true;loaded=false;resetAfterSave();setNotice('Follow-up saved. Checking the latest list…');}}
   }catch{if(alive(request.version))setNotice('We could not confirm this save. Its exact request is kept for checking. Do not create a replacement; check it or retry the same save.');}
   finally{endRequest(request.version);}
   if((confirmed||conflict)&&!destroyed)await refresh();
  }
  function submit(event){
   event?.preventDefault?.();if(destroyed||busy||!loaded||marker||markerInvalid||requireReload||versionConflict||!sameSession())return;
   const now=clock();if(!Number.isSafeInteger(now)||lastReadAt===null||now-lastReadAt>60000||lastReadAt>now+30000){loaded=false;setNotice('The follow-up list needs a fresh check before saving. Your unsaved form is preserved; refresh the control center first.');updateControls();return;}
   const draft={service:service.value,title:title.value.trim(),note:note.value,status:status.value};
   if(!Object.hasOwn(SERVICES,draft.service)||!Object.hasOwn(STATUSES,draft.status)||/[\u0000-\u001f\u007f]/.test(title.value)||!titleText(draft.title)||!text(draft.note,2000)){setNotice('Choose a service and progress, add a single-line title of 1–120 characters, and keep the note within 2,000 characters.');return;}
   if(editing?.version>=1000000000){setNotice('This follow-up has reached its supported edit limit. Ask for help reviewing it before making another change.');return;}
   let requestId,itemId;try{requestId=window.crypto.randomUUID();itemId=editing?editing.id:window.crypto.randomUUID();if(!UUID.test(requestId)||!UUID.test(itemId))throw Error('Invalid request reference');}catch{setNotice('This browser cannot create a safe save reference. Use a current browser or ask for help.');return;}
   const next={version:1,environmentId,member:owner.member,requestId,itemId};if(!persistMarker(next)){markerInvalid=true;setNotice('This browser cannot keep the save reference safely. No save was sent. Ask for help before trying again.');updateControls();return;}
   marker=next;payload=Object.freeze({operation:editing?'update':'create',requestId,itemId,version:editing?editing.version:0,...draft});updateControls();void sendPayload();
  }
  function destroy(){if(destroyed)return;destroyed=true;generation++;active?.abort();active=null;busy=false;loaded=false;items=[];editing=null;payload=null;resetPages();for(const n of [title,note])n.value='';root.replaceChildren();}
  form.addEventListener('submit',submit);check.addEventListener('click',()=>void reconcile());retry.addEventListener('click',()=>void sendPayload());newItem.addEventListener('click',()=>{if(destroyed||busy||marker||markerInvalid||!loaded||requireReload)return;editing=null;versionConflict=false;service.value='website';title.value='';note.value='';status.value='open';editingHint.textContent='Adding a new follow-up.';setNotice('New follow-up. Nothing is saved until you choose Save follow-up.');updateControls();});
  nextPage.addEventListener('click',()=>{if(destroyed||busy||marker||markerInvalid||!loaded||requireReload||nextCursor===null||visitedPages.has(nextCursor)||visitedPages.size>=100)return;pageCursor=nextCursor;nextCursor=null;loaded=false;void refresh();});
  firstPage.addEventListener('click',()=>{if(destroyed||busy||marker||markerInvalid||pageCursor===null)return;resetPages();loaded=false;void refresh();});
  readMarker();if(!window.crypto||typeof window.crypto.randomUUID!=='function'){markerInvalid=true;setNotice('This browser cannot create safe save references. Follow-up changes are unavailable.');}updateControls();
  return Object.freeze({refresh,destroy});
 }
 return Object.freeze({mount,validateWork,validateReceipt});
});
