const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
module.exports=createTestAdminRuntime();
module.exports.config={api:{bodyParser:false}};
