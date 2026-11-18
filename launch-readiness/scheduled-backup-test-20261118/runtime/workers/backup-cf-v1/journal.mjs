// SOURCE ONLY private role; no fetch activation or public route.
import { WorkerEntrypoint } from 'cloudflare:workers';
import runtime from './private-runtime.cjs';
export class ArchiveJournal extends WorkerEntrypoint { consumeScheduledTicket(message){return runtime.scheduledClaim(this.env,message);} claimOriginal(ctx,value){return runtime.claim(this.env,ctx,value);} verifyOriginal(ctx,value){return runtime.verified(this.env,ctx,'verifyOriginal',value);} lookupOriginal(ctx,value){return runtime.verified(this.env,ctx,'lookupOriginal',value);} }
export class ArchiveDispatch extends WorkerEntrypoint { consumeOriginalDispatch(ctx,value){return runtime.consume(this.env,ctx,value);} }
export default {fetch(){return new Response('Not found',{status:404});}};
