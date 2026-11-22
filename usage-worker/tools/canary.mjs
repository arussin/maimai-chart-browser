// Owner-invoked only: one synthetic aggregate count, no credentials or retries.
import {pathToFileURL} from 'node:url';

export async function runCanary(endpoint,fetcher=fetch){
  const url=new URL(endpoint);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||
      url.pathname!=='/__usage'||url.search||url.hash||endpoint.includes('?')||endpoint.includes('#'))
    throw Error('Pass an HTTP(S) /__usage URL without credentials, query or fragment');
  const response=await fetcher(url.href,{
    method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},
    body:JSON.stringify({version:1,events:[{event:'page_view',page:'charts',detail:'',count:1}]}),
    redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000),
  });
  const stored=response.status===204&&response.headers.get('X-Maimai-Usage-Receipt')==='stored'&&
    !response.headers.has('X-Maimai-Usage-Limiter');
  await response.body?.cancel();
  if(!stored)throw Error('Canary failed: require 204, stored receipt and no limiter-unavailable header');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw Error('Usage: node tools/canary.mjs <URL>');
    await runCanary(process.argv[2]);
    console.log('Usage canary passed: 204, stored receipt, limiter available.');
  }catch{
    // Never echo the endpoint, response body or transport exception.
    console.error('Usage canary failed. Require one /__usage URL and a 204 stored receipt without limiter unavailability.');
    process.exitCode=1;
  }
}
