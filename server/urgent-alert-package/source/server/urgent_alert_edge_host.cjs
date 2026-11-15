'use strict';
const {TEST_ENVIRONMENTS} = require('./test_environment_registry.cjs');
const {createCaseAlertRepository} = require('./case_alert_repository.cjs');
const {createResendOwnerAlertRepository} = require('./resend_owner_alert_repository.cjs');
const {createResendCaseAlertTransport} = require('./resend_case_alert_transport.cjs');
const {createPostCommitRiskWake} = require('./post-commit-risk-wake.cjs');
const {PINS, RECEIVER, createEnrollmentRun, receiptBoundary} = require('./urgent_alert_enrollment.cjs');
const {createScopedAlertRepository}=require('./urgent_alert_scope.cjs');
const E = TEST_ENVIRONMENTS.acceptance, RISK = E.projectUrl + '/rest/v1/rpc/rr_test_process_risk_notice';
const DATABASE = new Set(['rr_test_process_risk_notice', 'rr_test_claim_enrolled_case_alert', 'rr_test_enrolled_case_alert_authority', 'rr_test_finish_case_alert',
  'rr_test_case_alert_receipt_context', 'rr_test_resend_owner_claim', 'rr_test_resend_owner_accept', 'rr_test_resend_owner_read']
  .map(name => E.projectUrl + '/rest/v1/rpc/' + name));
const fail = () => {throw Error('TEST_CASE_WAKE_HOST_UNAVAILABLE');};
function createUrgentAlertHost({receiverFactory, receiverConfig = {}, wakeEnabled = false, readEnrollment = () => null,
  isStopped = () => true, workerId = null, databaseKey = null, resendApiKey = null, fetchImpl = globalThis.fetch,
  clock = Date.now, monotonicClock = () => performance.now()} = {}) {
  if (typeof receiverFactory !== 'function') fail(); // Fixed v9 factory is bound by the generated module.
  const original = receiverFactory({...receiverConfig, fetchImpl});
  const ready = typeof window === 'undefined' && wakeEnabled === true && receiverConfig.projectUrl === E.projectUrl &&
    receiverConfig.accountId === E.accountId && typeof readEnrollment === 'function' && typeof isStopped === 'function' &&
    typeof fetchImpl === 'function' && typeof clock === 'function' && typeof monotonicClock === 'function' &&
    /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(databaseKey || '') && /^re_[A-Za-z0-9_-]{16,256}$/.test(resendApiKey || '');
  if (!ready) return original; // Missing bindings never break the original signed ingestion path.
  return async request => {
    const forward = async (url, init) => {
      if (url !== RISK) return fetchImpl(url, init); // Preserve all original nonrisk paths, untouched.
      let run;
      try {run = createEnrollmentRun({getEnrollment: readEnrollment, isStopped, workerId, clock, monotonicClock, externalSignal: init.signal});}
      catch {return fetchImpl(url, init);} // Before any forwarding: use original risk ingestion, no wake.
      // An unrelated signed event still ingests normally, but cannot wake this exercise.
      let p;try{p=JSON.parse(init.body);}catch{run.close();return fetchImpl(url,init);}
      let enrolled;try{enrolled=run.check();}catch(e){run.close();throw e;}
      const scope=enrolled.alertScope;
      if(p?.p_event!==scope.providerEventId||p.p_case!==scope.caseId||p.p_payload_hash!==scope.providerPayloadHash){run.close();return fetchImpl(url,init);}
      let riskForwarded = false;
      let scoped;
      const guardedFetch = async (target, options) => {
        run.check();
        if (!options || options.redirect !== 'error' || options.cache !== 'no-store' || !(options.signal instanceof AbortSignal) || options.signal.aborted) fail();
        const db = DATABASE.has(target) && options.method === 'POST';
        const email = target === 'https://api.resend.com/emails' && options.method === 'POST';
        const probe = target === RECEIVER && ['GET', 'POST'].includes(options.method) ||
          target === RECEIVER + '?not_a_receipt=1' && options.method === 'POST';
        if (!db && !email && !probe) fail();
        if (target === RISK) {if (riskForwarded) fail(); riskForwarded = true;}
        // The journal is consumed before this final current-row check. A changed
        // generation/finality or expired enrollment holds, without freeing a resend.
        if(email){if(!scoped)fail();await scoped.recheck(run.signal);run.check();}
        // Re-check immediately before EVERY actual DB/provider/probe dispatch,
        // including the email POST after its awaited one-shot journal claim.
        const signal = AbortSignal.any([run.signal, options.signal]);
        return run.wait(() => {run.check(); if (signal.aborted) fail(); return fetchImpl(target, {...options, signal});});
      };
      try {
        const tuple = {branch: E.branch, projectUrl: E.projectUrl, accountId: E.accountId};
        const baseRepository = createCaseAlertRepository({enabled: true, ...tuple, serviceKey: databaseKey, fetchImpl: guardedFetch});
        scoped=createScopedAlertRepository(baseRepository,enrolled,workerId,clock);
        const repository=scoped.repository;
        const journal = createResendOwnerAlertRepository({enabled: true, ...tuple, serviceKey: databaseKey, fetchImpl: guardedFetch});
        const verifySetup = async () => {
          run.check(); await receiptBoundary(guardedFetch, run); const r = run.check(), now = clock();
          // Legacy transport interface: derived ONLY from validated NEW owner-
          // reviewed enrollment plus actual boundary probes, not provider API proof.
          return {verified: true, transportId: PINS.transportId, destinationId: PINS.destinationId,
            sender: PINS.sender, recipient: PINS.recipient, domainId: PINS.domainId,
            domainVerified: true, freePlan: true, paidOverages: false, tracking: false,
            sendingKeyDomain: 'alerts.rackrelic.com', webhookBoundaryVerified: true,
            evidenceKind: 'owner_reviewed_setup_and_receipt_boundary_probes_NOT_provider_attestation',
            checkedAt: now, expiresAt: Math.min(r.expiresAt, now + 20000)};
        };
        const transport = createResendCaseAlertTransport({enabled: true, ...tuple, sender: PINS.sender,
          apiKey: resendApiKey, repository: journal, verifySetup, fetchImpl: guardedFetch, clock});
        const protectedTransport = Object.freeze({...transport, async send(i) {
          run.check();
          scoped.assertSend(i);
          if (i?.message?.caseRef === 'issfr_RackOwnerAlertRehearsal' || i?.message?.orderRef === 'a11e4700-0000-4000-8000-000000000002') fail();
          const result = await transport.send(i); run.check(); return result;
        }});
        const wake = createPostCommitRiskWake({enabled: true, ...tuple, workerId, repository, transport: protectedTransport,
          fetchImpl: guardedFetch, clock, monotonicClock, timeoutMs: run.budgetMs, batchLimit: 1});
        // No catch-and-replay here. Risk SQL may already have committed, even if
        // a wake/response later fails. The preserved receiver requests a retry.
        const response = await wake.forward(url, init); run.check(); return response;
      } finally {run.close();}
    };
    return receiverFactory({...receiverConfig, fetchImpl: forward})(request);
  };
}
function readPrivateEnrollment(raw) {
  if (typeof raw !== 'string' || raw.length > 16384) return null;
  try {return JSON.parse(raw);} catch {return null;}
}
module.exports = {createUrgentAlertHost, readPrivateEnrollment};
