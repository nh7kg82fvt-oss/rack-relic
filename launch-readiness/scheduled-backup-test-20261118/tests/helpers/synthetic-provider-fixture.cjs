'use strict';
// FICTIONAL test metadata, not an operational snapshot. Fixed source identities
// mirror the existing validator constants; every deployment/version/module is
// deterministic, newly fictional data with no provider read or saved payload.
const {createHash}=require('node:crypto');
const {SCOPE_V5}=require('../../runtime/server/backup_scoped_execution_v5.cjs');
const roles=[
 ['journal','rack-relic-archive-journal','1cea9c31fbef47bb9e2705ad88edb03d'],
 ['source','rack-relic-backup-source-reader','cf24bfc351b1429f95039b713e9233c0'],
 ['gateway','rack-relic-private-photo-archive-gateway','d01911069df74ce38caec7f364cc9cb4'],
 ['caller','rack-relic-r2-backup-caller','2c3d72b65787409a8f1badab9f43d5d8'],
 ['verifier','rack-relic-r2-policy-verifier','63c8f95ae75343ca9445c11ac85d3fe7']
];
module.exports=Object.freeze({accountId:SCOPE_V5.accountId,workers:Object.freeze(roles.map(([role,name,workerId],index)=>{
 const n=index+1,content=`// FICTIONAL ${role} module for control-plane validation only.\nexport default {fetch(){return new Response('SYNTHETIC TEST ONLY',{status:404});}};\n`;
 return Object.freeze({name,workerId,deploymentId:`${n}1111111-1111-4111-8111-111111111111`,versionId:`${n}2222222-2222-4222-8222-222222222222`,module:Object.freeze({name:role+'.mjs',bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex'),content}),compatibilityDate:'2026-11-04',compatibilityFlags:Object.freeze(['nodejs_compat']),subdomain:Object.freeze({enabled:false,previews_enabled:false})});
}))});
