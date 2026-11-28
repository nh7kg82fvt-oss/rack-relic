// Closed, offline compile check. The named test key MUST NOT be deployed.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const base=fileURLToPath(new URL('../scheduled-backup-test-20261118/',import.meta.url));
const entries=['caller','verifier','source','journal','gateway'];
const hashes=value=>createHash('sha256').update(value).digest('hex');
const syntheticDer=Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex');
const syntheticReviewer={keyId:hashes(syntheticDer),spkiBase64:syntheticDer.toString('base64')};
const adapter='server/schedule-ticket-repository.cjs';
const ticket='sql/schedule_ticket_v1.sql';
// These inputs are pinned to the cfbc7d20 owner-reviewed parity follow-up.
const canonicalPins=Object.freeze({
 [adapter]:'39d660aa61ddb62bef9568f09c88f1baf5636f6bc3fa2210c0b1fdd83ce33de2',
 [ticket]:'bdf5eb7a5ce7ea0134d578dd4a662a5e906457d7233315246c55600b70334023',
});

export async function compileSynthetic(outdir) {
 for (const [path,sha] of Object.entries(canonicalPins)) {
  if (hashes(await readFile(resolve(base,path)))!==sha) throw Error('CANONICAL_PARITY_CHANGED');
 }
 const files=await build({
  absWorkingDir:base, outdir:'bundles', outExtension:{'.js':'.mjs'},
  entryPoints:entries.map(role=>'runtime/workers/backup-cf-v1/'+role+'.mjs'),
  bundle:true, write:false, metafile:true, format:'esm', platform:'neutral', target:'es2022',
  external:['cloudflare:workers'],
  define:{
   __RR_PROTECTED_REVIEWER_JSON__:JSON.stringify(JSON.stringify(syntheticReviewer)),
   __RR_NATIVE_LOCAL_AUDIT__:'false',
  },
  plugins:[{name:'native-workers-builtins',setup(bundle) {
   const supported=/^node:(crypto|perf_hooks)$/;
   bundle.onResolve({filter:supported},args=>args.kind==='require-call'
    ? {path:args.path,namespace:'native-esm'}
    : {path:args.path,external:true});
   bundle.onLoad({filter:supported,namespace:'native-esm'},args=>({
    contents:'export * from '+JSON.stringify(args.path)+';',
    loader:'js',
   }));
  }}],
 });
 const manifest={purpose:'synthetic-reviewer-public-key-NONDEPLOYABLE',canonicalPins,roles:{}};
 if (outdir) await mkdir(outdir); // Never overwrite existing output.
 for (const file of files.outputFiles) {
  const name=file.path.split('/').at(-1);
  const meta=Object.entries(files.metafile.outputs).find(([key])=>key.endsWith('/'+name))?.[1];
  if (!meta||!meta.imports.some(x=>x.path==='node:crypto')||!meta.imports.some(x=>x.path==='node:perf_hooks')||
      meta.imports.some(x=>!x.external||x.kind!=='import-statement'||!['node:crypto','node:perf_hooks','cloudflare:workers'].includes(x.path))) {
   throw Error('WORKER_NATIVE_ESM_REQUIRED');
  }
  manifest.roles[name]={sha256:hashes(file.contents),bytes:file.contents.length};
  if (outdir) await writeFile(resolve(outdir,name),file.contents,{flag:'wx'});
 }
 if (outdir) await writeFile(resolve(outdir,'fixture-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {manifest,outputs:files.outputFiles};
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if (process.argv.length!==3) throw Error('Give one new local output directory');
 const {manifest}=await compileSynthetic(resolve(process.argv[2]));
 console.log(JSON.stringify(manifest,null,2));
}
