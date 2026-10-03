import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

async function configure(page){
  await expect(page.locator('#catalog-count strong')).toHaveText('6');
  await page.evaluate(async()=>{
    await maimaiPersonal.ready;
    const data=maimaiResearchCatalog,c=data.catalog[0];
    maimaiPersonal.configure(data,{schema_version:'provider-mapping-1',charts:{chart:{chart_id:c.chart_id,source_hash:c.source_hash}}});
    const url=new URL(location.href);url.searchParams.set('chart',c.chart_id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));
  });
}

test('old file imports and remembered data show one source play, with PB snapshots kept separate',async({page})=>{
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
    await expect(history.getByRole('region',{name:'Saved PB changes',exact:true})).toBeHidden();
    await history.getByRole('button',{name:'Show saved PB changes (1)',exact:true}).click();
    await expect(history.getByRole('region',{name:'Saved PB changes',exact:true}).locator('tbody tr')).toHaveCount(1);
    await expect(history.locator('.player-pb-history')).toContainText('not when you played');
    await history.getByRole('button',{name:'Hide saved PB changes (1)',exact:true}).click();
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
  await expect(page.locator('.player-history')).toContainText('No recorded plays for this chart');
  await expect(page.locator('.player-history').getByRole('region',{name:'Recorded plays',exact:true})).toHaveCount(0);
  await expect(page.locator('.player-history .player-achievement')).toContainText('97.0000%');
});
