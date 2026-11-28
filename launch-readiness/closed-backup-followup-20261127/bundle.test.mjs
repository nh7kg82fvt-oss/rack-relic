import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {compileSynthetic} from './bundle.mjs';

test('five reproducible ESM artifacts load with static native Node imports and closed entrypoints',async()=>{
 const first=await compileSynthetic();
 assert.deepEqual(first.manifest,(await compileSynthetic()).manifest);
 assert.equal(Object.keys(first.manifest.roles).length,5);
 const hooks=registerHooks({resolve(specifier,context,next) {
  if (specifier==='cloudflare:workers') return {
   shortCircuit:true,url:'data:text/javascript,export class WorkerEntrypoint {}',
  };
  return next(specifier,context);
 }});
 try {
  for (const file of first.outputs) {
   const mod=await import('data:text/javascript;base64,'+Buffer.from(file.contents).toString('base64'));
   assert.equal((await mod.default.fetch()).status,404);
   const caller=file.path.endsWith('/caller.mjs');
   assert.deepEqual(Object.keys(mod.default).sort(),caller?['fetch','scheduled']:['fetch']);
   if (caller) {
    let noRetry=0;
    await assert.rejects(mod.default.scheduled({noRetry(){noRetry++;}},{}),/HELD/);
    assert.equal(noRetry,1);
    assert.deepEqual(Object.keys(mod),['default']);
   }
  }
 } finally {hooks.deregister();}
});
