'use strict';
// PRIVATE proposed host configuration. Structural checks are NOT authentication
// or independent provider attestation. Real owner/installer authority is absent.
const {createHash, randomBytes} = require('node:crypto');
const {validateScope}=require('./urgent_alert_scope.cjs');
const PINS = Object.freeze({version: 'rr-test-case-wake-enrollment-v2', purpose: 'one-finite-test-alert-exercise',
  packageRevision: 'rr-test-case-wake-edge-v2', environment: 'acceptance-v1', livemode: false,
  projectRef: 'tzymapahsfiyhgilsmxl', functionId: 'a7e4ae4d-1bb0-4e77-9e9d-b88c208d8704', functionSlug: 'stripe-test-events',
  receiverBaselineVersion: 9, receiverBaselineSha256: 'ded34e58dc19ba824b69e697e9b92197f747ac38cd470c3250da05da83811981',
  accountId: 'acct_1UXdWBGppSOhWnq8', branch: 'codex/prelaunch-seller-protections',
  ownerEmail: 'wayne@rackrelic.com', sender: 'alerts@alerts.rackrelic.com', recipient: 'wayne@rackrelic.com',
  transportId: 'resend_rack_owner_v1', destinationId: 'rack_owner_wayne_v1', domainId: 'f4adcee8-bc22-4597-9aae-6d9cd6780e6a',
  receiptSlug: 'rack-alert-receipts', receiptRevision: 4,
  receiptSha256: '7a23e5695a0126f88b48f31b564b1172492f7e4b114c3c85f19de15fc7e8fbf3'});
const FACTS = Object.freeze(['rack_team_and_domain_verified', 'transactional_free_and_paid_extras_off', 'tracking_and_receiving_off',
  'sending_key_domain_only', 'exact_receiver_code_and_secrets_verified', 'receipt_rpc_grants_and_denials_verified']);
const EXTRA = ['workerId', 'ownerDecisionReference', 'evidenceReference', 'installerReference', 'checkedAt', 'expiresAt', 'revoked', 'facts','alertScope'];
const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MANUAL_WORKER = 'a11e4700-0000-4000-8000-000000000001';
const RECEIVER = 'https://tzymapahsfiyhgilsmxl.supabase.co/functions/v1/rack-alert-receipts';
const fail = () => {throw Error('TEST_CASE_WAKE_ENROLLMENT_UNAVAILABLE');};
function plain(value, depth = 0) {
  if (depth > 3) fail();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (!value || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) fail();
  const out = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d?.enumerable || !Object.hasOwn(d, 'value')) fail();
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail();
    out[key] = plain(d.value, depth + 1);
  }
  return out;
}
function validateEnrollment(input, {workerId, now, stopped = true} = {}) {
  if (stopped !== false || !Number.isSafeInteger(now) || now <= 0 || !UUID.test(workerId || '') || workerId === MANUAL_WORKER) fail();
  const r = plain(input), keys = [...Object.keys(PINS), ...EXTRA].sort();
  if (!r || Object.keys(r).sort().join(',') !== keys.join(',') || Object.entries(PINS).some(([k, v]) => r[k] !== v) ||
      r.workerId !== workerId || r.revoked !== false || JSON.stringify(r.facts) !== JSON.stringify(FACTS) ||
      !/^owner_decision_[A-Za-z0-9_-]{8,80}$/.test(r.ownerDecisionReference || '') ||
      !/^owner_review_[A-Za-z0-9_-]{8,80}$/.test(r.evidenceReference || '') ||
      !/^rack_installer_[A-Za-z0-9_-]{8,80}$/.test(r.installerReference || '') ||
      !Number.isSafeInteger(r.checkedAt) || r.checkedAt <= 0 || r.checkedAt > now ||
      !Number.isSafeInteger(r.expiresAt) || r.expiresAt <= now || r.expiresAt <= r.checkedAt || r.expiresAt > r.checkedAt + 300000) fail();
  r.alertScope=validateScope(r.alertScope,r.checkedAt);
  const ordered = Object.fromEntries(keys.map(k => [k, r[k]])); Object.freeze(ordered.facts); Object.freeze(ordered);
  return Object.freeze({record: ordered, fingerprint: createHash('sha256').update(JSON.stringify(ordered)).digest('hex'),
    evidenceKind: 'owner_reviewed_enrollment_NOT_independent_provider_attestation'});
}
function createEnrollmentRun({getEnrollment, isStopped, workerId, clock = Date.now, monotonicClock = () => performance.now(),
  externalSignal, maximumMs = 5000} = {}) {
  if (typeof getEnrollment !== 'function' || typeof isStopped !== 'function' || !(externalSignal instanceof AbortSignal) ||
      !Number.isInteger(maximumMs) || maximumMs < 10 || maximumMs > 5000) fail();
  const wall = clock(), mono = monotonicClock();
  if (!Number.isSafeInteger(wall) || wall <= 0 || !Number.isFinite(mono) || mono < 0) fail();
  const enrolled = validateEnrollment(getEnrollment(), {workerId, now: wall, stopped: isStopped()});
  const budget = Math.min(maximumMs, enrolled.record.expiresAt - wall); if (budget < 10) fail();
  const controller = new AbortController(), abort = () => controller.abort();
  let closed = false, lastWall = wall, lastMono = mono;
  if (externalSignal.aborted) abort(); else externalSignal.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(abort, budget);
  function check() {
    const w = clock(), m = monotonicClock();
    if (closed || controller.signal.aborted || !Number.isSafeInteger(w) || !Number.isFinite(m) || w < lastWall || m < lastMono ||
        w - wall >= budget || m - mono >= budget) {abort(); fail();}
    let current;
    try {current = validateEnrollment(getEnrollment(), {workerId, now: w, stopped: isStopped()});}
    catch {abort(); fail();}
    if (current.fingerprint !== enrolled.fingerprint) {abort(); fail();}
    lastWall = w; lastMono = m;
    return current.record;
  }
  async function wait(fn) {
    check(); let onAbort;
    const aborted = new Promise((_, reject) => {onAbort = () => reject(Error('TEST_CASE_WAKE_ENROLLMENT_UNAVAILABLE')); controller.signal.addEventListener('abort', onAbort, {once: true});});
    try {const result = await Promise.race([Promise.resolve().then(() => {check(); return fn(controller.signal);}), aborted]); check(); return result;}
    finally {controller.signal.removeEventListener('abort', onAbort);}
  }
  return Object.freeze({budgetMs: budget, signal: controller.signal, check, wait,
    close() {closed = true; clearTimeout(timer); externalSignal.removeEventListener('abort', abort); abort();}});
}
async function receiptBoundary(fetchImpl, run) {
  const probes = [['GET', RECEIVER, null, null, 405], ['POST', RECEIVER, {}, '{}', 400],
    ['POST', RECEIVER, {'svix-id': 'msg_boundary_' + randomBytes(8).toString('hex'), 'svix-timestamp': String(Math.floor(Date.now()/1000)),
      'svix-signature': 'v1,' + randomBytes(32).toString('base64')}, '{}', 503], ['POST', RECEIVER + '?not_a_receipt=1', {}, '{}', 404]];
  for (const [method, url, headers, data, status] of probes) {
    const r = await run.wait(signal => fetchImpl(url, {method, redirect: 'error', cache: 'no-store', signal,
      headers: {'content-type': 'application/json', ...headers}, ...(data === null ? {} : {body: data})}));
    if (!(r instanceof Response) || r.url !== url || r.redirected || r.status !== status || r.headers.has('location') ||
        r.headers.has('access-control-allow-origin') || !/(?:^|,)\s*no-store(?:,|$)/i.test(r.headers.get('cache-control') || '') ||
        r.headers.has('age') && r.headers.get('age') !== '0' || ['cf-cache-status', 'x-vercel-cache'].some(k => /HIT|STALE|UPDATING/i.test(r.headers.get(k) || ''))) fail();
    const reader = r.body?.getReader();
    if (reader) {try {const p = await run.wait(() => reader.read()); if (!p.done) {void reader.cancel().catch(() => {}); fail();}}
      finally {reader.releaseLock();}}
    run.check();
  }
}
module.exports = {PINS, FACTS, RECEIVER, validateEnrollment, createEnrollmentRun, receiptBoundary};
