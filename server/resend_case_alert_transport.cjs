'use strict';
// SOURCE ONLY, OFF by default. No runtime import, route, env lookup or network default.
const {createHash, createHmac, timingSafeEqual} = require('node:crypto');
const {projectAlert} = require('./case_alert_worker.cjs');
const {TEST_ENVIRONMENTS, selectTestEnvironment} = require('./test_environment_registry.cjs');
const T = 'resend_rack_owner_v1', D = 'rack_owner_wayne_v1', OWNER = 'wayne@rackrelic.com';
const DOMAIN = 'alerts.rackrelic.com', DOMAIN_ID = 'f4adcee8-bc22-4597-9aae-6d9cd6780e6a';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/, KEY = /^rr_test_case_alert_([1-9][0-9]{0,15})$/;
const SUBJECT = 'Rack Relic TEST case alert', PREFIX = 'TEST ONLY. Financial hold remains.\n';
const EVENTS = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.suppressed', 'email.complained']);
const digest = x => createHash('sha256').update(x).digest('hex');
const fail = () => {throw Error('RESEND_OWNER_ALERT_UNVERIFIED');};
const senderOK = s => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}@alerts\.rackrelic\.com$/.test(s);
const apiKeyOK = s => typeof s === 'string' && /^re_[A-Za-z0-9_-]{16,256}$/.test(s);
const policyHashFor = sender => digest(JSON.stringify({transportId: T, destinationId: D, sender, recipient: OWNER}));
const bind = i => {
  if (i?.test !== true || i.transportId !== T || i.destinationId !== D || !KEY.test(i.deliveryKey || '') || !SHA.test(i.payloadHash || '')) fail();
  return {test: true, transportId: T, destinationId: D, deliveryKey: i.deliveryKey, payloadHash: i.payloadHash};
};
function projected(i) {
  const m = i.message, id = Number(KEY.exec(i.deliveryKey)[1]);
  if (!Number.isSafeInteger(id) || !m || typeof m !== 'object') fail();
  // Reuse the unchanged worker's strict privacy projection, not invented lease authority.
  const p = projectAlert({alertId: id, deliveryKey: i.deliveryKey,
    leaseToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', leasedUntil: '2026-01-01T00:00:00Z', attempt: 1,
    kind: 'case_changed', severity: m.severity, case: {test: m.test, releaseEnabled: m.releaseEnabled,
      holdRequired: m.holdRequired, caseId: m.caseRef, orderId: m.orderRef, kind: m.caseKind,
      status: m.caseStatus, requiresResponse: m.requiresResponse, providerDueBy: m.providerDueBy,
      dueBy: m.retainedDueBy, deadlineReviewRequired: m.deadlineReviewRequired, evidenceConflict: m.evidenceConflict}}, 0, {historical: true});
  if (JSON.stringify(m) !== JSON.stringify(p.message) || i.payloadHash !== p.payloadHash) fail();
  return p.message;
}
const tagsFor = i => [{name: 'rr_delivery_key', value: i.deliveryKey}, {name: 'rr_payload_sha256', value: i.payloadHash}];
const bodyFor = (sender, i) => ({from: sender, to: [OWNER], subject: SUBJECT,
  text: PREFIX + JSON.stringify(projected(i)), tags: tagsFor(i)});
function journal(r, i, requestHash, policyHash) {
  if (!r || Object.entries(bind(i)).some(([k, v]) => r[k] !== v) || r.releaseEnabled !== false ||
      !SHA.test(r.requestHash || '') || requestHash && r.requestHash !== requestHash || r.policyHash !== policyHash || !UUID.test(r.attemptId || '') ||
      ![null].includes(r.providerEmailId) && !UUID.test(r.providerEmailId || '') || typeof r.sendAllowed !== 'boolean' ||
      typeof r.delivered !== 'boolean' || typeof r.adverseSeen !== 'boolean' ||
      !['unknown', 'accepted', 'delivered', 'issue_hold'].includes(r.state) ||
      r.delivered !== (r.state === 'delivered') || r.adverseSeen !== (r.state === 'issue_hold') ||
      r.state === 'unknown' && r.providerEmailId !== null || r.state !== 'unknown' && !UUID.test(r.providerEmailId || '') ||
      r.sendAllowed && r.state !== 'unknown') fail();
  return r;
}
async function bounded(fn, external, timeoutMs) {
  const c = new AbortController(), abort = () => c.abort(); let timer;
  if (external?.aborted) abort(); else external?.addEventListener('abort', abort, {once: true});
  try {return await Promise.race([Promise.resolve().then(() => {if (c.signal.aborted) fail(); return fn(c.signal);}),
    new Promise((_, reject) => {timer = setTimeout(() => {abort(); reject(Error('RESEND_OWNER_ALERT_UNVERIFIED'));}, timeoutMs);})]);}
  catch {fail();} finally {clearTimeout(timer); abort(); external?.removeEventListener('abort', abort);}
}
async function request(fetchImpl, method, url, key, signal, body, idempotencyKey) {
  const r = await fetchImpl(url, {method, redirect: 'error', cache: 'no-store', signal,
    headers: {Authorization: 'Bearer ' + key, Accept: 'application/json', 'Cache-Control': 'no-store',
      ...(body ? {'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})});
  if (signal.aborted || !(r instanceof Response) || r.status !== 200 || r.url !== url || r.redirected ||
      r.headers.has('location') || !/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type') || '') ||
      r.headers.has('age') && r.headers.get('age') !== '0' || /HIT|STALE|UPDATING/i.test(r.headers.get('cf-cache-status') || '')) fail();
  const length = r.headers.get('content-length'); if (length !== null && (!/^\d+$/.test(length) || Number(length) > 32768)) fail();
  const reader = r.body?.getReader(); if (!reader) fail(); let size = 0; const chunks = [];
  const abort = () => {reader.cancel().catch(() => {});}; signal.addEventListener('abort', abort, {once: true});
  try {for (;;) {const p = await reader.read(); if (signal.aborted) fail(); if (p.done) break; size += p.value.byteLength;
    if (size > 32768) {await reader.cancel(); fail();} chunks.push(Buffer.from(p.value));}}
  finally {signal.removeEventListener('abort', abort); reader.releaseLock();}
  if (length !== null && Number(length) !== size) fail();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createResendCaseAlertTransport({enabled = false, branch, projectUrl, accountId, sender,
  apiKey, readApiKey, repository, verifySetup, fetchImpl, clock = Date.now, timeoutMs = 3000} = {}) {
  const env = selectTestEnvironment({branch, projectUrl, accountId});
  const ready = typeof window === 'undefined' && enabled === true && env === TEST_ENVIRONMENTS.acceptance &&
    senderOK(sender) && apiKeyOK(apiKey) && (readApiKey === undefined || apiKeyOK(readApiKey)) && typeof verifySetup === 'function' &&
    typeof fetchImpl === 'function' && typeof clock === 'function' && Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 10000 &&
    ['claim', 'accept', 'read'].every(k => typeof repository?.[k] === 'function');
  function open() {if (!ready) throw Error('RESEND_OWNER_ALERT_NOT_CONFIGURED'); if (!Number.isSafeInteger(clock())) fail();}
  const policyHash = policyHashFor(sender);
  async function inspect({signal} = {}) {
    open(); return bounded(async inner => {
      const started = clock(), p = await verifySetup({transportId: T, destinationId: D, sender, recipient: OWNER, domain: DOMAIN, domainId: DOMAIN_ID, signal: inner});
      if (inner.aborted || p?.verified !== true || p.transportId !== T || p.destinationId !== D || p.sender !== sender ||
          p.recipient !== OWNER || p.domainId !== DOMAIN_ID || p.domainVerified !== true || p.freePlan !== true ||
          p.paidOverages !== false || p.tracking !== false || p.sendingKeyDomain !== DOMAIN || p.webhookBoundaryVerified !== true ||
          readApiKey !== undefined && p.readAccessApproved !== true ||
          !Number.isSafeInteger(p.checkedAt) || p.checkedAt < started || p.checkedAt > clock() + 1000 ||
          !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= clock() || p.expiresAt > clock() + 30000) fail();
      return {test: true, transportId: T, destinationId: D, idempotentSend: true, readOnlyReconciliation: true, checkedAt: clock()};
    }, signal, timeoutMs);
  }
  async function reconcile(i) {
    open(); bind(i); return bounded(async signal => {
      await inspect({signal}); const saved = journal(await repository.read({...bind(i), policyHash, signal}), i, undefined, policyHash);
      const unknown = () => ({...bind(i), outcome: 'unknown', delivered: false, releaseEnabled: false});
      if (!saved.providerEmailId) return unknown(); // No ID: no invented lookup, POST or mailbox scan.
      if (readApiKey === undefined) {
        // The minimal sending-only deployment reconciles only authenticated,
        // durably stored webhook evidence. It needs no broad provider read key.
        if (!saved.delivered || saved.adverseSeen) return unknown();
        return {...bind(i), outcome: 'delivered', delivered: true,
          providerReference: 'resend_' + saved.providerEmailId, ownerRead: false, releaseEnabled: false};
      }
      const email = await request(fetchImpl, 'GET', 'https://api.resend.com/emails/' + saved.providerEmailId, readApiKey, signal);
      if (email.object !== 'email' || email.id !== saved.providerEmailId || email.from !== sender ||
          !Array.isArray(email.to) || email.to.length !== 1 || email.to[0] !== OWNER || email.subject !== SUBJECT ||
          typeof email.text !== 'string' || !email.text.startsWith(PREFIX) || email.html !== null ||
          !['bcc', 'cc', 'reply_to'].every(k => Array.isArray(email[k]) && email[k].length === 0) || email.scheduled_at !== null ||
          !Array.isArray(email.tags) || email.tags.length !== 2 || !tagsFor(i).every(t => email.tags.filter(x => x.name === t.name && x.value === t.value).length === 1)) fail();
      const canonical = {from: email.from, to: email.to, subject: email.subject, text: email.text, tags: tagsFor(i)};
      if (digest(JSON.stringify(canonical)) !== saved.requestHash || signal.aborted) fail();
      // A signed adverse receipt can arrive during provider lookup. Re-read the
      // durable original before reporting clean delivery; never erase history.
      const current = journal(await repository.read({...bind(i), policyHash, signal}), i, saved.requestHash, policyHash);
      if (signal.aborted || current.attemptId !== saved.attemptId || current.providerEmailId !== saved.providerEmailId) fail();
      if (!current.delivered || current.adverseSeen || email.last_event !== 'delivered') return unknown();
      return {...bind(i), outcome: 'delivered', delivered: true, providerReference: 'resend_' + email.id,
        ownerRead: false, releaseEnabled: false};
    }, i.signal, timeoutMs);
  }
  return Object.freeze({inspect, reconcile, async send(i) {
    open(); bind(i); const body = bodyFor(sender, i), requestHash = digest(JSON.stringify(body));
    return bounded(async signal => {
      await inspect({signal});
      const c = journal(await repository.claim({...bind(i), requestHash, policyHash, signal}), i, requestHash, policyHash);
      if (signal.aborted) fail();
      if (!c.sendAllowed) return reconcile({...bind(i), signal});
      const accepted = await request(fetchImpl, 'POST', 'https://api.resend.com/emails', apiKey, signal, body, 'rr-owner-alert/' + i.deliveryKey);
      if (!UUID.test(accepted?.id || '')) fail();
      const stored = journal(await repository.accept({...bind(i), requestHash, policyHash, attemptId: c.attemptId, providerEmailId: accepted.id, signal}), i, requestHash, policyHash);
      if (signal.aborted || stored.providerEmailId !== accepted.id || stored.attemptId !== c.attemptId || stored.sendAllowed) fail();
      return {...bind(i), outcome: 'accepted', delivered: false, ownerRead: false, releaseEnabled: false};
    }, i.signal, timeoutMs);
  }});
}

// Official Svix raw-body HMAC scheme. No incoming header can bypass verification.
function verifyResendWebhook({rawBody, headers, signingSecret, nowMs}) {
  try {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > 32768 || !Number.isSafeInteger(nowMs) ||
        typeof signingSecret !== 'string' || !signingSecret.startsWith('whsec_')) fail();
    const secret64 = signingSecret.slice(6), secret = Buffer.from(secret64, 'base64');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret64) || secret.length < 16 || secret.length > 64 || secret.toString('base64').replace(/=+$/, '') !== secret64.replace(/=+$/, '')) fail();
    const id = headers?.['svix-id'], ts = headers?.['svix-timestamp'], signatures = headers?.['svix-signature'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof ts !== 'string' || !/^[0-9]{10}$/.test(ts) ||
        Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > 300 || typeof signatures !== 'string' || signatures.length > 2048) fail();
    const expected = createHmac('sha256', secret).update(id + '.' + ts + '.').update(rawBody).digest();
    const parts = signatures.split(' '); if (!parts.length || parts.length > 8) fail();
    let matched = false;
    for (const part of parts) {
      const m = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(part); if (!m) continue;
      const value = Buffer.from(m[1], 'base64');
      if (value.length === expected.length && value.toString('base64') === m[1] && timingSafeEqual(value, expected)) matched = true;
    }
    if (!matched) fail();
    const text = new TextDecoder('utf-8', {fatal: true}).decode(rawBody);
    return {payload: JSON.parse(text), eventId: id, bodyHash: digest(rawBody)};
  } catch {fail();}
}
function createResendOwnerWebhookIntake({enabled = false, branch, projectUrl, accountId, sender, signingSecret, repository, clock = Date.now, timeoutMs = 3000} = {}) {
  const ready = typeof window === 'undefined' && enabled === true &&
    selectTestEnvironment({branch, projectUrl, accountId}) === TEST_ENVIRONMENTS.acceptance && senderOK(sender) &&
    typeof signingSecret === 'string' && typeof repository?.recordReceipt === 'function' &&
    typeof clock === 'function' && Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 10000;
  return Object.freeze({async ingest({rawBody, headers, signal} = {}) {
    if (!ready) throw Error('RESEND_OWNER_WEBHOOK_NOT_CONFIGURED');
    return bounded(async inner => {
      const v = verifyResendWebhook({rawBody, headers, signingSecret, nowMs: clock()}), p = v.payload, d = p?.data;
      if (!EVENTS.has(p?.type) || typeof p.created_at !== 'string' || !Number.isFinite(Date.parse(p.created_at)) ||
          !UUID.test(d?.email_id || '') || d.from !== sender || !Array.isArray(d.to) || d.to.length !== 1 || d.to[0] !== OWNER ||
          d.subject !== SUBJECT || !d.tags || typeof d.tags !== 'object' || Array.isArray(d.tags) ||
          Object.keys(d.tags).sort().join(',') !== 'rr_delivery_key,rr_payload_sha256' ||
          d.broadcast_id != null || d.template_id != null) fail();
      const i = bind({test: true, transportId: T, destinationId: D, deliveryKey: d.tags.rr_delivery_key, payloadHash: d.tags.rr_payload_sha256});
      const policyHash = policyHashFor(sender);
      const r = journal(await repository.recordReceipt({...i, policyHash, providerEmailId: d.email_id, eventId: v.eventId, bodyHash: v.bodyHash,
        eventType: p.type, createdAt: p.created_at, signal: inner}), i, undefined, policyHash);
      if (inner.aborted || r.providerEmailId !== d.email_id) fail();
      return {test: true, persisted: true, eventId: v.eventId, state: r.state, ownerRead: false, releaseEnabled: false};
    }, signal, timeoutMs);
  }});
}
module.exports = {createResendCaseAlertTransport, createResendOwnerWebhookIntake, verifyResendWebhook};
