import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {mountRegistryPage} from './registry-page-mount.mjs';

async function configure(page){
  await expect(page.locator('#catalog-count strong')).toHaveText('6');
  await page.evaluate(async()=>{
    await maimaiPersonal.ready;
    const data=maimaiResearchCatalog,c=data.catalog[0];
    maimaiPersonal.configure(data,{schema_version:'provider-mapping-1',charts:{chart:{chart_id:c.chart_id,source_hash:c.source_hash}}});
    const url=new URL(location.href);url.searchParams.set('chart',c.chart_id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));
  });
}

test('old imports and remembered data retain one source play and one persistent achievement',async({page})=>{
  const data=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  const bytes=gzipSync(Buffer.from(JSON.stringify(data)));
  await page.goto('/lab/');await configure(page);
  for(let attempt=0;attempt<2;attempt++){
    await page.locator('input[type=file]').setInputFiles({name:'player.gz',mimeType:'application/gzip',buffer:bytes});
    await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();
    await expect(page.locator('.player-dialog .player-profile-history')).toHaveText('1 retained play');
    await page.getByLabel('Remember on this device',{exact:true}).check();
    await page.getByRole('button',{name:'Import data',exact:true}).click();
    const history=page.locator('.player-history');
    await expect(history.getByRole('region',{name:'Recorded plays',exact:true}).locator('tbody tr')).toHaveCount(1);
    await expect(history.locator('.player-pb-toggle,.player-pb-history,.player-achievement')).toHaveCount(0);
    await expect(history.locator('.player-history-controls')).toHaveCount(0);
    await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toContainText('97.0000%');
    await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toBeVisible();
  }
  // Simulate a profile saved by the previous release. Reload must repair it too.
  await page.evaluate(async({data,bytes})=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('maimai-player-data',2);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    await new Promise((resolve,reject)=>{const t=db.transaction('datasets','readwrite');t.objectStore('datasets').put({revision:data.revision,bytes:new Uint8Array(bytes)},'active');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
  },{data,bytes:[...bytes]});
  await page.reload();await configure(page);
  await expect(page.locator('.player-history').getByRole('region',{name:'Recorded plays',exact:true}).locator('tbody tr')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('a saved PB without a play never creates a play-history row',async({page})=>{
  await page.goto('/lab/');await configure(page);
  const input=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  const data=await page.evaluate(async d=>{d.plays={};const captures={};for(const c of Object.values(d.captures)){c.playIDs=[];captures[await maimaiPlayerData.digest(c)]=c;}d.captures=captures;const {revision,...body}=d;d.revision=await maimaiPlayerData.digest(body);return d;},input);
  await page.locator('input[type=file]').setInputFiles({name:'pb-only.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect(page.locator('.player-history')).toHaveCount(0);
  await expect(page.locator('.player-history').getByRole('region',{name:'Recorded plays',exact:true})).toHaveCount(0);
  await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toContainText('97.0000%');
  await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toBeVisible();
});

async function historyFixture(page,total){
  const base=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  return page.evaluate(async({base,total})=>{
    const core=maimaiPlayerData,d=await core.reconcile(base),original=d.records[Object.values(d.plays)[0]];
    d.plays={};
    // Reverse insertion and paired timestamps exercise the existing deterministic tie-breaker.
    for(let i=total-1;i>=0;i--){
      const row={...original,timeAchieved:Date.UTC(2026,9,1,20)-Math.floor(i/2)*86400000,achievement:970000-i*17,grade:i?'AAA':'S',rate:i?190:194,lamp:i%5===0?'FULL COMBO':'CLEAR',sync:i%7===0?'FS':''};
      if(total>20&&i===total-2)row.timeAchieved=null;
      if(total>20&&i===total-1){row.achievement=null;row.grade='';row.rate=null;}
      const ref=await core.digest(row);d.records[ref]=row;d.plays['fictional-play-'+String(i).padStart(4,'0')]=ref;
    }
    d.captures={};const capture={capturedAt:Date.UTC(2026,9,3),sourceKind:'sync',sourceID:'fictional-history-review',sessionID:'',historyCoverage:'retained-window',playIDs:Object.keys(d.plays),snapshotIDs:Object.keys(d.snapshots)};
    d.captures[await core.digest(capture)]=capture;
    const {revision,...body}=d;d.revision=await core.digest(body);return d;
  },{base,total});
}
async function importHistory(page,data){
  await page.locator('input[type=file]').setInputFiles({name:'fictional-history.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.locator('.player-dialog .player-actions button').first().click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
}
async function historyFits(page){
  const result=await page.locator('.player-history').evaluate(root=>{
    const nodes=[root,...root.querySelectorAll('*')];return{page:document.documentElement.scrollWidth<=innerWidth+1,clipped:nodes.filter(n=>n.clientWidth>0&&n.getBoundingClientRect().width&&n.scrollWidth>n.clientWidth+1&&!(innerWidth<=600&&n.closest('thead'))).map(n=>n.className),fields:[...root.querySelectorAll('.player-history-value')].every(n=>n.getBoundingClientRect().height>0)};
  });expect(result).toEqual({page:true,clipped:[],fields:true});
}
for(const locale of ['en','zh-Hans','ko','ja'])test('bounded real imported history, keyboard and all records in '+locale,async({page},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem('maimai-chart-sections-v1',JSON.stringify({chart:false,player:false})));
  await page.goto('/lab/');await configure(page);const data=await historyFixture(page,243);await importHistory(page,data);
  await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);
  const history=page.locator('.player-history'),rows=history.locator('tbody tr'),more=history.locator('.player-history-more'),less=history.locator('.player-history-less'),count=history.locator('.player-history-count');
  await expect(rows).toHaveCount(3);await expect(count).toContainText('243');await expect(less).toBeHidden();await historyFits(page);
  await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toBeVisible();await expect(history.locator('.player-achievement,.player-pb-toggle,.chart-section-toggle')).toHaveCount(0);
  const graph=await history.locator('svg polyline').getAttribute('points');expect(graph.split(' ')).toHaveLength(241);
  await history.screenshot({path:testInfo.outputPath('history-three-'+locale+'.png')});
  await more.focus();await page.keyboard.press('Enter');await expect(rows).toHaveCount(23);await expect(rows.nth(3)).toBeFocused();
  expect(await rows.nth(3).evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;})).toBe(true);
  await page.keyboard.press('Tab');await expect(more).toBeFocused();await page.keyboard.press('Space');await expect(rows).toHaveCount(43);await expect(rows.nth(23)).toBeFocused();await historyFits(page);
  let shown=43;while(shown<243){await more.click();shown=Math.min(243,shown+20);await expect(rows).toHaveCount(shown);}
  await expect(more).toBeHidden();await expect(count).toContainText('243');await historyFits(page);expect(await history.locator('svg polyline').getAttribute('points')).toBe(graph);
  const expected=await page.evaluate(data=>maimaiPlayerData.chartHistory(data,['chart']).plays.map(e=>e.r.achievement==null?null:(e.r.achievement/10000).toFixed(4)+'%'),data);
  const rendered=await rows.evaluateAll(rs=>rs.map(r=>r.querySelectorAll('.player-history-value')[1].textContent));
  expect(rendered.filter(v=>v.endsWith('%'))).toEqual(expected.filter(v=>v!==null));
  // Rendering cannot alter or discard any retained records or PB observations.
  expect(await page.evaluate(data=>maimaiPlayerData.chartHistory(data,['chart']).plays.length,data)).toBe(243);
  await less.focus();await page.keyboard.press('Enter');await expect(rows).toHaveCount(3);await expect(history.locator('.player-history-title')).toBeFocused();
  expect(await history.locator('.player-history-title').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;})).toBe(true);
  await page.keyboard.press('Tab');await expect(more).toBeFocused();await historyFits(page);
  // Filter/sort redraw and a public navigation snapshot preserve the selected count.
  await more.click();const snap=await page.evaluate(()=>maimaiBrowserState.capture());await page.locator('[data-sort-key=bpm]').click();await expect(rows).toHaveCount(23);
  await page.evaluate(snap=>maimaiBrowserState.restore(snap),snap);await expect(rows).toHaveCount(23);
  // Check the 640px CSS layout used by a 1280px display at 200% zoom. CSS zoom is not a browser-zoom simulation.
  await less.click();if(page.viewportSize().width>=1000){const viewport=page.viewportSize();await page.setViewportSize({width:640,height:450});await historyFits(page);await page.setViewportSize(viewport);}
});

for(const total of [0,1,2,3,4,24])test('small imported history boundary '+total,async({page})=>{
  await page.goto('/lab/');await configure(page);await importHistory(page,await historyFixture(page,total));
  if(!total){await expect(page.locator('.player-history')).toHaveCount(0);await expect(page.locator('.song-row.is-expanded>.chart-summary>.player-achievement')).toBeVisible();return;}
  const history=page.locator('.player-history'),rows=history.locator('tbody tr');await expect(rows).toHaveCount(Math.min(3,total));await historyFits(page);
  if(total<=3)await expect(history.locator('.player-history-controls')).toHaveCount(0);
  else{let shown=3;while(shown<total){await history.locator('.player-history-more').click();shown=Math.min(total,shown+20);await expect(rows).toHaveCount(shown);}await expect(history.locator('.player-history-more')).toBeHidden();await history.locator('.player-history-less').click();await expect(rows).toHaveCount(3);}
});

test('song navigation restores history and difficulty changes reset its count',async({page,baseURL})=>{
 const mounted=await mountRegistryPage(page,baseURL);
 try{
  await page.goto('/?lang=en');await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  const chosen=await page.evaluate(()=>{const picker=[...document.querySelectorAll('#songs .row-difficulty')].find(p=>p.options.length>1);return{current:picker.value,other:[...picker.options].find(o=>o.value!==picker.value).value};});
  await page.evaluate(async chosen=>{await maimaiPersonal.ready;const data=maimaiResearchCatalog,c=data.catalog.find(c=>c.chart_id===chosen.current);maimaiPersonal.configure(data,{schema_version:'provider-mapping-1',charts:{chart:{chart_id:c.chart_id,source_hash:c.source_hash}}});},chosen);
  const row=page.locator('#songs .song-row[data-chart-id='+JSON.stringify(chosen.current)+']');await row.locator('.chart-row').click();await importHistory(page,await historyFixture(page,24));
  await row.locator('.player-history-more').click();await expect(row.locator('tbody tr')).toHaveCount(23);
  const captured=await page.evaluate(()=>maimaiBrowserState.capture());
  await row.locator('[data-song-page]').click();await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();await page.locator('#seo-route-view [data-back-results]').click();
  await expect(row.locator('tbody tr')).toHaveCount(23);expect(await page.evaluate(()=>maimaiBrowserState.capture().historyRows)).toEqual(captured.historyRows);
  await row.locator('.row-difficulty').selectOption(chosen.other);
  const changed=page.locator('#songs .song-row[data-chart-id='+JSON.stringify(chosen.other)+']').filter({has:page.locator('.chart-row[aria-expanded=true]')});await changed.locator('.row-difficulty').selectOption(chosen.current);
  await expect(row.locator('tbody tr')).toHaveCount(3);await expect(row.locator('.row-difficulty')).toBeFocused();
 }finally{await mounted.close();}
});
