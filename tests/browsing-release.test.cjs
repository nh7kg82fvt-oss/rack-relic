'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(require.resolve('../'+p),'utf8');
test('new privacy and community routes have real documents and remain outside SPA interception',()=>{
 const config=JSON.parse(read('vercel.json')),home=read('index.html');
 for(const route of ['privacy','community-guidelines']){
  const entry=config.rewrites.find(r=>r.source==='/'+route);assert.equal(entry.destination,'/policies/'+route+'.html');
  const page=read(entry.destination.slice(1));assert.match(page,/<html lang="en">/);assert.match(page,/Rack Relic LLC/);assert.doesNotMatch(page,/clearchoicepayments|Clear Choice Payments|tracking\.js/i);
  assert.match(home,new RegExp('<a data-policy-document href="/'+route+'">'));
 }
});
test('fictional stock is labelled, described and cannot become a community seller listing',()=>{
 const home=read('index.html');const cards=[...home.matchAll(/<article class="item"[^>]*data-demo-description="([^"]+)"/g)];assert.equal(cards.length,12);for(const c of cards)assert.match(c[1],/^Fictional/);
 assert.match(home,/Demo — not for sale/);assert.doesNotMatch(home,/Chrome Hearts Style Tee/);assert.match(home,/This sample item cannot be purchased or messaged/);assert.match(home,/buy\.disabled=true/);assert.match(home,/Checkout is closed while payments and shipping are completed/);
});
test('seller help matches the six-photo account draft flow and preserves device-only limits',()=>{
 const guide=read('policies/seller-guide.html');assert.match(guide,/up to six photos/);assert.match(guide,/Save private account draft/);assert.match(guide,/Device-only drafts keep one cover photo/);assert.doesNotMatch(guide,/current local draft holds one photo/);
});
