'use strict';
const {createRecoveryHost}=require('../server/recovery_host.cjs');
const binding=require('../server/recovery_private_binding.cjs');
const host=createRecoveryHost(binding);
module.exports=host.handle;
// No router/body parser should consume the request before the host checks it.
module.exports.config={api:{bodyParser:false}};
