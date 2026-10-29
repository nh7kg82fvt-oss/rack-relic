const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../tracking.js'),'utf8');
const KEY='rack-relic-tracking-choice', ID='G-XDKCMZRPPH';
const stored=(analytics=true)=>JSON.stringify({v:1,at:Date.now(),analytics,advertising:false});
// No provider network or real storage is used in these production-mode checks.
function browser(url='https://www.rackrelic.com/', raw=null, options={}) {
  const listeners={},scripts=[],elements=[],storage=new Map(raw?[[KEY,raw]]:[]);
  function element(tag){const children=new Map();const e={tag,hidden:false,checked:false,append(){},focus(){},setAttribute(){},querySelector(s){if(!children.has(s))children.set(s,element('input'));return children.get(s)}};elements.push(e);return e}
  const document={readyState:'loading',cookie:'',referrer:options.referrer||'',createElement:element,head:{append(e){if(e.tag==='script')scripts.push(e.src)}},body:{append(){}},addEventListener(n,fn){(listeners[n]??=[]).push(fn)}};
  const location=new URL(url);let reloads=0;location.reload=()=>reloads++;
  const window={RackTrackingConfig:{enabled:true,ga4Id:ID,advertisingEnabled:false,metaPixelId:'1424113702672150',campaignNames:['rr_launch_buyers']},addEventListener(n,fn){(listeners[n]??=[]).push(fn)}};
  const context={window,document,location,navigator:{globalPrivacyControl:options.gpc||false},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,Date,Set,console};
  vm.runInNewContext(source,context);listeners.DOMContentLoaded[0]();
  const fire=(name,event={})=>(listeners[name]||[]).forEach(fn=>fn(event));
  const entries=()=>window.dataLayer.map(a=>Array.from(a));
  const events=()=>entries().filter(a=>a[0]==='event');
  const select=name=>elements.find(e=>e.tag==='section').querySelector('[data-choice="'+name+'"]').onclick();
  return {window,document,location,scripts,fire,events,entries,select,reloads:()=>reloads,navigate(path){location.href=new URL(path,location).href;fire('rack-route-changed')}};
}
test('production without consent or with a prior rejection loads no vendor',()=>{for(const raw of [null,stored(false)]){const b=browser(undefined,raw);assert.equal(b.scripts.length,0);assert.equal(b.events().length,0)}});
test('preview remains silent even with analytics and advertising consent',()=>{const b=browser('https://preview.vercel.app/',stored());assert.equal(b.scripts.length,0);assert.equal(b.events().length,0)});
test('production consent loads only the separate GA property, once',()=>{const b=browser(undefined,stored());b.fire('rack-route-changed');assert.deepEqual(b.scripts,['https://www.googletagmanager.com/gtag/js?id='+ID]);assert.equal(b.events().length,1);assert.equal(b.events()[0][2].send_to,ID);assert.equal(JSON.stringify(b.entries()).includes('ad_personalization":"granted'),false)});
test('allowing analytics starts measurement; withdrawing stops and reloads',()=>{const b=browser();b.select('analytics');assert.equal(b.scripts.length,1);b.select('reject');assert.equal(b.window['ga-disable-'+ID],true);assert.equal(b.reloads(),1);const count=b.events().length;b.navigate('/shop');assert.equal(b.events().length,count)});
test('consent withdrawal in another tab disables loaded analytics',()=>{const b=browser(undefined,stored());b.fire('storage',{key:KEY,newValue:stored(false)});assert.equal(b.window['ga-disable-'+ID],true);assert.equal(b.reloads(),1)});
test('private landing and auth callback never load a provider',()=>{for(const p of ['/account','/messages/abc','/sell/new','/?code=PRIVATE'])assert.equal(browser('https://www.rackrelic.com'+p,stored()).scripts.length,0)});
test('private navigation disables an already loaded provider and emits no event',()=>{const b=browser(undefined,stored());const n=b.events().length;b.navigate('/account');assert.equal(b.window['ga-disable-'+ID],true);assert.equal(b.window.RackTracking.track('search_used',{q:'PRIVATE'}),false);assert.equal(b.events().length,n);b.navigate('/shop');assert.equal(b.window['ga-disable-'+ID],false);assert.equal(b.events().length,n+1)});
test('queries, fragments, unknown referrers and raw search never enter measurement queue',()=>{const b=browser('https://www.rackrelic.com/shop?q=PRIVATE&gclid=PRIVATE#PRIVATE',stored(),{referrer:'https://private.example/PRIVATE'});b.window.RackTracking.track('search_used',{q:'PRIVATE'});assert.equal(JSON.stringify(b.entries()).includes('PRIVATE'),false);assert.equal(b.events()[0][2].page_location,'https://www.rackrelic.com/shop')});
test('known referrers retain only a fixed public domain',()=>{const b=browser(undefined,stored(),{referrer:'https://www.google.com/search?q=PRIVATE'});assert.equal(b.events()[0][2].page_referrer,'https://google.com/');assert.equal(JSON.stringify(b.entries()).includes('PRIVATE'),false)});
test('only verified public listing can load measurement on a listing page',()=>{const id='11111111-2222-3333-4444-555555555555';const b=browser('https://www.rackrelic.com/listing/'+id,stored());assert.equal(b.scripts.length,0);b.window.RackTracking.track('view_item',{id,status:'archived',moderation_status:'active',category:'Bags',price_cents:500});assert.equal(b.scripts.length,0);b.window.RackTracking.track('view_item',{id,status:'published',moderation_status:'active',category:'Bags',price_cents:500,title:'PRIVATE',seller_id:'PRIVATE'});assert.equal(b.scripts.length,1);assert.equal(b.events().filter(e=>e[1]==='view_item').length,1);assert.equal(JSON.stringify(b.entries()).includes('PRIVATE'),false);assert.equal(b.events()[0][2].page_location,'https://www.rackrelic.com/listing')});
