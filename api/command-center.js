// Dedicated owner entry point. Provider session credentials stay in HttpOnly cookies.
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const {createCommandSessionService}=require('../server/command_session.cjs');
module.exports=createTestAdminRuntime({commandSession:createCommandSessionService()});
module.exports.config={api:{bodyParser:false}};
