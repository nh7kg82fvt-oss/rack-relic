'use strict';

// SOURCE ONLY. No environment reads, runtime imports, provisioning or activation.
// This verifies configuration, NEVER deployment or caller-credential authority.
const ACCOUNT = '7a3ed4f82692abebebc6447e5f5e217c';
const BUCKET = 'rack-relic-private-photo-archive';
const SOURCE = 'tzymapahsfiyhgilsmxl';
const ORIGIN = 'https://api.cloudflare.com/client/v4';
const ROOT = '/accounts/' + ACCOUNT;
const BUCKET_PATH = ROOT + '/r2/buckets/' + BUCKET;
const PATHS = [ROOT, BUCKET_PATH, BUCKET_PATH + '/lock',
  BUCKET_PATH + '/domains/managed', BUCKET_PATH + '/domains/custom', BUCKET_PATH + '/cors'];
const LIMIT = 65536, FRESH_MS = 10000, EVIDENCE_TTL_MS = 5000;
const fail = () => { throw Error('R2_ARCHIVE_CONFIGURATION_UNVERIFIED'); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const only = (value, keys) => object(value) && Object.keys(value).every(k => keys.includes(k));

async function readJSON(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT)) fail();
  if (!response.body) fail();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      if (signal.aborted) fail();
      const part = await reader.read();
      if (signal.aborted) fail();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMIT) { await reader.cancel(); fail(); }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  if (length !== null && Number(length) !== size) fail();
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function validate(results) {
  const [account, bucket, locks, managed, domains, cors] = results;
  if (!object(account) || account.id !== ACCOUNT || !object(bucket) || bucket.name !== BUCKET ||
      bucket.storage_class !== 'Standard' || bucket.location !== 'wnam' || bucket.jurisdiction !== 'default') fail();
  // Strict current baseline. Additional rules require review, not guessed composition.
  if (!only(locks, ['rules']) || !Array.isArray(locks.rules) || locks.rules.length !== 1) fail();
  const rule = locks.rules[0];
  if (!only(rule, ['id', 'condition', 'enabled', 'prefix']) || typeof rule.id !== 'string' ||
      !rule.id || rule.enabled !== true || (own(rule, 'prefix') && rule.prefix !== '') ||
      !only(rule.condition, ['type', 'maxAgeSeconds']) || rule.condition.type !== 'Age' ||
      rule.condition.maxAgeSeconds !== 604800) fail();
  if (!only(managed, ['bucketId', 'domain', 'enabled']) || managed.enabled !== false ||
      typeof managed.bucketId !== 'string' || !managed.bucketId || managed.bucketId.length > 32 ||
      typeof managed.domain !== 'string' || !managed.domain) fail();
  const domainURL = new URL('https://' + managed.domain);
  if (domainURL.hostname !== managed.domain || !domainURL.hostname.endsWith('.r2.dev') ||
      domainURL.username || domainURL.password || domainURL.port || domainURL.pathname !== '/' ||
      domainURL.search || domainURL.hash) fail();
  // These documented endpoints return complete arrays, with no page/cursor contract.
  // Missing arrays, alternate shapes or pagination metadata are not empty inventories.
  if (!only(domains, ['domains']) || !Array.isArray(domains.domains) || domains.domains.length !== 0 ||
      !only(cors, ['rules']) || !Array.isArray(cors.rules) || cors.rules.length !== 0) fail();
}

function createR2ArchiveConfigurationVerifier({enabled = false, readToken, fetchImpl,
  clock = Date.now, timeoutMs = 5000} = {}) {
  const ready = typeof window === 'undefined' && enabled === true && typeof fetchImpl === 'function' &&
    typeof clock === 'function' && typeof readToken === 'string' && /^[A-Za-z0-9_-]{20,256}$/.test(readToken) &&
    Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 20000;
  return Object.freeze({async inspect({signal} = {}) {
    if (!ready) throw Error('R2_ARCHIVE_CONFIGURATION_NOT_CONFIGURED');
    const controller = new AbortController();
    let timer, stopped = false, lastClock;
    const now = () => {
      const value = clock();
      if (!Number.isSafeInteger(value) || (lastClock !== undefined && value < lastClock)) fail();
      lastClock = value;
      return value;
    };
    const stop = () => { stopped = true; controller.abort(); };
    const check = started => {
      if (stopped || controller.signal.aborted || now() - started > FRESH_MS) fail();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, {once: true});
    try {
      return await Promise.race([Promise.resolve().then(async () => {
        const started = now(), results = [];
        let oldestProviderDate = Infinity;
        check(started);
        for (const path of PATHS) {
          check(started);
          const url = ORIGIN + path;
          const response = await fetchImpl(url, {method: 'GET', redirect: 'error', cache: 'no-store',
            headers: {Authorization: 'Bearer ' + readToken, Accept: 'application/json',
              'Cache-Control': 'no-store', ...(path === ROOT ? {} : {'cf-r2-jurisdiction': 'default'})},
            signal: controller.signal});
          check(started);
          // Require the actual final URL; do not accept a fabricated/unknown destination.
          if (!(response instanceof Response) || response.status !== 200 || response.url !== url ||
              response.redirected || response.headers.has('location') || response.headers.has('link') ||
              !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail();
          const age = response.headers.get('age'), date = Date.parse(response.headers.get('date') || '');
          if ((age !== null && age !== '0') || !Number.isFinite(date) || date > now() + 1000 ||
              now() - date > FRESH_MS || /\b(?:HIT|STALE|UPDATING|REVALIDATED)\b/i.test(response.headers.get('cf-cache-status') || '')) fail();
          oldestProviderDate = Math.min(oldestProviderDate, date);
          const envelope = await readJSON(response, controller.signal);
          check(started);
          if (!only(envelope, ['success', 'errors', 'messages', 'result']) || envelope.success !== true ||
              !Array.isArray(envelope.errors) || envelope.errors.length !== 0 ||
              !Array.isArray(envelope.messages) || !object(envelope.result)) fail();
          results.push(envelope.result);
        }
        validate(results);
        check(started);
        const checkedAt = now(), expiresAt = Math.min(started + FRESH_MS,
          oldestProviderDate + FRESH_MS, checkedAt + EVIDENCE_TTL_MS);
        if (expiresAt <= checkedAt) fail();
        // Deliberately incompatible with verifyPolicy's full verified:true contract.
        return Object.freeze({kind: 'rack-relic-r2-configuration-evidence-v1', configurationVerified: true,
          verified: false, accountId: ACCOUNT, bucket: BUCKET, sourceProjectRef: SOURCE,
          observedFrom: started, checkedAt, expiresAt, publicDevelopmentEnabled: false,
          customDomainCount: 0, corsRuleCount: 0,
          wholeBucketLock: Object.freeze({type: 'Age', maxAgeSeconds: 604800, prefix: ''}),
          deploymentAttested: false, credentialBoundaryAttested: false,
          activationAuthorized: false, releaseEnabled: false});
      }), new Promise((_, reject) => {
        timer = setTimeout(() => { stop(); reject(Error('R2_ARCHIVE_CONFIGURATION_UNVERIFIED')); }, timeoutMs);
      })]);
    } catch {
      // No raw URL, token, provider body, domain, account-owner detail or nested error leaks.
      throw Error('R2_ARCHIVE_CONFIGURATION_UNVERIFIED');
    } finally {
      stop(); clearTimeout(timer); signal?.removeEventListener('abort', stop);
    }
  }});
}

module.exports = {createR2ArchiveConfigurationVerifier};
