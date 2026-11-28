// SOURCE ONLY private role; no fetch activation or public route.
import { WorkerEntrypoint } from 'cloudflare:workers';
import runtime from './private-runtime.cjs';
export class ArchiveGateway extends WorkerEntrypoint { inspectNewManifest(ctx,value){return runtime.gateway(this.env,ctx,'inspectNewManifest',value);} putOriginal(ctx,value){return runtime.gateway(this.env,ctx,'putOriginal',value);} readForCaller(ctx,value){return runtime.gateway(this.env,ctx,'readForCaller',value);} }
export class ArchiveReceiptReader extends WorkerEntrypoint { readOriginal(ctx,value){return runtime.read(this.env,ctx,value);} }
export default {fetch(){return new Response('Not found',{status:404});}};
