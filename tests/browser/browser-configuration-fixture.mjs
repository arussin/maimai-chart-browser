/** Fictional resource overrides preserve the deployed byte/hash verification contract. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha256=body=>createHash('sha256').update(body).digest('hex');
const fixtureRoot=()=>resolve(process.env.MAIMAI_BROWSER_OUTPUT||fileURLToPath(new URL('../../output/browser-tests/',import.meta.url)));
const fixtureOrigin=()=>`http://127.0.0.1:${process.env.MAIMAI_TEST_PORT||8766}`;
const descriptor=/<script\b(?=[^>]*\bid=["']browser-resources["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([^<]*)<\/script>/g;
const roles={configuration:['json',4],catalog:['json',1],permalinks:['json',2],shell:['html',2],styles:['css',2],seoStyle:['css',2]};
function resourceReference(value,role){
  const [extension,maximum]=roles[role]||[];
  if(!extension||!value||Object.keys(value).length!==3||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>maximum*1024*1024||
    typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||value.path!==`browser-resources/${value.sha256}.${extension}`)
    throw Error('Invalid fixture '+role+' reference');
  return value;
}
const resourcesAt=async directory=>JSON.parse(await readFile(resolve(directory,'browser-resources.json'),'utf8'));

/** Resolve the role in local generated fixture metadata to its exact mounted URL. */
export async function browserResourceURL(role,{fixture='registry',mount='/',origin=fixtureOrigin()}={}){
  const resources=await resourcesAt(resolve(fixtureRoot(),fixture));
  const reference=resourceReference(resources[role],role);
  return new URL(reference.path,new URL(mount,origin)).href;
}

/** All reads are from the generated local fixture; this helper makes no network calls. */
export async function browserJSONResourceFixture(directory,role,update){
  if(!['configuration','catalog','permalinks'].includes(role))throw Error('Expected a JSON fixture resource');
  const resources=await resourcesAt(directory),original=resourceReference(resources[role],role);
  const accepted=await readFile(resolve(directory,original.path));
  if(accepted.length!==original.bytes||sha256(accepted)!==original.sha256)throw Error('Fixture '+role+' integrity mismatch');
  const body=Buffer.from(JSON.stringify(update(JSON.parse(accepted))));
  const hash=sha256(body),reference=resourceReference({path:`browser-resources/${hash}.json`,sha256:hash,bytes:body.length},role);
  return {
    reference,body,
    rewriteDocument(bytes){
      const html=bytes.toString('utf8'),matches=[...html.matchAll(descriptor)];
      if(!matches.length){
        if(html.includes('data-maimai-browser'))throw Error('Browser fixture document lacks its resource descriptor');
        return bytes;
      }
      if(matches.length!==1)throw Error('Browser fixture document has multiple resource descriptors');
      const current=JSON.parse(matches[0][1]),bound=resourceReference(current[role],role);
      if(bound.path!==original.path||bound.sha256!==original.sha256||bound.bytes!==original.bytes)
        throw Error('Browser fixture document belongs to a different '+role);
      const replacement=JSON.stringify({...current,[role]:reference}).replaceAll('<','\\u003c');
      return Buffer.from(html.replace(descriptor,()=>matches[0][0].replace(matches[0][1],()=>replacement)));
    },
  };
}
export const browserConfigurationFixture=(directory,update)=>browserJSONResourceFixture(directory,'configuration',update);

/** Rebind each isolated document to its fixture value; retain prior immutable bytes for in-flight readers. */
export async function mockBrowserJSONResource(surface,role,update,{fixture='registry',mount='/registry/',origin=fixtureOrigin()}={}){
  const directory=resolve(fixtureRoot(),fixture),base=new URL(mount,origin),assets=new Map();
  await surface.route(url=>url.origin===base.origin&&url.pathname.startsWith(base.pathname),async route=>{
    const request=route.request(),url=new URL(request.url());
    if(assets.has(url.href))return route.fulfill({contentType:'application/json',body:assets.get(url.href)});
    if(request.resourceType()!=='document')return route.fallback();
    const response=await route.fetch();
    if(!response.headers()['content-type']?.includes('text/html'))return route.fulfill({response});
    const amended=await browserJSONResourceFixture(directory,role,update);
    assets.set(new URL(amended.reference.path,base).href,amended.body);
    return route.fulfill({response,body:amended.rewriteDocument(await response.body())});
  });
}
export const mockBrowserConfiguration=(context,update)=>mockBrowserJSONResource(context,'configuration',update,{fixture:'lab',mount:'/lab/'});
