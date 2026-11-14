// Dedicated owner entry point. Provider session credentials stay in HttpOnly cookies.
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const {createCommandSessionService}=require('../server/command_session.cjs');
const {createOwnerPracticeMount}=require('../server/owner_practice_mount.cjs');
const ownerPractice=createOwnerPracticeMount({env:process.env,fetchImpl:globalThis.fetch});
module.exports=createTestAdminRuntime({commandSession:createCommandSessionService(),ownerFixtureSetupAvailable:ownerPractice.localAvailability});
module.exports.config={api:{bodyParser:false}};
