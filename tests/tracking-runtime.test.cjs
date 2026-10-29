const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../tracking.js'),'utf8');
const KEY='rack-relic-tracking-choice', ID='G-XDKCMZRPPH';
const stored=(analytics=true)=>JSON.stringify({v:1,at:Date.now(),analytics,advertising:false});
// No provider network or real storage is used in these production-mode checks.
function browser(url='https://www.rackrelic.com/', raw=null, options={}) {
  const loadedLocations=[];const listeners={},scripts=[],elements=[],storage=new Map(raw?[[KEY,raw]]:[]);
  function element(tag){const children=new Map();const e={tag,hidden:false,checked:false,append(){},focus(){},setAttribute(){},querySelector(s){if(!children.has(s))children.set(s,element('input'));return children.get(s)}};elements.push(e);return e}
  const document={readyState:'loading',cookie:'',referrer:options.referrer||'',createElement:element,head:{append(e){if(e.tag==='script')scripts.push(e.src); if(e.tag==='script')loadedLocations.push(location.href)}},body:{append(){}},addEventListener(n,fn){(listeners[n]??=[]).push(fn)}};
  const location=new URL(url);let reloads=0;location.reload=()=>reloads++;const navigations=[];location.assign=url=>navigations.push(['assign',url]);location.replace=url=>navigations.push(['replace',url]);
  const cleaned=[];const history={state:{existing:'preserve'},replaceState(state,title,url){if(options.historyThrows)throw Error('blocked');cleaned.push({state,url});location.href=url}};
  const window={history,RackTrackingConfig:{enabled:true,ga4Id:ID,advertisingEnabled:false,metaPixelId:'1424113702672150',campaignNames:['rr_launch_buyers'],...(options.config||{})},addEventListener(n,fn){(listeners[n]??=[]).push(fn)}};
  const context={window,document,location,navigator:{globalPrivacyControl:options.gpc||false},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,Date,Set,console};
  vm.runInNewContext(source,context);listeners.DOMContentLoaded[0]();
  const fire=(name,event={})=>(listeners[name]||[]).forEach(fn=>fn(event));
  const entries=()=>window.dataLayer.map(a=>Array.from(a));
  const events=()=>entries().filter(a=>a[0]==='event');
  const select=name=>elements.find(e=>e.tag==='section').querySelector('[data-choice="'+name+'"]').onclick();
  return {window,document,location,scripts,cleaned,loadedLocations,fire,events,entries,select,navigations,panel:elements.find(e=>e.tag==='section'),meta:()=>window.fbq?.queue.map(a=>Array.from(a))||[],reloads:()=>reloads,navigate(path){location.href=new URL(path,location).href;fire('rack-route-changed')}};
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

const adConsent=(analytics=false)=>JSON.stringify({v:1,at:Date.now(),analytics,advertising:true,adPolicy:'2026-10-29'});
const metaConfig={advertisingEnabled:true,metaEnabled:true};
const adsConfig={advertisingEnabled:true,googleAdsEnabled:true,googleAdsId:'AW-123456789'}; // Synthetic: no network.
test('master off overrides a saved advertising opt-in',()=>{const b=browser(undefined,adConsent(),{config:{metaEnabled:true,googleAdsEnabled:true,googleAdsId:'AW-123456789'}});assert.equal(b.scripts.length,0);assert.equal(b.meta().length,0)});
test('each vendor also requires an explicit enable flag',()=>{const b=browser(undefined,adConsent(),{config:{advertisingEnabled:true}});assert.equal(b.scripts.length,0)});
test('legacy choices preserve analytics and require fresh advertising choice',()=>{const legacy=JSON.stringify({v:1,at:Date.now(),analytics:true,advertising:true});const b=browser(undefined,legacy,{config:metaConfig});assert.equal(b.meta().length,0);assert.equal(b.scripts.length,1);assert.equal(b.panel.hidden,false)});
test('Meta only loads after fresh ad consent; analytics can stay rejected',()=>{const b=browser(undefined,adConsent(),{config:metaConfig});assert.deepEqual(b.scripts,['https://connect.facebook.net/en_US/fbevents.js']);assert.equal(b.events().length,0);assert.equal(b.window.fbq.disablePushState,true);const calls=b.meta();assert.ok(calls.findIndex(a=>a[0]==='set'&&a[1]==='autoConfig'&&a[2]===false)<calls.findIndex(a=>a[0]==='init'));assert.deepEqual(calls.find(a=>a[0]==='init'),['init','1424113702672150']);assert.equal(calls.filter(a=>a[0]==='trackSingle'&&a[2]==='PageView').length,1)});
test('analytics-only button never turns on advertising',()=>{const b=browser(undefined,null,{config:metaConfig});b.select('analytics');assert.equal(b.meta().length,0);assert.equal(b.window.RackTracking.status().advertising,false)});
test('GPC prevents both vendors despite saved ad consent',()=>{const b=browser(undefined,adConsent(),{gpc:true,config:{...metaConfig,...adsConfig}});assert.equal(b.scripts.length,0);assert.equal(b.panel.querySelector('[name="rr-advertising"]').disabled,true)});
test('private, query, hash, callback and preview pages load no ad providers',()=>{for(const url of ['https://preview.vercel.app/','http://www.rackrelic.com/','https://www.rackrelic.com/account','https://www.rackrelic.com/sell','https://www.rackrelic.com/shop?q=PRIVATE','https://www.rackrelic.com/#PRIVATE','https://www.rackrelic.com/?code=PRIVATE'])assert.equal(browser(url,adConsent(),{config:{...metaConfig,...adsConfig}}).scripts.length,0,url)});
test('only verified item data reaches Meta and no fake sales events are forwarded',()=>{const id='11111111-2222-3333-4444-555555555555';const b=browser('https://www.rackrelic.com/listing/'+id,adConsent(),{config:metaConfig});const item={id,status:'published',moderation_status:'active',category:'Bags',price_cents:500,title:'PRIVATE',seller_id:'PRIVATE'};assert.equal(b.meta().length,0);b.window.RackTracking.track('view_item',{...item,status:'archived'});assert.equal(b.meta().length,0);b.window.RackTracking.track('view_item',item);b.window.RackTracking.track('view_item',item);assert.equal(b.meta().filter(a=>a[2]==='ViewContent').length,1);for(const n of ['purchase','begin_checkout','search_used','begin_selling'])b.window.RackTracking.track(n,{q:'PRIVATE'});assert.equal(b.meta().filter(a=>/^track/.test(a[0])).length,2);assert.equal(JSON.stringify(b.meta()).includes('PRIVATE'),false)});
test('private navigation revokes advertising before a full document navigation',()=>{const b=browser(undefined,adConsent(),{config:metaConfig});assert.equal(b.window.RackTracking.beforeNavigate('/account'),true);assert.deepEqual(b.navigations,[['assign','https://www.rackrelic.com/account']]);assert.deepEqual(b.meta().at(-1),['consent','revoke']);const n=b.meta().length;b.window.RackTracking.track('begin_selling');assert.equal(b.meta().length,n)});
test('search URL changes unload advertising before writing search text',()=>{const b=browser(undefined,adConsent(),{config:metaConfig});b.window.RackTracking.beforeNavigate('/shop?q=PRIVATE',true);assert.equal(b.location.pathname,'/');assert.equal(b.navigations[0][0],'replace');assert.equal(JSON.stringify(b.meta()).includes('PRIVATE'),false)});
test('back/forward navigation revokes and reloads to unload advertising',()=>{const b=browser(undefined,adConsent(),{config:metaConfig});b.location.href='https://www.rackrelic.com/account';b.fire('popstate');assert.equal(b.reloads(),1);assert.deepEqual(b.meta().at(-1),['consent','revoke'])});
test('advertising withdrawal revokes and reloads in this tab and across tabs',()=>{for(const elsewhere of [false,true]){const b=browser(undefined,adConsent(),{config:metaConfig});if(elsewhere)b.fire('storage',{key:KEY,newValue:stored(false)});else b.select('reject');assert.equal(b.reloads(),1);assert.deepEqual(b.meta().at(-1),['consent','revoke']);assert.equal(b.window.RackTracking.status().advertising,false)}});
test('Google Ads missing real AW ID fails closed',()=>{const b=browser(undefined,adConsent(),{config:{advertisingEnabled:true,googleAdsEnabled:true,googleAdsId:'553-686-9733'}});assert.equal(b.scripts.length,0)});
test('Google Ads test ID loads independently and uses only its own destination',()=>{const b=browser(undefined,adConsent(),{config:adsConfig});assert.deepEqual(b.scripts,['https://www.googletagmanager.com/gtag/js?id=AW-123456789']);assert.equal(b.events()[0][2].send_to,'AW-123456789');assert.equal(b.entries().some(a=>a[0]==='config'&&a[1]===ID),false)});
test('preview with full future configuration still makes no ad requests',()=>{const b=browser('http://localhost:8769/',adConsent(true),{config:{...metaConfig,...adsConfig}});assert.equal(b.scripts.length,0);assert.equal(b.meta().length,0);assert.equal(b.events().length,0)});


test('ad landing tags are removed before either SDK loads, with campaign labels retained only for analytics',()=>{
 for(const config of [metaConfig,adsConfig]){
  const b=browser('https://www.rackrelic.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=rr_launch_buyers&fbclid=TEST_CLICK_ID',adConsent(true),{config});
  assert.equal(b.location.search,'');assert.ok(b.loadedLocations.every(url=>!new URL(url).search));assert.equal(b.cleaned.length,1);assert.equal(b.cleaned[0].state.existing,'preserve');
  assert.equal(b.window.RackTracking.status().advertising,true);
  assert.equal(JSON.stringify([b.entries(),b.meta()]).includes('TEST_CLICK_ID'),false);
  assert.equal(b.events().find(e=>e[2].send_to===ID)[2].campaign_name,'rr_launch_buyers');
 }
});
test('off, rejected, expired, legacy and GPC states never clean ad URLs or load advertising',()=>{
 const url='https://www.rackrelic.com/?fbclid=TEST';
 for(const [raw,options] of [[adConsent(),{}],[stored(),{config:metaConfig}],[null,{config:metaConfig}],[JSON.stringify({v:1,at:1,analytics:false,advertising:true,adPolicy:'2026-10-29'}),{config:metaConfig}],[JSON.stringify({v:1,at:Date.now(),analytics:false,advertising:true}),{config:metaConfig}],[adConsent(),{config:metaConfig,gpc:true}]]){
  const b=browser(url,raw,options);assert.equal(b.location.href,url);assert.equal(b.cleaned.length,0);assert.equal(b.meta().length,0);
 }
});
test('unknown, duplicate, private and auth URL data remain untouched and block ads',()=>{
 for(const path of ['/?email=private&fbclid=TEST','/?code=secret&gclid=TEST','/?q=private&fbclid=TEST','/?utm_campaign=private','/?utm_source=facebook&utm_source=google','/?fbclid=TEST#private','/account?fbclid=TEST','/sell?gclid=TEST']){
  const url='https://www.rackrelic.com'+path,b=browser(url,adConsent(),{config:metaConfig});assert.equal(b.location.href,url);assert.equal(b.scripts.length,0);assert.equal(b.cleaned.length,0);
 }
});
test('failed history cleanup keeps advertising blocked',()=>{
 const b=browser('https://www.rackrelic.com/?gclid=TEST',adConsent(),{config:metaConfig,historyThrows:true});assert.equal(b.scripts.length,0);assert.equal(b.location.search,'?gclid=TEST');
});
test('tagged listing waits for verified available inventory before cleanup or tracking',()=>{
 const id='11111111-2222-3333-4444-555555555555';const b=browser('https://www.rackrelic.com/listing/'+id+'?fbclid=TEST',adConsent(),{config:metaConfig});
 const item={id,status:'archived',moderation_status:'active',category:'Bags',price_cents:500};
 b.window.RackTracking.track('view_item',item);assert.equal(b.cleaned.length,0);assert.equal(b.scripts.length,0);
 b.window.RackTracking.track('view_item',{...item,status:'published'});assert.equal(b.location.search,'');assert.equal(b.meta().filter(a=>a[2]==='ViewContent').length,1);
});

test('new advertising choice on tagged seller guide cleans URL and records one PageView',()=>{
 const b=browser('https://www.rackrelic.com/seller-guide?fbclid=TEST',null,{config:metaConfig});assert.equal(b.cleaned.length,0);
 b.panel.querySelector('[name="rr-advertising"]').checked=true;b.select('save');
 assert.equal(b.location.pathname,'/seller-guide');assert.equal(b.location.search,'');assert.equal(b.meta().filter(a=>a[2]==='PageView').length,1);
});
