// Bounded, fresh-context measurements: public assets only, no live player reads.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(process.env.MAIMAI_NODE_MODULES_ROOT,'tests/browser/package.json'));
const {chromium}=require('@playwright/test');
const target=new URL(process.env.PILOT_PROFILE_URL||'https://maimai.party/pilot/maishift/browser/?view=catalog');
const output=process.env.PILOT_PROFILE_OUTPUT;
if(!/^C:\\DevCache\\/i.test(output||'')||!(target.hostname==='maimai.party'||target.hostname.endsWith('.maimai-party.pages.dev')||target.hostname==='127.0.0.1'))throw Error('Use an approved pilot URL and DevCache output');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try{
  for(const rate of (process.env.PILOT_PROFILE_RATES||'1,4').split(',').map(Number)){
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
    const session=await context.newCDPSession(page),blocked=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await session.send('Network.enable');
    // Block analytics and every account/proxy destination without disabling cache.
    await session.send('Network.setBlockedURLs',{urls:['*://*.shiftpsh.com/*','*/api/*','*://static.cloudflareinsights.com/*','*://www.google-analytics.com/*','*://www.googletagmanager.com/*']});
    await session.send('Emulation.setCPUThrottlingRate',{rate});
    await page.addInitScript(()=>{
      window.pilotTiming={longTasks:[],events:[],lcp:0,shifts:0};
      new PerformanceObserver(list=>{for(const e of list.getEntries())pilotTiming.longTasks.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
      new PerformanceObserver(list=>{for(const e of list.getEntries())pilotTiming.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)pilotTiming.shifts+=e.value;}).observe({type:'layout-shift',buffered:true});
      for(const type of ['input','click','change'])document.addEventListener(type,e=>{
        if(!e.target.closest('#search,[data-sort-key],.row-difficulty,#more,#filter-min'))return;
        const start=performance.now(),label=e.target.id||e.target.dataset.sortKey||e.target.className;
        requestAnimationFrame(()=>requestAnimationFrame(()=>pilotTiming.events.push({type,label,ms:performance.now()-start})));
      },true);
    });
    await session.send('Profiler.enable');await session.send('Profiler.start');
    await page.goto(target.href,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelectorAll('#songs .song-row').length===40,{},{timeout:60000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const startup=await page.evaluate(()=>({readyMs:performance.now(),timing:structuredClone(pilotTiming),navigation:performance.getEntriesByType('navigation')[0].toJSON(),resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,ms:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize})),domNodes:document.querySelectorAll('*').length}));
    const startupProfile=(await session.send('Profiler.stop')).profile;
    await writeFile(path.join(output,`startup-${rate}.cpuprofile`),JSON.stringify(startupProfile));
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelectorAll('#songs .song-row').length===40,{},{timeout:60000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const reload=await page.evaluate(()=>({readyMs:performance.now(),timing:structuredClone(pilotTiming),resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,ms:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize}))}));
    await session.send('Profiler.start');
    async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
    for(const value of ['s','so','ソテリア','']){await page.locator('#search').fill(value);await settle();}
    await page.locator('[data-sort-key=difficulty]').click();await settle();
    await page.locator('[data-sort-key=title]').click();await settle();
    await page.locator('#more').click();await settle();
    await page.locator('#more').click();await settle();
    await page.locator('#search').fill('ソテリア');await settle();
    const picker=page.locator('.row-difficulty').first(),options=await picker.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
    if(options.length>1){await picker.selectOption(options.at(-1));await settle();}
    const runtime=await page.evaluate(()=>({timing:structuredClone(pilotTiming),domNodes:document.querySelectorAll('*').length}));
    const profile=(await session.send('Profiler.stop')).profile;
    await writeFile(path.join(output,`interactions-${rate}.cpuprofile`),JSON.stringify(profile));
    function hot(profile){const times=new Map();profile.samples?.forEach((id,i)=>times.set(id,(times.get(id)||0)+(profile.timeDeltas?.[i]||0)));return profile.nodes.map(n=>({fn:n.callFrame.functionName,path:n.callFrame.url?new URL(n.callFrame.url,target).pathname:'',line:n.callFrame.lineNumber+1,selfMs:(times.get(n.id)||0)/1000})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,25);}
    const result={rate,startup,reload,runtime,startupHot:hot(startupProfile),interactionHot:hot(profile),errors,blocked};results.push(result);
    console.log(JSON.stringify({rate,readyMs:startup.readyMs,reloadMs:reload.readyMs,lcp:startup.timing.lcp,longTasks:startup.timing.longTasks,events:runtime.timing.events,startupHot:result.startupHot.slice(0,8),interactionHot:result.interactionHot.slice(0,8),bytes:startup.resources.reduce((sum,r)=>sum+r.transfer,0),reloadBytes:reload.resources.reduce((sum,r)=>sum+r.transfer,0),errors}));
    await context.close();
  }
}finally{await browser.close();}
await writeFile(path.join(output,'profile.json'),JSON.stringify({target:target.href,fieldMetrics:false,results},null,2));
