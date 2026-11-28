'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {mkdtempSync,writeFileSync,readFileSync,copyFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {compareRestore}=require('./restore-check.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=x=>Buffer.from(JSON.stringify(x));
const source='tzymapahsfiyhgilsmxl',target='xkxolhgafjadpknsfqqw';
const objectKey='listing-photos/fictional-owner/fictional-listing/restore.png';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
function docker(args,input) {
 return execFileSync('docker',['exec','-i',process.env.RR_NATIVE_CONTAINER,...args],{input,timeout:10000});
}
function sql(db,query) {
 return docker(['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],query);
}
test('native logical restore plus exact Auth/config, Edge modules and required photo bytes share one checkpoint',t=>{
 assert.match(sql('postgres','SHOW server_version;').toString(),/^17\./);
 const dir=mkdtempSync(join(tmpdir(),'rr-restore-fixture-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const src='restore_source_fixture',dst='restore_target_fixture';
 for (const db of [src,dst]) docker(['createdb','-U','postgres',db]);
 sql(src,`
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id integer PRIMARY KEY, confirmed boolean NOT NULL);
  CREATE TABLE auth.identities(user_id integer PRIMARY KEY REFERENCES auth.users(id), provider text NOT NULL);
  CREATE TABLE public.listings(id integer PRIMARY KEY, owner_id integer REFERENCES auth.users(id), required_photo text NOT NULL);
  ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
  CREATE POLICY fixture_read ON public.listings FOR SELECT TO authenticated USING (owner_id=7);
  INSERT INTO auth.users VALUES (7,true);
  INSERT INTO auth.identities VALUES (7,'fixture');
  INSERT INTO public.listings VALUES (11,7,'${objectKey}');
 `);
 const dump=docker(['pg_dump','-U','postgres','-Fc',src]);
 // The dump is synthetic. The actual restore writes only to the disposable DB.
 docker(['pg_restore','-U','postgres','--exit-on-error','--single-transaction','-d',dst],dump);
 const checkpointSha256=sha(dump);
 const artifactFixtures={
  config:bytes({provider:'fixture',redirectAllowlist:['https://recovery.example.invalid'],secretNames:['FIXTURE_ONLY']}),
  edge:Buffer.from('export default () => new Response("fictional edge fixture");'),
  photos:png,
 };
 for (const [name,body] of Object.entries(artifactFixtures)) {
  writeFileSync(join(dir,'source-'+name),body,{flag:'wx'});
  copyFileSync(join(dir,'source-'+name),join(dir,'restored-'+name));
 }
 function inventory(db,stage) {
  const required=sql(db,'SELECT required_photo FROM public.listings ORDER BY id;').toString().trim();
  return {
   database:new Map([['app-listings-and-rls',sql(db,`
    SELECT json_build_object('rows',(SELECT json_agg(l ORDER BY id) FROM public.listings l),
      'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.listings'::regclass),
      'policies',(SELECT json_agg(p ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='listings'));
   `)]]),
   auth:new Map([['users-and-identities',sql(db,`
    SELECT json_agg(u ORDER BY u.id) FROM (
      SELECT a.id,a.confirmed,i.provider FROM auth.users a JOIN auth.identities i ON i.user_id=a.id
    ) u;
   `)]]),
   config:new Map([['auth-and-edge-config-projection',readFileSync(join(dir,stage+'-config'))]]),
   edge:new Map([['fixture-edge/index.mjs',readFileSync(join(dir,stage+'-edge'))]]),
   photos:new Map([[required,readFileSync(join(dir,stage+'-photos'))]]),
  };
 }
 const expected=Object.fromEntries(Object.entries(inventory(src,'source')).map(([group,files])=>[
  group,[...files].map(([id,body])=>({id,size:body.length,sha256:sha(body)})),
 ]));
 const manifestBytes=bytes({version:'rr-coherent-restore-challenge-v1',source,target,
  checkpointSha256,inventory:expected});
 const readback={target,checkpointSha256,inventory:inventory(dst,'restored')};
 const input={manifestBytes,expectedManifestSha256:sha(manifestBytes),readback};
 assert.deepEqual(compareRestore(input),{matched:true,counts:{database:1,auth:1,config:1,edge:1,photos:1}});
 assert.deepEqual(compareRestore({...input,readback:{...readback,checkpointSha256:'e'.repeat(64)}}),{matched:false,component:'scope'});
 for (const artifact of ['auth','config','edge','photos']) {
  const observed={...readback.inventory,[artifact]:new Map()};
  assert.deepEqual(compareRestore({...input,readback:{...readback,inventory:observed}}),{matched:false,component:artifact});
 }
 writeFileSync(join(dir,'restored-photos'),Buffer.alloc(png.length));
 assert.deepEqual(compareRestore({...input,readback:{...readback,inventory:inventory(dst,'restored')}}),{matched:false,component:'photos'});
 writeFileSync(join(dir,'restored-photos'),png);
 sql(dst,"UPDATE public.listings SET required_photo='historical/other.png' WHERE id=11;");
 assert.deepEqual(compareRestore({...input,readback:{...readback,inventory:inventory(dst,'restored')}}),{matched:false,component:'database'});
});
