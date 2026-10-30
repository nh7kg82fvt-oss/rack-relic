const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
module.exports=createTestMarketplaceRuntime();
module.exports.config={api:{bodyParser:false}};
