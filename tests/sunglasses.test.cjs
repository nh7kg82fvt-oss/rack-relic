'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),navigation=fs.readFileSync(__dirname+'/../navigation.js','utf8');
function section(source,start,end){const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert(from>=0&&to>from,'Expected application function boundaries: '+start);return source.slice(from,to)}
function setup(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id)};
 const c={URL,URLSearchParams,location:{origin:'https://www.rackrelic.com',pathname:'/',search:''},document:{getElementById:node,dispatchEvent(){}},Event:class{constructor(type){this.type=type}},onlySaved:false,update(){}};
 vm.createContext(c);
 vm.runInContext([
  section(html,'const aliases=','const brands='),section(html,'function canonical(','function catalogFilters('),
  section(html,'function catalogFilters(','function renderActiveFilters('),section(html,'function catalogMatches(','function update('),
  section(html,'function normalizeSearch(','try{searchStorageSnapshot='),section(html,'function draftFields(','function toast('),
  section(navigation,'const $=','const community='),section(navigation,'function parse(path)','function visible(')
 ].join('\n'),c);return c;
}
function options(id){
 const select=new RegExp('<select\\b[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>').exec(html);assert(select,'Expected actual category select: '+id);
 return [...select[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([,attrs,text])=>({value:/\bvalue="([^"]*)"/.exec(attrs)?.[1]??text,label:text.replace(/&amp;/g,'&')}));
}
test('sunglasses navigation filters actual catalog data while preserving Accessories drafts and links',()=>{
 const c=setup(),route=c.parse('/category/sunglasses');assert.equal(route.kind,'catalog');assert.equal(route.title,'Sunglasses');assert.equal(route.filters.q,'sunglasses');assert.equal(route.filters.category,'Accessories');
 c.setFilters(route.filters);const filters=c.catalogFilters();assert.equal(filters.invalid,false);
 const listing=(search,category='Accessories')=>({search,category,price_cents:2500,size:'One size',condition:'Good'});
 assert.equal(c.catalogMatches(listing('tortoiseshell sunglasses'),filters),true);assert.equal(c.catalogMatches(listing('leather wallet'),filters),false);assert.equal(c.catalogMatches(listing('sunglasses print tee','Clothing'),filters),false);
 const cards=[...html.matchAll(/<article class="item"[^>]*data-search="([^"]+)"[^>]*data-demo-description="([^"]+)"[\s\S]*?<strong>([^<]+)<\/strong><small>([^<]+)<\/small>[\s\S]*?<div class="price">\$([^<]+)<\/div>[\s\S]*?<\/article>/g)];
 assert.equal(cards.length,12);const sunglasses=cards.find(card=>/sunglasses/i.test(card[3]));assert(sunglasses,'The dedicated category needs a visible demo result');assert.match(sunglasses[2],/^Fictional/);
 assert.equal(c.catalogMatches({...listing(sunglasses[1],sunglasses[4].split(' · ')[1]),price_cents:Math.round(Number(sunglasses[5])*100)},filters),true);
 const shared=c.parse('/shop?'+new URLSearchParams({q:route.filters.q,category:route.filters.category}));assert.equal(shared.kind,'catalog');assert.deepEqual(JSON.parse(JSON.stringify(shared.filters)),JSON.parse(JSON.stringify(route.filters)));
 const saved=c.searchFromHash(c.searchHash(route.filters));assert.equal(saved.category,'Accessories');assert.equal(saved.q,'sunglasses');
 const legacy=c.draftFields({id:'existing-device-draft',name:'Vintage sunglasses',brand:'Vintage',category:'Accessories',price:'25.00',size:'One size',condition:'Good',description:'Existing saved sunglasses draft.'});assert.equal(legacy.category,'Accessories');
 for(const id of ['category','listing-category']){const choices=options(id),choice=choices.find(option=>option.value===legacy.category);assert(choice,'Existing Accessories drafts must remain selectable');assert.equal(choice.label,'Sunglasses & accessories');assert(!choices.some(option=>option.value==='Sunglasses'),'Do not send a new unsupported stored category')}
 c.setFilters(c.parse('/category/accessories').filters);const allAccessories=c.catalogFilters();assert.equal(c.catalogMatches(listing('leather wallet'),allAccessories),true);assert.equal(c.catalogMatches(listing('tortoiseshell sunglasses'),allAccessories),true);
 const draft=c.parse('/sell/new?category=sunglasses');assert.equal(draft.kind,'draft');assert.equal(draft.sunglasses,true);assert.equal(draft.title,'Create a sunglasses draft');assert.equal(c.parse('/sell/new').sunglasses,false);assert.equal(c.parse('/sell/edit/old-draft?category=sunglasses').sunglasses,undefined);
 const tracking=require('../tracking.js');assert.deepEqual(tracking.route('/category/sunglasses?q=private'),{path:'/category/sunglasses',name:'browse'});assert.equal(tracking.route('/sell/new?category=sunglasses'),null);
});

test('brand filter uses the stored brand, including on existing brand routes',()=>{
 const c=setup(),sunglasses=c.parse('/category/sunglasses');c.setFilters({...sunglasses.filters,brand:'  rAy-BaN  '});
 const item={search:'ray-ban inspired oval sunglasses',category:'Accessories',brand:'Ray-Ban',price_cents:2500,size:'One size',condition:'Good'};
 assert.equal(c.catalogMatches(item,c.catalogFilters()),true);
 assert.equal(c.catalogMatches({...item,brand:'Unbranded'},c.catalogFilters()),false,'A name in the title cannot become its stored brand');
 assert.equal(c.catalogMatches({...item,brand:undefined},c.catalogFilters()),false);
 c.setFilters({...sunglasses.filters,brand:'LV'});
 assert.equal(c.catalogMatches({...item,brand:'Louis Vuitton'},c.catalogFilters()),true);
 const gucci=c.parse('/brand/gucci');assert.equal(gucci.filters.brand,'Gucci');assert.equal(gucci.filters.q,'');
 c.setFilters(gucci.filters);assert.equal(c.catalogMatches({...item,brand:'Gucci',search:'oval sunglasses'},c.catalogFilters()),true);
 assert.equal(c.catalogMatches({...item,brand:'Other',search:'gucci inspired sunglasses'},c.catalogFilters()),false);
});

test('brand survives saved/shared searches while older links remain valid and invalid fields are rejected',()=>{
 const c=setup();assert.equal(c.normalizeSearch({q:'sunglasses',category:'Accessories'}).brand,'');
 const filters=c.normalizeSearch({q:'sunglasses',category:'Accessories',brand:'Ray-Ban',condition:'Good',max:'50'});
 const saved=c.searchFromHash(c.searchHash(filters));assert.deepEqual(JSON.parse(JSON.stringify(saved)),JSON.parse(JSON.stringify(filters)));
 const route=c.parse('/shop?'+new URLSearchParams(filters));assert.equal(route.kind,'catalog');c.setFilters(route.filters);assert.equal(c.currentSearch().brand,'Ray-Ban');
 for(const brand of [12,'x'.repeat(61)])assert.throws(()=>c.normalizeSearch({brand}));
 assert.equal(c.parse('/shop?brand=Gucci&brand=Nike').kind,'missing');
 assert.throws(()=>c.searchFromHash('#search?v=1&brand=Gucci&brand=Nike'));
 const tracking=require('../tracking.js');assert.deepEqual(tracking.route('/shop?brand=private-search'),{path:'/shop',name:'shop'});
});

test('description checklist preserves text, is repeat-safe and respects the draft size limit',()=>{
 const {addChecklist,checklist}=require('../sunglasses-details.js');
 const original='Small scratch on the left lens.\nCase is included.  ';
 const added=addChecklist(original);assert.equal(added.changed,true);assert(added.value.startsWith(original+'\n\n'));assert(added.value.includes('replacement lenses:'));
 assert.equal(addChecklist(added.value).changed,false);assert.equal(addChecklist(added.value).value,added.value);
 const boundary='x'.repeat(2000-checklist.length-2);assert.equal(addChecklist(boundary).value.length,2000);
 const tooLong=boundary+'x';assert.deepEqual(addChecklist(tooLong),{value:tooLong,changed:false,reason:'limit'});
 assert.equal(addChecklist('Sunglasses details:\r\nAlready edited.').reason,'present');
});

test('checklist click changes only the editable description and reports unsaved input',()=>{
 let click,reset,inputEvents=0,focused=0;
 const description={value:'Existing seller notes.',form:{addEventListener(type,handler){assert.equal(type,'reset');reset=handler}},dispatchEvent(e){assert.equal(e.type,'input');assert.equal(e.bubbles,true);inputEvents++},focus(){focused++}},status={textContent:'Adds editable prompts; existing text is kept.'};
 const button={addEventListener(type,handler){assert.equal(type,'click');click=handler}};
 const nodes={'add-sunglasses-checklist':button,'listing-description':description,'sunglasses-checklist-status':status};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../sunglasses-details.js','utf8'),{window:{document:{getElementById:id=>nodes[id]}},Event:class{constructor(type,options){this.type=type;this.bubbles=options.bubbles}}});
 assert.equal(description.value,'Existing seller notes.');click();assert(description.value.startsWith('Existing seller notes.\n\n'));assert.equal(inputEvents,1);assert.equal(focused,1);assert.match(status.textContent,/before saving/);
 const once=description.value;click();assert.equal(description.value,once);assert.equal(inputEvents,1);assert.match(status.textContent,/already contains/);
 reset();assert.equal(status.textContent,'Adds editable prompts; existing text is kept.');assert.equal(inputEvents,1);
});
