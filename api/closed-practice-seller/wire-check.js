'use strict';
const {createOwnerStripeWireCheck}=require('../../server/owner_stripe_wire_check.cjs');
module.exports=async function handler(req,res){
 const mount=createOwnerStripeWireCheck({env:process.env,fetchImpl:globalThis.fetch});
 await mount.handler(req,res);
};
