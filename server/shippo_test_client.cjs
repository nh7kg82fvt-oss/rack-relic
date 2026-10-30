'use strict';
// Server-only preparation. No public route or live-label purchase is enabled.
const ID = /^[a-f0-9]{32}$/;
function createShippoTestClient({token, fetchImpl=globalThis.fetch}={}) {
  if (typeof token !== 'string' || !/^shippo_test_[A-Za-z0-9]+$/.test(token)) throw Error('A Shippo test token is required');
  const quotedRates = new Set();
  async function request(path, body) {
    let response;
    try {
      response = await fetchImpl('https://api.goshippo.com'+path, {
        method:'POST', redirect:'error', cache:'no-store', signal:AbortSignal.timeout(20000),
        headers:{Authorization:'ShippoToken '+token, 'Content-Type':'application/json', 'SHIPPO-API-VERSION':'2018-02-08'},
        body:JSON.stringify(body)
      });
    } catch { throw Error('Shippo test request failed; no automatic retry was made'); }
    if (!response.ok) throw Error('Shippo test request rejected ('+response.status+')');
    let data; try { data=await response.json(); } catch { throw Error('Invalid Shippo response'); }
    if (data.test !== true) throw Error('Expected a test-mode response');
    return data;
  }
  function address(value) {
    const out={};
    for (const field of ['name','street1','city','state','zip','country']) {
      if (typeof value?.[field] !== 'string' || !value[field].trim() || value[field].length>150) throw Error('Incomplete shipping address');
      out[field]=value[field].trim();
    }
    if(out.country!=='US') throw Error('Only US test shipping is supported');
    if(value.street2) out.street2=String(value.street2).slice(0,150);
    for(const field of ['email','phone']) {
      if(value[field]!==undefined) {
        if(typeof value[field]!=='string'||value[field].length>150) throw Error('Invalid sender contact');
        out[field]=value[field];
      }
    }
    return out;
  }
  function parcel(value) {
    const out={distance_unit:'in',mass_unit:'lb'};
    for(const field of ['length','width','height','weight']) {
      const n=Number(value?.[field]);
      if(!Number.isFinite(n)||n<=0||n>(field==='weight'?150:108)) throw Error('Invalid packaged dimensions or weight');
      out[field]=String(n);
    }
    return out;
  }
  return {
    async quote({from,to,package:pack}={}) {
      const data=await request('/shipments/',{address_from:address(from),address_to:address(to),parcels:[parcel(pack)],async:false,metadata:'Rack Relic test only'});
      if(!ID.test(data.object_id)||!Array.isArray(data.rates)) throw Error('Invalid test shipment');
      const rates=data.rates.filter(r=>ID.test(r.object_id)&&r.currency==='USD'&&/^\d+(\.\d{1,2})?$/.test(r.amount)).map(r=>{
        const cents=Math.round(Number(r.amount)*100);
        if(!Number.isSafeInteger(cents)||cents<0) throw Error('Invalid shipping price');
        quotedRates.add(r.object_id);
        return {id:r.object_id,amountCents:cents,currency:'USD',carrier:String(r.provider||''),service:String(r.servicelevel?.name||''),test:true};
      });
      return {id:data.object_id,test:true,rates};
    },
    async label(rateId) {
      if(!quotedRates.has(rateId)) throw Error('Choose a rate quoted in this test session');
      // Consume before request: uncertain responses must never trigger duplicate automatic purchases.
      quotedRates.delete(rateId);
      const data=await request('/transactions/',{rate:rateId,label_file_type:'PDF_4x6',async:false,metadata:'Rack Relic test only - not valid postage'});
      if(data.status!=='SUCCESS'||!ID.test(data.object_id)) throw Error('Test label not ready; check Shippo before retrying');
      let url; try { url=new URL(data.label_url); } catch { throw Error('Invalid test label URL'); }
      if(url.protocol!=='https:') throw Error('Invalid test label URL');
      return {id:data.object_id,test:true,labelUrl:url.href,trackingNumber:String(data.tracking_number||'')};
    }
  };
}
module.exports={createShippoTestClient};
