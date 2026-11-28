// Independent owner-practice routing preserves the existing closed test handler.
const {createOwnerPracticeMarketplaceMount}=require('../server/owner_practice_mount.cjs');
module.exports=createOwnerPracticeMarketplaceMount({env:process.env,fetchImpl:globalThis.fetch}).handler;
module.exports.config={api:{bodyParser:false}};
