import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createService,PATH} from '../../player-import-worker/index.mjs';
import {publicProfile,wire} from '../../player-import-worker/fixtures.mjs';
const entry='/maishift-pilot/pilot/maishift/browser/';
const saved=page=>page.evaluate(()=>maimaiPlayerStorage.read());
const fixture=async()=>JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
async function boot(page){await page.goto(entry);await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden();}
async function setup(page,context,locale='en'){
  const root=process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests';
  const config=JSON.parse(await readFile(path.join(root,'maishift-pilot/pilot/maishift/mapping.json'),'utf8'));
  const [id,row]=Object.entries(config.mapping.charts).find(([id,r])=>id.startsWith('maishift:intl:')&&r.expected_source.difficulty==='MASTER');
  const profile=publicProfile(),tracks={songs:[{...row.expected_source,type:row.expected_source.format==='STD'?'STANDARD':'DX'}],tracks:[{s:0,i:Number(id.split(':')[2]),d:'MASTER',r:{a:987654,d:100,m:300,g:315.789}}]};
  const state={profile,tracks,calls:0,hold:null,status:200,external:[],chart:row.chart_id,requests:[]};
  await context.addInitScript(locale=>localStorage.setItem('maimai-language-v1',locale),locale);
  await context.addCookies([{name:'unrelated-session',value:'fictional-cookie',url:'http://127.0.0.1:'+(process.env.MAIMAI_TEST_PORT||8766)}]);
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname!=='127.0.0.1'){state.external.push(url.origin);await route.abort();return;}
    if(url.pathname!==PATH){await route.continue();return;}
    const headers=await req.allHeaders();for(const key of ['cookie','authorization','referer'])expect(headers[key]).toBeUndefined();
    state.calls++;state.requests.push(JSON.parse(req.postData()));if(state.hold)await state.hold;
    if(state.status!==200){await route.fulfill({status:state.status,headers:{'Retry-After':'120'},contentType:'application/json',body:'{"error":"upstream_busy"}'});return;}
    const values=[profile,tracks,profile],service=createService({fetcher:async()=>Response.json(wire(values.shift()))});
    const response=await service.fetch(new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:req.postData()}),{MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'fictional'}),finish:async()=>{}})}});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await page.clock.install();await boot(page);return state;
}
async function importData(page,remember=true,expectedRating=15432){
  await page.locator('#player-import-primary').click();await page.locator('input[value=maishift]').check();
  await page.locator('#player-maishift-url').fill('fictional-player');await page.locator('.player-actions button').first().click();
  await expect(page.locator('.player-profile-name').last()).toHaveText('Fictional Player');
  await expect(page.locator('.player-dialog .player-rating')).toHaveAttribute('aria-label',expectedRating==null?'Rating unknown':'Maishift rating '+expectedRating);
  await page.locator('.player-dialog .player-remember input').setChecked(remember);await page.locator('.player-dialog .player-actions button').first().click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
}
async function menu(page,id){await page.locator('#settings-toggle').click();await page.locator('#'+id).click();}
async function refreshAndWait(page){const checked=(await saved(page)).active.source.lastChecked;await menu(page,'player-refresh');await expect.poll(async()=>(await saved(page)).active.source.lastChecked).toBeGreaterThan(checked);await expect(page.locator('#player-refresh')).toBeEnabled();await expect(page.locator('#player-status > small')).toHaveCount(1);}
async function record(page,chart){return page.evaluate(id=>maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id)),chart);}
const updatedLabel=page=>page.locator('#player-status>.player-storage-label');
const localUpdateText=(page,time)=>page.evaluate(ms=>'Last Updated: '+new Date(ms).toLocaleString(),time);

for(const [name,url]of [['main','/lab/'],['pilot',entry]]){
  test(`prominent Charts import and Settings import restore focus in the ${name} app and restores keyboard focus`,async({page,context})=>{
    const state=await setup(page,context);if(url!==entry){await page.goto(url);await page.evaluate(()=>maimaiPersonal.ready);}
    const launch=page.locator('#player-import-primary'),dialog=page.locator('#player-import-dialog');
    await expect(launch).toHaveAccessibleName('Import player data');
    for(const view of ['catalog']){
      await page.locator('#'+view+'-tab').click();await expect(launch).toBeVisible();
      await launch.focus();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
      await expect(page.locator('input[value=file]')).toBeFocused();
      await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(launch).toBeFocused();
      await launch.press('Enter');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(launch).toBeFocused();
    }
    for(const view of ['patterns','compare','about']){await page.locator('#'+view+'-tab').click();await expect(launch).toBeHidden();await menu(page,'player-import');await expect(dialog).toBeVisible();await page.keyboard.press('Escape');}
    await expect(page.locator('#settings-toggle')).toBeFocused();expect(state.calls).toBe(0);
  });

  test(`prominent import fits all four languages in the ${name} Charts heading`,async({page,context},testInfo)=>{
    await setup(page,context);if(url!==entry){await page.goto(url);await page.evaluate(()=>maimaiPersonal.ready);}
    const translations={en:'Import player data','zh-Hans':'导入玩家数据',ko:'플레이어 데이터 가져오기',ja:'プレイヤーデータを読み込む'};
    for(const width of [320,390,600,740,1061,1100,1280]){
      await page.setViewportSize({width,height:900});
      for(const [locale,label]of Object.entries(translations)){
        await page.locator('.site-header [data-language="'+locale+'"]').click();
        await expect(page.locator('#player-import-primary')).toHaveAccessibleName(label);
        const layout=await page.locator('#catalog>.page-heading').evaluate(header=>{
          const visible=n=>n.getBoundingClientRect().width>0;
          const controls=[...header.querySelectorAll('h1,#player-import-primary')].filter(visible);
          const clipped=controls.filter(n=>{
            const b=n.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(n);
            return n.scrollWidth>n.clientWidth+1||[...r.getClientRects()].some(t=>t.width&&(t.left<b.left-1||t.right>b.right+1||t.top<b.top-1||t.bottom>b.bottom+1));
          }).map(n=>n.id||n.className);
          const overlaps=[];
          for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
            const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();
            if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([controls[i].id||controls[i].className,controls[j].id||controls[j].className]);
          }
          const button=header.querySelector('#player-import-primary').getBoundingClientRect();
          return {clipped,overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1,largeEnough:button.height>=44,inside:button.left>=0&&button.right<=innerWidth};
        });
        expect(layout,locale+' at '+width+'px').toEqual({clipped:[],overlaps:[],overflow:false,largeEnough:true,inside:true});
        if((width===1280&&locale==='en')||(width===320&&locale==='ja'))await page.screenshot({path:testInfo.outputPath(`import-header-${name}-${locale}-${width}.png`)});
      }
    }
  });
}

test('Last Updated tracks committed imports and successful refreshes across reloads and tabs',async({page,context})=>{
  const state=await setup(page,context),start=Date.parse('2030-01-02T12:00:00Z');await page.clock.setFixedTime(start);
  await importData(page);const first=(await saved(page)).active;
  expect(first.lastImportedAt).toBe(start);expect(first.source.sourceUpdatedAt).not.toBe(start);
  await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,start));
  const other=await context.newPage();await boot(other);await expect(updatedLabel(other)).toHaveText(await localUpdateText(other,start));
  const refreshed=start+31000;await page.clock.setFixedTime(refreshed);await menu(page,'player-refresh');
  await expect.poll(async()=>(await saved(page)).active.lastImportedAt).toBe(refreshed);
  await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));await expect(updatedLabel(other)).toHaveText(await localUpdateText(other,refreshed));
  const current=(await saved(page)).active;expect(current.revision).toBe(first.revision);expect(current.bytes).toEqual(first.bytes);expect(current.source.lastAttempt).toBe(refreshed);
  await menu(page,'player-refresh');await expect(page.locator('#player-status')).toContainText('Please wait');expect(state.calls).toBe(2);
  state.status=503;await page.clock.setFixedTime(start+62000);await menu(page,'player-refresh');await expect(page.locator('#player-status')).toContainText('Could not refresh');
  expect((await saved(page)).active.lastImportedAt).toBe(refreshed);await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));
  // A successful read whose local commit fails must not advance the label either.
  state.status=200;await page.clock.setFixedTime(start+200000);
  await page.evaluate(time=>{const put=IDBObjectStore.prototype.put;window.restoreImportPut=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='datasets'&&key==='active'&&value.lastImportedAt!==time)throw new DOMException('Synthetic quota failure','QuotaExceededError');return put.apply(this,arguments);};},refreshed);
  await menu(page,'player-refresh');await expect.poll(()=>state.calls).toBe(4);await expect(page.locator('#player-status')).toContainText('Could not refresh');
  expect((await saved(page)).active.lastImportedAt).toBe(refreshed);await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));await page.evaluate(()=>restoreImportPut());
  state.profile.userRecord.profile.updatedAt=new Date(state.profile.userRecord.profile.updatedAt.getTime()-1000);await page.clock.setFixedTime(start+2000000);await menu(page,'player-refresh');await expect(page.locator('#player-status')).toContainText('older data');
  expect((await saved(page)).active.lastImportedAt).toBe(refreshed);expect((await saved(page)).active.source.lastSuccess).toBe(refreshed);await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));
  // Older connections already record a local success time; source dates are never a fallback.
  await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();delete s.active.lastImportedAt;await maimaiPlayerStorage.save(s.active,s.token);});
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));
  await menu(page,'player-forget');await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,refreshed));
});

test('derived grades restore without reimport and drive list, sorting, filters and PB history without changing saved observations',async({page,context},testInfo)=>{
  const state=await setup(page,context);
  const root=process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests';
  const config=JSON.parse(await readFile(path.join(root,'maishift-pilot/pilot/maishift/mapping.json'),'utf8'));
  const rows=Object.entries(config.mapping.charts).filter(([id,r])=>id.startsWith('maishift:intl:')&&r.expected_source.difficulty==='MASTER').slice(0,3);
  state.tracks.songs=rows.map(([,r])=>({...r.expected_source,type:r.expected_source.format==='STD'?'STANDARD':'DX'}));
  state.tracks.tracks=rows.map(([id],i)=>({s:i,i:Number(id.split(':')[2]),d:'MASTER',r:{a:[1005028,1004999,null][i],g:315.789}}));
  await importData(page);const before=(await saved(page)).active;
  // The persisted adapter records intentionally contain no reported grade.
  const original=await page.evaluate(async()=>{const d=await maimaiPlayerData.decode((await maimaiPlayerStorage.read()).active.bytes);return {grades:Object.values(d.records).map(r=>r.grade),plays:Object.keys(d.plays),snapshots:Object.keys(d.snapshots)};});
  expect(original.grades).toEqual(['','','']);expect(original.plays).toHaveLength(0);expect(original.snapshots).toHaveLength(1);
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden();
  expect(state.calls).toBe(1);expect((await saved(page)).active.bytes).toEqual(before.bytes);
  await page.getByRole('button',{name:'My PBs',exact:true}).click();
  const chartRows=page.locator('#songs .song-row');await expect(chartRows).toHaveCount(3);
  const ids=rows.map(([,row])=>row.chart_id);
  expect(await page.evaluate(ids=>ids.map(id=>{const c=maimaiResearchCatalog.catalog.find(c=>c.chart_id===id);return [maimaiPersonal.record(c).grade,maimaiPersonal.gradeIndex(c)];}),ids)).toEqual([['SSS+',13],['SSS',12],['',null]]);
  await expect(chartRows.locator('.player-grade[aria-label="SSS+"]')).toHaveCount(1);await expect(chartRows.locator('.player-grade[aria-label="SSS"]')).toHaveCount(1);await expect(chartRows.locator('.player-grade[aria-label="Grade unknown"]')).toHaveCount(1);
  await page.locator('.player-filters .player-filter-toggle').click();
  const sort=page.locator('.player-sorting [data-sort-key=grade]');await sort.click();await expect(chartRows.first()).toHaveAttribute('data-chart-id',ids[0]);await sort.click();await expect(chartRows.first()).toHaveAttribute('data-chart-id',ids[1]);
  await page.getByRole('group',{name:'Filter by grade',exact:true}).getByRole('button',{name:'SSS+',exact:true}).click();
  await expect(chartRows).toHaveCount(1);await expect(chartRows.first()).toHaveAttribute('data-chart-id',ids[0]);
  await page.screenshot({path:testInfo.outputPath('maishift-derived-grade.png'),fullPage:true});
  const history=await page.evaluate(id=>{const c=maimaiResearchCatalog.catalog.find(c=>c.chart_id===id),details=maimaiPersonal.details(c);return {grade:details.querySelector('.player-history-table .player-grade')?.getAttribute('aria-label'),toggle:details.querySelector('.player-pb-toggle')?.textContent};},ids[0]);
  expect(history).toEqual({grade:'SSS+',toggle:'Show saved PB changes (1)'});
  expect((await saved(page)).active.bytes).toEqual(before.bytes);expect((await saved(page)).active.revision).toBe(before.revision);
});

for(const remember of [false,true])test(`Last Updated uses file commit time and survives reload (${remember?'remembered':'temporary'})`,async({page,context})=>{
  await setup(page,context);const start=Date.parse('2030-01-02T12:00:00Z');await page.clock.setFixedTime(start);
  const data=await page.evaluate(d=>maimaiPlayerData.reconcile(d),await fixture());
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();
  const accepted=start+60000;await page.clock.setFixedTime(accepted);await page.locator('.player-remember input').setChecked(remember);await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,accepted));
  await page.clock.setFixedTime(accepted+10000);await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(updatedLabel(page)).toHaveText(await localUpdateText(page,accepted));
  expect(await page.evaluate(async remember=>{const entry=remember?(await maimaiPlayerStorage.read()).active:JSON.parse(sessionStorage.getItem('maimai-pilot-maishift-v1:maimai-player-session'));const bytes=remember?entry.bytes:Uint8Array.from(atob(entry.bytes),c=>c.charCodeAt(0));return (await maimaiPlayerData.decode(bytes)).revision;},remember)).toBe(data.revision);
  // Do not fabricate a local timestamp when restoring pre-feature file imports.
  await page.evaluate(async remember=>{if(remember){const s=await maimaiPlayerStorage.read();delete s.active.lastImportedAt;await maimaiPlayerStorage.save(s.active,s.token);}else{const key='maimai-pilot-maishift-v1:maimai-player-session',entry=JSON.parse(sessionStorage.getItem(key));delete entry.lastImportedAt;sessionStorage.setItem(key,JSON.stringify(entry));}},remember);
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(updatedLabel(page)).toHaveText('Last Updated: Date unknown');
});

test('real browser shows exact scores, filters, restored data and shared version artwork without main-site storage',async({page,context},testInfo)=>{
  const state=await setup(page,context);expect(state.calls).toBe(0);
  const normal=await context.newPage();await normal.goto('/lab/');await normal.evaluate(()=>maimaiPersonal.ready);
  const normalRevision=await normal.evaluate(async d=>{const data=await maimaiPlayerData.reconcile(d),s=await maimaiPlayerStorage.read();await maimaiPlayerStorage.save({revision:data.revision,bytes:await maimaiPlayerData.encode(data),source:null},s.token);localStorage.setItem('maimai-announcement:player-import-sources-v1','preserve');return data.revision;},await fixture());
  await importData(page);await page.getByRole('button',{name:'My PBs',exact:true}).click();
  await expect(page.locator('.player-achievement-value').first()).toHaveText('98.7654%');
  await expect(page.locator('.player-chart-rating')).toHaveText('315 RT');await expect(page.locator('.player-achievement')).not.toContainText(['Rating unknown']);
  expect((await record(page,state.chart)).achievement).toBe(987654);
  await expect(page.locator('#catalog-filters-toggle')).toHaveAttribute('aria-expanded','false');
  await page.locator('#catalog-filters-toggle').click();await expect(page.locator('#catalog-filter-content')).toBeVisible();
  await page.locator('#catalog-filters-toggle').click();
  expect(await page.evaluate(()=>localStorage.getItem('maimai-catalog-filters-collapsed'))).toBeNull();
  await page.screenshot({path:testInfo.outputPath('maishift-browser-fictional.png'),fullPage:true});
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden();await expect.poll(()=>record(page,state.chart)).toMatchObject({achievement:987654});
  expect(state.calls).toBe(1);expect((await saved(normal)).active.revision).toBe(normalRevision);
  expect(await normal.evaluate(()=>maimaiPlayerSources.capabilities.maishift)).toBe(false);
  expect(await page.locator('script[src*="analytics"],script[src*="support-"],script[src*="feature-announcements"]').count()).toBe(0);
  expect(await page.evaluate(()=>localStorage.getItem('maimai-announcement:player-import-sources-v1'))).toBe('preserve');
  expect(state.external).toEqual([]);
  const versions=await page.evaluate(()=>maimaiResearchCatalog.artwork.versions);
  expect(Object.keys(versions)).toHaveLength(28);
  for(const name of ['maimai','maimai DX FESTiVAL','maimai DX MAGiCAL']){const logo=await page.request.get(entry+versions[name]);expect(logo.ok()).toBe(true);expect(logo.headers()['content-type']).toContain('image/webp');}
  await page.evaluate(()=>{for(const name of ['maimai','maimai DX FESTiVAL','maimai DX MAGiCAL'])document.body.prepend(maimaiChartArtwork.version(name));});
  await expect(page.locator('body>.version-logo.artwork-missing')).toHaveCount(0);
  await menu(page,'player-forget');await page.getByRole('button',{name:'Okay!',exact:true}).click();
  expect((await saved(normal)).active.revision).toBe(normalRevision);await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
});

test('unchanged refresh adds no history; corrected score preserves hidden state and filter selection',async({page,context})=>{
  const state=await setup(page,context);await importData(page);const before=(await saved(page)).active.revision;state.profile.userRecord.profile.rating=15433;
  await page.clock.fastForward(31000);await refreshAndWait(page);expect((await saved(page)).active.revision).toBe(before);await expect(page.locator('#player-status .player-rating')).toHaveAttribute('aria-label','Maishift rating 15433');
  await page.getByRole('button',{name:'My PBs',exact:true}).click();await menu(page,'player-toggle');
  state.tracks.tracks[0].r.a=970001;state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');
  await page.clock.fastForward(900001);expect(state.calls).toBe(2);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(async()=>{const s=await saved(page);return s.active.revision;}).not.toBe(before);
  expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);await menu(page,'player-toggle');
  await expect(page.getByRole('button',{name:'My PBs',exact:true})).toHaveAttribute('aria-pressed','true');
  expect((await record(page,state.chart)).achievement).toBe(970001);
  expect(await page.evaluate(async()=>{const d=await maimaiPlayerData.decode((await maimaiPlayerStorage.read()).active.bytes);return Object.keys(d.plays).length;})).toBe(0);
});

test('pilot tabs coordinate refresh and Forget aborts delayed work without resurrection',async({page,context})=>{
  const state=await setup(page,context);await importData(page);const other=await context.newPage();await boot(other);
  await page.clock.fastForward(31000);let release;state.hold=new Promise(resolve=>release=resolve);await menu(page,'player-refresh');await expect.poll(()=>state.calls).toBe(2);
  await menu(other,'player-refresh');expect(state.calls).toBe(2);
  await menu(other,'player-forget');await other.getByRole('button',{name:'Okay!',exact:true}).click();release();
  await expect.poll(async()=>(await saved(page)).active).toBeNull();await expect(page.locator('#player-refresh')).toBeHidden();
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);expect(state.calls).toBe(2);
});

test('new file replaces a delayed refresh and temporary imports remain isolated',async({page,context})=>{
  const state=await setup(page,context);await importData(page);await page.clock.fastForward(31000);let release;state.hold=new Promise(resolve=>release=resolve);await menu(page,'player-refresh');await expect.poll(()=>state.calls).toBe(2);
  const data=await page.evaluate(d=>maimaiPlayerData.reconcile(d),await fixture());
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Import data',exact:true}).click();release();
  await expect(page.locator('#player-refresh')).toBeHidden();await expect(page.locator('#player-status')).not.toContainText('Fictional Player');
  expect(await page.evaluate(()=>sessionStorage.getItem('maimai-player-session'))).toBeNull();
  expect(await page.evaluate(()=>!!sessionStorage.getItem('maimai-pilot-maishift-v1:maimai-player-session'))).toBe(true);
});

for(const locale of ['en','zh-Hans','ko','ja'])test(`browser pilot ${locale} fits narrow controls and supports keyboard import`,async({page,context},testInfo)=>{
  await page.setViewportSize({width:320,height:800});await setup(page,context,locale);
  await page.locator('#player-import-primary').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.player-source-help')).toHaveCount(2);await expect(page.locator('.player-import-help')).toHaveCount(0);
  const help=page.locator('[data-import-help=maishift]');await expect(help).toHaveAttribute('href','player-import-help.'+locale+'.html#maishift');
  const opened=context.waitForEvent('page');await help.click();const guide=await opened;await expect(guide).toHaveURL(new RegExp('player-import-help\\.'+locale+'\\.html#maishift$'));
  await expect(guide.locator('html')).toHaveAttribute('lang',locale);await expect(guide.locator('#maishift')).toHaveCount(1);expect(await guide.evaluate(()=>window.opener===null)).toBe(true);await guide.close();
  await expect(page.locator('input[value=file]')).toBeChecked();expect(await page.locator('.player-source-options img').evaluateAll(nodes=>nodes.every(n=>n.complete&&n.naturalWidth>0))).toBe(true);
  await page.locator('input[value=report]').check();await expect(page.locator('.player-source-fields a')).toHaveCount(0);await expect(page.locator('[data-import-help=session-report]')).toHaveAttribute('href','player-import-help.'+locale+'.html#session-report');await page.locator('input[value=file]').check();
  await page.screenshot({path:testInfo.outputPath('import-sources-'+locale+'.png')});
  await page.locator('input[value=maishift]').check();await page.locator('#player-maishift-url').fill('fictional-player');await page.locator('.player-actions button').first().click();
  await expect(page.locator('.player-source-fields select,.player-import-details')).toHaveCount(0);
  await expect(page.locator('.player-profile-name').last()).toHaveText('Fictional Player');
  const badge=page.locator('.player-dialog .player-rating');
  await expect(badge).toBeVisible();await expect(badge).toHaveAttribute('data-tier','rainbow');
  expect(await badge.evaluate(node=>getComputedStyle(node).backgroundImage.startsWith('url("data:image/webp;base64,'))).toBe(true);
  expect(await page.locator('.player-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await badge.evaluate(node=>{const card=node.parentElement,style=getComputedStyle(card),a=card.getBoundingClientRect(),b=node.getBoundingClientRect();return b.left>=a.left+parseFloat(style.paddingLeft)-1&&b.right<=a.right-parseFloat(style.paddingRight)+1;})).toBe(true);
  await expect(page.locator('.player-dialog .player-profile-link')).toHaveText('fictional-player');
  await expect(page.locator('.player-dialog .player-profile-link')).toHaveAttribute('href','https://maimai.shiftpsh.com/en@intl/profile/fictional-player/home');
  await expect(page.locator('.player-dialog .player-profile-link')).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.locator('.player-profile')).not.toContainText(/International|Japan|国际版|日本版|국제판|일본판|海外版/);
  await page.screenshot({path:testInfo.outputPath('profile-import-'+locale+'.png')});
  await page.locator('.player-dialog .player-actions button').first().click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const clipped=await page.locator('#player-import-primary,#settings-actions button,.personal-scope button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&n.scrollWidth>n.clientWidth+2).map(n=>n.id));expect(clipped).toEqual([]);
  await page.locator('#settings-toggle').click();await expect(page.locator('#player-status .player-rating')).toBeVisible();
  const updated={en:'Last Updated:', 'zh-Hans':'最后更新：',ko:'최근 업데이트:',ja:'最終更新：'};
  await expect(page.locator('#player-status>.player-storage-label')).toContainText(updated[locale]);
  await expect(page.locator('#player-status>small')).toHaveCount(1);await expect(page.locator('#player-status .player-profile-link')).toHaveCount(1);
  await expect(page.locator('#player-status .player-profile-link')).toHaveAttribute('href','https://maimai.shiftpsh.com/en@intl/profile/fictional-player/home');
  await page.screenshot({path:testInfo.outputPath('profile-settings-'+locale+'.png')});await page.locator('#settings-toggle').click();
  const clearLabels={en:'Clear player data','zh-Hans':'清除玩家数据',ko:'플레이어 데이터 지우기',ja:'プレイヤーデータを消去'};
  await expect(page.locator('#player-clear')).toHaveText(clearLabels[locale]);
  await menu(page,'player-import');await expect(page.locator('input[value=maishift]')).toBeChecked();
  const warning=page.locator('.player-import-replace-warning');await expect(warning).toBeVisible();
  const overwrite={en:'Importing will overwrite data from the currently imported account.','zh-Hans':'导入将覆盖当前已导入账号的数据。',ko:'가져오면 현재 가져온 계정의 데이터를 덮어씁니다.',ja:'読み込むと、現在読み込み済みのアカウントのデータが上書きされます。'};
  await expect(warning).toHaveText(overwrite[locale]);
  expect(await warning.evaluate(node=>{const d=node.closest('dialog').getBoundingClientRect(),r=node.getBoundingClientRect();return r.left>=d.left&&r.right<=d.right&&getComputedStyle(node).color==='rgb(163, 36, 50)';})).toBe(true);
  await page.screenshot({path:testInfo.outputPath('import-replacement-'+locale+'.png')});
  await page.keyboard.press('Escape');await expect(page.locator('.player-dialog')).not.toBeVisible();
});

test('Clear removes a hidden temporary import and its reload cache without touching preferences',async({page,context})=>{
  const state=await setup(page,context);await importData(page,false);
  await expect(page.locator('#player-import-primary')).toBeVisible();
  await page.evaluate(()=>localStorage.setItem('maimai-announcement:player-import-sources-v1','preserve'));
  await menu(page,'player-toggle');await expect(page.locator('#player-import-primary')).toBeVisible();await page.locator('#settings-toggle').click();await expect(page.locator('#player-forget')).toBeHidden();
  await page.locator('#player-clear').focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Player data cleared',exact:true})).toBeVisible();await page.getByRole('button',{name:'Okay!',exact:true}).click();
  expect(await record(page,state.chart)).toBeNull();expect(await page.locator('.player-achievement').evaluateAll(nodes=>nodes.every(n=>n.hidden))).toBe(true);await expect(page.locator('#player-status')).toBeHidden();
  expect(await page.evaluate(()=>sessionStorage.getItem('maimai-pilot-maishift-v1:maimai-player-session'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('maimai-announcement:player-import-sources-v1'))).toBe('preserve');
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await page.locator('#player-import-primary').click();await expect(page.locator('.player-import-replace-warning')).toHaveCount(0);expect(state.calls).toBe(1);
});

test('Clear reaches other tabs, cancels refresh, and is caught after missed notifications',async({page,context})=>{
  const state=await setup(page,context);await importData(page);const other=await context.newPage();await boot(other);
  const stale=await context.newPage();await stale.addInitScript(()=>{window.BroadcastChannel=class{postMessage(){}};window.addEventListener('storage',e=>e.stopImmediatePropagation(),true);});await boot(stale);
  await page.clock.fastForward(31000);let release;state.hold=new Promise(resolve=>release=resolve);await menu(page,'player-refresh');await expect.poll(()=>state.calls).toBe(2);
  await menu(other,'player-clear');await expect(other.getByRole('heading',{name:'Player data cleared',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);release();
  expect((await saved(page)).active).toBeNull();await expect(page.locator('#player-refresh')).toBeHidden();
  // This tab intentionally missed both notification transports. The durable clear
  // marker must remove its in-memory scores when it becomes active again.
  await stale.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>stale.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);expect(state.calls).toBe(2);
});

test('Clear wins over a consented import still preparing its commit',async({page,context})=>{
  await setup(page,context);await importData(page);const other=await context.newPage();await boot(other);
  const data=await page.evaluate(async()=>maimaiPlayerData.decode((await maimaiPlayerStorage.read()).active.bytes));
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();await page.locator('.player-remember input').check();
  await page.evaluate(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);let held=true;crypto.subtle.digest=async(...args)=>{if(held){held=false;window.commitWaiting=true;await new Promise(resolve=>window.releaseCommit=resolve);}return digest(...args);};});
  await page.getByRole('button',{name:'Import data',exact:true}).click();await page.waitForFunction(()=>window.commitWaiting);
  await menu(other,'player-clear');await expect.poll(async()=>(await saved(other)).active).toBeNull();
  await page.evaluate(()=>window.releaseCommit());await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);expect((await saved(page)).active).toBeNull();
});

test('failed Clear preserves loaded scores and saved data; retry clears stale write tokens',async({page,context})=>{
  const state=await setup(page,context);await importData(page);const before=await saved(page);
  await page.evaluate(()=>{window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Synthetic quota failure','QuotaExceededError');return window.originalTransaction.apply(this,args);};});
  await menu(page,'player-clear');await expect(page.getByRole('heading',{name:'Could not clear player data',exact:true})).toBeVisible();
  expect((await saved(page)).active.revision).toBe(before.active.revision);expect((await record(page,state.chart)).achievement).toBe(987654);
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>IDBDatabase.prototype.transaction=window.originalTransaction);
  await menu(page,'player-clear');await expect(page.getByRole('heading',{name:'Player data cleared',exact:true})).toBeVisible();
  expect(await page.evaluate(async token=>{try{await maimaiPlayerStorage.save({revision:'stale'},token);return false;}catch{return true;}},before.token)).toBe(true);
});

test('only new imports into a loaded account warn; cancel and refresh preserve data without repeated warnings',async({page,context})=>{
  const state=await setup(page,context);await menu(page,'player-import');await expect(page.locator('.player-import-replace-warning')).toHaveCount(0);await page.keyboard.press('Escape');
  await importData(page);const before=(await saved(page)).active.revision;
  await menu(page,'player-import');await expect(page.locator('.player-import-replace-warning')).toHaveText('Importing will overwrite data from the currently imported account.');
  for(const value of ['file','report','maishift']){await page.locator('input[value='+value+']').check();await expect(page.locator('.player-import-replace-warning')).toBeVisible();}expect(state.calls).toBe(1);
  await page.locator('.player-actions button').first().click();await expect(page.locator('.player-import-replace-warning')).toHaveCount(0);
  await page.locator('.player-actions button').last().click();expect((await saved(page)).active.revision).toBe(before);
  const data=await page.evaluate(d=>maimaiPlayerData.reconcile(d),await fixture());
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.locator('.player-import-replace-warning')).toHaveText('Importing will overwrite data from the currently imported account.');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await saved(page)).active.revision).toBe(before);expect((await record(page,state.chart)).achievement).toBe(987654);
  await page.clock.fastForward(31000);await refreshAndWait(page);await expect(page.locator('.player-import-replace-warning')).not.toBeVisible();await expect(page.locator('.player-dialog')).not.toBeVisible();
});

test('reported rating survives a temporary reload and missing rating stays unknown',async({page,context})=>{
  const state=await setup(page,context);await importData(page,false);await page.reload();await page.evaluate(()=>maimaiPersonal.ready);
  await expect(page.locator('#lab-status')).toBeHidden();
  await expect(page.locator('#player-status .player-rating')).toHaveAttribute('aria-label','Maishift rating 15432');
  await expect(page.locator('#player-status .player-profile-link')).toHaveAttribute('href','https://maimai.shiftpsh.com/en@intl/profile/fictional-player/home');
  expect((await saved(page)).active).toBeNull();delete state.profile.userRecord.profile.rating;
  await importData(page,false,null);await expect(page.locator('#player-status .player-rating-unknown')).not.toHaveAttribute('data-tier');
});

test('pasted explicit regional URL selects its record region without a read',async({page,context})=>{
  const state=await setup(page,context);await page.locator('#player-import-primary').click();await page.locator('input[value=maishift]').check();
  for(const part of ['jp','na','intl']){await page.locator('#player-maishift-url').fill('https://maimai.shiftpsh.com/en@'+part+'/profile/fictional-player');await expect(page.locator('.player-source-fields select')).toHaveCount(0);}
  expect(state.calls).toBe(0);
  await page.locator('.player-actions button').first().click();await expect(page.locator('.player-profile-name').last()).toHaveText('Fictional Player');expect(state.requests[0].region).toBe('intl');
});

test('automatic region is resolved and remembered explicitly; a regional link switches without merging',async({page,context})=>{
  const state=await setup(page,context);state.profile.region='JAPAN';await importData(page);
  expect(state.requests[0].region).toBe('auto');let s=(await saved(page)).active.source;expect(s.region).toBe('jp');expect(s.playerKey).toBe('maishift:maimaidx:jp:fictional-player');expect(s.url).toContain('/en@jp/');
  await page.clock.fastForward(31000);await refreshAndWait(page);expect(state.requests.length).toBe(2);expect(state.requests[1].region).toBe('jp');
  state.profile.region='ASIA';await menu(page,'player-import');await page.locator('#player-maishift-url').fill('https://maimai.shiftpsh.com/en@intl/profile/fictional-player');await page.locator('.player-actions button').first().click();
  await expect(page.locator('.player-dialog')).toContainText('1 PBs');await expect(page.locator('.player-dialog')).toContainText('Importing will overwrite data from the currently imported account.');
  await page.locator('.player-dialog .player-actions button').first().click();await expect.poll(async()=>(await saved(page)).active.source.region).toBe('intl');
  expect(await page.evaluate(async()=>{const d=await maimaiPlayerData.decode((await maimaiPlayerStorage.read()).active.bytes);return Object.keys(d.charts).every(id=>id.startsWith('maishift:intl:'));})).toBe(true);
});

test('a portable Maishift identity without a verified public URL still imports and restores',async({page,context})=>{
  await setup(page,context);await importData(page);const data=await page.evaluate(async()=>{
    const d=await maimaiPlayerData.decode((await maimaiPlayerStorage.read()).active.bytes);d.player.username='Fictional portable identity';d.player.key='maishift:maimaidx:intl:'+encodeURIComponent(d.player.username);
    const {revision,...body}=d;d.revision=await maimaiPlayerData.digest(body);return d;
  });
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect(page.locator('#player-status')).toContainText('Fictional portable identity');await expect(page.locator('#player-status .player-profile-link')).toHaveCount(0);
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#player-status')).toContainText('Fictional portable identity');
});

test('same-observation rating upgrade survives reload without new PB history and powers rating controls',async({page,context})=>{
  const state=await setup(page,context);delete state.tracks.tracks[0].r.g;await importData(page);
  await expect(page.locator('.player-chart-rating')).toHaveCount(0);
  state.tracks.tracks[0].r.g=315.789;await page.clock.fastForward(31000);await menu(page,'player-refresh');
  await expect.poll(()=>record(page,state.chart)).toMatchObject({rate:315,achievement:987654});
  const facts=()=>page.evaluate(async()=>{const s=await maimaiPlayerStorage.read(),d=await maimaiPlayerData.decode(s.active.bytes);return {snapshots:Object.keys(d.snapshots).length,captures:Object.keys(d.captures).length,plays:Object.keys(d.plays).length,changes:maimaiPlayerData.chartHistory(d,Object.keys(d.charts)).changes.length,adapter:s.active.source.adapterVersion};});
  expect(await facts()).toEqual({snapshots:1,captures:1,plays:0,changes:1,adapter:2});
  await page.reload();await expect(page.locator('#lab-status')).toBeHidden();await page.evaluate(()=>maimaiPersonal.ready);
  await page.getByRole('button',{name:'My PBs',exact:true}).click();await expect(page.locator('.player-chart-rating')).toHaveText('315 RT');
  await page.locator('.player-filters .player-filter-toggle').click();await expect(page.locator('.player-filters .player-filter-toggle')).toHaveAttribute('aria-expanded','true');
  await page.locator('.player-sorting [data-sort-key=rating]').click();await expect(page.locator('#songs .song-row').first()).toHaveAttribute('data-chart-id',state.chart);
  await page.locator('#personal-rateMin').fill('316');await expect(page.locator('#songs .song-row')).toHaveCount(0);
  await page.locator('#personal-rateMin').fill('315');await expect(page.locator('#songs .song-row')).toHaveCount(1);
  expect(await facts()).toEqual({snapshots:1,captures:1,plays:0,changes:1,adapter:2});
});
