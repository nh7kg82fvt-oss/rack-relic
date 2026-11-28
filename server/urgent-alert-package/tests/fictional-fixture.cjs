'use strict';
// In-memory SYNTHETIC enrollment/keys/ports only. Not real owner consent or setup.
const {projectAlert}=require('../source/server/case_alert_worker.cjs');
const {createHmac,createHash} = require('node:crypto');
const {PINS, FACTS, RECEIVER} = require('../source/server/urgent_alert_enrollment.cjs');
const NOW = Date.UTC(2031, 0, 1), WORKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', LEASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ATTEMPT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EMAIL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', SECRET = 'whsec_synthetic';
const PROJECT = 'https://' + PINS.projectRef + '.supabase.co', RISK = PROJECT + '/rest/v1/rpc/rr_test_process_risk_notice';
function enrollment(now = NOW) {return {...PINS, workerId: WORKER, ownerDecisionReference: 'owner_decision_synthetic01',
  evidenceReference: 'owner_review_synthetic01', installerReference: 'rack_installer_synthetic01',
  checkedAt: now - 1, expiresAt: now + 299999, revoked: false, alertScope:scopeFor(now), facts: [...FACTS]};}
function response(value, url, options) {const r = Response.json(value, options); Object.defineProperty(r, 'url', {value: url}); return r;}
const EVENT_TIME=Math.floor(Date.now()/1000);
function eventFixture(){return {id:'evt_synthetic',created:EVENT_TIME,livemode:false,account:PINS.accountId,type:'charge.dispute.created',
 data:{object:{id:'du_synthetic',object:'dispute',livemode:false,charge:'ch_synthetic',payment_intent:'pi_synthetic',amount:1000,currency:'usd',status:'needs_response',evidence_details:{due_by:EVENT_TIME+3600}}}};}
function request(change=()=>{},signed=true){const e=eventFixture();change(e);const raw=JSON.stringify(e),t=EVENT_TIME,sig=createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
 return new Request('https://synthetic.invalid/receiver',{method:'POST',body:raw,headers:{'stripe-signature':signed?`t=${t},v1=${sig}`:'invalid'}});}
function alertFor(now){return {alertId:1,deliveryKey:'rr_test_case_alert_1',leaseToken:LEASE,leasedUntil:new Date(now+90000).toISOString(),attempt:1,kind:'case_changed',severity:2,
 evidenceHash:'c'.repeat(32),providerEventId:'evt_synthetic',providerPayloadHash:createHash('sha256').update(JSON.stringify(eventFixture())).digest('hex'),
 case:{test:true,releaseEnabled:false,holdRequired:true,caseId:'du_synthetic',orderId:ORDER,kind:'dispute',status:'needs_response',generation:1,
 dueBy:new Date(NOW+3600000).toISOString(),providerDueBy:new Date(NOW+3600000).toISOString(),requiresResponse:true,deadlineReviewRequired:false,evidenceConflict:false,customerName:'PRIVATE_NOT_FOR_EMAIL'}};}
function scopeFor(now){const a=alertFor(now),p=projectAlert(a,now);return {version:'rr-case-alert-scope-v1',alertId:a.alertId,caseId:a.case.caseId,orderId:ORDER,generation:1,
 evidenceHash:a.evidenceHash,providerEventId:a.providerEventId,providerPayloadHash:a.providerPayloadHash,createdAfter:now-1000,payloadHash:p.payloadHash,payloadJson:JSON.stringify(p.message)};}
function fixture() {
  const state = {now: NOW, mono: 100, stopped: false, enrollment: enrollment(), held: false, queued: false,
    leased: false, final: null, journal: null, calls: [], emails: [], afterJournalBody: null, riskHook: null};
  const receiverConfig = {projectUrl: PROJECT, accountId: PINS.accountId, serviceKey: 'sb_secret_syntheticReceiver123', webhookSecret: SECRET,
    refundsEnabled: false, refundRequestsEnabled: false, disputesEnabled: true};
  const alert = () => alertFor(state.now);
  const fetchImpl = async (url, init) => {
    state.calls.push({url, method: init.method});
    if (url.startsWith(RECEIVER)) {
      const status = url.includes('?') ? 404 : init.method === 'GET' ? 405 : new Headers(init.headers).has('svix-id') ? 503 : 400;
      const r = new Response(null, {status, headers: {'Cache-Control': 'private, no-store'}}); Object.defineProperty(r, 'url', {value: url}); return r;
    }
    if (url === 'https://api.resend.com/emails') {
      state.emails.push(JSON.parse(init.body)); return response({id: EMAIL}, url);
    }
    const rpc = url.split('/').at(-1), p = JSON.parse(init.body);
    if (rpc === 'rr_test_process_risk_notice') {
      const duplicate = state.held; state.held = state.queued = true;
      if (state.riskHook) return state.riskHook(url, init, duplicate);
      return response({duplicate, state: 'held'}, url);
    }
    if (rpc === 'rr_test_claim_enrolled_case_alert') {
      if (!state.held || !state.queued) throw Error('Claim before atomic hold/queue');
      const alerts = state.leased ? [] : [alert()]; state.leased = true;
      return response({test: true, cloudReady: false, releaseEnabled: false, alerts}, url);
    }
    if (rpc === 'rr_test_enrolled_case_alert_authority') return response({test: true, allowed: true, releaseEnabled: false}, url);
    if (rpc === 'rr_test_finish_case_alert') {state.final = p.p_outcome; return response({test: true, releaseEnabled: false, state: p.p_outcome === 'delivered' ? 'delivered' : 'unknown'}, url);}
    if (rpc === 'rr_test_resend_owner_claim') {
      if (!state.journal) state.journal = {test: true, transportId: PINS.transportId, destinationId: PINS.destinationId, deliveryKey: p.p_key,
        payloadHash: p.p_payload, requestHash: p.p_request, policyHash: p.p_policy, attemptId: ATTEMPT, providerEmailId: null,
        sendAllowed: true, state: 'unknown', delivered: false, adverseSeen: false, releaseEnabled: false};
      const r = response(state.journal, url);
      if (state.afterJournalBody) {
        const body = r.body, get = body.getReader.bind(body);
        body.getReader = () => {const reader = get(); return {async read() {const part = await reader.read(); state.afterJournalBody(); return part;},
          cancel: (...a) => reader.cancel(...a), releaseLock: () => reader.releaseLock()};};
      }
      return r;
    }
    if (rpc === 'rr_test_resend_owner_accept') {state.journal = {...state.journal, providerEmailId: p.p_email, sendAllowed: false, state: 'accepted'}; return response(state.journal, url);}
    if (rpc === 'rr_test_resend_owner_read') return response(state.journal, url);
    return response({duplicate: false, state: 'observed'}, url); // Original nonrisk RPC only.
  };
  const options = {receiverConfig, wakeEnabled: true, workerId: WORKER, databaseKey: 'sb_secret_syntheticWorker123',
    resendApiKey: 're_syntheticSendingOnly123456', readEnrollment: () => state.enrollment, isStopped: () => state.stopped,
    fetchImpl, clock: () => state.now, monotonicClock: () => state.mono};
  return {state, options, receiverConfig, fetchImpl, alert};
}
module.exports = {PINS, FACTS, RECEIVER, NOW, WORKER, LEASE, ORDER, PROJECT, RISK, enrollment, response, request, fixture};
