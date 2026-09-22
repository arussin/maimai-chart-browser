// Deterministic verification of the actual pilot package; no upstream accounts.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
const require=createRequire(path.join(process.env.MAIMAI_NODE_MODULES_ROOT,'tests/browser/package.json'));
const {chromium,firefox,webkit,expect}=require('@playwright/test');
const origin=process.env.IMPORT_PREVIEW_ORIGIN,output=process.env.IMPORT_PREVIEW_RESULTS;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||'')||!/^C:\\DevCache\\/i.test(output||''))throw Error('Local preview and DevCache results required');
await mkdir(output,{recursive:true});const results=[];
for(const [engine,type,options]of [['chrome',chromium,{channel:'chrome'}],['edge',chromium,{channel:'msedge'}],['firefox',firefox,{}],['webkit',webkit,{}]]){
  const browser=await type.launch({headless:true,...options});
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    const requested=[];page.on('request',r=>requested.push(r.url()));
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(new URL(route.request().url()).origin);return route.abort();}return route.continue();});
    await page.goto(origin+'/pilot/maishift/browser/?view=catalog');await page.waitForFunction(()=>window.maimaiResearchCatalog?.catalog?.length>7000);
    await expect(page.locator('.pilot-notice')).toHaveCount(0);await expect(page.locator('#player-import-primary')).toBeVisible();
    const fingerprint=await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog));
    const controller=await page.locator('link[rel=preload][as=script][href^="challenge-review.js"]').getAttribute('href');
    expect(requested.some(url=>new URL(url).pathname.endsWith('/challenge-review.js')&&url.endsWith(controller))).toBe(true);
    for(const width of [320,1280])for(const locale of ['en','zh-Hans','ko','ja']){
      await page.setViewportSize({width,height:932});await page.locator('.site-header [data-language="'+locale+'"]').click();
      await page.locator('#search').fill('馬と鹿');
      const row=page.locator('#songs .song-row').first(),title=row.locator('.song-title'),reading=row.locator('.song-romaji');
      await expect(title).toHaveText('馬と鹿');await expect(reading).toHaveText('Uma to Shika');
      if(locale==='en')await expect(reading).toBeVisible();else await expect(reading).toBeHidden();
      expect(await row.evaluate(n=>{const t=n.querySelector('.song-title'),r=n.querySelector('.song-romaji');return document.documentElement.scrollWidth<=innerWidth+1&&parseFloat(getComputedStyle(t).fontSize)>parseFloat(getComputedStyle(r).fontSize)&&[t,r].every(e=>!e.clientWidth||e.scrollWidth<=e.clientWidth+1);})).toBe(true);
      if(locale==='en'&&engine==='chrome')await page.screenshot({path:path.join(output,`pronunciation-${width}.png`)});
    }
    await page.locator('.site-header [data-language=en]').click();
    await page.locator('#search').fill('uma to shika');await expect(page.locator('#songs .song-row').first().locator('.song-title')).toHaveText('馬と鹿');
    await page.locator('#search').fill('ソテリア');
    const rows=page.locator('#songs .song-row');await expect(rows).not.toHaveCount(0);
    const levels=await rows.evaluateAll(rows=>rows.map(r=>parseFloat(r.dataset.level)+(r.dataset.level.includes('+')?.5:0)));
    expect(levels).toEqual([...levels].sort((a,b)=>b-a));expect(new Set(await rows.evaluateAll(rows=>rows.map(r=>r.dataset.chartId))).size).toBe(await rows.count());
    for(const width of [320,1280])for(const locale of ['en','zh-Hans','ko','ja']){
      await page.setViewportSize({width,height:932});await page.locator('.site-header [data-language="'+locale+'"]').click();
      const title=rows.first().locator('.song-title'),romaji=rows.first().locator('.song-romaji');
      await expect(title).toHaveText('ソテリア');if(locale==='en')await expect(romaji).toBeVisible();else await expect(romaji).toBeHidden();
      const layout=await rows.first().evaluate(row=>{const title=row.querySelector('.song-title'),roman=row.querySelector('.song-romaji');return {overflow:document.documentElement.scrollWidth>innerWidth+1,titleDominant:parseFloat(getComputedStyle(title).fontSize)>parseFloat(getComputedStyle(roman).fontSize),clipped:[title,roman,row.querySelector('.row-difficulty')].some(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+1)};});
      expect(layout).toEqual({overflow:false,titleDominant:true,clipped:false});
      const row=rows.first(),picker=row.locator('.row-difficulty'),ids=await picker.locator('option').evaluateAll(options=>options.map(n=>n.value));
      await picker.focus();const before=await row.evaluate(n=>({y:n.getBoundingClientRect().y,scroll:scrollY}));
      await picker.selectOption(ids.at(-1));await expect(row).toHaveAttribute('data-chart-id',ids.at(-1));await expect(picker).toBeFocused();
      expect(await row.evaluate(n=>n.getBoundingClientRect().y)).toBeCloseTo(before.y,0);expect(await page.evaluate(()=>scrollY)).toBe(before.scroll);
      await picker.selectOption(ids[0]);
      results.push({engine,width,locale,...layout});
      if(locale==='en'){await rows.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${engine}-title-${width}.png`)});}
    }
    await page.locator('.site-header [data-language=en]').click();await page.locator('#search').fill('');
    const filter=page.locator('#catalog-filters-toggle');if(await filter.getAttribute('aria-expanded')==='false')await filter.click();
    await page.locator('#filter-min').fill('14+');await page.locator('#filter-min').press('Enter');await page.locator('#filter-max').fill('15');await page.locator('#filter-max').press('Enter');
    const matches=await page.evaluate(()=>maimaiResearchCatalog.catalog.filter(c=>['14+','15'].includes(c.level)).length);
    await expect(page.locator('#catalog-count')).toContainText(String(matches));
    expect(await rows.evaluateAll(rows=>rows.every(r=>['14+','15'].includes(r.dataset.level)))).toBe(true);
    await page.locator('#reset-filters').click();
    const data=await page.evaluate(async()=>{
      const rows=Object.entries(maimaiResearchCatalog.maishift_mapping.charts).filter(([id,row])=>id.startsWith('maishift:intl:')&&row.expected_source.difficulty==='MASTER').slice(0,5);
      const e={schemaVersion:1,adapterVersion:2,provider:'maishift',identity:{handle:'fictional-badge-review',region:'intl',displayName:'Fictional badge review',createdAt:1,updatedAt:100000,rating:15000},coverage:{kind:'partial',totalCharts:5,playedCharts:5,importedCharts:5,diagnosticCount:0},diagnostics:[],records:rows.map(([id,row],i)=>({id:id.split(':')[2],...row.expected_source,level:'14',constant:null,achievement:1005000,rate:315,lamp:['FULL_COMBO','FULL_COMBO_PLUS','ALL_PERFECT','ALL_PERFECT_PLUS',''][i],sync:['FULL_SYNC','FULL_SYNC_PLUS','FULL_SYNC_DX','FULL_SYNC_DX_PLUS','SYNC_PLAY'][i],dxScore:null,maxDxScore:null}))};
      return (await maimaiPlayerMaishift.normalize(e,{handle:e.identity.handle,region:'intl'})).data;
    });
    await page.locator('input[type=file]').setInputFiles({name:'fictional-badges.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
    await page.getByRole('heading',{name:'Import this profile?',exact:true}).waitFor();await page.locator('.player-remember input').uncheck();await page.getByRole('button',{name:'Import data',exact:true}).click();
    await page.getByRole('button',{name:'My PBs',exact:true}).click();await expect(rows).toHaveCount(5);
    await expect(rows.locator('.player-icon')).toHaveCount(9);
    const personal=page.locator('.player-filters .player-filter-toggle');if(await personal.getAttribute('aria-expanded')==='false')await personal.click();
    for(const width of [320,1280])for(const locale of ['en','zh-Hans','ko','ja'])for(const field of ['lamp','sync']){
      await page.setViewportSize({width,height:932});await page.locator('.site-header [data-language="'+locale+'"]').click();
      await page.locator('#personal-'+field+'-button').click();const menu=page.locator('#personal-'+field+'-choices');await expect(menu).toBeVisible();
      await expect(menu.locator('.player-icon')).toHaveCount(field==='lamp'?4:5);
      expect(await menu.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&[...n.querySelectorAll('button')].every(b=>b.scrollWidth<=b.clientWidth+1);})).toBe(true);
      if(locale==='en'&&engine==='chrome')await page.screenshot({path:path.join(output,`${engine}-${field}-${width}.png`)});
      await page.keyboard.press('Escape');
    }
    await page.locator('.site-header [data-language=en]').click();
    await page.locator('#personal-lamp-button').click();await page.locator('#personal-lamp-choices [data-value="ALL PERFECT+"]').click();await expect(rows).toHaveCount(1);await expect(rows.locator('[data-icon="ap+"]')).toBeVisible();await expect(rows.locator('[data-icon="fdx+"]')).toBeVisible();
    await page.locator('#personal-lamp-button').click();await page.locator('#personal-lamp-choices [data-value=""]').click();await page.locator('#personal-sync-button').click();await page.locator('#personal-sync-choices [data-value=SYNC]').click();await expect(rows).toHaveCount(1);await expect(rows.locator('[data-icon=sync]')).toBeVisible();
    expect(await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog))).toBe(fingerprint);expect(errors).toEqual([]);expect(external).toEqual([]);
    await context.close();
  }finally{await browser.close();}
}
await writeFile(path.join(output,'results-ui.json'),JSON.stringify({passed:true,layouts:results.length,badgeMenus:64,engines:4,results},null,2));
console.log(JSON.stringify({passed:true,layouts:results.length,badgeMenus:64,engines:4}));
