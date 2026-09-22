import {test,expect} from './fixtures.js';
import {gzipSync} from 'node:zlib';
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
async function openRanges(page){
  await page.goto('/maishift-pilot/pilot/maishift/browser/');await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden();
  await importFictional(page,[0,150,240,315,null],100000);
  const disclosure=page.locator('.player-filters .player-filter-toggle');if(await disclosure.getAttribute('aria-expanded')==='false')await disclosure.click();
}
async function checkRanges(page){
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
  await rate.fill('240');
  await test.step('Rating domain changes retain the selected filter',async()=>{
    await importFictional(page,[100,200,250,400,null],200000);await expect(rateSlider).toHaveAttribute('min','100');await expect(rateSlider).toHaveAttribute('max','400');await expect(rate).toHaveValue('240');
  });
  await test.step('Single known rating disables the slider',async()=>{
    await importFictional(page,[220,null,null,null,null],300000);await expect(rateSlider).toBeDisabled();await expect(rate).toHaveAttribute('placeholder','220');
  });
  await test.step('Unknown ratings disable the rating controls',async()=>{
    await importFictional(page,[null,null,null,null,null],400000);await expect(rateSlider).toBeDisabled();await expect(rate).toBeDisabled();await expect(page.locator('[data-range=rating] .personal-range-hint')).toHaveText('No known chart ratings in this import.');
  });
}

test('personal ranges preserve precision, grade stops and rating domains',async({page})=>{
  await test.step('Open ranges with fictional player data',()=>openRanges(page));
  await checkRanges(page);
});

// Keep screenshot/font/layout work out of the behavior test's 30-second budget.
// Each width has its own fixture and still covers all four locales.
for(const width of [320,537,1280]){
  test(`personal range layouts fit all languages at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:1000});
    await test.step('Open ranges with fictional player data',()=>openRanges(page));
    await page.locator('#personal-min').fill('97');await page.locator('#personal-max').fill('100.5');await page.locator('#personal-rateMin').fill('150');
    for(const locale of ['en','zh-Hans','ko','ja'])await test.step(`${locale} layout and screenshot`,async()=>{
      await page.locator('.site-header [data-language='+locale+']').click();await page.locator('.personal-range-sections').scrollIntoViewIfNeeded();
      const layout=await page.locator('.personal-range-sections').evaluate(root=>{
        const inputs=[...root.querySelectorAll('input[type=number],button,h3,.personal-range-hint')];
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,clipped:inputs.some(n=>n.scrollWidth>n.clientWidth+1),cards:[...root.children].every(n=>n.getBoundingClientRect().width<=root.getBoundingClientRect().width+1),sliders:root.querySelectorAll('input[type=range]').length};
      });
      expect(layout).toEqual({overflow:false,clipped:false,cards:true,sliders:4});
      await page.screenshot({path:testInfo.outputPath(`ranges-${locale}-${width}.png`)});
    });
  });
}

test('production enables Maishift without adopting pilot storage or launching a request',async({page})=>{
  const requests=[];page.on('request',r=>{if(r.url().includes('/api/player-import'))requests.push(r.url());});
  await page.goto('/production/');await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden();
  expect(await page.evaluate(()=>({enabled:maimaiPlayerSources.capabilities.maishift,pilot:globalThis.maimaiPlayerContext?.pilot===true}))).toEqual({enabled:true,pilot:false});
  await expect(page.locator('.feature-announcement')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.feature-announcement')).toBeHidden();
  await page.locator('#player-import-primary').click();await page.locator('input[value=maishift]').check();await page.locator('#player-maishift-url').fill('fictional-player');await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();expect(requests).toEqual([]);
  await page.keyboard.press('Escape');
  const stores=await page.evaluate(async()=>indexedDB.databases());expect(stores.some(s=>s.name==='maimai-player-data')).toBe(true);expect(stores.some(s=>s.name.includes('pilot'))).toBe(false);
});
