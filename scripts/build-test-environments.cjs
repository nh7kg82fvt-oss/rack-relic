'use strict';
const fs=require('node:fs'),path=require('node:path');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
function build(){
 const rows=Object.values(TEST_ENVIRONMENTS).map(({id,projectUrl,previewOrigin,returnUrl})=>({id,projectUrl,previewOrigin,returnUrl}));
 return "'use strict';\n// Generated from server/test_environment_registry.cjs. Do not edit manually.\n(function(root){\n const rows="+JSON.stringify(rows)+";\n const environments=Object.freeze(rows.map(row=>Object.freeze(row)));\n if(typeof module==='object'&&module.exports)module.exports=environments;else root.RackRelicTestEnvironments=environments;\n})(typeof globalThis==='object'?globalThis:this);\n";
}
if(require.main===module)fs.writeFileSync(path.join(__dirname,'../test-environments.js'),build());
module.exports={build};
