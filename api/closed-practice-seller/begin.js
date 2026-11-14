// Native form body must reach the operation scope without host parsing.
const {createOwnerPracticeMount}=require('../../server/owner_practice_mount.cjs');
module.exports=createOwnerPracticeMount({env:process.env,fetchImpl:globalThis.fetch}).beginHandler;
module.exports.config={api:{bodyParser:false}};
