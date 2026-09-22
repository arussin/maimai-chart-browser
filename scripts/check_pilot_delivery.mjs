// Public release verification only; no accounts, imports, analytics or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [root,deployment]=process.argv.slice(2);
if(!/^C:\\DevCache\\/i.test(root||'')||!/^\w{8}-[a-f0-9-]{27}$/.test(deployment||''))throw Error('Expected retained DevCache package and deployment UUID');
const inventory=JSON.parse(await readFile(path.join(root,'public-inventory.json'),'utf8'));
const prefix='pilot/maishift/browser/';
const manifest=JSON.parse(await readFile(path.join(root,'public',prefix,'manifest.json'),'utf8'));
const startup=manifest.releases.find(r=>r.version===manifest.default).startup;
const index=JSON.parse(await readFile(path.join(root,'public',prefix,startup.path),'utf8'));
const detail=Object.values(index.detail_buckets)[0].path;
const files=['index.html','manifest.json',...['index.html','manifest.json','lab-loader.js','challenge-review.js','challenge-review.css','player-data.js','player-data.css','player-sources.js','import-placement.js','player-range-controls.js',startup.path,detail].map(p=>prefix+p)];
const checks=[];
for(const origin of ['https://'+deployment.slice(0,8)+'.maimai-party.pages.dev','https://maimai.party']){
  for(let start=0;start<files.length;start+=3){
    const group=await Promise.all(files.slice(start,start+3).map(async file=>{
      const url=origin+'/'+file.replace(/index\.html$/,'');
      const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
      let bytes=Buffer.from(await response.arrayBuffer()),excluded=0;
      if(file.endsWith('.html')){
        bytes=Buffer.from(bytes.toString('utf8').replace(/<!-- Cloudflare Pages Analytics --><script\b[^>]*src=['"]https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js['"][^>]*><\/script><!-- Cloudflare Pages Analytics -->/g,()=>{excluded++;return '';}));
      }
      const sha=createHash('sha256').update(bytes).digest('hex'),cache=response.headers.get('cache-control');
      const security=Object.fromEntries(['content-security-policy','x-frame-options','x-robots-tag','x-content-type-options','referrer-policy'].map(k=>[k,response.headers.get(k)]));
      let policy=true;
      if(file.startsWith(prefix)){
        const expectedCache=file===prefix+'index.html'?'no-cache':file===prefix+startup.path||file===prefix+detail?'public, max-age=31536000, immutable':'no-store';
        policy=cache===expectedCache&&security['x-frame-options']==='DENY'&&security['x-robots-tag']==='noindex, nofollow'&&security['x-content-type-options']==='nosniff'&&security['referrer-policy']==='no-referrer'&&security['content-security-policy']==="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
      }
      return {origin,file,status:response.status,sha256:sha,expected:inventory[file],analyticsBlocksExcluded:excluded,cache,security,verified:response.ok&&sha===inventory[file]&&excluded<=1&&policy};
    }));checks.push(...group);
  }
}
const result={deployment,verifiedAt:new Date().toISOString(),passed:checks.every(r=>r.verified),checks};
await writeFile(path.join(root,'hosted-assets.json'),JSON.stringify(result,null,2));
if(!result.passed)throw Error(JSON.stringify(checks.filter(r=>!r.verified)));
console.log(JSON.stringify({passed:true,checks:checks.length,deployment}));
