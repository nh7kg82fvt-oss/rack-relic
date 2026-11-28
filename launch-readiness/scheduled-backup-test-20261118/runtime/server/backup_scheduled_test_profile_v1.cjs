'use strict';
// Derivative TEST scope only. A recurring provider trigger never renews this slot.
const {copyV5ConstructionData:copy}=require('./backup_runtime_enrollment_v5.cjs');
const fail=()=>{throw Error('SCHEDULED_SINGLE_TEST_PROFILE_HELD');};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function cronForSlot(ms){
 if(!Number.isSafeInteger(ms)||ms<=0||ms%60000!==0)fail();
 const d=new Date(ms);if(!Number.isFinite(d.getTime()))fail();
 return `${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth()+1} *`;
}
function scheduleProfile(value){
 const p=copy(value);
 if(!exact(p,['version','ticketId','cron','scheduledTime','deadline','requestSha256','selectionSha256'])||p.version!=='rr-cf-scheduled-single-test-profile-v1'||!UUID.test(p.ticketId||'')||p.ticketId==='00000000-0000-0000-0000-000000000000'||p.cron!==cronForSlot(p.scheduledTime)||!Number.isSafeInteger(p.deadline)||p.deadline-p.scheduledTime!==5000||[p.requestSha256,p.selectionSha256].some(x=>typeof x!=='string'||!SHA.test(x)||x==='0'.repeat(64)))fail();
 return p;
}
function scheduledController(value,p){
 const c=copy(value);p=scheduleProfile(p);
 if(!exact(c,['cron','scheduledTime'])||c.cron!==p.cron||c.scheduledTime!==p.scheduledTime)fail();
 return c;
}
// Official schedule API permits only these two optional annotation fields.
// They are reviewed, not erased to make a nonempty schedule look absent.
function observedSchedules(role,value,p){
 p=scheduleProfile(p);const e=copy(value);
 if(!exact(e,['schedules'])||!Array.isArray(e.schedules))fail();
 if(role!=='caller'){if(e.schedules.length)fail();return [];}
 if(e.schedules.length!==1)fail();const r=e.schedules[0];
 if(!r||Object.getPrototypeOf(r)!==Object.prototype||!Object.hasOwn(r,'cron')||Object.keys(r).some(k=>!['cron','created_on','modified_on'].includes(k))||r.cron!==p.cron)fail();
 for(const k of ['created_on','modified_on'])if(Object.hasOwn(r,k)&&(typeof r[k]!=='string'||r[k].length>64||!Number.isFinite(Date.parse(r[k]))))fail();
 return [{cron:r.cron}];
}
module.exports=Object.freeze({cronForSlot,scheduleProfile,scheduledController,observedSchedules});
