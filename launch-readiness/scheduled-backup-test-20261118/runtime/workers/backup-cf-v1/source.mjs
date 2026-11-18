// SOURCE ONLY private role; no fetch activation or public route.
import { WorkerEntrypoint } from 'cloudflare:workers';
import runtime from './private-runtime.cjs';
export class SourcePhotos extends WorkerEntrypoint { capture(ctx){return runtime.source(this.env,ctx,'capture');} recheckBeforeManifest(ctx,value){return runtime.source(this.env,ctx,'recheckBeforeManifest',value);} recheckFinal(ctx,value){return runtime.source(this.env,ctx,'recheckFinal',value);} }
export default {fetch(){return new Response('Not found',{status:404});}};
