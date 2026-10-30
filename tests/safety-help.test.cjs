const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guide,listingPath,topics}=require('../safety-help.js');
const id='00000000-0000-4000-8000-000000000001';
test('accepts only canonical Rack Relic listing routes and removes tracking or fragment data',()=>{
  for(const origin of ['https://www.rackrelic.com','https://rackrelic.com','']) assert.equal(listingPath(origin+'/listing/'+id+'?secret=do-not-forward#fragment'),'/listing/'+id);
  for(const url of ['https://evil.example/listing/'+id,'https://rackrelic.com.evil.example/listing/'+id,'https://rackrelic.com@evil.example/listing/'+id,'http://rackrelic.com/listing/'+id,'javascript:alert(1)','/account?token=private','/demo/item-2','https://u:p@rackrelic.com/listing/'+id,'https://rackrelic.com:444/listing/'+id]) assert.equal(listingPath(url),null,url);
});
test('invalid topics and invalid links cannot manufacture links or support drafts',()=>{
  for(const topic of ['__proto__','constructor','<script>',''])assert.throws(()=>guide(topic,''));
  assert.throws(()=>guide('listing','https://evil.example'));
});
test('every topic prepares only an email to Rack Relic and never includes incoming URL secrets',()=>{
  for(const key of Object.keys(topics)){
    const result=guide(key,'https://rackrelic.com/listing/'+id+'?secret=abc#token');
    assert.ok(result.mailto.startsWith('mailto:support@rackrelic.com?subject='));
    assert.ok(!result.body.includes('secret'));assert.ok(!result.body.includes('token'));
    assert.match(result.body,/has not submitted a listing report or an order dispute/);
    assert.ok(result.steps.length>=3);
  }
});
test('listing route opens the existing authenticated report flow; generic help never invents a case',()=>{
  assert.equal(guide('listing','/listing/'+id).link,'/listing/'+id+'/report');
  assert.equal(guide('listing','').link,'/reports');
  assert.match(guide('order','').steps.join(' '),/cannot issue a refund or open an order dispute/);
});
