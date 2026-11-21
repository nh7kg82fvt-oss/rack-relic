const {createCommandSessionService}=require('../server/command_session.cjs');
module.exports=createCommandSessionService().handle;
module.exports.config={api:{bodyParser:false}};
