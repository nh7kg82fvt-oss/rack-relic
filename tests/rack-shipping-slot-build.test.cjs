'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'scripts', 'rack-shipping-slot-build.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const flag = 'RACK_SHIPPO_SLOT_DIAGNOSTIC_ENABLED';
const bindingName = 'RACK_SHIPPO_SLOT_DIAGNOSTIC_BINDING';
const keyName = 'RACK_RELIC_TEST_SHIPPO_KEY';
const allowedNames = new Set([
  flag, bindingName, keyName, 'VERCEL', 'VERCEL_ENV', 'VERCEL_TARGET_ENV',
  'VERCEL_PROJECT_ID', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_COMMIT_SHA'
]);
const instant = Date.parse('2030-01-02T03:04:05.000Z');
const futureCommit = 'a'.repeat(40);
const baselineCommit = 'cfbc7d20c98fbd25f3eb819edba86b9dfce72965';

function utc(ms) { return new Date(ms).toISOString(); }
function binding(overrides = {}) {
  return JSON.stringify({commit: futureCommit, notBefore: utc(instant - 1000), notAfter: utc(instant + 60000), ...overrides});
}
function validEnv(overrides = {}) {
  return {
    [flag]: 'true', [bindingName]: binding(), VERCEL: '1', VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_XO9ADzBydcq45PHSQHX9v23GPCri',
    VERCEL_GIT_COMMIT_REF: 'test-only-marketplace-foundation', VERCEL_GIT_COMMIT_SHA: futureCommit,
    [keyName]: 'shippo_test_' + 'X'.repeat(28) + 'ecf3', ...overrides
  };
}
function exercise(values, options = {}) {
  const reads = [];
  const writes = [];
  const output = [];
  let keyReads = 0;
  let clockRead = 0;
  const forbidden = [];
  const original = Object.getOwnPropertyDescriptors(values);
  const env = new Proxy(values, {
    get(target, name) {
      reads.push(name);
      assert(allowedNames.has(name), 'unexpected environment access');
      if (name === keyName) keyReads += 1;
      if (options.throwName === name) throw new Error('synthetic-private-exception-' + String(target[keyName]));
      return Reflect.get(target, name);
    },
    ownKeys() { throw new Error('environment enumeration forbidden'); },
    set() { writes.push('env'); throw new Error('environment mutation forbidden'); },
    deleteProperty() { writes.push('delete'); throw new Error('environment mutation forbidden'); },
    defineProperty() { writes.push('define'); throw new Error('environment mutation forbidden'); }
  });
  class FixedDate extends Date {
    static now() {
      const clocks = options.clocks || [instant, instant];
      return clocks[Math.min(clockRead++, clocks.length - 1)];
    }
  }
  const fakeProcess = {env, stdout: {write(line) {output.push(line);}}, exitCode: undefined};
  const context = {process: fakeProcess, Date: FixedDate};
  for (const capability of ['require', 'fetch', 'console', 'WebSocket', 'XMLHttpRequest', 'setTimeout', 'setInterval']) {
    Object.defineProperty(context, capability, {get() {forbidden.push(capability); throw new Error('forbidden capability');}});
  }
  vm.runInNewContext(source, context, {filename: 'rack-shipping-slot-build.cjs', timeout: 100, codeGeneration: {strings: false, wasm: false}});
  assert.deepEqual(Object.getOwnPropertyDescriptors(values), original, 'input environment preserved');
  assert.deepEqual(writes, [], 'no environment writes');
  assert.deepEqual(forbidden, [], 'no network, import, timer or console capability accessed');
  assert(output.length <= 1, 'at most one fixed output line');
  if (output.length) assert(['SLOT_A\n', 'SLOT_B\n', 'HELD\n'].includes(output[0]), 'fixed enum only');
  if (typeof values[keyName] === 'string' && values[keyName].length > 0) assert(!output.join('').includes(values[keyName]), 'no token output');
  return {reads, keyReads, output: output.join(''), exitCode: fakeProcess.exitCode};
}
function held(result, expectedKeyReads = 0) {
  assert.equal(result.output, 'HELD\n');
  assert.equal(result.exitCode, 1);
  assert.equal(result.keyReads, expectedKeyReads);
}

const groups = [
  ['default off and removed configuration perform no output or key access', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      const result = exercise(validEnv({[flag]: value}));
      assert.deepEqual(result.reads, [flag]);
      assert.equal(result.output, ''); assert.equal(result.exitCode, undefined); assert.equal(result.keyReads, 0);
    }
    const values = validEnv(); delete values[flag]; delete values[bindingName];
    assert.equal(exercise(values).output, '');
  }],
  ['scope mismatches and missing system variables hold before key access', () => {
    const alternatives = {
      VERCEL: ['0', undefined], VERCEL_ENV: ['production', 'development', undefined],
      VERCEL_TARGET_ENV: ['staging', undefined], VERCEL_PROJECT_ID: ['other-project', undefined],
      VERCEL_GIT_COMMIT_REF: ['codex/prelaunch-seller-protections', undefined]
    };
    for (const [name, values] of Object.entries(alternatives)) for (const value of values) held(exercise(validEnv({[name]: value})));
  }],
  ['external binding is exact, canonical, finite and tied to new source', () => {
    for (const value of [undefined, '', '{}', 'x'.repeat(193), binding() + '\n', binding().replace('{', '{ '),
      binding({commit: 'b'.repeat(40)}), binding({commit: baselineCommit}),
      binding({commit: futureCommit.toUpperCase()}),
      binding().replace('"commit":', '"extra":0,"commit":')]) held(exercise(validEnv({[bindingName]: value})));
    held(exercise(validEnv({VERCEL_GIT_COMMIT_SHA: undefined})));
    held(exercise(validEnv({[bindingName]: binding({commit: baselineCommit}), VERCEL_GIT_COMMIT_SHA: baselineCommit})));
  }],
  ['invalid, excessive, not-yet-open and expired UTC windows hold before key access', () => {
    const bad = [
      {notBefore: '2030-02-30T00:00:00.000Z'}, {notAfter: '2030-01-02T03:04:05Z'},
      {notBefore: utc(instant + 1)}, {notAfter: utc(instant)},
      {notAfter: utc(instant - 1000)},
      {notBefore: utc(instant - 1), notAfter: utc(instant + 20 * 60 * 1000)},
      {notBefore: utc(instant), notAfter: utc(instant)}
    ];
    for (const times of bad) held(exercise(validEnv({[bindingName]: binding(times)})));
    held(exercise(validEnv(), {clocks: [NaN]}));
  }],
  ['only the two known slots return their fixed enum after one key read', () => {
    for (const [suffix, result] of [['ecf3', 'SLOT_A\n'], ['d4fc', 'SLOT_B\n']]) {
      const value = 'shippo_test_' + 'Y'.repeat(28) + suffix;
      const actual = exercise(validEnv({[keyName]: value}));
      assert.equal(actual.output, result); assert.equal(actual.exitCode, 0); assert.equal(actual.keyReads, 1);
      assert.equal(actual.reads[actual.reads.length - 1], keyName);
      assert(!actual.output.includes(suffix));
    }
    const maxWindow = binding({notBefore: utc(instant), notAfter: utc(instant + 20 * 60 * 1000)});
    assert.equal(exercise(validEnv({[bindingName]: maxWindow})).output, 'SLOT_A\n');
  }],
  ['missing, malformed, live, whitespace and other-slot tokens emit only HELD', () => {
    const malformed = [undefined, null, 42, {}, '', 'shippo_live_' + 'X'.repeat(28) + 'ecf3',
      'shippo_test_shortecf3', 'shippo_test_' + 'X'.repeat(129),
      ' shippo_test_' + 'X'.repeat(28) + 'ecf3', 'shippo_test_' + 'X'.repeat(28) + 'ecf3\n',
      'shippo_test_' + 'X'.repeat(28) + 'abcd', 'shippo_test_' + 'X'.repeat(28) + 'ECF3'];
    for (const value of malformed) held(exercise(validEnv({[keyName]: value})), 1);
  }],
  ['exceptions expose neither exception values nor any private input', () => {
    held(exercise(validEnv(), {throwName: bindingName}));
    held(exercise(validEnv(), {throwName: keyName}), 1);
    held(exercise(validEnv(), {throwName: flag}));
  }],
  ['expiry crossing, clock rollback, invalid late time and excessive elapsed time hold', () => {
    for (const end of [instant + 60000, instant - 1, NaN, instant + 5001]) held(exercise(validEnv(), {clocks: [instant, end]}), 1);
    assert.equal(exercise(validEnv(), {clocks: [instant, instant + 5000]}).output, 'SLOT_A\n');
  }]
];

function runFocused() {
  const results = [];
  for (const [name, run] of groups) { run(); results.push({name, passed: true}); }
  return {pass: results.length, fail: 0, skip: 0, scope: 'synthetic VM only; no provider, network, real credential or hosted build', results};
}
module.exports = {runFocused};
if (require.main === module) {
  const test = require('node:test');
  for (const [name, run] of groups) test(name, run);
}
