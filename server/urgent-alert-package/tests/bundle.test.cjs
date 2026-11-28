'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url'), {setImmediate: nextTurn} = require('node:timers/promises');
const {build} = require('../scripts/build-edge-bundle.cjs');
const f = require('./fictional-fixture.cjs');
const bundlePath = path.join(__dirname, '../../../supabase/functions/stripe-test-events/index.mjs');
const load = () => import(pathToFileURL(bundlePath).href);
const rpcNames = state => state.calls.filter(x => x.url.includes('/rest/v1/rpc/')).map(x => x.url.split('/').at(-1));
test('offline bundle is deterministic and embeds complete byte-exact v9 factory/module/imports', () => {
  const a = build(), b = build(), original = fs.readFileSync(path.join(__dirname, '../source/baseline/stripe-test-events-v9.mjs'), 'utf8');
  assert.equal(a, b); assert.equal(fs.readFileSync(bundlePath, 'utf8'), a); assert.equal(a.includes(original), true);
  assert.equal(a.includes('eval('), false); assert.equal(a.includes('new Function('), false);
  assert.equal(a.includes('const Deno = undefined;'), true);
});
test('mock native host registers once; OFF reads no new key/enrollment fields and performs no fetch', async () => {
  const gets = [], registrations = [], x = f.fixture(), values = {SUPABASE_URL: f.PROJECT, RACK_RELIC_TEST_STRIPE_ACCOUNT: f.PINS.accountId,
    SUPABASE_SERVICE_ROLE_KEY: x.receiverConfig.serviceKey, RACK_RELIC_TEST_WEBHOOK_SECRET: x.receiverConfig.webhookSecret};
  const old = globalThis.Deno;
  globalThis.Deno = {env: {get(name) {gets.push(name); return values[name];}}, serve(handler) {registrations.push(handler);}};
  try {await import(pathToFileURL(bundlePath).href + '?native-registration-test');}
  finally {if (old === undefined) delete globalThis.Deno; else globalThis.Deno = old;}
  assert.equal(registrations.length, 1); assert.equal((await registrations[0](new Request('https://synthetic.invalid'))).status, 405);
  assert.equal(gets.includes('RACK_RELIC_TEST_CASE_WAKE_RESEND_API_KEY'), false);
  assert.equal(gets.includes('RACK_RELIC_TEST_CASE_WAKE_DB_KEY'), false); assert.equal(gets.includes('RACK_RELIC_TEST_CASE_WAKE_SETUP'), false);
});
test('OFF/missing/expired/revoked/foreign enrollment preserves signed risk ingestion with zero worker/probe/email calls', async () => {
  const {createUrgentAlertEdgeHost} = await load();
  for (const change of [x => x.options.wakeEnabled = false, x => x.options.resendApiKey = null, x => x.options.databaseKey = 'legacy.jwt',
    x => x.state.enrollment = null, x => x.state.enrollment.expiresAt = x.state.now,
    x => x.state.enrollment.revoked = true, x => x.state.enrollment.accountId = 'acct_foreign', x => x.state.stopped = true]) {
    const x = f.fixture(); change(x); const r = await createUrgentAlertEdgeHost(x.options)(f.request());
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), {received: true});
    assert.deepEqual(rpcNames(x.state), ['rr_test_process_risk_notice']); assert.equal(x.state.calls.length, 1); assert.equal(x.state.held, true);
  }
});
test('configured integration retains raw signature/live/foreign rejection before DB or email activity', async () => {
  const {createUrgentAlertEdgeHost} = await load(), x = f.fixture(), h = createUrgentAlertEdgeHost(x.options);
  for (const change of [e => e.livemode = true, e => e.account = 'acct_foreign', e => e.data.object.livemode = true])
    assert.equal((await h(f.request(change))).status, 400);
  assert.equal((await h(f.request(() => {}, false))).status, 400); assert.deepEqual(x.state.calls, []);
});
test('actual bundled receiver/worker/repositories/transport queue before wake and send one minimal new alert', async () => {
  const {createUrgentAlertEdgeHost} = await load(), x = f.fixture(), h = createUrgentAlertEdgeHost(x.options);
  const r = await h(f.request()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), {received: true});
  assert.equal(x.state.held, true); assert.equal(x.state.queued, true); assert.equal(x.state.emails.length, 1);
  assert.equal(x.state.journal.state, 'accepted'); assert.equal(x.state.journal.delivered, false); assert.equal(x.state.final, 'outcome_unknown');
  const email = x.state.emails[0]; assert.deepEqual(email.to, [f.PINS.recipient]); assert.equal(email.from, f.PINS.sender);
  assert.equal(email.subject, 'Rack Relic TEST case alert'); assert.equal(email.text.includes('PRIVATE'), false);
  assert.equal(email.text.includes('issfr_RackOwnerAlertRehearsal'), false);
  assert.equal((await h(f.request())).status, 200); assert.equal(x.state.emails.length, 1);
  assert.equal(rpcNames(x.state).filter(x => x === 'rr_test_process_risk_notice').length, 2);
});
test('stop/revocation after awaited journal claim prevents lowest-level email POST and never replays risk SQL', async () => {
  const {createUrgentAlertEdgeHost} = await load();
  for (const mode of ['stop', 'revoked', 'expiry']) {
    const x = f.fixture();
    x.state.afterJournalBody = () => {if (mode === 'stop') x.state.stopped = true;
      else if (mode === 'revoked') x.state.enrollment.revoked = true;
      else x.state.now = x.state.enrollment.expiresAt;};
    const h = createUrgentAlertEdgeHost(x.options), r = await h(f.request()); assert.equal(r.status, 503);
    assert.equal(x.state.emails.length, 0); assert.equal(x.state.held, true); assert.equal(x.state.queued, true);
    assert.equal(x.state.journal.state, 'unknown');
    assert.equal(rpcNames(x.state).filter(x => x === 'rr_test_process_risk_notice').length, 1);
    const calls = x.state.calls.length; assert.equal((await h(f.request())).status, 200);
    assert.equal(x.state.calls.length, calls+1); assert.equal(x.state.emails.length, 0);
  }
});
test('lost risk commit ACK leaves queue held; duplicate retries wake without in-handler SQL retry', async () => {
  const {createUrgentAlertEdgeHost} = await load(), x = f.fixture(); let first = true;
  x.state.riskHook = async (url, _init, duplicate) => {if (first) {first = false; throw Error('Synthetic lost commit ACK');} return f.response({duplicate, state: 'held'}, url);};
  const h = createUrgentAlertEdgeHost(x.options); assert.equal((await h(f.request())).status, 503);
  assert.equal(rpcNames(x.state).length, 1); assert.equal(x.state.held, true); assert.equal(x.state.emails.length, 0);
  assert.equal((await h(f.request())).status, 200); assert.equal(x.state.emails.length, 1);
  assert.equal(rpcNames(x.state).filter(x => x === 'rr_test_process_risk_notice').length, 2);
});
test('failed receipt-boundary probes cannot become setup proof or cause a claim/email', async () => {
  const {createUrgentAlertEdgeHost} = await load();
  for (const mode of ['status', 'body', 'cache', 'cors', 'url']) {
    const x = f.fixture(), original = x.options.fetchImpl;
    x.options.fetchImpl = async (url, init) => {
      if (url !== f.RECEIVER || init.method !== 'GET') return original(url, init);
      x.state.calls.push({url, method: init.method});
      const r = new Response(mode === 'body' ? 'not empty' : null, {status: mode === 'status' ? 200 : 405,
        headers: {'Cache-Control': 'no-store', ...(mode === 'cache' ? {Age: '1'} : {}), ...(mode === 'cors' ? {'Access-Control-Allow-Origin': '*'} : {})}});
      Object.defineProperty(r, 'url', {value: mode === 'url' ? 'https://foreign.invalid' : url}); return r;
    };
    const r = await createUrgentAlertEdgeHost(x.options)(f.request());
    assert.equal(r.status, 503); assert.equal(x.state.held, true); assert.equal(x.state.queued, true);
    assert.deepEqual(rpcNames(x.state), ['rr_test_process_risk_notice']); assert.equal(x.state.emails.length, 0);
  }
});
test('clamped original enrollment deadline expires during DB ACK; retained late reply cannot start probes/worker', async () => {
  const {createUrgentAlertEdgeHost} = await load(), x = f.fixture(), entered = Promise.withResolvers(), late = Promise.withResolvers();
  x.state.enrollment.expiresAt = x.state.now + 20;
  x.state.riskHook = async (url) => {entered.resolve(); return late.promise;};
  const p = createUrgentAlertEdgeHost(x.options)(f.request()); await entered.promise;
  const r = await p; assert.equal(r.status, 503); assert.equal(x.state.held, true); assert.equal(x.state.queued, true);
  late.resolve(f.response({duplicate: false, state: 'held'}, f.RISK)); await nextTurn();
  assert.equal(x.state.calls.length, 1); assert.equal(x.state.emails.length, 0);
});
test('all four original nonrisk mapper variants remain direct DB-only behavior with enabled setup', async () => {
  const {createUrgentAlertEdgeHost} = await load();
  for (const [kind, refunds, requests, expected] of [['checkout', false, false, 'rr_test_process_event'], ['checkout', true, false, 'rr_test_process_payment_event'],
    ['refund', true, false, 'rr_test_process_refund'], ['refund', true, true, 'rr_test_process_refund_receipt']]) {
    const x = f.fixture(); x.receiverConfig.refundsEnabled = refunds; x.receiverConfig.refundRequestsEnabled = requests;
    const r = await createUrgentAlertEdgeHost(x.options)(f.request(e => {
      if (kind === 'checkout') {e.type = 'checkout.session.completed'; e.data.object = {id: 'cs_test_synthetic', livemode: false, mode: 'payment', status: 'complete',
        payment_status: 'paid', currency: 'usd', amount_total: 1000, client_reference_id: f.ORDER,
        metadata: {integration: 'rack_relic_test_acceptance_v1', rr_test_environment: 'acceptance-v1', order_id: f.ORDER}, payment_intent: 'pi_synthetic'};}
      else {e.type = 'refund.updated'; e.data.object = {object: 'refund', id: 're_synthetic', payment_intent: 'pi_synthetic', charge: 'ch_synthetic', currency: 'usd',
        amount: 1000, status: 'succeeded', metadata: {}};}
    }));
    assert.equal(r.status, 200); assert.deepEqual(rpcNames(x.state), [expected]); assert.equal(x.state.calls.length, 1);
  }
});
