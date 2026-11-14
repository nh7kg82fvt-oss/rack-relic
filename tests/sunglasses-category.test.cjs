'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),nav=fs.readFileSync(__dirname+'/../navigation.js','utf8');
const {route,safeEvent}=require('../tracking.js');
function browse(){
 const ctx={URL,URLSearchParams,location:{origin:'https://www.rackrelic.com',pathname:'/',search:''},document:{getElementById(){return {}},querySelector(){return null}}};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function normalizeSearch('),html.indexOf('function currentSearch('))+html.slice(html.indexOf('function catalogMatches('),html.indexOf('function update('))+nav.slice(nav.indexOf('const $='),nav.indexOf('const community='))+nav.slice(nav.indexOf('function parse('),nav.indexOf('function setFilters(')),ctx);return ctx;
}
function draft(){
 // Reuse the existing account-draft client harness; no HTTP, storage or real rows.
 const helper=fs.readFileSync(__dirname+'/account-gallery-flow.test.cjs','utf8').split('\ntest(')[0],ctx={require,__dirname,Buffer,Blob,Uint8Array};vm.createContext(ctx);vm.runInContext(helper+';globalThis.makeDraft=setup;',ctx);return ctx.makeDraft();
}
test('sunglasses deep link produces an exact category search and preserves existing routes',()=>{
 const b=browse(),result=b.parse('/category/sunglasses');assert.equal(result.kind,'catalog');assert.equal(result.title,'Sunglasses');assert.equal(result.filters.category,'Sunglasses');
 for(const category of ['clothing','sneakers','bags','accessories'])assert.equal(b.parse('/category/'+category).kind,'catalog');assert.equal(b.parse('/category/unknown').kind,'missing');
});
test('saved/shared Sunglasses searches round-trip but unknown categories stay rejected',()=>{
 const b=browse(),filters=b.normalizeSearch({category:'Sunglasses',size:'52 mm',min:'10',max:'30'});assert.equal(filters.category,'Sunglasses');assert.equal(filters.min,'10.00');assert.equal(filters.size,'52 mm');
 assert.throws(()=>b.normalizeSearch({category:'Unknown eyewear'}));assert.throws(()=>b.normalizeSearch({category:'Sunglasses',min:'30',max:'10'}));
});
test('Sunglasses filters isolate eyewear while Accessories includes both accessory categories',()=>{
 const b=browse(),s={search:'vintage sunglasses',category:'Sunglasses',size:'52 mm',condition:'Good',price_cents:2500},a={...s,search:'wallet',category:'Accessories'},shoe={...s,category:'Sneakers'};
 const f={q:'',category:'Sunglasses',size:'',condition:'',min:null,max:null,invalid:false};assert.equal(b.catalogMatches(s,f),true);assert.equal(b.catalogMatches(a,f),false);assert.equal(b.catalogMatches(shoe,f),false);
 assert.equal(b.catalogMatches(s,{...f,category:'Accessories'}),true);assert.equal(b.catalogMatches(a,{...f,category:'Accessories'}),true);assert.equal(b.catalogMatches(shoe,{...f,category:'Accessories'}),false);
 assert.equal(b.catalogMatches(s,{...f,q:'vintage',min:2600}),false);assert.equal(b.catalogMatches(s,{...f,condition:'Like new'}),false);
});
test('seller Sunglasses account draft saves and reopens the same category and sizing',async()=>{
 const h=draft();h.node('listing-category').value='Sunglasses';h.node('listing-size').value='52-18-140 mm';h.node('listing-description').value='Small lens scratch shown in photo. Case included.';await h.ctx.window.RackAccountDrafts.save();
 assert.equal(h.rows.size,1);const row=[...h.rows.values()][0];assert.equal(row.category,'Sunglasses');assert.equal(row.size,'52-18-140 mm');assert.equal(row.status,'draft');assert.equal(row.description,'Small lens scratch shown in photo. Case included.');
 await h.ctx.window.RackAccountDrafts.open(row.id);assert.equal(h.node('listing-category').value,'Sunglasses');assert.equal(h.node('listing-size').value,'52-18-140 mm');assert.equal(h.calls.filter(c=>c.op==='insert').length,1);
});
test('existing listing categories remain valid and a forged category makes no account write',async()=>{
 for(const category of ['Clothing','Sneakers','Bags','Accessories']){const h=draft();h.node('listing-category').value=category;await h.ctx.window.RackAccountDrafts.save();assert.equal([...h.rows.values()][0].category,category)}
 const h=draft();h.node('listing-category').value='Unknown eyewear';await h.ctx.window.RackAccountDrafts.save();assert.equal(h.calls.length,0);assert.match(h.node('form-error').textContent,/listed category/);
});
test('seller and buyer category choices and disclosure guidance are available without adding inventory',()=>{
 for(const id of ['category','listing-category'])assert.match(html.match(new RegExp('<select id="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'))[1],/<option>Sunglasses<\/option>/);
 assert.match(html,/data-browse-category="Sunglasses"/);assert.match(html,/lens scratches, frame and hinge condition/);assert.match(html,/Size field for the marked frame size/);
});
test('Sunglasses measurement remains opt-in public-category data with no private fields',()=>{
 assert.deepEqual(route('/category/sunglasses'),{path:'/category/sunglasses',name:'browse'});assert.deepEqual(safeEvent('browse_category',{category:'Sunglasses',email:'PRIVATE'}),{name:'browse_category',params:{item_category:'Sunglasses'}});
 const item={id:'11111111-2222-3333-4444-555555555555',status:'published',moderation_status:'active',category:'Sunglasses',price_cents:2500,email:'PRIVATE',photo_path:'PRIVATE'};const e=safeEvent('view_item',item);assert.equal(e.params.items[0].item_category,'Sunglasses');assert.equal(JSON.stringify(e).includes('PRIVATE'),false);assert.equal(safeEvent('view_item',{...item,status:'draft'}),null);assert.equal(route('/sell/new'),null);
});
