'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {checks,siteOrigin,validatePage,scriptPaths,readPublic,run}=require('../scripts/check-browsing-site.cjs');
const home=fs.readFileSync(require.resolve('../index.html'),'utf8');
const manifest=fs.readFileSync(require.resolve('../manifest.webmanifest'),'utf8');
const target=new URL('https://www.rackrelic.com');
function fixtureFetch(overrides={},seen=[]){return async(url,options)=>{
 const path=url.pathname;seen.push({url:String(url),options});
 if(overrides[path])return overrides[path]();
 const body=path==='/'?home:path==='/manifest.webmanifest'?manifest:path.endsWith('.js')?'/* public script */':checks.find(c=>c[0]===path)?.[1];
 return new Response(body,{headers:{'content-type':path.endsWith('.js')?'application/javascript':path.endsWith('webmanifest')?'application/manifest+json':'text/html'}});
};}
test('monitor checks public routes and local scripts without credentials or redirects',async()=>{
 const seen=[],lines=[];assert.equal(await run(target.href,{fetchImpl:fixtureFetch({},seen),log:v=>lines.push(v)}),0);
 assert.equal(seen.length,checks.length+scriptPaths(home,target).length);
 for(const {url,options} of seen){assert.equal(new URL(url).origin,target.origin);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.headers,undefined);assert.equal(options.body,undefined);}
 assert.match(lines.at(-1),/0 failures/);
});
test('missing navigation asset and HTML fallback are failures even when pages load',async()=>{
 for(const response of [()=>new Response('Not found',{status:404}),()=>new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}}),()=>new Response('',{headers:{'content-type':'application/javascript'}})]){
  const lines=[];assert.equal(await run(target.href,{fetchImpl:fixtureFetch({'/navigation.js':response}),log:v=>lines.push(v)}),1);assert.ok(lines.some(v=>v.startsWith('FAIL asset /navigation.js')));
 }
});
test('one broken route is reported independently of the other pages',async()=>{
 const lines=[];assert.equal(await run(target.href,{fetchImpl:fixtureFetch({'/support':()=>new Response('unavailable',{status:503})}),log:v=>lines.push(v)}),1);assert.ok(lines.includes('FAIL /support — HTTP 503'));assert.ok(lines.includes('PASS /manifest.webmanifest'));
});
test('public reads never follow a redirect',async()=>{
 await assert.rejects(readPublic(target,async()=>new Response(null,{status:302,headers:{location:'https://example.org'}})),/HTTP 302/);
});
test('bounded reads reject oversized pages and cancel the stream',async()=>{
 let canceled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){canceled=true;}});
 await assert.rejects(readPublic(target,async()=>new Response(stream)),/size limit/);assert.equal(canceled,true);
});
test('demo count and fictional descriptions are checked beyond generic notice text',()=>{
 validatePage('/',home,'text/html');
 assert.throws(()=>validatePage('/',home.replace('data-demo-description="Fictional','data-demo-description="Actual'),'text/html'),/Fictional demo/);
 assert.throws(()=>validatePage('/',home.replace('<article class="item"','<article class="other"'),'text/html'),/Fictional demo/);
});
test('checkout notice cannot substitute for the disabled-button source guard',()=>{
 assert.throws(()=>validatePage('/',home.replace('buy.disabled=true','buy.disabled=false'),'text/html'),/button guard/);
});
test('manifest must be valid JSON with required installation fields and its own content type',()=>{
 validatePage('/manifest.webmanifest',manifest,'application/manifest+json; charset=utf-8');
 assert.throws(()=>validatePage('/manifest.webmanifest',manifest,'text/html'),/content type/);
 assert.throws(()=>validatePage('/manifest.webmanifest','Payments are not enabled','application/json'));
});
test('script discovery deduplicates and excludes outside libraries',()=>{
 assert.deepEqual(scriptPaths('<script src="/navigation.js"></script><script src="/navigation.js"></script><script src="https://outside.example/a.js"></script>',target),['/navigation.js']);
 assert.throws(()=>scriptPaths('<script src="/navigation.js?token=private"></script>',target),/Unexpected local script/);
 assert.throws(()=>scriptPaths('<script src="/other.js"></script>',target),/Navigation script missing/);
});
test('monitor origin rejects credentials, HTTP and path or query inputs',()=>{
 for(const value of ['http://www.rackrelic.com','https://user:secret@www.rackrelic.com','https://www.rackrelic.com/account','https://www.rackrelic.com/?token=x'])assert.throws(()=>siteOrigin(value));
});
