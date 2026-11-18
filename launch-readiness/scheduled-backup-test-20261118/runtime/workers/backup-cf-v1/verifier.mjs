// SOURCE ONLY private role; no fetch activation or public route.
import { WorkerEntrypoint } from 'cloudflare:workers';
import runtime from './private-runtime.cjs';
export class BackupVerifier extends WorkerEntrypoint { issue(ctx,value){return runtime.issue(this.env,ctx,value);} }
export default {fetch(){return new Response('Not found',{status:404});}};
