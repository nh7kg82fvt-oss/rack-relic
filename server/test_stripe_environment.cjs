'use strict';
const {getTestEnvironmentByAccount}=require('./test_environment_registry.cjs');
function stripeEnvironment(accountId){
 const environment=getTestEnvironmentByAccount(accountId);
 if(!environment)throw Error('Approved Rack Relic sandbox required');
 return environment;
}
function integrationTag(environment,legacy){return environment.id==='legacy'?legacy:legacy+'_acceptance_v1';}
function environmentMetadata(environment){return environment.id==='legacy'?{}:{rr_test_environment:environment.id};}
function matchesEnvironmentMetadata(metadata,environment){return environment.id==='legacy'?metadata?.rr_test_environment==null:metadata?.rr_test_environment===environment.id;}
function idempotencyKey(environment,prefix,id){return prefix+(environment.id==='legacy'?'':'acceptance_v1_')+id;}
module.exports={stripeEnvironment,integrationTag,environmentMetadata,matchesEnvironmentMetadata,idempotencyKey};
