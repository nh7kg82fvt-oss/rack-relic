/* Explicit measurement only: no form values, account identifiers or raw search text. */
(function (root) {
  'use strict';
  const AD_POLICY = '2026-10-29', VERSION = 1, KEY = 'rack-relic-tracking-choice', TTL = 180 * 86400000;
  const categories = ['Clothing', 'Sneakers', 'Bags', 'Accessories'];
  const pageNames = {'/':'home','/shop':'shop','/brands':'brands','/about':'about','/seller-guide':'seller_guide','/support':'support','/tracking-privacy':'tracking_privacy'};
  const catalogRoutes = /^\/(category\/(clothing|sneakers|bags|accessories)|style\/(vintage|streetwear|y2k|minimalist|sportswear|designer)|brand\/(louis-vuitton|nike|jordan|gucci|adidas|vintage|carhartt|stussy)|price\/(under-25|25-50|50-100|over-100))$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function route(url) {
    try {
      const u = new URL(url, 'https://www.rackrelic.com');
      // Auth callbacks are never measured, even if they land on the home page.
      if (/[?&#](access_token|refresh_token|token|token_hash|code|error|email)=/i.test(u.search + u.hash)) return null;
      if (pageNames[u.pathname]) return {path:u.pathname, name:pageNames[u.pathname]};
      if (catalogRoutes.test(u.pathname)) return {path:u.pathname, name:'browse'};
      return null;
    } catch { return null; }
  }
  function choice(raw, now, gpc) {
    try {
      const c = JSON.parse(raw);
      if (c.v !== VERSION || !Number.isFinite(c.at) || c.at > now || now-c.at > TTL || typeof c.analytics !== 'boolean' || typeof c.advertising !== 'boolean') return null;
      return {v:VERSION, at:c.at, analytics:c.analytics, advertising:!!c.advertising && c.adPolicy === AD_POLICY && !gpc, adPolicy:c.adPolicy === AD_POLICY ? AD_POLICY : null};
    } catch { return null; }
  }
  function safeEvent(name, input = {}) {
    if (['search_used','begin_selling','seller_guide_opened'].includes(name)) return {name, params:{}};
    if (name === 'browse_category' && categories.includes(input.category)) return {name,params:{item_category:input.category}};
    if (name === 'view_item' && input.status === 'published' && input.moderation_status === 'active' && uuid.test(input.id || '') && categories.includes(input.category) && Number.isSafeInteger(input.price_cents) && input.price_cents >= 100 && input.price_cents <= 10000000) {
      return {name,params:{currency:'USD', value:input.price_cents/100, items:[{item_id:input.id,item_category:input.category,price:input.price_cents/100}]}};
    }
    return null; // No purchase, payment, demo, message or arbitrary custom events.
  }
  function attribution(url, campaignNames) {
    const out = {}; let u; try { u = new URL(url); } catch { return out; }
    const allowed = {utm_source:['google','facebook','instagram','bing','newsletter'],utm_medium:['cpc','paid_social','organic_social','email','referral'],utm_campaign:campaignNames};
    for (const [key, values] of Object.entries(allowed)) if (values.includes(u.searchParams.get(key))) out[({utm_source:'campaign_source',utm_medium:'campaign_medium',utm_campaign:'campaign_name'})[key]] = u.searchParams.get(key);
    return out;
  }
  function cleanAdLanding(url, campaignNames, listingId) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !['rackrelic.com','www.rackrelic.com'].includes(u.hostname) || u.port || u.username || u.password || u.hash || !u.search) return null;
      const listing = uuid.test(listingId || '') && u.pathname === '/listing/'+listingId;
      if (!route(u.href) && !listing) return null;
      const labels = {utm_source:['google','facebook','instagram','bing','newsletter'],utm_medium:['cpc','paid_social','organic_social','email','referral'],utm_campaign:campaignNames};
      const seenKeys = new Set();
      for (const [key,value] of u.searchParams) {
        if (seenKeys.has(key)) return null;
        seenKeys.add(key);
        if (Object.prototype.hasOwnProperty.call(labels,key)) {
          if (!labels[key].includes(value)) return null;
        } else if (!['fbclid','gclid','gbraid','wbraid'].includes(key) || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) return null;
      }
      if (!seenKeys.size) return null;
      // Discard click identifiers, never persist them or pass them to SDKs.
      return u.origin+u.pathname;
    } catch { return null; }
  }
  function referrer(value) {
    try { const h=new URL(value).hostname;
      for (const site of ['google.com','bing.com','facebook.com','instagram.com','t.co','pinterest.com'])
        if (h===site || h.endsWith('.'+site)) return 'https://'+site+'/';
    } catch {}
    return '';
  }
  const core = {route, choice, safeEvent, attribution, referrer, cleanAdLanding};
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  const config = root.RackTrackingConfig || {}, production = ['www.rackrelic.com','rackrelic.com'].includes(location.hostname) && location.protocol === 'https:';
  let consent; try { consent = choice(localStorage.getItem(KEY), Date.now(), navigator.globalPrivacyControl === true); } catch { consent = null; }
  let googleLoaded = false, gaConfigured = false, adsConfigured = false, metaLoaded = false, metaGranted = false, leaving = false, lastPage = '', panel, controls, choiceButton;
  const seen = new Set(), diagnostics = []; let verifiedListing = null;
  const campaign = attribution(location.href, config.campaignNames || []), sourceReferrer=referrer(document.referrer);
  root.dataLayer = root.dataLayer || [];
  const gtag = function () { root.dataLayer.push(arguments); };
  const googleId = /^G-[A-Z0-9]+$/.test(config.ga4Id || '') ? config.ga4Id : '';
  const adsId = /^AW-[0-9]+$/.test(config.googleAdsId || '') ? config.googleAdsId : '';
  const pixelId = /^[0-9]{10,20}$/.test(config.metaPixelId || '') ? config.metaPixelId : '';
  const adsAvailable = config.advertisingEnabled === true && ((config.metaEnabled === true && !!pixelId) || (config.googleAdsEnabled === true && !!adsId));
  gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  gtag('set','ads_data_redaction',true);
  gtag('set','url_passthrough',false);
  function publicContext() { if (verifiedListing && location.pathname === '/listing/'+verifiedListing && !location.search && !location.hash) return {path:'/listing',name:'listing'}; return route(location.href); }
  function allowed() { return production && config.enabled === true && consent?.analytics === true && Date.now()-consent.at <= TTL; }
  function note(event) { if (!production) { diagnostics.push(event); if (diagnostics.length > 30) diagnostics.shift(); } }
  function script(src) { const s = document.createElement('script'); s.src=src; s.async=true; s.referrerPolicy='origin'; document.head.append(s); }
  function prepareAdLanding() {
    if (leaving || !production || config.enabled !== true || !adsAvailable ||
        consent?.advertising !== true || consent.adPolicy !== AD_POLICY ||
        Date.now()-consent.at > TTL || navigator.globalPrivacyControl === true) return;
    const clean = cleanAdLanding(location.href,config.campaignNames || [],verifiedListing);
    if (!clean) return;
    try { root.history.replaceState(root.history.state,'',clean); } catch { /* URL remains blocked. */ }
  }
  function adsAllowed() {
    // SDKs can read the document URL themselves. Never load them on a query,
    // fragment, auth callback, preview, or an unverified/private page.
    return !leaving && production && config.enabled === true && adsAvailable &&
      consent?.advertising === true && consent.adPolicy === AD_POLICY &&
      Date.now()-consent.at <= TTL && navigator.globalPrivacyControl !== true &&
      !!publicContext() && !location.search && !location.hash;
  }
  function googleConsent(analytics, ads) {
    gtag('consent','update',{analytics_storage:analytics?'granted':'denied',
      ad_storage:ads?'granted':'denied',ad_user_data:ads?'granted':'denied',ad_personalization:ads?'granted':'denied'});
  }
  function sync() {
    prepareAdLanding();
    const context=publicContext(), on=allowed() && !!context && !leaving;
    const adOn=adsAllowed(), googleAdsOn=adOn && config.googleAdsEnabled === true && !!adsId;
    if (googleId) root['ga-disable-'+googleId]=!on;
    if (googleLoaded || on || googleAdsOn) googleConsent(on,googleAdsOn);
    if ((on && googleId) || googleAdsOn) {
      if (!googleLoaded) { googleLoaded=true;gtag('js',new Date());script('https://www.googletagmanager.com/gtag/js?id='+(on&&googleId?googleId:adsId)); }
      const params={send_page_view:false,page_location:location.origin+context.path,page_referrer:sourceReferrer,page_title:'Rack Relic | '+context.name,...campaign};
      if (on && googleId && !gaConfigured) { gaConfigured=true;gtag('config',googleId,{...params,allow_google_signals:false,allow_ad_personalization_signals:false}); }
      if (googleAdsOn && !adsConfigured) { adsConfigured=true;gtag('config',adsId,{...params,allow_enhanced_conversions:false}); }
    }
    const metaOn=adOn && config.metaEnabled === true && !!pixelId;
    if (metaOn && !metaLoaded) {
      // Fail closed if unrelated pixel code was already installed.
      if (root.fbq) return;
      const fbq=root.fbq=function(){fbq.callMethod?fbq.callMethod.apply(fbq,arguments):fbq.queue.push(arguments)};
      fbq.push=fbq;fbq.loaded=true;fbq.version='2.0';fbq.queue=[];fbq.disablePushState=true;
      root._fbq=fbq;metaLoaded=true;
      fbq('consent','revoke');fbq('set','autoConfig',false,pixelId);fbq('init',pixelId);
      script('https://connect.facebook.net/en_US/fbevents.js');
    }
    if (metaLoaded && metaOn!==metaGranted) { metaGranted=metaOn;root.fbq('consent',metaOn?'grant':'revoke'); }
  }
  function adEvent(name, params={}) {
    if (!adsAllowed()) return;
    // No analytics event is automatically forwarded to advertising.
    if (metaLoaded && metaGranted) {
      if (name==='page_view') root.fbq('trackSingle',pixelId,'PageView');
      if (name==='view_item') root.fbq('trackSingle',pixelId,'ViewContent',{content_ids:[params.items[0].item_id],content_type:'product',content_category:params.items[0].item_category,value:params.value,currency:'USD'});
    }
    if (adsConfigured && config.googleAdsEnabled === true) {
      if (name==='page_view') gtag('event','page_view',{send_to:adsId,page_location:location.origin+publicContext().path,page_referrer:sourceReferrer});
      if (name==='view_item') gtag('event','view_item',{send_to:adsId,value:params.value,currency:'USD',items:params.items.map(i=>({id:i.item_id,google_business_vertical:'retail'})),page_location:location.origin+'/listing',page_referrer:sourceReferrer});
    }
  }
  function beforeNavigate(path, replace=false) {
    if (!metaLoaded && !adsConfigured) return false;
    const target=new URL(path,location.origin);if(target.origin!==location.origin)return false;
    // Destroy advertising SDKs before rendering another page, especially a
    // private workspace or a URL containing user-entered search text.
    leaving=true;sync();
    if(replace)location.replace(target.href);else location.assign(target.href);
    return true;
  }
  function page() {
    sync(); const current=publicContext();
    if (!current) { lastPage=''; return; }
    if (lastPage===current.path) return;
    lastPage=current.path;
    const params={page_location:location.origin+current.path,page_referrer:sourceReferrer,page_title:'Rack Relic | '+current.name,...campaign};
    note({name:'page_view',params});
    adEvent('page_view');
    if (allowed() && gaConfigured) { gtag('set',params); gtag('event','page_view',{...params,send_to:googleId}); }
  }
  function track(name,input) {
    const event=safeEvent(name,input); if (!event) return false;
    if (name==='view_item' && location.pathname==='/listing/'+input.id) { verifiedListing=input.id; sync(); page(); }
    const current=publicContext();
    // Real item views are sent only after the application verifies public availability.
    const itemContext=name==='view_item' && /^\/listing\/[0-9a-f-]+$/i.test(location.pathname) && !location.search && !location.hash;
    if (!current && !itemContext) return false;
    const path=itemContext?'/listing':current.path;
    const key=name==='view_item'?name+':'+input.id:null;
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    note(event);
    // Only verified public listings can establish a listing measurement context.
    adEvent(event.name,event.params);
    if (allowed() && gaConfigured && current) gtag('event',event.name,{...event.params,page_location:location.origin+path,page_referrer:sourceReferrer,page_title:'Rack Relic',send_to:googleId});
    return true;
  }
  function clearCookies(analytics = true, advertising = true) {
    const names=document.cookie.split(';').map(v=>v.trim().split('=')[0]).filter(n=>(analytics && /^(_ga(?:_|$)|_gid$|_gat)/.test(n)) || (advertising && /^(_gcl_|_fbp$|_fbc$)/.test(n)));
    for (const name of names) for (const domain of ['', '; domain='+location.hostname, '; domain=.rackrelic.com']) document.cookie=name+'=; Max-Age=0; path=/; SameSite=Lax'+domain;
  }
  function save(analytics, advertising) {
    const previous=consent;
    consent={v:VERSION,at:Date.now(),analytics:!!analytics,advertising:adsAvailable && !!advertising && navigator.globalPrivacyControl!==true,adPolicy:adsAvailable?AD_POLICY:null};
    try { localStorage.setItem(KEY,JSON.stringify(consent)); } catch { /* Memory-only choice when storage is unavailable. */ }
    if (!consent.analytics || !consent.advertising) clearCookies(!consent.analytics,!consent.advertising);
    lastPage=''; sync(); panel.hidden=true; page();
    choiceButton.focus();
    // Already loaded vendor code cannot be unloaded reliably; restart only on withdrawal.
    if ((googleLoaded && previous?.analytics && !consent.analytics) || ((metaLoaded || adsConfigured) && previous?.advertising && !consent.advertising)) location.reload();
  }
  function mount() {
    const style=document.createElement('style'); style.textContent='.rr-choice{font:inherit;padding:8px 12px;border:1px solid #665372;background:#fff;color:#242027;border-radius:4px;cursor:pointer}.rr-privacy-controls{margin:16px auto;max-width:1320px;padding:0 20px}.rr-consent{position:fixed;z-index:10000;bottom:16px;left:16px;right:16px;max-width:640px;padding:22px;background:#fff;color:#242027;border:1px solid #d5ccd9;border-radius:10px;box-shadow:0 8px 35px #0003;max-height:80vh;overflow:auto;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}.rr-consent[hidden]{display:none}.rr-consent h2{font-size:22px;margin:0 0 8px}.rr-consent p{margin:8px 0}.rr-consent label{display:block;margin:12px 0}.rr-consent input{margin-right:8px}.rr-consent-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.rr-consent button{font:inherit;padding:10px 14px;border:1px solid #665372;background:#fff;color:#242027;border-radius:4px;cursor:pointer}.rr-consent button:focus-visible,.rr-choice:focus-visible{outline:3px solid #79559c;outline-offset:3px}.rr-consent a{color:#563573}.rr-consent small{display:block;color:#5a535f}@media(max-width:480px){.rr-consent{left:8px;right:8px;bottom:8px;padding:16px}.rr-consent-actions button{flex:1 1 100%}}';document.head.append(style);
    controls=document.createElement('div'); controls.className='rr-privacy-controls';
    choiceButton=document.createElement('button'); choiceButton.type='button'; choiceButton.className='rr-choice'; choiceButton.textContent='Privacy & cookie choices'; controls.append(choiceButton);document.body.append(controls);
    panel=document.createElement('section');panel.className='rr-consent';panel.setAttribute('role','region');panel.setAttribute('aria-label','Privacy and cookie choices');
    panel.innerHTML='<h2>Your visit. Your choice.</h2><p>Essential storage keeps sign-in and your drafts working. With your permission, analytics helps us understand how people browse Rack Relic. Advertising measurement and retargeting are not active yet.</p><p>We do not send your messages, account details, private drafts or search text to analytics.</p><label><input type="checkbox" name="rr-analytics">Allow analytics</label><label><input type="checkbox" name="rr-advertising" disabled>Allow advertising <small>Not available yet. We will ask again before activating advertising tools.</small></label><p class="rr-gpc" hidden>Your browser’s Global Privacy Control is on. Advertising remains off.</p><p><a href="/tracking-privacy" data-policy-document>How tracking works</a></p><div class="rr-consent-actions"><button type="button" data-choice="reject">Reject optional</button><button type="button" data-choice="save">Save choices</button><button type="button" data-choice="analytics">Allow analytics</button></div>';
    const advertising=panel.querySelector('[name="rr-advertising"]');
    advertising.disabled=!adsAvailable || navigator.globalPrivacyControl===true;advertising.checked=adsAvailable && !!consent?.advertising;
    if(adsAvailable){panel.querySelector('p').textContent='Essential storage keeps sign-in and your drafts working. Choose optional analytics and advertising separately. Advertising shares public page and available-item views, cookies, browser/device and network information with Meta and, when connected, Google Ads to measure ads and show relevant ads on their services.';panel.querySelector('small').textContent='Optional. You can withdraw this choice at any time.';}
    const analytics=panel.querySelector('[name="rr-analytics"]');analytics.checked=!!consent?.analytics;panel.querySelector('.rr-gpc').hidden=navigator.globalPrivacyControl!==true;
    panel.querySelector('[data-choice="reject"]').onclick=()=>save(false,false);panel.querySelector('[data-choice="save"]').onclick=()=>save(analytics.checked,advertising.checked);panel.querySelector('[data-choice="analytics"]').onclick=()=>save(true,false);
    choiceButton.onclick=()=>{analytics.checked=!!consent?.analytics;advertising.checked=adsAvailable && !!consent?.advertising;panel.hidden=false;analytics.focus()};panel.hidden=!!consent && (!adsAvailable || consent.adPolicy===AD_POLICY);document.body.append(panel);
    page();
  }
    document.addEventListener('submit',e=>{if(e.target.matches('form[role="search"]'))track('search_used')},true);
    document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const href=a.getAttribute('href');if(['/sell','#sell'].includes(href))track('begin_selling');if(href==='/seller-guide')track('seller_guide_opened');if(a.dataset.browseCategory)track('browse_category',{category:a.dataset.browseCategory})},true);
  root.RackTracking=Object.freeze({track,beforeNavigate,publicRoute:route,diagnostics:()=>diagnostics.map(e=>JSON.parse(JSON.stringify(e))),status:()=>({production,enabled:config.enabled===true,analytics:!!consent?.analytics,advertising:adsAllowed(),advertisingAvailable:adsAvailable,googleLoaded,metaLoaded,googleAdsConfigured:adsConfigured})});
  root.addEventListener('rack-route-changed',()=>{verifiedListing=null;page()});
  root.addEventListener('popstate',()=>{if(metaLoaded||adsConfigured){leaving=true;sync();location.reload()}else sync();});
  root.addEventListener('hashchange',()=>{if(metaLoaded||adsConfigured){leaving=true;sync();location.reload()}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||leaving)return;sync();if((metaLoaded||adsConfigured)&&!adsAllowed()){clearCookies(false,true);location.reload()}});
  root.addEventListener('storage',e=>{if(e.key!==KEY)return;const previouslyAllowed=!!consent?.analytics,previousAds=!!consent?.advertising;consent=choice(e.newValue,Date.now(),navigator.globalPrivacyControl===true);lastPage='';sync();clearCookies(!consent?.analytics,!consent?.advertising);if(panel)panel.hidden=!!consent && (!adsAvailable || consent.adPolicy===AD_POLICY);page();if((googleLoaded && previouslyAllowed && !consent?.analytics)||((metaLoaded||adsConfigured)&&previousAds&&!consent?.advertising))location.reload()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(typeof window !== 'undefined' ? window : globalThis);

