'use strict';
// Public identities only. A preview may use one complete reviewed tuple; none
// of these values grants access or permits a caller-selected provider target.
function environment({id,branch,projectRef,accountId,previewOrigin}){
 return Object.freeze({id,branch,projectRef,projectUrl:'https://'+projectRef+'.supabase.co',accountId,previewOrigin,returnUrl:previewOrigin+'/api/test-marketplace'});
}
const TEST_ENVIRONMENTS=Object.freeze({
 legacy:environment({id:'legacy',branch:'test-only-marketplace-foundation',projectRef:'zvtaqzcqfdjpuwnlpzln',accountId:'acct_1UWJZuGVbz9Pnhxd',previewOrigin:'https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app'}),
 acceptance:environment({id:'acceptance-v1',branch:'codex/prelaunch-seller-protections',projectRef:'tzymapahsfiyhgilsmxl',accountId:'acct_1UXdWBGppSOhWnq8',previewOrigin:'https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app'})
});
const environments=Object.freeze(Object.values(TEST_ENVIRONMENTS));
const find=(key,value)=>typeof value==='string'?environments.find(row=>row[key]===value)||null:null;
const getTestEnvironmentByAccount=accountId=>find('accountId',accountId);
const getTestEnvironmentByProject=projectUrl=>find('projectUrl',projectUrl);
const getTestEnvironmentByPreviewOrigin=origin=>find('previewOrigin',origin);
const getTestEnvironmentByBranch=branch=>find('branch',branch);
function selectTestEnvironment({branch,projectUrl,accountId}={}){
 const row=getTestEnvironmentByBranch(branch);
 return row&&row.projectUrl===projectUrl&&row.accountId===accountId?row:null;
}
module.exports=Object.freeze({TEST_ENVIRONMENTS,getTestEnvironmentByAccount,getTestEnvironmentByProject,getTestEnvironmentByPreviewOrigin,getTestEnvironmentByBranch,selectTestEnvironment});
