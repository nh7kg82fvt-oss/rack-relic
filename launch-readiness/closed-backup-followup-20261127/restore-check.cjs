'use strict';
// Read-only comparison of owner-pinned expectations and independent readbacks.
// Supply canonical bytes for logical DB/Auth/config projections, original bytes
// for Edge modules and photos. The observer, custody and manifest remain external.
const {createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const GROUPS=Object.freeze(['database','auth','config','edge','photos']);
const SOURCE='tzymapahsfiyhgilsmxl',TARGET='xkxolhgafjadpknsfqqw';
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value!=='0'.repeat(64);
function exact(x,keys) {
 return x!==null&&x!==undefined&&Object.getPrototypeOf(x)===Object.prototype&&
    Reflect.ownKeys(x).length===keys.length&&keys.every(k=>{
     const d=Object.getOwnPropertyDescriptor(x,k);
     return d?.enumerable&&Object.hasOwn(d,'value');
    });
}

function compareRestore({manifestBytes,expectedManifestSha256,readback}) {
 const fail=component=>Object.freeze({matched:false,component});
 if (!(manifestBytes instanceof Uint8Array)||manifestBytes.length<1||manifestBytes.length>1048576||
     !digest(expectedManifestSha256)||sha(manifestBytes)!==expectedManifestSha256) return fail('manifest');
 let m;
 try {m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
 catch {return fail('manifest');}
 if (!exact(m,['version','source','target','checkpointSha256','inventory'])||
     m.version!=='rr-coherent-restore-challenge-v1'||m.source!==SOURCE||m.target!==TARGET||
     !digest(m.checkpointSha256)||!exact(m.inventory,GROUPS)||
     !exact(readback,['target','checkpointSha256','inventory'])||readback.target!==TARGET||
     readback.checkpointSha256!==m.checkpointSha256||!exact(readback.inventory,GROUPS)) return fail('scope');
 const counts={};
 for (const group of GROUPS) {
  const expected=m.inventory[group],observed=readback.inventory[group];
  if (!Array.isArray(expected)||expected.length<1||expected.length>10000||
      !(observed instanceof Map)||observed.size!==expected.length) return fail(group);
  const seen=new Set();
  for (const row of expected) {
   if (!exact(row,['id','size','sha256'])||typeof row.id!=='string'||!row.id||row.id.length>512||
       seen.has(row.id)||!Number.isSafeInteger(row.size)||row.size<1||!digest(row.sha256)) return fail(group);
   seen.add(row.id);
   const bytes=observed.get(row.id);
   if (!(bytes instanceof Uint8Array)||bytes.length!==row.size||sha(bytes)!==row.sha256) return fail(group);
  }
  counts[group]=seen.size;
 }
 return Object.freeze({matched:true,counts:Object.freeze(counts)});
}

module.exports={compareRestore};
