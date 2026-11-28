/* PRIVATE SOURCE PROPOSAL. Default-off build diagnostic; no provider calls. */
(function rackShippingSlotBuild() {
  'use strict';
  let outcome = 'HELD';
  try {
    if (process.env.RACK_SHIPPO_SLOT_DIAGNOSTIC_ENABLED !== 'true') return;
    do {
      if (process.env.VERCEL !== '1' ||
          process.env.VERCEL_ENV !== 'preview' ||
          process.env.VERCEL_TARGET_ENV !== 'preview' ||
          process.env.VERCEL_PROJECT_ID !== 'prj_XO9ADzBydcq45PHSQHX9v23GPCri' ||
          process.env.VERCEL_GIT_COMMIT_REF !== 'test-only-marketplace-foundation') break;

      const binding = process.env.RACK_SHIPPO_SLOT_DIAGNOSTIC_BINDING;
      if (typeof binding !== 'string' || binding.length > 192) break;
      const parsed = /^\{"commit":"([0-9a-f]{40})","notBefore":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)","notAfter":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)"\}$/.exec(binding);
      if (!parsed || parsed[0] !== binding || parsed[1] === 'cfbc7d20c98fbd25f3eb819edba86b9dfce72965' ||
          process.env.VERCEL_GIT_COMMIT_SHA !== parsed[1]) break;

      const notBefore = Date.parse(parsed[2]);
      const notAfter = Date.parse(parsed[3]);
      if (!Number.isSafeInteger(notBefore) || !Number.isSafeInteger(notAfter) ||
          new Date(notBefore).toISOString() !== parsed[2] ||
          new Date(notAfter).toISOString() !== parsed[3] ||
          notAfter <= notBefore || notAfter - notBefore > 20 * 60 * 1000) break;
      const observedStart = Date.now();
      if (!Number.isSafeInteger(observedStart) || observedStart < notBefore || observedStart >= notAfter) break;

      const token = process.env.RACK_RELIC_TEST_SHIPPO_KEY;
      if (typeof token !== 'string' || !/^shippo_test_[A-Za-z0-9]{16,128}(?![\s\S])/.test(token)) break;
      const observedEnd = Date.now();
      if (!Number.isSafeInteger(observedEnd) || observedEnd < observedStart ||
          observedEnd - observedStart > 5000 || observedEnd < notBefore || observedEnd >= notAfter) break;
      if (token.endsWith('ecf3')) outcome = 'SLOT_A';
      else if (token.endsWith('d4fc')) outcome = 'SLOT_B';
    } while (false);
  } catch {
    // Deliberately suppress all exception values and environment contents.
  }
  try {
    process.exitCode = outcome === 'HELD' ? 1 : 0;
    process.stdout.write(outcome + '\n');
  } catch {
    process.exitCode = 1;
  }
}());
