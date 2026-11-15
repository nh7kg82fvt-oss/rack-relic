'use strict';
// PRIVATE SOURCE ONLY. Unmounted and OFF; this is not worker authorization.
const {createCaseAlertWorker} = require('./case_alert_worker.cjs');
const {TEST_ENVIRONMENTS, selectTestEnvironment} = require('./test_environment_registry.cjs');
const RISK = 'rr_test_process_risk_notice';
const RPCS = new Set([RISK, 'rr_test_process_event', 'rr_test_process_payment_event', 'rr_test_process_refund', 'rr_test_process_refund_receipt']);
const TYPES = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'radar.early_fraud_warning.created']);
const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPO = ['claim', 'authority', 'finish', 'receiptContext', 'receiptQueue'];
const TRANSPORT = ['inspect', 'send', 'reconcile'];
const fail = () => {throw Error('IMMEDIATE_CASE_WAKE_UNAVAILABLE');};

function scopeFor({signal, clock, monotonicClock, timeoutMs}) {
  const wall = clock(), mono = monotonicClock(), controller = new AbortController();
  if (!Number.isSafeInteger(wall) || wall <= 0 || !Number.isFinite(mono) || mono < 0) fail();
  let closed = false, timer, lastWall = wall, lastMono = mono;
  const abort = () => controller.abort();
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once: true});
  timer = setTimeout(abort, timeoutMs);
  function check() {
    const w = clock(), m = monotonicClock();
    if (closed || controller.signal.aborted || !Number.isSafeInteger(w) || !Number.isFinite(m) ||
        w < lastWall || m < lastMono || w - wall >= timeoutMs || m - mono >= timeoutMs) {abort(); fail();}
    lastWall = w; lastMono = m;
  }
  async function call(fn, external) {
    check();
    const child = new AbortController(), stop = () => child.abort();
    const signals = [controller.signal, ...(external ? [external] : [])];
    for (const s of signals) {if (s.aborted) stop(); else s.addEventListener('abort', stop, {once: true});}
    let rejectAbort;
    const stopped = new Promise((_, reject) => {rejectAbort = () => reject(Error('IMMEDIATE_CASE_WAKE_UNAVAILABLE')); child.signal.addEventListener('abort', rejectAbort, {once: true});});
    try {
      check(); if (child.signal.aborted) fail();
      const value = await Promise.race([Promise.resolve().then(() => {check(); if (child.signal.aborted) fail(); return fn(child.signal);}), stopped]);
      check(); if (child.signal.aborted) fail();
      return value;
    } finally {
      child.signal.removeEventListener('abort', rejectAbort);
      for (const s of signals) s.removeEventListener('abort', stop);
      child.abort();
    }
  }
  return {check, call, signal: controller.signal, close() {closed = true; clearTimeout(timer); signal.removeEventListener('abort', abort); abort();}};
}

async function heldAcknowledgement(response, url, scope) {
  if (!(response instanceof Response) || response.status !== 200 || response.url !== url || response.redirected ||
      response.headers.has('location') || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
      response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity' ||
      response.headers.has('age') && response.headers.get('age') !== '0' ||
      ['cf-cache-status', 'x-vercel-cache'].some(k => /^(HIT|STALE|UPDATING)$/i.test(response.headers.get(k) || ''))) fail();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) fail();
  const copy = response.clone(), reader = copy.body?.getReader(); if (!reader) fail();
  const chunks = []; let size = 0;
  const cancel = () => {void reader.cancel().catch(() => {});};
  scope.signal.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      const p = await scope.call(() => reader.read());
      if (p.done) break;
      size += p.value.byteLength; if (size > 8192) fail();
      chunks.push(Buffer.from(p.value));
    }
    if (length !== null && Number(length) !== size) fail();
    const ack = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    if (!ack || Object.keys(ack).sort().join(',') !== 'duplicate,state' || typeof ack.duplicate !== 'boolean' || ack.state !== 'held') fail();
    return ack;
  } finally {scope.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock();}
}

function fencedPorts(ports, methods, scope) {
  return Object.fromEntries(methods.map(name => [name, input => scope.call(signal => ports[name]({...input, signal}), input?.signal)]));
}

function createPostCommitRiskWake({enabled = false, branch, projectUrl, accountId, workerId = null,
  repository = null, transport = null, fetchImpl = null, clock = Date.now,
  monotonicClock = () => performance.now(), timeoutMs = 5000, batchLimit = 1} = {}) {
  const env = selectTestEnvironment({branch, projectUrl, accountId});
  const ready = typeof window === 'undefined' && enabled === true && env === TEST_ENVIRONMENTS.acceptance &&
    UUID.test(workerId || '') && typeof fetchImpl === 'function' && typeof clock === 'function' && typeof monotonicClock === 'function' &&
    Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 5000 && Number.isInteger(batchLimit) && batchLimit >= 1 && batchLimit <= 5 &&
    REPO.every(k => typeof repository?.[k] === 'function') && TRANSPORT.every(k => typeof transport?.[k] === 'function');
  // Only the trusted, signature-verifying receiver's internal fixed DB port may use
  // this function. It is deliberately not a route or an authentication exchange.
  return Object.freeze({async forward(url, init) {
    if (!ready || typeof url !== 'string' || !init || init.method !== 'POST' || init.redirect !== 'error' || init.cache !== 'no-store' ||
        !(init.signal instanceof AbortSignal)) fail();
    const prefix = env.projectUrl + '/rest/v1/rpc/';
    if (!url.startsWith(prefix) || !RPCS.has(url.slice(prefix.length))) fail();
    if (url !== prefix + RISK) return fetchImpl(url, init); // Existing nonrisk path; no worker call.
    let payload;
    try {payload = JSON.parse(init.body);} catch {fail();}
    if (!payload || !TYPES.has(payload.p_type) || !/^evt_[A-Za-z0-9]+$/.test(payload.p_event || '') || !/^[0-9a-f]{64}$/.test(payload.p_payload_hash || '')) fail();
    const scope = scopeFor({signal: init.signal, clock, monotonicClock, timeoutMs});
    try {
      const response = await scope.call(() => fetchImpl(url, {...init, signal: scope.signal}));
      const ack = await heldAcknowledgement(response, url, scope);
      scope.check();
      const worker = createCaseAlertWorker({enabled: true, branch, projectUrl, accountId, workerId,
        repository: fencedPorts(repository, REPO, scope), transport: fencedPorts(transport, TRANSPORT, scope),
        transportId: 'resend_rack_owner_v1', destinationId: 'rack_owner_wayne_v1', clock,
        operationTimeoutMs: timeoutMs});
      const result = await scope.call(() => worker.runOnce({workerId, limit: batchLimit}));
      if (result?.test !== true || result.cloudReady !== false || result.releaseEnabled !== false ||
          !Array.isArray(result.outcomes) || result.outcomes.length > batchLimit ||
          result.outcomes.some(x => !Number.isSafeInteger(x?.alertId) || x.alertId <= 0 ||
            !['delivered', 'pending', 'unknown', 'exhausted', 'superseded', 'authority_revoked', 'receipt_confirmation_unknown'].includes(x.state))) fail();
      scope.check();
      // Only the bounded original ACK fields survive closing/aborting the native
      // fetch body. The receiver never sees worker outcomes or a delivery claim.
      return Response.json(ack, {headers: {'Cache-Control': 'private, no-store'}});
    } finally {scope.close();}
  }});
}
module.exports = {createPostCommitRiskWake};
