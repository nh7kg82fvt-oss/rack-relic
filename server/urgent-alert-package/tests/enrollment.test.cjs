'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const {validateEnrollment, createEnrollmentRun} = require('../source/server/urgent_alert_enrollment.cjs');
const {PINS, NOW, WORKER, enrollment} = require('./fictional-fixture.cjs');
const context = {workerId: WORKER, now: NOW, stopped: false};
test('separate synthetic finite enrollment validates as owner-reviewed input, never provider attestation', () => {
  const r = validateEnrollment(enrollment(), context); assert.equal(r.fingerprint.length, 64);
  assert.equal(r.evidenceKind, 'owner_reviewed_enrollment_NOT_independent_provider_attestation');
  assert.equal(Object.hasOwn(r, 'verified'), false); assert.equal(Object.isFrozen(r.record), true);
});
test('all pinned host/account/mode/revision/sender/receipt identities are exact and foreign values hold', () => {
  for (const key of Object.keys(PINS)) {const r = enrollment(); r[key] = typeof r[key] === 'boolean' ? !r[key] : typeof r[key] === 'number' ? r[key]+1 : r[key]+'wrong';
    assert.throws(() => validateEnrollment(r, context));}
});
test('NULL, old browser review/JWT, unknown fields, missing provenance, revoked, future/expired/long enrollment fail', () => {
  for (const r of [null, 'synthetic.jwt.string', {version: 'rr-owner-alert-action-review-v1'}, {...enrollment(), extra: true},
    {...enrollment(), ownerDecisionReference: ''}, {...enrollment(), evidenceReference: ''}, {...enrollment(), installerReference: ''},
    {...enrollment(), checkedAt: NOW+1}, {...enrollment(), expiresAt: NOW}, {...enrollment(), expiresAt: NOW+300000},
    {...enrollment(), revoked: true}, {...enrollment(), workerId: 'a11e4700-0000-4000-8000-000000000001'}, {...enrollment(), facts: []}])
    assert.throws(() => validateEnrollment(r, context));
  assert.throws(() => validateEnrollment(enrollment(), {...context, stopped: true}));
});
test('record accessors/prototypes are denied without invoking getters', () => {
  let reads = 0; const r = enrollment(); Object.defineProperty(r, 'facts', {enumerable: true, get() {reads++; return [];}});
  assert.throws(() => validateEnrollment(r, context)); assert.equal(reads, 0);
  assert.throws(() => validateEnrollment(Object.assign(Object.create({foreign: true}), enrollment()), context));
  const hidden = enrollment(); hidden.facts.ignoredByJSON = 'unreviewed'; assert.throws(() => validateEnrollment(hidden, context));
});
test('run keeps original expiry, denies masked clock rollback, changed record and stop', () => {
  let now = NOW, mono = 100, record = enrollment(), stopped = false;
  const create = () => createEnrollmentRun({getEnrollment: () => record, isStopped: () => stopped, workerId: WORKER,
    clock: () => now, monotonicClock: () => mono, externalSignal: new AbortController().signal});
  let run = create(); now += 10; mono += 10; run.check(); now -= 5; assert.throws(run.check); run.close();
  now = NOW; mono = 100; run = create(); now += 10; mono += 10; run.check(); mono -= 5; assert.throws(run.check); run.close();
  now = NOW; mono = 100; run = create(); record = {...record, evidenceReference: 'owner_review_replaced01'}; assert.throws(run.check); run.close();
  record = enrollment(); run = create(); stopped = true; assert.throws(run.check); run.close();
});
