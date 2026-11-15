'use strict';
// Fictional Auth/SQL/Stripe only; the native HTTP check uses loopback.
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events');
const {Readable}=require('node:stream');
const http=require('node:http');
const {fixture,response}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {BEGIN_PATH,ENV}=require('../server/owner_practice_runtime.cjs');

function disconnectableResponse(){
 const res=Object.assign(new EventEmitter(),response());
 const destroy=res.destroy.bind(res);
 res.destroy=()=>{destroy();res.emit('close');};
 return res;
}

test('already aborted requests and closed response sinks cannot start owner practice',async()=>{
 for(const kind of ['aborted','destroyed','ended']){
  const f=fixture(),res=disconnectableResponse(),stream=Readable.from([Buffer.from('action=begin')]);
  if(kind==='aborted')stream.aborted=true;
  if(kind==='destroyed')res.destroy();
  if(kind==='ended')res.writableEnded=true;
  await f.request('POST','begin',{stream,response:res});
  assert.deepEqual(f.calls,[],kind);assert.deepEqual(f.writes,[],kind);assert.deepEqual(f.providerPosts,[],kind);
  assert.equal(res.body,'');assert.equal(res.headers.location,undefined);
 }
});

test('disconnect after context or a committed claim stops before the first provider POST',async()=>{
 for(const operation of ['context','claim']){
  const res=disconnectableResponse();
  const f=fixture({event(name,data){if(name==='sql:after'&&data.p_operation===operation)res.destroy();}});
  await f.request('POST','begin',{response:res});
  assert.deepEqual(f.providerPosts,[]);assert.equal(res.body,'');assert.equal(res.headers.location,undefined);
  assert.equal(f.phase,operation==='claim'?'dispatched':'prepared');
  assert.deepEqual(f.writes,operation==='claim'?['claim']:[]);
  assert.equal(res.listenerCount('close'),0);
  if(operation==='claim'){
   assert.equal((await f.request('POST','begin')).statusCode,503);
   assert.deepEqual(f.providerPosts,[]);assert.deepEqual(f.writes,['claim']);
  }
 }
});

test('response close promptly aborts a stalled claim and fences its late acknowledgment',{timeout:7000},async()=>{
 const res=disconnectableResponse();
 const f=fixture({hangSql:'claim',event(name,data){
  if(name==='sql:before'&&data.p_operation==='claim')setImmediate(()=>res.destroy());
 }});
 const started=performance.now();await f.request('POST','begin',{response:res});
 assert(performance.now()-started<1500,'Disconnect must not wait for the five-second expiry');
 assert.equal(f.phase,'dispatched');assert.deepEqual(f.writes,['claim']);assert.deepEqual(f.providerPosts,[]);
 f.releaseRpc();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.providerPosts,[]);assert.equal(res.headers.location,undefined);assert.equal(res.body,'');
 assert(f.signals.every(signal=>signal.aborted));assert.equal(res.listenerCount('close'),0);
});

test('request abortion fences a late create response without saving, linking or recreating',{timeout:7000},async()=>{
 const res=disconnectableResponse(),stream=Readable.from([Buffer.from('action=begin')]);
 const f=fixture({hangProviderBody:true,event(name,data){
  if(name==='provider:after'&&data.path==='/v2/core/accounts'&&data.method==='POST')setImmediate(()=>{
   stream.aborted=true;stream.emit('aborted');res.destroy();
  });
 }});
 const started=performance.now();await f.request('POST','begin',{stream,response:res});
 assert(performance.now()-started<1500,'Aborted request must cancel its stalled provider body promptly');
 assert.deepEqual(f.providerPosts,['/v2/core/accounts']);assert.deepEqual(f.writes,['claim']);assert.equal(f.phase,'dispatched');
 f.releaseProviderBody();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.writes,['claim']);assert.equal(res.headers.location,undefined);assert.equal(res.body,'');
 assert.equal(stream.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
 assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.providerPosts,['/v2/core/accounts']);
});

test('disconnect after an unsent private Location clears it without writing another response',async()=>{
 const f=fixture({phase:'known'}),res=disconnectableResponse(),set=res.setHeader.bind(res);
 res.setHeader=(name,value)=>{set(name,value);if(name==='Location')res.destroy();};
 await f.request('POST','refresh',{response:res});
 assert.equal(res.headers.location,undefined);assert.equal(res.headersSent,false);assert.equal(res.body,'');
 assert.deepEqual(f.providerPosts,['/v2/core/account_links']);assert.deepEqual(f.writes,[]);
});

test('native Node request completion permits the redirect; a real socket disconnect stops new effects',{timeout:10000},async()=>{
 for(const disconnect of [false,true]){
  let client,handled,handlerError,cut=false;
  const completed=new Promise(resolve=>{handled=resolve;});
  const f=fixture({event:async(name,data)=>{
   if(disconnect&&!cut&&name==='sql:after'&&data.p_operation==='context'){
    cut=true;const closed=once(serverResponse,'close');client.destroy();await closed;
   }
  }});
  let serverResponse;
  const server=http.createServer((req,res)=>{
   serverResponse=res;
   f.instance.handler(req,res).catch(error=>{handlerError=error;res.destroy();}).finally(handled);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const outcome=new Promise((resolve,reject)=>{
    client=http.request({host:'127.0.0.1',port:server.address().port,path:BEGIN_PATH,method:'POST',headers:{
     cookie:f.cookie(),origin:ENV.previewOrigin,'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'
    }},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));});
    client.on('error',error=>disconnect?resolve({disconnected:true}):reject(error));client.end('action=begin');
   });
   const result=await outcome;await completed;assert.equal(handlerError,undefined);
   if(disconnect){assert.equal(result.disconnected,true);assert.equal(f.phase,'prepared');assert.deepEqual(f.writes,[]);assert.deepEqual(f.providerPosts,[]);}
   else{assert.equal(result.status,303);assert.match(result.location,/^https:\/\/accounts\.stripe\.com\//);assert.equal(f.phase,'known');assert.deepEqual(f.writes,['claim','save']);}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
});
