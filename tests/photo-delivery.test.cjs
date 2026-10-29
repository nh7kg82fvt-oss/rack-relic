'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createProductionApi}=require('../api/listing-photo.js');
const {createListingPhotoHandler}=require('../server/listing_photo_delivery.cjs');
const {serverConfig}=require('../server/photo_production_config.cjs');
const PROD='https://zrfztnbyynrdzfeblkeq.supabase.co';
const ID='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const BUYER='33333333-3333-4333-8333-333333333333';
const PNG=Buffer.from('89504e470d0a1a0a00000000','hex');
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',SUPABASE_URL:PROD,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test'};
const row=(status='published',extra={})=>({id:ID,seller_id:OWNER,status,moderation_status:'active',photo_path:OWNER+'/'+ID+'/test.png',...extra});
function fixture(options={}){
 const calls=[];let rowReads=0;
 const fetchImpl=async(url,init)=>{
  calls.push({url:String(url),init});
  if(String(url).endsWith('/auth/v1/user'))return Response.json({id:options.actor||OWNER},{status:options.authStatus||200,headers:options.authHeaders});
  if(String(url).includes('/rest/v1/listings')){
   const current=options.rows?options.rows[Math.min(rowReads++,options.rows.length-1)]:[options.row||row()];
   return Response.json(current,{headers:options.rowHeaders});
  }
  assert.ok(String(url).startsWith(PROD+'/storage/v1/object/listing-photos/'));
  assert.equal(init.headers.Authorization,'Bearer sb_secret_test');
  assert.equal(init.headers.apikey,'sb_secret_test');
  assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  return new Response(options.bytes||PNG,{status:options.imageStatus||200,headers:{'Content-Type':options.type||'image/png',...options.imageHeaders}});
 };
 return {calls,handler:createProductionApi(options.env||env,fetchImpl)};
}
async function run(f,request={}){
 const headers={};let body;
 const res={setHeader(k,v){headers[k.toLowerCase()]=v},end(data){body=data},statusCode:0};
 await f.handler({method:'GET',url:'/api/listing-photo?id='+ID,headers:{},...request},res);
 assert.equal(headers['cache-control'],'private, no-store, max-age=0');
 assert.equal(headers['cdn-cache-control'],'no-store');assert.equal(headers['vercel-cdn-cache-control'],'no-store');
 assert.equal(headers.vary,'Authorization');
 return {status:res.statusCode,headers,body};
}
test('anonymous published photo is delivered with fresh authorization checks',async()=>{
 const f=fixture();const r=await run(f);assert.equal(r.status,200);assert.deepEqual(r.body,PNG);
 assert.equal(f.calls.filter(x=>x.url.includes('/rest/v1/listings')).length,2);
 assert.equal(f.calls.some(x=>x.url.includes('/auth/')),false);
 assert.equal(r.headers['content-type'],'image/png');
});
for(const state of ['draft','archived']){
 test('owner can read '+state,async()=>{const f=fixture({row:row(state)});assert.equal((await run(f,{headers:{authorization:'Bearer owner-session'}})).status,200);});
 test('buyer cannot read '+state,async()=>{const f=fixture({row:row(state),actor:BUYER});assert.equal((await run(f,{headers:{authorization:'Bearer buyer-session'}})).status,404);assert.equal(f.calls.some(x=>x.url.includes('/storage/')),false);});
 test('anonymous cannot read '+state,async()=>{assert.equal((await run(fixture({row:row(state)}))).status,404);});
}
test('invalid caller token never reaches storage',async()=>{const f=fixture({authStatus:401});assert.equal((await run(f,{headers:{authorization:'Bearer bad'}})).status,404);assert.equal(f.calls.length,1);});
test('hidden photo is denied to buyer',async()=>{assert.equal((await run(fixture({row:row('published',{moderation_status:'hidden'}),actor:BUYER}),{headers:{authorization:'Bearer buyer'}})).status,404);});
test('active sold photo remains public according to existing listing rules',async()=>{assert.equal((await run(fixture({row:row('sold')}))).status,200);});
test('archive during image read prevents bytes escaping',async()=>{assert.equal((await run(fixture({rows:[[row()],[row('archived')]]}))).status,404);});
test('replacement during image read prevents obsolete bytes escaping',async()=>{assert.equal((await run(fixture({rows:[[row()],[row('published',{photo_path:OWNER+'/'+ID+'/new.png'})]]}))).status,404);});
test('missing or removed image reference denies read',async()=>{assert.equal((await run(fixture({row:row('published',{photo_path:null})}))).status,404);});
test('a cached authorization row is rejected',async()=>{const f=fixture({rowHeaders:{'cf-cache-status':'HIT'}});assert.equal((await run(f)).status,503);assert.equal(f.calls.some(x=>x.url.includes('/storage/')),false);});
test('aged authorization data is rejected',async()=>{assert.equal((await run(fixture({rowHeaders:{age:'1'}}))).status,503);});
test('cached user identity is rejected',async()=>{assert.equal((await run(fixture({authHeaders:{'x-vercel-cache':'STALE'}}),{headers:{authorization:'Bearer user'}})).status,503);});
test('path belonging to a different listing is denied',async()=>{assert.equal((await run(fixture({row:row('published',{photo_path:OWNER+'/'+BUYER+'/wrong.png'})}))).status,404);});
test('storage redirects are denied',async()=>{assert.equal((await run(fixture({imageHeaders:{Location:'https://example.invalid/'}}))).status,503);});
test('non-image storage response is denied',async()=>{assert.equal((await run(fixture({type:'text/html'}))).status,503);});
test('image with invalid magic bytes is denied',async()=>{assert.equal((await run(fixture({bytes:Buffer.from('not a png')}))).status,503);});
test('oversized image is denied',async()=>{assert.equal((await run(fixture({imageHeaders:{'Content-Length':'2097153'}}))).status,503);});
test('oversized streaming body is denied without trusting Content-Length',async()=>{assert.equal((await run(fixture({bytes:Buffer.alloc(2097153)}))).status,503);});
for(const url of ['/api/listing-photo?id='+ID+'&id='+ID,'/api/listing-photo?id='+ID+'&url=https://evil.invalid','/api/listing-photo?id=../bad','/api/listing-photo/'+ID+'?x=1']){
 test('malformed route is rejected: '+url,async()=>{const f=fixture();assert.equal((await run(f,{url})).status,404);assert.equal(f.calls.length,0);});
}
test('non-GET and range requests are rejected',async()=>{assert.equal((await run(fixture(),{method:'POST'})).status,405);assert.equal((await run(fixture(),{headers:{range:'bytes=0-1'}})).status,404);});
test('production configuration is denied on preview, wrong branch and wrong project',async()=>{
 for(const changes of [{VERCEL_ENV:'preview'},{VERCEL_GIT_COMMIT_REF:'preview/photo-delivery-boundary'},{SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co'},{SUPABASE_SECRET_KEY:'sb_publishable_wrong'},{SUPABASE_SECRET_KEY:''}]){
  const f=fixture({env:{...env,...changes}});assert.equal(serverConfig({...env,...changes}),null);assert.equal((await run(f)).status,503);assert.equal(f.calls.length,0);
 }
});
test('authorization timeout aborts and returns unavailable',async()=>{
 const handler=createListingPhotoHandler({projectUrl:PROD,publicKey:'sb_publishable_test',readObject:async()=>new Response(PNG),timeoutMs:5,fetchImpl:async()=>new Promise(()=>{})});
 assert.equal((await run({handler},{url:'/api/listing-photo/'+ID})).status,503);
});
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
test('all executable inline scripts parse and direct Storage downloads are removed',()=>{
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(!/type=["']application\/ld\+json/.test(match[1])&&match[2].trim())new vm.Script(match[2]);}
 assert.equal(html.includes(".download(path)"),false);
 assert.equal((html.match(/attachPhoto\((?:item|body|card),d,d.title\)/g)||[]).length,5);
 assert.ok(html.includes('setPhotoSession(data.session);loadAccount(data.session)'));
});
function frontend(){
 const boxes=[];let fetched=[],resolveResponse;
 const el=(tag,text)=>({tag,textContent:text,dataset:{},style:{},setAttribute(){},remove(){this.removed=true},parentNode:null});
 const box={dataset:{},isConnected:true,firstChild:null,nodes:[],append(n){n.parentNode=this;this.nodes.push(n)},prepend(n){n.parentNode=this;this.nodes.unshift(n)},querySelectorAll(){return this.nodes}};boxes.push(box);
 const context={user:{id:OWNER},generation:1,validShopId:()=>true,el,document:{querySelectorAll:()=>boxes},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},AbortSignal,
  fetch:async(url,opts)=>{fetched.push({url,opts});return new Promise(r=>{resolveResponse=r})}};
 vm.createContext(context);vm.runInContext(html.slice(html.indexOf('let photoToken='),html.indexOf('const signedOut',html.indexOf('let photoToken='))),context);
 context.setPhotoSession({user:{id:OWNER},access_token:'owner-session'});
 return {context,box,fetched,respond(){resolveResponse({ok:true,headers:new Headers({'Content-Type':'image/png'}),blob:async()=>new Blob([PNG],{type:'image/png'})})}};
}
test('browser photo request uses same-origin protected route and no-store',async()=>{
 const f=frontend(),p=f.context.attachPhoto(f.box,row(),'test');assert.equal(f.fetched[0].url,'/api/listing-photo?id='+ID);assert.equal(f.fetched[0].opts.cache,'no-store');assert.equal(f.fetched[0].opts.headers.Authorization,'Bearer owner-session');f.respond();await p;assert.equal(f.box.nodes[0].tag,'img');
});
test('sign-out clears displayed photos and prevents late private bytes rendering',async()=>{
 const f=frontend(),p=f.context.attachPhoto(f.box,row(),'test');f.context.user=null;f.context.generation++;f.context.setPhotoSession(null);f.respond();await p;assert.equal(f.box.nodes.some(n=>n.tag==='img'),false);
});
test('gallery takeover prevents a stale photo overwriting the current view',async()=>{
 const f=frontend(),p=f.context.attachPhoto(f.box,row(),'test');f.box.dataset.galleryActive='true';f.respond();await p;assert.equal(f.box.nodes.some(n=>n.tag==='img'),false);
});
