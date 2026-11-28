'use strict';
// Public package composition only. All provider ports below reject any I/O.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {build}=require('../server/urgent-alert-package/scripts/build-edge-bundle.cjs');
const edge=path.join(__dirname,'../supabase/functions/stripe-test-events/index.mjs');
test('public canonical receiver is exactly reproducible from pinned scoped package with complete original v9',()=>{
 const bytes=fs.readFileSync(edge,'utf8'),v9=fs.readFileSync(path.join(__dirname,'../server/urgent-alert-package/source/baseline/stripe-test-events-v9.mjs'),'utf8');
 assert.equal(build(),bytes);assert.equal(bytes.includes(v9),true);
 assert.equal(bytes.includes("rr-test-case-wake-edge-v2"),true);
});
test('canonical package defaults OFF and does not read wake credentials or perform provider I/O',async()=>{
 const m=await import(pathToFileURL(edge).href),gets=[];let calls=0;
 const f=require('../server/urgent-alert-package/tests/fictional-fixture.cjs'),x=f.fixture();
 const values={SUPABASE_URL:f.PROJECT,RACK_RELIC_TEST_STRIPE_ACCOUNT:f.PINS.accountId,SUPABASE_SERVICE_ROLE_KEY:x.receiverConfig.serviceKey,RACK_RELIC_TEST_WEBHOOK_SECRET:x.receiverConfig.webhookSecret};
 const handler=m.createUrgentAlertEdgeFromEnv(name=>{gets.push(name);return values[name];},()=>{calls++;throw Error('Unapproved provider I/O');});
 assert.equal((await handler(new Request('https://fictional.invalid/receiver'))).status,405);
 assert.equal(calls,0);
 assert.equal(gets.includes('RACK_RELIC_TEST_CASE_WAKE_ENABLED'),true);
 for(const name of ['RACK_RELIC_TEST_CASE_WAKE_WORKER_ID','RACK_RELIC_TEST_CASE_WAKE_DB_KEY','RACK_RELIC_TEST_CASE_WAKE_RESEND_API_KEY','RACK_RELIC_TEST_CASE_WAKE_SETUP'])assert.equal(gets.includes(name),false);
});

// The ordinary root test glob must include the complete portable regression suite.
require('../server/urgent-alert-package/tests/bundle.test.cjs');
require('../server/urgent-alert-package/tests/enrollment.test.cjs');
require('../server/urgent-alert-package/tests/finite-scope.test.cjs');
require('../server/urgent-alert-package/tests/scoped-claim-sql.test.cjs');
