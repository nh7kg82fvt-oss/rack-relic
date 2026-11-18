// SOURCE ONLY private role; no fetch activation or public route.
import runtime from './private-runtime.cjs';
// No direct Caller RPC entrypoint: the scheduled durable admission is mandatory.
export default {async scheduled(controller,env){return runtime.scheduled(env,controller);},fetch(){return new Response('Not found',{status:404});}};
