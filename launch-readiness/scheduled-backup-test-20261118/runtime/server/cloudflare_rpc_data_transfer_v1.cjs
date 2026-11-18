'use strict';
// NATIVE RPC DATA codec only. Returned byte fields use explicit ArrayBuffer
// transport, avoiding enumeration of millions of typed-array index properties.
// It never changes a semantic field or grants policy/operation authority.
const fail=()=>{throw Error('CF_RPC_DATA_TRANSFER_V1_HELD');};
const apply=Reflect.apply,AB=ArrayBuffer,U8=Uint8Array,abProto=AB.prototype,u8Proto=U8.prototype,taProto=Object.getPrototypeOf(u8Proto),abLength=Object.getOwnPropertyDescriptor(abProto,'byteLength').get,abResizable=Object.getOwnPropertyDescriptor(abProto,'resizable')?.get,taLength=Object.getOwnPropertyDescriptor(taProto,'byteLength').get,taSet=taProto.set;
const owned=new WeakSet();
function copyInternalBytesToRpcBufferV1(bytes){
 // Producer-only: input is a privately produced reviewed Source/R2 byte view,
 // never raw request data. Intrinsics do not consult iterator/species/getters.
 let size;try{size=apply(taLength,bytes,[]);}catch{fail();}
 if(Object.getPrototypeOf(bytes)!==u8Proto||size<1||size>2097152)fail();
 const buffer=new AB(size),target=new U8(buffer);apply(taSet,target,[bytes,0]);return buffer;
}
function takeBuffer(value){
 let size;try{size=apply(abLength,value,[]);}catch{fail();}
 if(size<1||size>2097152||Object.getPrototypeOf(value)!==abProto||Reflect.ownKeys(value).length!==0||abResizable&&apply(abResizable,value,[])!==false)fail();
 const out=new U8(size);apply(taSet,out,[new U8(value),0]);return out;
}
async function takeCfRpcDataV1(pending,expectedKeys,binaryFields=[]){
 const input=await pending;let disposer=null,completed=false;
 try{
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||owned.has(input)||!Array.isArray(expectedKeys)||expectedKeys.length<1||expectedKeys.length>32||expectedKeys.some(k=>typeof k!=='string'||!/^[A-Za-z][A-Za-z0-9]*$/.test(k))||new Set(expectedKeys).size!==expectedKeys.length||!Array.isArray(binaryFields)||binaryFields.some(k=>!expectedKeys.includes(k))||new Set(binaryFields).size!==binaryFields.length)fail();owned.add(input);
  const descriptors=Object.getOwnPropertyDescriptors(input),symbols=Reflect.ownKeys(input).filter(k=>typeof k==='symbol');
  if(Object.hasOwn(descriptors,Symbol.dispose)){const d=descriptors[Symbol.dispose];if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||d.enumerable)fail();disposer=d.value.bind(input);}
  if(symbols.length!==1||symbols[0]!==Symbol.dispose||Object.keys(input).sort().join('|')!==expectedKeys.slice().sort().join('|'))fail();
  let nodes=0,bytes=0;const add=n=>{bytes+=n;if(bytes>2200000)fail();};
  function walk(x,depth,top=false){
   if(++nodes>8192||depth>20)fail();
   if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isSafeInteger(x))return x;
   if(typeof x==='string'){const n=new TextEncoder().encode(x).byteLength;if(n>65536)fail();add(n);return x;}
   // No raw view, ArrayBuffer, subclass or proxy is accepted outside an exact
   // declared top-level binary field. Do not read a user-provided byteLength.
   if(!x||typeof x!=='object')fail();
   let isBuffer=false;try{apply(abLength,x,[]);isBuffer=true;}catch{}
   let isView=false;try{apply(taLength,x,[]);isView=true;}catch{}
   if(isBuffer||isView)fail();
   const ds=Object.getOwnPropertyDescriptors(x),keys=Reflect.ownKeys(x),names=keys.filter(k=>typeof k==='string');
   if(keys.some(k=>typeof k==='symbol'&&!(top&&k===Symbol.dispose))||names.some(k=>!Object.hasOwn(ds[k],'value')||!ds[k].enumerable&&!(Array.isArray(x)&&k==='length')))fail();
   if(Array.isArray(x)){if(keys.length!==x.length+1||x.length>4096||names.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=x.length)))fail();return Object.freeze(Array.from({length:x.length},(_,i)=>walk(ds[i].value,depth+1)));}
   if(Object.getPrototypeOf(x)!==Object.prototype)fail();return Object.freeze(Object.fromEntries(names.map(k=>{add(new TextEncoder().encode(k).byteLength);if(top&&binaryFields.includes(k)){const value=takeBuffer(ds[k].value);add(value.byteLength);return [k,value];}return [k,walk(ds[k].value,depth+1)];})));
  }
  const out=walk(input,0,true);completed=true;return out;
 }finally{if(disposer){disposer();if(typeof __RR_NATIVE_LOCAL_AUDIT__==='boolean'&&__RR_NATIVE_LOCAL_AUDIT__)console.log('RR_CF_LOCAL_TRANSFER '+(completed?'copied-disposed':'held-disposed'));}}
}
module.exports=Object.freeze({takeCfRpcDataV1,copyInternalBytesToRpcBufferV1});
