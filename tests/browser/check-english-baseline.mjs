// Compare independently built, pre-change English fixtures with the candidate.
// Usage: node check-english-baseline.mjs BASELINE_BROWSER_OUTPUT CANDIDATE_BROWSER_OUTPUT
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.MAIMAI_NODE_MODULES_ROOT ? resolve(process.env.MAIMAI_NODE_MODULES_ROOT,'tests/browser/package.json') : new URL('./package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const [baseline,candidate]=process.argv.slice(2).map(p=>resolve(p));
assert(baseline&&candidate,'Pass baseline and candidate fixture directories');
const output=resolve('english-baseline-results');await mkdir(output,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const browser=await chromium.launch();const results=[];
try{
  for(const width of [1280,390,320]){
    const captures=[];
    for(const [name,root] of [['baseline',baseline],['candidate',candidate]]){
      const context=await browser.newContext({viewport:{width,height:900},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce'});
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());if(url.hostname!=='fixture.test')return route.abort();
        // The fixtures assign random stable IDs. Reuse identical baseline data
        // to compare presentation rather than incidental tie ordering by UUID.
        const dataRoot=/\.(json|gz)$/.test(url.pathname)?baseline:root;
        const path=resolve(dataRoot,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
        if(!path.startsWith(dataRoot+sep))return route.abort();
        try{return route.fulfill({body:await readFile(path),contentType:mime[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
      });
      const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto('https://fixture.test/registry/');await page.locator('#songs .song-row').first().waitFor();
      const views={};
      for(const view of ['catalog','patterns','compare','about']){
        await page.locator('#'+view+'-tab').click();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        views[view]=await page.evaluate(()=>{
          const clone=document.body.cloneNode(true);clone.querySelectorAll('script,style,.language-controls').forEach(node=>node.remove());
          const geometry=[...document.querySelectorAll('.site-header,.brand,main,[id],.song-row,.chart-row')].filter(node=>
            !node.closest('.language-controls') && !['SCRIPT','STYLE','OPTION'].includes(node.tagName) && node.getBoundingClientRect().height>0
          ).map(node=>{const r=node.getBoundingClientRect();return {id:node.id,cls:node.className,x:r.x,y:r.y,w:r.width,h:r.height};});
          return {text:clone.textContent,geometry};
        });
      }
      if(name==='candidate'){
        await page.locator('#catalog-tab').click();
        for(const locale of ['en','zh-Hans','ko','ja']){await page.locator('[data-language="'+locale+'"]').click();await page.screenshot({path:resolve(output,locale+'-'+width+'.png'),fullPage:false});}
      }
      captures.push(views);await context.close();
    }
    for(const view of Object.keys(captures[0])){
      const before=captures[0][view],after=captures[1][view];
      const entry={width,view,textEqual:before.text===after.text,geometryEqual:JSON.stringify(before.geometry)===JSON.stringify(after.geometry)};
      if(!entry.textEqual || !entry.geometryEqual)await writeFile(resolve(output,view+'-'+width+'.json'),JSON.stringify({before,after},null,2));
      results.push(entry);
    }
  }
  await writeFile(resolve(output,'comparison.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  assert(results.every(r=>r.textEqual&&r.geometryEqual),'English text or existing element geometry differs; inspect comparison artifacts');
}finally{await browser.close();}
