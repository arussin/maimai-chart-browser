// Manual visual review of the local proposal; not a release or live account test.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
const require=createRequire(path.join(process.env.MAIMAI_NODE_MODULES_ROOT,'tests/browser/package.json'));
const {chromium,webkit,expect}=require('@playwright/test');
const output=process.env.IMPORT_PREVIEW_RESULTS;
const previewOrigin=process.env.IMPORT_PREVIEW_ORIGIN||'http://127.0.0.1:8897';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(previewOrigin))throw Error('A local preview origin is required');
if(!/^C:\\DevCache\\/i.test(output||''))throw Error('DevCache results are required');
await mkdir(output,{recursive:true});
const results=[];
async function importFictional(page,rates,updatedAt){
  const data=await page.evaluate(async({rates,updatedAt})=>{
    const rows=Object.entries(maimaiResearchCatalog.maishift_mapping.charts).filter(([id,row])=>id.startsWith('maishift:intl:')&&row.expected_source.difficulty==='MASTER').slice(0,5);
    const envelope={schemaVersion:1,adapterVersion:2,provider:'maishift',identity:{handle:'fictional-range-review',region:'intl',displayName:'Fictional range review',createdAt:1,updatedAt,rating:15000},coverage:{kind:'partial',totalCharts:5,playedCharts:5,importedCharts:5,diagnosticCount:0},diagnostics:[],records:rows.map(([id,row],index)=>({id:id.split(':')[2],...row.expected_source,level:'14',constant:null,achievement:[800000,970000,990001,1005000,null][index],rate:rates[index],lamp:'',sync:'',dxScore:null,maxDxScore:null}))};
    return (await maimaiPlayerMaishift.normalize(envelope,{handle:'fictional-range-review',region:'intl'})).data;
  },{rates,updatedAt});
  await page.locator('input[type=file]').setInputFiles({name:'fictional-range-review.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.getByRole('heading',{name:'Import this profile?',exact:true}).waitFor();
  await page.locator('.player-remember input').uncheck();await page.getByRole('button',{name:'Import data',exact:true}).click();
  await page.waitForFunction(()=>maimaiPersonal.enabled());
}
async function checkRanges(page,engine){
  await importFictional(page,[0,150,240,315,null],100000);
  const disclosure=page.locator('.player-filters .player-filter-toggle');if(await disclosure.getAttribute('aria-expanded')==='false')await disclosure.click();
  const min=page.locator('#personal-min'),max=page.locator('#personal-max'),rate=page.locator('#personal-rateMin');
  const lowSlider=page.locator('#personal-min-slider'),highSlider=page.locator('#personal-max-slider'),rateSlider=page.locator('#personal-rateMin-slider');
  await expect(rateSlider).toHaveAttribute('min','0');await expect(rateSlider).toHaveAttribute('max','315');
  await expect(rate).toHaveValue('');await expect(min).toHaveValue('');
  // Native thumbs travel from half a thumb inside each input edge. Verify that
  // those positions coincide with the separately drawn track, not a shorter box.
  for(const width of [320,537,1024,1280]){
    await page.setViewportSize({width,height:1000});
    const endpoints=await page.locator('.personal-range-slider').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),track=n.parentElement.getBoundingClientRect();return Math.abs(r.left+9-track.left)<1&&Math.abs(r.right-9-track.right)<1;}));
    expect(endpoints).toEqual([true,true,true,true]);
  }
  const revision=await page.evaluate(()=>sessionStorage.getItem('maimai-pilot-maishift-v1:maimai-player-session'));
  expect(revision).not.toBeNull();
  await min.fill('99.0001');await expect(min).toHaveValue('99.0001');
  expect(await page.evaluate(()=>maimaiResearchCatalog.catalog.filter(c=>maimaiPersonal.record(c)&&maimaiPersonal.matches(c)).map(c=>maimaiPersonal.record(c).achievement).sort((a,b)=>a-b))).toEqual([990001,1005000]);
  await expect(rateSlider).toHaveAttribute('min','0');await expect(rateSlider).toHaveAttribute('max','315');
  await min.fill('99.1234');await lowSlider.press('ArrowRight');await expect(min).toHaveValue('99.5');
  await min.fill('97');await lowSlider.press('ArrowLeft');await expect(min).toHaveValue('94');
  await page.locator('[data-range=achievement] button').click();await expect(min).toHaveValue('');await expect(max).toHaveValue('');
  await lowSlider.press('End');await expect(min).toHaveValue('101');await lowSlider.press('Home');await expect(min).toHaveValue('0');
  await highSlider.press('Home');await expect(max).toHaveValue('0');await highSlider.press('End');await expect(max).toHaveValue('101');
  await page.locator('[data-range=achievement] button').click();
  await lowSlider.scrollIntoViewIfNeeded();const box=await lowSlider.boundingBox();
  await page.mouse.move(box.x+9,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+9+(box.width-18)*13/14,box.y+box.height/2,{steps:12});await page.mouse.up();
  await expect(min).toHaveValue('100.5');await highSlider.press('ArrowLeft');await expect(max).toHaveValue('100.5');await highSlider.press('ArrowLeft');await expect(max).toHaveValue('100.5');
  await page.locator('[data-range=achievement] button').click();await rate.fill('240');await rateSlider.press('ArrowRight');await expect(rate).toHaveValue('241');
  await rateSlider.press('End');await expect(rate).toHaveValue('315');await rateSlider.press('Home');await expect(rate).toHaveValue('0');
  const rateHigh=page.locator('#personal-rateMax-slider');await rateHigh.press('Home');await expect(page.locator('#personal-rateMax')).toHaveValue('0');await rateHigh.press('End');await expect(page.locator('#personal-rateMax')).toHaveValue('315');
  await page.locator('.player-clear-filters').click();await expect(rate).toHaveValue('');await expect(min).toHaveValue('');await expect(lowSlider).toHaveValue('0');
  expect(await page.evaluate(()=>sessionStorage.getItem('maimai-pilot-maishift-v1:maimai-player-session'))).toBe(revision);
  await min.fill('97');await max.fill('100.5');await rate.fill('150');
  for(const width of [320,537,1280]){
    await page.setViewportSize({width,height:1000});
    for(const locale of ['en','zh-Hans','ko','ja']){
      await page.locator('.site-header [data-language='+locale+']').click();await page.locator('.personal-range-sections').scrollIntoViewIfNeeded();
      const layout=await page.locator('.personal-range-sections').evaluate(root=>{
        const inputs=[...root.querySelectorAll('input[type=number],button,h3,.personal-range-hint')];
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,clipped:inputs.some(n=>n.scrollWidth>n.clientWidth+1),cards:[...root.children].every(n=>n.getBoundingClientRect().width<=root.getBoundingClientRect().width+1),sliders:root.querySelectorAll('input[type=range]').length};
      });
      expect(layout).toEqual({overflow:false,clipped:false,cards:true,sliders:4});
      await page.screenshot({path:path.join(output,`${engine}-ranges-${locale}-${width}.png`)});
    }
  }
  await page.locator('.site-header [data-language=en]').click();await rate.fill('240');
  await importFictional(page,[100,200,250,400,null],200000);await expect(rateSlider).toHaveAttribute('min','100');await expect(rateSlider).toHaveAttribute('max','400');await expect(rate).toHaveValue('240');
  await importFictional(page,[220,null,null,null,null],300000);await expect(rateSlider).toBeDisabled();await expect(rate).toHaveAttribute('placeholder','220');
  await importFictional(page,[null,null,null,null,null],400000);await expect(rateSlider).toBeDisabled();await expect(rate).toBeDisabled();await expect(page.locator('[data-range=rating] .personal-range-hint')).toHaveText('No known chart ratings in this import.');
}
async function checkReportRecovery(page,engine){
  let reads=0;await page.route('https://public-report.example/**',route=>{reads++;return route.abort();});
  for(const width of [320,430,1280])for(const locale of ['en','zh-Hans','ko','ja']){
    await page.setViewportSize({width,height:932});await page.locator('.site-header [data-language='+locale+']').click();await page.locator('#player-import-primary').click();
    await page.locator('input[value=report]').check();await page.locator('#player-report-url').fill('https://public-report.example/fixture');await page.locator('.player-dialog .player-actions button').first().click();
    const link=page.locator('.player-message-actions>a');await expect(link).toBeVisible();await expect(link).toHaveAttribute('href','https://public-report.example/fixture');
    const layout=await page.locator('.player-message-actions').evaluate(root=>{const a=root.querySelector('a'),b=root.querySelector('button'),ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return {separated:ar.right+10<=br.left||ar.bottom+10<=br.top||br.bottom+10<=ar.top,targets:[a,b].every(n=>n.getBoundingClientRect().height>=44),clipped:[a,b].some(n=>n.scrollWidth>n.clientWidth+1),overflow:document.documentElement.scrollWidth>innerWidth+1};});
    expect(layout).toEqual({separated:true,targets:true,clipped:false,overflow:false});
    await page.keyboard.press('Shift+Tab');await expect(link).toBeFocused();
    if(width===430)await page.screenshot({path:path.join(output,`${engine}-report-recovery-${locale}.png`)});
    await page.keyboard.press('Escape');
  }
  expect(reads).toBe(12);await page.unroute('https://public-report.example/**');
}
for(const [engine,type]of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome'}:{});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),unexpected=[],errors=[];
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
    await context.route('**/*',route=>new URL(route.request().url()).origin===previewOrigin?route.continue():(unexpected.push(route.request().url()),route.abort()));
    await page.goto(previewOrigin+'/pilot/maishift/browser/?view=catalog');
    await page.waitForFunction(()=>window.maimaiPersonal&&window.maimaiResearchCatalog?.catalog?.length>0);
    await page.locator('#lab-status').waitFor({state:'hidden'});
    for(const width of process.env.IMPORT_PREVIEW_RANGES_ONLY?[]:[320,390,537,600,740,800,1024,1280]){
      await page.setViewportSize({width,height:900});
      for(const locale of ['en','zh-Hans','ko','ja']){
        await page.locator('.site-header [data-language="'+locale+'"]').click();
        const layout=await page.evaluate(()=>{
          const button=document.querySelector('#player-import-primary'),total=document.querySelector('.catalog-total'),count=document.querySelector('#catalog-count');
          const toggle=document.querySelector('.sort-toolbar>.check'),rules=document.getElementById('sort-rules');
          const nodes=[button,count,document.querySelector('#catalog h1'),toggle],rects=nodes.map(n=>n.getBoundingClientRect());
          const clipped=nodes.some((n,i)=>{const r=document.createRange();r.selectNodeContents(n);const b=rects[i];return n.scrollWidth>n.clientWidth+1||[...r.getClientRects()].some(t=>t.width&&(t.left<b.left-1||t.right>b.right+1||t.top<b.top-1||t.bottom>b.bottom+1));});
          const sortAligned=Math.abs((rects[1].top+rects[1].bottom-rects[3].top-rects[3].bottom)/2)<1&&rects[1].left>=rects[3].right;
          const rulesBelow=rules.getBoundingClientRect().top>=Math.max(rects[1].bottom,rects[3].bottom);
          return {clipped,sortAligned,rulesBelow,overflow:document.documentElement.scrollWidth>innerWidth+1,topCountHidden:!total.getClientRects().length,numberBold:getComputedStyle(count.querySelector('strong')).fontWeight==='700',labelNormal:getComputedStyle(count.querySelector('span')).fontWeight==='400',simpleLabel:count.querySelector('span').textContent===maimaiI18n.translate('charts'),visible:rects[0].height>=44&&rects[1].height>0,navButton:!!document.querySelector('.site-header #player-import-primary'),banner:!!document.querySelector('#maishift-browser-pilot'),color:getComputedStyle(button).backgroundColor};
        });
        if(JSON.stringify(layout)!==JSON.stringify({clipped:false,sortAligned:true,rulesBelow:true,overflow:false,topCountHidden:true,numberBold:true,labelNormal:true,simpleLabel:true,visible:true,navButton:false,banner:false,color:'rgb(21, 40, 59)'}))throw Error(engine+' '+locale+' '+width+' '+JSON.stringify(layout));
        results.push({engine,locale,width,passed:true});
        if([320,390,537,1280].includes(width))await page.screenshot({path:path.join(output,`${engine}-${locale}-${width}.png`)});
      }
    }
    await page.locator('.site-header [data-language=en]').click();
    await page.locator('#search').fill('no-chart-matches-this-fictional-query');
    await page.waitForFunction(()=>document.querySelector('#catalog-count')?.textContent==='0 charts');
    await page.locator('#search').fill('');
    await page.waitForFunction(()=>document.querySelector('#catalog-count strong')?.textContent!=='0');
    await page.locator('#player-import-primary').click();
    if(!await page.getByRole('heading',{name:'Import player data',exact:true}).isVisible())throw Error('Import dialog unavailable');
    await page.keyboard.press('Escape');await checkRanges(page,engine);await checkReportRecovery(page,engine);if(unexpected.length)throw Error('Unexpected external request');if(errors.length)throw Error('Unexpected page errors: '+errors.join('; '));
    await context.close();
  }finally{await browser.close();}
}
await writeFile(path.join(output,'layout-checks.json'),JSON.stringify({checks:results,rangeLayouts:24,reportRecoveryLayouts:24,rangeInteractions:['precision','grade stepping','pointer snapping','crossing prevention','rating bounds','unchanged storage','clear','source changes','single rating','unknown ratings'],liveReads:0,release:false},null,2));
console.log(JSON.stringify({layoutChecks:results.length,rangeLayouts:24,reportRecoveryLayouts:24,rangeInteractions:['precision','grade stepping','pointer snapping','crossing prevention','rating bounds','unchanged storage','clear','source changes','single rating','unknown ratings'],engines:['Chrome','WebKit'],languages:4,widths:8,output,liveReads:0}));
