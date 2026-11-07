'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,validateWork,validateReceipt}=require('../test-admin-work.js');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',ITEM='33333333-3333-4333-8333-333333333333',REQUEST='44444444-4444-4444-8444-444444444444';
const NOW=Date.parse('2026-11-03T22:00:00Z'),ENV='acceptance-v1',KEY='rr-private-admin-work-pending:'+ENV+':'+OWNER;
const tick=()=>new Promise(r=>setImmediate(r));
const item=(patch={})=>({id:ITEM,service:'stripe',title:'Check setup',note:'Private note',status:'open',version:1,createdAt:new Date(NOW-1000).toISOString(),updatedAt:new Date(NOW).toISOString(),...patch});
const list=(items=[],patch={})=>({test:true,live:false,releaseEnabled:false,observedAt:new Date(NOW).toISOString(),items,hasMore:false,nextCursor:patch.hasMore?'cursor_next':null,...patch});
const receipt=(body,patch={})=>({test:true,live:false,releaseEnabled:false,requestId:body.requestId,replayed:false,item:item({id:body.itemId,version:body.version+1,service:body.service,title:body.title,note:body.note,status:body.status}),...patch});
const marker=(patch={})=>({version:1,environmentId:ENV,member:OWNER,requestId:REQUEST,itemId:ITEM,...patch});
function setup({saved=new Map(),onFetch,crypto=true,storageFailure=false,relatedTargets=new Set()}={}){
 let current={token:'owner-session-token',member:OWNER},now=NOW,accessLost=0,next=0;
 const elements=[],calls=[],roots=[];
 const createElement=tag=>{const n={tag,children:[],textContent:'',value:'',style:{},hidden:false,disabled:false,events:{},append(...xs){this.children.push(...xs);},replaceChildren(...xs){this.children=[...xs];},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;},fire(k='click'){return this.events[k]?.({preventDefault(){}});}};elements.push(n);return n;};
 const root=createElement('section');roots.push(root);
 const document={createElement,getElementById:id=>relatedTargets.has(id)?{}:null};
 const storage={getItem:k=>{if(storageFailure)throw Error('Storage unavailable');return saved.get(k)??null;},setItem:(k,v)=>{if(storageFailure)throw Error('Storage unavailable');saved.set(k,v);},removeItem:k=>{if(storageFailure)throw Error('Storage unavailable');saved.delete(k);}};
 const window={crypto:crypto?{randomUUID:()=>++next===1?REQUEST:ITEM}:undefined};
 const fetchImpl=async(url,options)=>{calls.push({url,options,stored:[...saved.entries()]});assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer owner-session-token');assert.ok(url.startsWith('/api/test-admin?action=work'));return onFetch?onFetch(url,options,calls.length):Response.json(list());};
 const client=mount({root,document,window,fetchImpl,storage,session:()=>current,environmentId:ENV,onAccessLost:()=>accessLost++,clock:()=>now});
 const flat=n=>[n,...n.children.flatMap(flat)];
 const nodes=()=>flat(root),byTag=tag=>nodes().filter(n=>n.tag===tag),button=text=>nodes().find(n=>n.tag==='button'&&n.textContent===text);
 const textOf=n=>[n.textContent,...n.children.map(textOf)].join(' ');
 return {root,client,document,window,storage,saved,calls,nodes,byTag,button,text:()=>textOf(root),form:()=>byTag('form')[0],title:()=>byTag('input')[0],note:()=>byTag('textarea')[0],selects:()=>byTag('select'),setSession:v=>current=v,accessLost:()=>accessLost,advance:v=>now+=v,fill({title='Check the website',note='Waiting on support',service='vercel',status='waiting'}={}){this.title().value=title;this.note().value=note;this.selects()[0].value=service;this.selects()[1].value=status;},submit(){this.form().fire('submit');},postCalls:()=>calls.filter(c=>c.options.method==='POST')};
}
test('follow-ups do not auto-load, require their own validated read, preserve unsaved inputs and render notes as plain text',async()=>{
 let reads=0;const x=setup({onFetch:async()=>Response.json(list([item({note:'<script>private</script>',title:'A <b>plain</b> title'})],{hasMore:++reads>1}))});
 assert.equal(x.calls.length,0);assert.equal(x.button('Save follow-up').disabled,true);await x.client.refresh();
 assert.equal(x.button('Save follow-up').disabled,false);x.fill();const title=x.title(),note=x.note();await x.client.refresh();
 assert.equal(x.title(),title);assert.equal(x.note(),note);assert.equal(title.value,'Check the website');assert.equal(note.value,'Waiting on support');assert.match(x.text(),/<script>private<\/script>/);assert.equal(x.nodes().some(n=>n.tag==='script'||n.tag==='b'),false);assert.match(x.text(),/not the complete list/);assert.match(x.text(),/Last saved: 11\/3\/2026, 2:00:00 PM PST/);assert.equal(x.byTag('h2').length,0);assert.equal(x.postCalls().length,0);x.client.destroy();
});
test('a create persists only opaque recovery references before sending its exact request, then checks the saved list',async()=>{
 const x=setup({onFetch:async(url,o)=>o.method==='POST'?Response.json(receipt(JSON.parse(o.body))):Response.json(list())});
 await x.client.refresh();x.fill();x.submit();await tick();
 const call=x.postCalls()[0],body=JSON.parse(call.options.body);assert.deepEqual(body,{operation:'create',requestId:REQUEST,itemId:ITEM,version:0,service:'vercel',title:'Check the website',note:'Waiting on support',status:'waiting'});
 assert.deepEqual(call.stored,[[KEY,JSON.stringify(marker())]]);assert.equal(call.stored[0][1].includes('Waiting'),false);assert.equal(call.stored[0][1].includes('owner-session-token'),false);assert.equal(x.saved.has(KEY),false);assert.equal(x.calls.length,3);assert.ok(x.calls.every(c=>c.url.startsWith('/api/test-admin?action=work')));x.client.destroy();
});
test('an uncertain save locks replacement changes and retries only the same in-memory payload and request ID',async()=>{
 let attempts=0;const x=setup({onFetch:async(url,o)=>{if(o.method==='POST'){if(++attempts===1)throw Error('Lost response');return Response.json(receipt(JSON.parse(o.body),{replayed:true}));}if(url.includes('requestId='))return Response.json({test:true,live:false,releaseEnabled:false,requestId:REQUEST,state:'unconfirmed'});return Response.json(list());}});
 await x.client.refresh();x.fill();x.submit();await tick();const body=x.postCalls()[0].options.body;assert.equal(x.button('Save follow-up').disabled,true);assert.equal(x.button('Start a new follow-up').disabled,true);assert.equal(x.saved.has(KEY),true);
 x.title().value='Do not send this replacement';await x.client.refresh();assert.equal(x.postCalls().length,1);assert.match(x.text(),/cannot confirm that save yet/);
 x.button('Retry the same save').fire();await tick();assert.equal(x.postCalls().length,2);assert.equal(x.postCalls()[1].options.body,body);assert.equal(x.saved.has(KEY),false);x.client.destroy();
});
test('destroy aborts an uncertain request and clears private values; remount reconciles opaque references without recreating a save',async()=>{
 let finish;const wait=new Promise(r=>finish=r),saved=new Map();
 const x=setup({saved,onFetch:async(url,o)=>o.method==='POST'?wait:Response.json(list())});await x.client.refresh();x.fill({note:'Never persisted note'});const oldTitle=x.title(),oldNote=x.note();x.submit();await tick();assert.equal(saved.has(KEY),true);const call=x.postCalls()[0];x.client.destroy();
 assert.equal(call.options.signal.aborted,true);assert.equal(oldTitle.value,'');assert.equal(oldNote.value,'');assert.equal(x.root.children.length,0);assert.equal([...saved.values()].join().includes('Never persisted'),false);
 finish(Response.json(receipt(JSON.parse(call.options.body))));await tick();assert.equal(x.root.children.length,0);assert.equal(saved.has(KEY),true);
 const remount=setup({saved,onFetch:async()=>Response.json({test:true,live:false,releaseEnabled:false,requestId:REQUEST,state:'unconfirmed'})});await remount.client.refresh();assert.equal(remount.calls[0].url,'/api/test-admin?action=work&requestId='+REQUEST);assert.equal(remount.postCalls().length,0);assert.equal(remount.button('Retry the same save').hidden,true);assert.equal(remount.button('Save follow-up').disabled,true);assert.match(remount.text(),/Ask for help checking/);remount.client.destroy();
});
test('a recorded receipt after remount clears the marker only for its matching request and item, then loads work',async()=>{
 const saved=new Map([[KEY,JSON.stringify(marker())]]);const x=setup({saved,onFetch:async url=>url.includes('requestId=')?Response.json({test:true,live:false,releaseEnabled:false,requestId:REQUEST,replayed:true,item:item()}):Response.json(list([item()]))});await x.client.refresh();
 assert.equal(saved.has(KEY),false);assert.equal(x.calls.length,2);assert.equal(x.button('Save follow-up').disabled,false);assert.equal(x.postCalls().length,0);x.client.destroy();
 for(const response of [{test:true,live:false,releaseEnabled:false,requestId:REQUEST,replayed:true,item:item({id:OTHER})},{test:true,live:false,releaseEnabled:false,requestId:OTHER,replayed:true,item:item()}]){
  const pending=new Map([[KEY,JSON.stringify(marker())]]),y=setup({saved:pending,onFetch:async()=>Response.json(response)});await y.client.refresh();assert.equal(pending.has(KEY),true);assert.equal(y.button('Save follow-up').disabled,true);y.client.destroy();
 }
});
test('current owner denial clears data while a late denial from an old session cannot revoke its replacement',async()=>{
 const current=setup({onFetch:async()=>Response.json({error:'denied'},{status:403})});await current.client.refresh();assert.equal(current.accessLost(),1);assert.equal(current.root.children.length,0);
 let finish;const wait=new Promise(r=>finish=r),old=setup({onFetch:async()=>wait});const reading=old.client.refresh();old.setSession({token:'replacement-token',member:OWNER});finish(Response.json({error:'old denial'},{status:403}));await reading;assert.equal(old.accessLost(),0);assert.equal(old.root.children.length,0);assert.equal(old.postCalls().length,0);
});
test('version conflicts preserve the unsaved form and require selecting the newly read version before another update',async()=>{
 let version=1,posts=0;const x=setup({onFetch:async(url,o)=>{if(o.method==='POST'){posts++;if(posts===1){version=2;return Response.json({error:'changed',code:'version_conflict'},{status:409});}return Response.json(receipt(JSON.parse(o.body)));}return Response.json(list([item({version,title:'Latest saved '+version})]));}});
 await x.client.refresh();x.button('Edit this follow-up').fire();x.fill({title:'My unsaved change'});x.submit();await tick();
 assert.equal(x.title().value,'My unsaved change');assert.equal(x.button('Save follow-up').disabled,true);assert.equal(x.saved.has(KEY),false);assert.equal(x.calls.filter(c=>c.options.method==='GET').length,2);x.submit();await tick();assert.equal(posts,1);
 x.button('Edit this follow-up').fire();assert.equal(x.title().value,'Latest saved 2');x.fill({title:'Reviewed change'});x.submit();await tick();assert.equal(posts,2);assert.equal(JSON.parse(x.postCalls()[1].options.body).version,2);x.client.destroy();
});
test('generic conflicts and unavailable/cached/malformed save confirmations retain the original recovery marker',async()=>{
 for(const response of [()=>Response.json({code:'request_conflict'},{status:409}),()=>Response.json({error:'unknown'},{status:503}),b=>Response.json(receipt(b),{headers:{age:'1'}}),b=>Response.json(receipt(b,{item:item({id:b.itemId,title:'Substituted note'})}))]){
  const x=setup({onFetch:async(url,o)=>o.method==='POST'?response(JSON.parse(o.body)):Response.json(list())});await x.client.refresh();x.fill();x.submit();await tick();assert.equal(x.saved.has(KEY),true);assert.equal(x.button('Save follow-up').disabled,true);assert.equal(x.postCalls().length,1);x.client.destroy();
 }
});
test('no command overlaps an active list read or save',async()=>{
 let finish;const pending=new Promise(r=>finish=r),x=setup({onFetch:async()=>pending});const reading=x.client.refresh();await x.client.refresh();assert.equal(x.calls.length,1);assert.equal(x.button('Save follow-up').disabled,true);finish(Response.json(list()));await reading;x.client.destroy();
});
test('a form cannot begin a new save from an old follow-up read and keeps its unsaved note for a fresh check',async()=>{
 const x=setup();await x.client.refresh();x.fill();x.advance(60001);x.submit();await tick();assert.equal(x.postCalls().length,0);assert.equal(x.title().value,'Check the website');assert.equal(x.note().value,'Waiting on support');assert.equal(x.button('Save follow-up').disabled,true);assert.match(x.text(),/needs a fresh check/);x.client.destroy();
});
test('missing crypto, unavailable storage and malformed/cross-owner pending markers fail without a write',async()=>{
 for(const options of [{crypto:false},{storageFailure:true},{saved:new Map([[KEY,JSON.stringify(marker({member:OTHER}))]])},{saved:new Map([[KEY,'not-json']])}]){
  const x=setup(options);await x.client.refresh();x.fill();x.submit();await tick();assert.equal(x.postCalls().length,0);assert.equal(x.button('Save follow-up').disabled,true);x.client.destroy();
 }
});
test('bounded record validation rejects wrong authority, stale lists, duplicates, invalid fields and substituted receipt contents',()=>{
 assert.deepEqual(validateWork(list([item()]),{now:NOW}).items,[item()]);
 for(const patch of [{live:true},{releaseEnabled:true},{observedAt:new Date(NOW-60001).toISOString()},{items:Array(26).fill(item())},{items:[item(),item()]},{items:[item({service:'mailbox'})]},{items:[item({title:'  not normalized '})]},{items:[item({title:'title\nnewline'})]},{items:[item({title:'title\ttab'})]},{items:[item({note:'x'.repeat(2001)})]},{items:[item({version:0})]},{items:[item({version:1000000001})]},{items:[item({email:'not allowed'})]}])assert.throws(()=>validateWork(list([],patch),{now:NOW}));
 const body={operation:'create',requestId:REQUEST,itemId:ITEM,version:0,service:'stripe',title:'Check setup',note:'Private note',status:'open'};
 assert.equal(validateReceipt(receipt(body),marker(),{now:NOW,payload:body}).state,'confirmed');
 assert.throws(()=>validateReceipt(receipt(body,{item:item({note:'different'})}),marker(),{now:NOW,payload:body}));
});
test('page navigation follows only returned cursors and preserves unsaved text, edit identity and the current page during refresh',async()=>{
 const second='55555555-5555-4555-8555-555555555555',third='66666666-6666-4666-8666-666666666666';
 const x=setup({onFetch:async(url)=>Response.json(url.includes('cursor=cursor_two')?list([item({id:third,title:'Third page'})]):url.includes('cursor=cursor_one')?list([item({id:second,title:'Second page'})],{hasMore:true,nextCursor:'cursor_two'}):list([item({title:'First page',version:3})],{hasMore:true,nextCursor:'cursor_one'}))});
 await x.client.refresh();x.button('Edit this follow-up').fire();x.fill({title:'Unsaved edit',note:'Keep this note'});const title=x.title(),note=x.note();
 x.button('Next page').fire();await tick();assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work&cursor=cursor_one');assert.equal(x.title(),title);assert.equal(x.note(),note);assert.equal(x.title().value,'Unsaved edit');assert.match(x.text(),/Editing saved follow-up: First page/);
 await x.client.refresh();assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work&cursor=cursor_one');assert.equal(x.note().value,'Keep this note');
 x.button('Next page').fire();await tick();assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work&cursor=cursor_two');assert.equal(x.button('Next page').disabled,true);
 x.button('Back to first page').fire();await tick();assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work');assert.equal(x.title().value,'Unsaved edit');assert.equal(x.button('Back to first page').disabled,true);assert.equal(x.postCalls().length,0);x.client.destroy();
});
test('a save from an older page keeps the selected item version and returns to the first page only after confirmation',async()=>{
 const second='55555555-5555-4555-8555-555555555555';
 const x=setup({onFetch:async(url,o)=>o.method==='POST'?Response.json(receipt(JSON.parse(o.body))):Response.json(url.includes('cursor=cursor_one')?list([item({id:second,version:7,title:'Older task'})]):list([item()],{hasMore:true,nextCursor:'cursor_one'}))});
 await x.client.refresh();x.button('Next page').fire();await tick();x.button('Edit this follow-up').fire();x.fill({title:'Reviewed older task'});x.submit();await tick();
 assert.equal(JSON.parse(x.postCalls()[0].options.body).itemId,second);assert.equal(JSON.parse(x.postCalls()[0].options.body).version,7);assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work');assert.equal(x.title().value,'');assert.equal(x.note().value,'');assert.equal(x.button('Back to first page').disabled,true);x.client.destroy();
});
test('an uncertain command disables paging, and confirming the original save clears its form before returning to the first page',async()=>{
 const second='55555555-5555-4555-8555-555555555555';let body;
 const x=setup({onFetch:async(url,o)=>{if(o.method==='POST'){body=JSON.parse(o.body);throw Error('Lost save');}if(url.includes('requestId='))return Response.json(receipt(body));return Response.json(url.includes('cursor=cursor_one')?list([item({id:second,title:'Older task'})]):list([item()],{hasMore:true,nextCursor:'cursor_one'}));}});
 await x.client.refresh();x.button('Next page').fire();await tick();x.button('Edit this follow-up').fire();x.fill({title:'Already sent once',note:'Do not duplicate'});x.submit();await tick();assert.equal(x.button('Next page').disabled,true);assert.equal(x.button('Back to first page').disabled,true);
 const before=x.calls.length;x.button('Back to first page').fire();await tick();assert.equal(x.calls.length,before);x.button('Check the same save').fire();await tick();assert.equal(x.calls.at(-1).url,'/api/test-admin?action=work');assert.equal(x.title().value,'');assert.equal(x.note().value,'');assert.equal(x.postCalls().length,1);x.client.destroy();
});
test('looping cursors and duplicate records across pages fail closed while Back to first page remains available',async()=>{
 for(const duplicate of [false,true]){
  const x=setup({onFetch:async(url)=>Response.json(url.includes('cursor=cursor_one')?list([item({id:duplicate?ITEM:OTHER})],{hasMore:true,nextCursor:duplicate?'cursor_two':'cursor_one'}):list([item()],{hasMore:true,nextCursor:'cursor_one'}))});await x.client.refresh();x.fill();x.button('Next page').fire();await tick();assert.equal(x.button('Save follow-up').disabled,true);assert.equal(x.button('Next page').disabled,true);assert.equal(x.button('Back to first page').disabled,false);assert.equal(x.title().value,'Check the website');assert.equal(x.byTag('article').length,0);assert.equal(x.postCalls().length,0);x.client.destroy();
 }
});
test('pagination validates exact next-cursor consistency and never invents or decodes a continuation',()=>{
 for(const patch of [{hasMore:true,nextCursor:null},{hasMore:false,nextCursor:'cursor_one'},{hasMore:true,nextCursor:''},{hasMore:true,nextCursor:'bad/cursor'},{hasMore:true,nextCursor:'x'.repeat(257)}])assert.throws(()=>validateWork(list([item()],patch),{now:NOW}));
 assert.throws(()=>validateWork(list([],{hasMore:true,nextCursor:'cursor_one'}),{now:NOW}));
 assert.throws(()=>validateWork(list([item()],{hasMore:true,nextCursor:'cursor_one'}),{now:NOW,cursor:'cursor_one'}));
 assert.throws(()=>validateWork(list([item()],{hasMore:true,nextCursor:'cursor_one'}),{now:NOW,cursor:'cursor_two',seenCursors:['cursor_one']}));
});
test('single-line titles reject newlines and tabs before a save is sent',async()=>{
 for(const title of ['first\nsecond','first\tsecond','edge newline\n','\tedge tab']){const x=setup();await x.client.refresh();x.fill({title});x.submit();await tick();assert.equal(x.postCalls().length,0);assert.equal(x.saved.size,0);assert.match(x.text(),/single-line title/);x.client.destroy();}
});
test('a record at the supported version ceiling cannot begin an unrepresentable update',async()=>{
 const x=setup({onFetch:async()=>Response.json(list([item({version:1000000000})]))});await x.client.refresh();x.button('Edit this follow-up').fire();x.fill();x.submit();await tick();assert.equal(x.postCalls().length,0);assert.equal(x.saved.size,0);assert.match(x.text(),/supported edit limit/);x.client.destroy();
});

test('related record shortcut drafts only after a fresh owner list and sends no save automatically',async()=>{
 const x=setup(),ref={kind:'case',ref:'case_'+'a'.repeat(32),orderRef:OTHER};
 assert.equal(x.client.startFromRecord(ref),false);assert.equal(x.calls.length,0);
 await x.client.refresh();assert.equal(x.client.startFromRecord(ref),true);
 assert.equal(x.title().value,'Review payment case');assert.match(x.note().value,new RegExp(ref.ref));assert.match(x.note().value,new RegExp(OTHER));assert.equal(x.selects()[0].value,'stripe');
 assert.equal(x.postCalls().length,0);assert.equal(x.saved.size,0);assert.match(x.text(),/Nothing has been saved yet/);x.client.destroy();
});
test('record shortcuts never replace an unsaved draft, pending save or expired owner context',async()=>{
 const x=setup();await x.client.refresh();x.fill({title:'Keep this draft',note:'My unsaved note'});
 assert.equal(x.client.startFromRecord({kind:'order',ref:OTHER}),false);assert.equal(x.title().value,'Keep this draft');assert.equal(x.note().value,'My unsaved note');assert.equal(x.postCalls().length,0);
 x.setSession({token:'different-owner-session',member:OWNER});assert.equal(x.client.startFromRecord({kind:'order',ref:OTHER}),false);assert.equal(x.root.children.length,0);
 const y=setup({saved:new Map([[KEY,JSON.stringify(marker())]])});assert.equal(y.client.startFromRecord({kind:'order',ref:OTHER}),false);assert.equal(y.postCalls().length,0);y.client.destroy();
});
test('related draft accepts only an opaque order or case binding, with no URL/body/authority injection',async()=>{
 const x=setup();await x.client.refresh();
 for(const value of [null,{kind:'order',ref:'https://foreign.invalid'},{kind:'order',ref:OTHER,verified:true},{kind:'case',ref:'case_bad',orderRef:OTHER},{kind:'case',ref:'case_'+'a'.repeat(32),orderRef:'foreign'}])assert.equal(x.client.startFromRecord(value),false);
 assert.equal(x.title().value,'');assert.equal(x.note().value,'');assert.equal(x.postCalls().length,0);
 assert.equal(x.client.startFromRecord({kind:'order',ref:OTHER}),true);assert.equal(x.title().value,'Review order');assert.match(x.note().value,new RegExp(OTHER));x.client.destroy();
});

test('saved follow-up links only well-formed references to currently visible owner records',async()=>{
 const c='case_'+'a'.repeat(32),targets=new Set(['case-'+c,'order-'+OTHER]);
 const x=setup({relatedTargets:targets,onFetch:async()=>Response.json(list([item({note:'Case reference: '+c+'\nOrder reference: '+OTHER+'\nOrder reference: https://foreign.invalid\nCase reference: '+c})]))});await x.client.refresh();
 assert.deepEqual(x.byTag('a').map(n=>n.href),['#case-'+c,'#order-'+OTHER]);assert.equal(x.postCalls().length,0);
 targets.clear();await x.client.refresh();assert.equal(x.byTag('a').length,0);assert.match(x.text(),new RegExp(c));x.client.destroy();
});
