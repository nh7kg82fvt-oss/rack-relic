const {createOwnerAlertRehearsalRuntime}=require('../server/owner_alert_rehearsal_runtime.cjs');
module.exports=createOwnerAlertRehearsalRuntime();
module.exports.config={api:{bodyParser:false}};
