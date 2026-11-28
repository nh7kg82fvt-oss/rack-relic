'use strict';
const {execFileSync,spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {createInterface}=require('node:readline');

function docker(...args) {
 return execFileSync('docker',args,{encoding:'utf8',timeout:10000});
}
function session(db) {
 const child=spawn('docker',['exec','-i',process.env.RR_NATIVE_CONTAINER,'sh','-c',
  'exec psql -XqAt -U postgres -d "$1" 2>&1','psql',db],{stdio:['pipe','pipe','inherit']});
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 const closed=new Promise(resolve=>child.once('close',resolve));
 async function exec(sql) {
  const tag='rr_'+randomUUID();
  child.stdin.write(sql.trim().replace(/;?$/,';')+'\n\\echo '+tag+' :SQLSTATE\n');
  const output=[];
  for (;;) {
   const {value,done}=await lines.next();
   if (done) throw Error('Local psql closed');
   if (!value.startsWith(tag+' ')) {output.push(value);continue;}
   if (value !== tag+' 00000' || output.some(line=>line.startsWith('ERROR:'))) throw Error(output.join('\n'));
   return output;
  }
 }
 async function query(sql,args=[]) {
  for (const [i,value] of args.entries()) {
   if (!Array.isArray(value)) throw Error('Unexpected native fixture parameter');
   const array='ARRAY['+value.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')+']';
   sql=sql.replace('$'+(i+1),array);
  }
  const body=sql.toLowerCase()==='show search_path'
   ? "SELECT pg_catalog.current_setting('search_path') AS search_path"
   : sql;
  const rows=(await exec('SELECT row_to_json(rr_fixture) FROM ('+body+') rr_fixture'))
   .filter(line=>line.startsWith('{')).map(JSON.parse);
  return {rows};
 }
 return {exec,query,async close(){child.stdin.end();await closed;}};
}
async function createDb() {
 const db='fixture_'+randomUUID().replaceAll('-','');
 const name=process.env.RR_NATIVE_CONTAINER;
 docker('exec',name,'createdb','-U','postgres',db);
 const client=session(db);
 return {...client,peer:async()=>session(db),async close() {
  await client.close();
  docker('exec',name,'dropdb','-U','postgres',db);
  docker('exec',name,'psql','-Xq','-U','postgres','-c',
   "SET client_min_messages=error; REVOKE pg_maintain FROM service_role; DROP ROLE IF EXISTS unexpected_reader;");
 }};
}
module.exports={createDb};
