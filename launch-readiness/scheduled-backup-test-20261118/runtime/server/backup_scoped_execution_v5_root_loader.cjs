'use strict';
// NODE-ONLY CONSTRUCTION PROPOSAL. Never reads env, discovers secrets, fetches,
// authenticates a runtime host, or turns configuration into execution authority.
const {createHash}=require('node:crypto');
const {digestV5}=require('./backup_scoped_execution_v5.cjs');
const COUNT='RACK_RELIC_BACKUP_V5_CONFIG_COUNT';
const PARTS=Object.freeze(Array.from({length:13},(_,i)=>'RACK_RELIC_BACKUP_V5_CONFIG_'+String(i+1).padStart(2,'0')));
const PIN_NAMES=Object.freeze(['RACK_RELIC_BACKUP_V5_ROOT_SHA256','RACK_RELIC_BACKUP_V5_ACCEPTANCE_SHA256']);
const SHA=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('V5_CONSTRUCTION_CONFIG_HELD');};
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const sha=x=>typeof x==='string'&&SHA.test(x)&&x!=='0'.repeat(64);
function dataProperties(x){if(!plain(x)||Reflect.ownKeys(x).length!==Object.keys(x).length)fail();const properties=Object.getOwnPropertyDescriptors(x);if(Object.values(properties).some(p=>!Object.hasOwn(p,'value')||p.enumerable!==true))fail();return properties;}
// JSON.parse revivers cannot detect duplicate keys. Parse bounded plain JSON and
// compare decoded object names, including Unicode-escaped duplicate names.
function parse(text){
 let pos=0,nodes=0;
 const space=()=>{while(/[ \t\r\n]/.test(text[pos]||'')&&pos<text.length)pos++;};
 function string(){
  const start=pos++;for(;;){if(pos>=text.length)fail();const c=text[pos++];if(c==='"')break;if(c.charCodeAt(0)<32)fail();if(c==='\\'){if(pos>=text.length)fail();const e=text[pos++];if(e==='u'){if(!/^[a-fA-F0-9]{4}$/.test(text.slice(pos,pos+4)))fail();pos+=4;}else if(!'"\\/bfnrt'.includes(e))fail();}}
  return JSON.parse(text.slice(start,pos));
 }
 function value(depth){
  if(++nodes>4096||depth>14)fail();space();const c=text[pos];
  if(c==='"')return string();
  if(c==='{'){
   pos++;space();const entries=[],seen=new Set();if(text[pos]==='}'){pos++;return Object.freeze({});}
   for(;;){space();if(text[pos]!=='"')fail();const name=string();if(seen.has(name))fail();seen.add(name);space();if(text[pos++]!==':')fail();entries.push([name,value(depth+1)]);space();const sep=text[pos++];if(sep==='}')return Object.freeze(Object.fromEntries(entries));if(sep!==',')fail();}
  }
  if(c==='['){pos++;space();const entries=[];if(text[pos]===']'){pos++;return Object.freeze(entries);}for(;;){entries.push(value(depth+1));space();const sep=text[pos++];if(sep===']')return Object.freeze(entries);if(sep!==',')fail();}}
  for(const [literal,result]of [['true',true],['false',false],['null',null]])if(text.startsWith(literal,pos)){pos+=literal.length;return result;}
  const number=text.slice(pos).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
  if(!number)fail();pos+=number[0].length;const result=Number(number[0]);if(!Number.isSafeInteger(result))fail();return result;
 }
 const result=value(0);space();if(pos!==text.length)fail();return result;
}
function createScopedV5ConstructionLoader(input={}){
 let fixed=null;
 try{
  dataProperties(input);if(!exact(input,['enabled','expectedRootSha256','expectedAcceptanceSha256','secretValues'])||input.enabled!==true||!sha(input.expectedRootSha256)||!sha(input.expectedAcceptanceSha256))fail();
  const properties=dataProperties(input.secretValues),rawCount=properties[COUNT]?.value;
  if(typeof rawCount!=='string'||!/^(?:[1-9]|1[0-3])$/.test(rawCount))fail();
  const count=Number(rawCount),names=[COUNT,...PARTS.slice(0,count)];if(!exact(input.secretValues,names))fail();
  const chunks=PARTS.slice(0,count).map(name=>{const text=properties[name]?.value;if(typeof text!=='string'||Buffer.byteLength(text)<1||Buffer.byteLength(text)>5000)fail();return text;});
  const text=chunks.join('');if(Buffer.byteLength(text)>65536)fail();
  fixed=Object.freeze({text,count,rootSha256:input.expectedRootSha256,acceptanceSha256:input.expectedAcceptanceSha256,names:Object.freeze(names)});
 }catch{}
 return Object.freeze({load(...args){
  try{
   if(!fixed||args.length!==0)fail();const packet=parse(fixed.text);
   if(!exact(packet,['version','root','executionAcceptance'])||packet.version!=='rr-backup-v5-scheduled-test-private-construction-v1'||!exact(packet.root,['version','rootId','acceptanceSha256','collectorKey'])||packet.root.version!=='rr-backup-scoped-root-v5-scheduled-test-v1'||!plain(packet.executionAcceptance)||packet.root.acceptanceSha256!==fixed.acceptanceSha256||digestV5(packet.root)!==fixed.rootSha256||digestV5(packet.executionAcceptance)!==fixed.acceptanceSha256)fail();
   // Data integrity against independently supplied construction pins only.
   // Caller must still use the actual validator, protected host/root enrollment,
   // and a fresh authenticated observation. No accepted/verified flag is returned.
   return Object.freeze({kind:'rr-scoped-v5-construction-data-only',root:packet.root,executionAcceptance:packet.executionAcceptance,rootSha256:fixed.rootSha256,acceptanceSha256:fixed.acceptanceSha256,packetSha256:createHash('sha256').update(fixed.text).digest('hex'),chunkCount:fixed.count,configurationSecretNames:fixed.names});
  }catch{return null;}
 }});
}
module.exports=Object.freeze({createScopedV5ConstructionLoader,V5_CONSTRUCTION_COUNT_NAME:COUNT,V5_CONSTRUCTION_PART_NAMES:PARTS,V5_CONSTRUCTION_PIN_NAMES:PIN_NAMES});
