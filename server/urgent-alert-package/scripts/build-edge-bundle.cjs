'use strict';
// OFFLINE ONLY: no dependency installation, environment access or code evaluation.
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const root = path.join(__dirname, '..');
const hash = b => createHash('sha256').update(b).digest('hex');
const ORDER = ['test_environment_registry.cjs', 'case_alert_worker.cjs', 'case_alert_repository.cjs', 'resend_owner_alert_repository.cjs',
  'resend_case_alert_transport.cjs', 'post-commit-risk-wake.cjs', 'urgent_alert_scope.cjs', 'urgent_alert_enrollment.cjs', 'urgent_alert_edge_host.cjs'];
function build() {
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'source-inputs.json'), 'utf8'));
  for (const p of pins.files) {const b = fs.readFileSync(path.join(root, p.path)); if (b.length !== p.bytes || hash(b) !== p.sha256) throw Error('Pinned source mismatch: ' + p.path);}
  const baseline = fs.readFileSync(path.join(root, 'source/baseline/stripe-test-events-v9.mjs'));
  if (baseline.length !== 15500 || hash(baseline) !== 'ded34e58dc19ba824b69e697e9b92197f747ac38cd470c3250da05da83811981') throw Error('Actual v9 baseline mismatch');
  let out = '// PRIVATE SOURCE-ONLY proposed bundle. Runtime is OFF unless separately authorized/bound.\n' +
    'import * as __rrCrypto from "node:crypto";\n' +
    '// Lexical suppression preserves the complete exact v9 module, while disabling its legacy registration.\n' +
    'const Deno = undefined;\n\n' + baseline.toString('utf8') + '\n\n' +
    'const __rrModules = Object.create(null);\n' +
    'const __rrRequire = name => { if(name === "node:crypto") return __rrCrypto; if(Object.hasOwn(__rrModules,name)) return __rrModules[name]; throw Error("Unapproved bundled import"); };\n';
  for (const name of ORDER) {
    const source = fs.readFileSync(path.join(root, 'source/server', name), 'utf8');
    out += '\n__rrModules[' + JSON.stringify('./' + name) + '] = (function(require){\nconst module = {exports:{}};\n' + source + '\nreturn module.exports;\n})(__rrRequire);\n';
  }
  out += `
export const URGENT_ALERT_PACKAGE_REVISION = 'rr-test-case-wake-edge-v2';
export function createUrgentAlertEdgeHost(options = {}) {
  return __rrModules['./urgent_alert_edge_host.cjs'].createUrgentAlertHost({...options, receiverFactory:createTestEdgeWebhook});
}
export function createUrgentAlertEdgeFromEnv(get, fetchImpl = globalThis.fetch) {
  const receiverConfig = {projectUrl:get('SUPABASE_URL'), accountId:get('RACK_RELIC_TEST_STRIPE_ACCOUNT'),
    serviceKey:get('SUPABASE_SERVICE_ROLE_KEY'), webhookSecret:get('RACK_RELIC_TEST_WEBHOOK_SECRET'),
    refundsEnabled:get('RACK_RELIC_TEST_REFUNDS_ENABLED')==='true',
    refundRequestsEnabled:get('RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED')==='true',
    disputesEnabled:get('RACK_RELIC_TEST_DISPUTE_HOLDS_ENABLED')==='true'};
  const wakeEnabled = get('RACK_RELIC_TEST_CASE_WAKE_ENABLED') === 'true';
  if (!wakeEnabled) return createUrgentAlertEdgeHost({receiverConfig, fetchImpl});
  return createUrgentAlertEdgeHost({receiverConfig, fetchImpl, wakeEnabled,
    workerId:get('RACK_RELIC_TEST_CASE_WAKE_WORKER_ID'),
    databaseKey:get('RACK_RELIC_TEST_CASE_WAKE_DB_KEY') || receiverConfig.serviceKey,
    resendApiKey:get('RACK_RELIC_TEST_CASE_WAKE_RESEND_API_KEY'),
    readEnrollment:() => __rrModules['./urgent_alert_edge_host.cjs'].readPrivateEnrollment(get('RACK_RELIC_TEST_CASE_WAKE_SETUP')),
    isStopped:() => get('RACK_RELIC_TEST_CASE_WAKE_ENABLED') !== 'true'});
}
const __rrNativeDeno = globalThis.Deno;
if (__rrNativeDeno && typeof __rrNativeDeno.serve === 'function') {
  __rrNativeDeno.serve(createUrgentAlertEdgeFromEnv(name => __rrNativeDeno.env.get(name)));
}
`;
  if (!out.includes(baseline.toString('utf8'))) throw Error('Full v9 bytes not preserved');
  return out;
}
if (require.main === module) process.stdout.write(build());
module.exports = {build};
