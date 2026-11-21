'use strict';
// Proposed v3 fixed-import Node entrypoint; all keys/features remain NULL/OFF.
const {createPaymentTaxOwnerRuntimeV3}=require('../server/private-tax/payment_tax_owner_runtime_v3.cjs');
module.exports=createPaymentTaxOwnerRuntimeV3();
module.exports.config=Object.freeze({api:Object.freeze({bodyParser:false})});
