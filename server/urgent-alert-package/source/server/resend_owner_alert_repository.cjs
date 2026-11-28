'use strict';
// UNINSTALLED acceptance-only RPC adapter. No environment or credential reads.
const {TEST_ENVIRONMENTS, selectTestEnvironment} = require('./test_environment_registry.cjs');
const error = () => Error('RESEND_OWNER_JOURNAL_UNVERIFIED');
function createResendOwnerAlertRepository({enabled = false, branch, projectUrl, accountId,
  serviceKey, fetchImpl, timeoutMs = 3000} = {}) {
  const env = selectTestEnvironment({branch, projectUrl, accountId});
  if (typeof window !== 'undefined' || enabled !== true || env !== TEST_ENVIRONMENTS.acceptance ||
      typeof serviceKey !== 'string' || !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serviceKey) ||
      typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000)
    throw Error('RESEND_OWNER_JOURNAL_NOT_CONFIGURED');
  async function rpc(name, args, external) {
    const controller = new AbortController(), abort = () => controller.abort(); let timer;
    if (external?.aborted) controller.abort(); else external?.addEventListener('abort', abort, {once: true});
    try {return await Promise.race([Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw error();
      const url = env.projectUrl + '/rest/v1/rpc/' + name;
      const r = await fetchImpl(url, {method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: {apikey: serviceKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, body: JSON.stringify(args)});
      if (controller.signal.aborted || !(r instanceof Response) || r.status !== 200 || r.redirected ||
          r.url !== url || r.headers.has('location') || !/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type') || '') ||
          r.headers.has('age') && r.headers.get('age') !== '0' || /HIT|STALE|UPDATING/i.test(r.headers.get('cf-cache-status') || '')) throw error();
      const reader = r.body?.getReader(); if (!reader) throw error();
      let size = 0; const chunks = [], cancel = () => {reader.cancel().catch(() => {});};
      controller.signal.addEventListener('abort', cancel, {once: true});
      try {for (;;) {const p = await reader.read(); if (controller.signal.aborted) throw error(); if (p.done) break;
        size += p.value.byteLength; if (size > 8192) {await reader.cancel(); throw error();} chunks.push(Buffer.from(p.value));}}
      finally {controller.signal.removeEventListener('abort', cancel); reader.releaseLock();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }), new Promise((_, reject) => {timer = setTimeout(() => {abort(); reject(error());}, timeoutMs);})]);}
    catch {throw error();} finally {clearTimeout(timer); abort(); external?.removeEventListener('abort', abort);}
  }
  return Object.freeze({
    claim: ({deliveryKey, payloadHash, requestHash, policyHash, signal}) => rpc('rr_test_resend_owner_claim', {p_key: deliveryKey, p_payload: payloadHash, p_request: requestHash, p_policy: policyHash}, signal),
    accept: ({deliveryKey, payloadHash, requestHash, policyHash, attemptId, providerEmailId, signal}) => rpc('rr_test_resend_owner_accept', {p_key: deliveryKey, p_payload: payloadHash, p_request: requestHash, p_policy: policyHash, p_attempt: attemptId, p_email: providerEmailId}, signal),
    read: ({deliveryKey, payloadHash, policyHash, signal}) => rpc('rr_test_resend_owner_read', {p_key: deliveryKey, p_payload: payloadHash, p_policy: policyHash}, signal),
    recordReceipt: ({deliveryKey, payloadHash, policyHash, providerEmailId, eventId, bodyHash, eventType, createdAt, signal}) => rpc('rr_test_resend_owner_receipt', {p_key: deliveryKey, p_payload: payloadHash, p_policy: policyHash, p_email: providerEmailId, p_event: eventId, p_body: bodyHash, p_type: eventType, p_created: createdAt}, signal)
  });
}
module.exports = {createResendOwnerAlertRepository};
