'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectAdminOverview,adminAttention}=require('../test-admin.js');
const NOW=Date.parse('2026-11-03T22:00:00Z'),ENV='acceptance-v1',ORDER='11111111-1111-4111-8111-111111111111';
const stamp=delta=>new Date(NOW+delta).toISOString();
const caseRow=(n,delta,requiresResponse=true)=>({caseRef:'case_'+n.toString(16).padStart(32,'0'),orderRef:ORDER,kind:'dispute',status:requiresResponse?'needs_response':'won',requiresResponse,dueBy:delta===null?null:stamp(delta),observedAt:stamp(0),holdRequired:true});
function overview({cases=[],counts={},hasMoreCases=false,hasMoreOrders=false,sources={}}={}){
 return projectAdminOverview({test:true,live:false,releaseEnabled:false,observedAt:stamp(0),counts:{orders:0,paidOrders:0,heldOrders:0,sellers:0,openCases:cases.filter(c=>c.requiresResponse).length,alertDeliveryGaps:0,...counts},orders:[],cases,hasMoreCases,hasMoreOrders,sources:{stripeObservedAt:stamp(0),sellerObservedAt:stamp(0),shippingObservedAt:stamp(0),...sources}},{environmentId:ENV,now:NOW});
}
const attention=(data,now=NOW)=>adminAttention(data,{environmentId:ENV,now});
test('actual response deadlines rank reached, due within 24 hours, unknown and later cases without flagging a closed case deadline',()=>{
 const cases=[caseRow(1,86400001),caseRow(2,null),caseRow(3,86400000),caseRow(4,1),caseRow(5,0),caseRow(6,-1),caseRow(7,-10000,false)];
 const items=attention(overview({cases})).filter(x=>x.caseRef);
 assert.deepEqual(items.map(x=>x.kind),['deadline_reached','deadline_reached','deadline_soon','deadline_soon','deadline_unknown','response_required']);
 assert.deepEqual(items.map(x=>x.caseRef),[cases[5].caseRef,cases[4].caseRef,cases[3].caseRef,cases[2].caseRef,cases[1].caseRef,cases[0].caseRef]);
 assert.equal(items.find(x=>x.kind==='deadline_unknown').dueBy,null);
 assert.match(items.find(x=>x.kind==='deadline_unknown').message,/no deadline was provided/);
 assert.equal(items.some(x=>x.caseRef===cases[6].caseRef),false);
});
test('the same saved case becomes reached when the trusted refresh clock crosses its real deadline',()=>{
 const data=overview({cases:[caseRow(1,1)]});
 assert.equal(attention(data)[0].kind,'deadline_soon');
 assert.equal(attention(data,NOW+1)[0].kind,'deadline_reached');
 assert.equal(attention(data,NOW+2)[0].kind,'deadline_reached');
});
test('a case with conflicting evidence retains its conflict warning as well as an urgent response deadline',()=>{
 const row={...caseRow(1,-1),status:'conflicting_evidence'};
 const items=attention(overview({cases:[row]})).filter(x=>x.caseRef===row.caseRef);
 assert.deepEqual(items.map(x=>x.kind),['deadline_reached','case_conflict']);
 assert.match(items[1].message,/money stays held/);
});
test('a bounded empty view never claims complete case coverage, delivered alerts or verified providers',()=>{
 const items=attention(overview({hasMoreCases:true,hasMoreOrders:true,counts:{openCases:12,alertDeliveryGaps:4},sources:{stripeObservedAt:stamp(-300001),sellerObservedAt:null,shippingObservedAt:null}}));
 const byKind=kind=>items.filter(x=>x.kind===kind);
 assert.match(byKind('case_coverage')[0].message,/not a complete list/);
 assert.match(byKind('order_coverage')[0].nextStep,/remaining order records/);
 assert.match(byKind('alert_delivery')[0].message,/4 case alerts have no confirmed delivery/);
 assert.equal(byKind('source_missing').length,2);assert.equal(byKind('source_stale').length,1);
 assert.equal(byKind('website_coverage').length,1);assert.equal(byKind('backup_coverage').length,1);
 assert.equal(items.some(x=>x.kind.startsWith('deadline_')),false);
 assert.equal(JSON.stringify(items).includes('all clear'),false);
 assert.ok(items.every(x=>typeof x.nextStep==='string'&&x.nextStep.length>0));
});
test('attention classification revalidates evidence and does not trust an invented healthy label or release authority',()=>{
 const data=overview();
 assert.throws(()=>attention({...data,live:true}));
 assert.throws(()=>attention({...data,releaseEnabled:true}));
 assert.throws(()=>attention({...data,sources:{...data.sources,stripe:{...data.sources.stripe,state:'healthy'}}}));
 assert.throws(()=>adminAttention(data,{environmentId:'legacy',now:NOW}));
 const items=attention(data);assert.equal(items.length,2);
 assert.ok(items.every(x=>['website_coverage','backup_coverage'].includes(x.kind)));
});
