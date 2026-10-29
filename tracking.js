/* Explicit measurement only: no form values, account identifiers or raw search text. */
(function (root) {
  'use strict';
  const VERSION = 1, KEY = 'rack-relic-tracking-choice', TTL = 180 * 86400000;
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
      return {v:VERSION, at:c.at, analytics:c.analytics, advertising:!!c.advertising && !gpc};
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
  function referrer(value) {
    try { const h=new URL(value).hostname;
      for (const site of ['google.com','bing.com','facebook.com','instagram.com','t.co','pinterest.com'])
        if (h===site || h.endsWith('.'+site)) return 'https://'+site+'/';
    } catch {}
    return '';
  }
  const core = {route, choice, safeEvent, attribution, referrer};
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  const config = root.RackTrackingConfig || {}, production = ['www.rackrelic.com','rackrelic.com'].includes(location.hostname) && location.protocol === 'https:';
  let consent; try { consent = choice(localStorage.getItem(KEY), Date.now(), navigator.globalPrivacyControl === true); } catch { consent = null; }
  let googleLoaded = false, lastPage = '', panel, controls, choiceButton;
  const seen = new Set(), diagnostics = []; let verifiedListing = null;
  const campaign = attribution(location.href, config.campaignNames || []), sourceReferrer=referrer(document.referrer);
  root.dataLayer = root.dataLayer || [];
  const gtag = function () { root.dataLayer.push(arguments); };
  const googleId = /^G-[A-Z0-9]+$/.test(config.ga4Id || '') ? config.ga4Id : '';
  gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  gtag('set','ads_data_redaction',true);
  gtag('set','url_passthrough',false);
  function publicContext() { if (verifiedListing && location.pathname === '/listing/'+verifiedListing && !location.search && !location.hash) return {path:'/listing',name:'listing'}; return route(location.href); }
  function allowed() { return production && config.enabled === true && consent?.analytics === true && Date.now()-consent.at <= TTL; }
  function note(event) { if (!production) { diagnostics.push(event); if (diagnostics.length > 30) diagnostics.shift(); } }
  function script(src) { const s = document.createElement('script'); s.src=src; s.async=true; s.referrerPolicy='origin'; document.head.append(s); }
  function sync() {
    const context=publicContext(), on=allowed() && !!context;
    if (googleId) root['ga-disable-'+googleId]=!on;
    // Ad storage remains denied until separate advertising configuration is reviewed.
    if (googleLoaded) gtag('consent','update',{analytics_storage:on?'granted':'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    if (!on) return;
    if (googleId && !googleLoaded) {
      googleLoaded=true;
      gtag('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
      gtag('js',new Date());
      gtag('config',googleId,{send_page_view:false,page_location:location.origin+context.path,page_referrer:sourceReferrer,page_title:'Rack Relic | '+context.name,allow_google_signals:false,allow_ad_personalization_signals:false,...campaign});
      script('https://www.googletagmanager.com/gtag/js?id='+googleId);
    }
  }
  function page() {
    sync(); const current=publicContext();
    if (!current) { lastPage=''; return; }
    if (lastPage===current.path) return;
    lastPage=current.path;
    const params={page_location:location.origin+current.path,page_referrer:sourceReferrer,page_title:'Rack Relic | '+current.name,...campaign};
    note({name:'page_view',params});
    if (allowed() && googleLoaded) { gtag('set',params); gtag('event','page_view',{...params,send_to:googleId}); }
  }
  function track(name,input) {
    const event=safeEvent(name,input); if (!event) return false;
    if (name==='view_item' && location.pathname==='/listing/'+input.id && !location.search && !location.hash) { verifiedListing=input.id; sync(); page(); }
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
    if (allowed() && googleLoaded && current) gtag('event',event.name,{...event.params,page_location:location.origin+path,page_referrer:sourceReferrer,page_title:'Rack Relic',send_to:googleId});
    return true;
  }
  function clearCookies(analytics = true, advertising = true) {
    const names=document.cookie.split(';').map(v=>v.trim().split('=')[0]).filter(n=>(analytics && /^(_ga(?:_|$)|_gid$|_gat)/.test(n)) || (advertising && /^(_gcl_|_fbp$|_fbc$)/.test(n)));
    for (const name of names) for (const domain of ['', '; domain='+location.hostname, '; domain=.rackrelic.com']) document.cookie=name+'=; Max-Age=0; path=/; SameSite=Lax'+domain;
  }
  function save(analytics, advertising) {
    const previous=consent;
    consent={v:VERSION,at:Date.now(),analytics:!!analytics,advertising:!!advertising && navigator.globalPrivacyControl!==true};
    try { localStorage.setItem(KEY,JSON.stringify(consent)); } catch { /* Memory-only choice when storage is unavailable. */ }
    if (!consent.analytics || !consent.advertising) clearCookies(!consent.analytics,!consent.advertising);
    lastPage=''; sync(); panel.hidden=true; page();
    choiceButton.focus();
    // Already loaded vendor code cannot be unloaded reliably; restart only on withdrawal.
    if (googleLoaded && previous?.analytics && !consent.analytics) location.reload();
  }
  function mount() {
    const style=document.createElement('style'); style.textContent='.rr-choice{font:inherit;padding:8px 12px;border:1px solid #665372;background:#fff;color:#242027;border-radius:4px;cursor:pointer}.rr-privacy-controls{margin:16px auto;max-width:1320px;padding:0 20px}.rr-consent{position:fixed;z-index:10000;bottom:16px;left:16px;right:16px;max-width:640px;padding:22px;background:#fff;color:#242027;border:1px solid #d5ccd9;border-radius:10px;box-shadow:0 8px 35px #0003;max-height:80vh;overflow:auto;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}.rr-consent[hidden]{display:none}.rr-consent h2{font-size:22px;margin:0 0 8px}.rr-consent p{margin:8px 0}.rr-consent label{display:block;margin:12px 0}.rr-consent input{margin-right:8px}.rr-consent-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.rr-consent button{font:inherit;padding:10px 14px;border:1px solid #665372;background:#fff;color:#242027;border-radius:4px;cursor:pointer}.rr-consent button:focus-visible,.rr-choice:focus-visible{outline:3px solid #79559c;outline-offset:3px}.rr-consent a{color:#563573}.rr-consent small{display:block;color:#5a535f}@media(max-width:480px){.rr-consent{left:8px;right:8px;bottom:8px;padding:16px}.rr-consent-actions button{flex:1 1 100%}}';document.head.append(style);
    controls=document.createElement('div'); controls.className='rr-privacy-controls';
    choiceButton=document.createElement('button'); choiceButton.type='button'; choiceButton.className='rr-choice'; choiceButton.textContent='Privacy & cookie choices'; controls.append(choiceButton);document.body.append(controls);
    panel=document.createElement('section');panel.className='rr-consent';panel.setAttribute('role','region');panel.setAttribute('aria-label','Privacy and cookie choices');
    panel.innerHTML='<h2>Your visit. Your choice.</h2><p>Essential storage keeps sign-in and your drafts working. With your permission, analytics helps us understand how people browse Rack Relic. Advertising measurement and retargeting are not active yet.</p><p>We do not send your messages, account details, private drafts or search text to analytics.</p><label><input type="checkbox" name="rr-analytics">Allow analytics</label><label><input type="checkbox" name="rr-advertising" disabled>Allow advertising <small>Not available yet. We will ask again before activating advertising tools.</small></label><p class="rr-gpc" hidden>Your browser’s Global Privacy Control is on. Advertising remains off.</p><p><a href="/tracking-privacy" data-policy-document>How tracking works</a></p><div class="rr-consent-actions"><button type="button" data-choice="reject">Reject optional</button><button type="button" data-choice="save">Save choices</button><button type="button" data-choice="analytics">Allow analytics</button></div>';
    const analytics=panel.querySelector('[name="rr-analytics"]');analytics.checked=!!consent?.analytics;panel.querySelector('.rr-gpc').hidden=navigator.globalPrivacyControl!==true;
    panel.querySelector('[data-choice="reject"]').onclick=()=>save(false,false);panel.querySelector('[data-choice="save"]').onclick=()=>save(analytics.checked,false);panel.querySelector('[data-choice="analytics"]').onclick=()=>save(true,false);
    choiceButton.onclick=()=>{analytics.checked=!!consent?.analytics;panel.hidden=false;analytics.focus()};panel.hidden=!!consent;document.body.append(panel);
    page();
  }
    document.addEventListener('submit',e=>{if(e.target.matches('form[role="search"]'))track('search_used')},true);
    document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const href=a.getAttribute('href');if(['/sell','#sell'].includes(href))track('begin_selling');if(href==='/seller-guide')track('seller_guide_opened');if(a.dataset.browseCategory)track('browse_category',{category:a.dataset.browseCategory})},true);
  root.RackTracking=Object.freeze({track,publicRoute:route,diagnostics:()=>diagnostics.map(e=>JSON.parse(JSON.stringify(e))),status:()=>({production,enabled:config.enabled===true,analytics:!!consent?.analytics,advertising:false,googleLoaded})});
  root.addEventListener('rack-route-changed',()=>{verifiedListing=null;page()});
  root.addEventListener('popstate',()=>{sync();});
  root.addEventListener('storage',e=>{if(e.key!==KEY)return;const previouslyAllowed=!!consent?.analytics;consent=choice(e.newValue,Date.now(),navigator.globalPrivacyControl===true);lastPage='';sync();if(!consent?.analytics)clearCookies();if(panel)panel.hidden=!!consent;page();if(googleLoaded && previouslyAllowed && !consent?.analytics)location.reload()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(typeof window !== 'undefined' ? window : globalThis);
