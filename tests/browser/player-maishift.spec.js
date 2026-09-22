import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createService,PATH} from '../../player-import-worker/index.mjs';
import {tracks,publicProfile,wire} from '../../player-import-worker/fixtures.mjs';
const saved=page=>page.evaluate(()=>maimaiPlayerStorage.read());
async function boot(page){await page.goto('/lab/');await page.evaluate(()=>maimaiPersonal.ready);}
async function prepare(context,{locale='en'}={}){
  await context.addInitScript(locale=>{localStorage.setItem('maimai-language-v1',locale);sessionStorage.setItem('maimai-announcement:player-import-sources-v1','seen');},locale);
  // The public asset is disabled. Only this synthetic harness enables it.
  await context.route('**/player-sources.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('maishift:globalThis.maimaiPlayerContext?.pilot===true','maishift:true')});});
  const state={calls:0,delay:null,profile:publicProfile(),tracks:tracks(),status:200,html:false};
  await context.route('**'+PATH,async route=>{
    state.calls++;if(state.delay)await state.delay();
    if(state.status!==200||state.html){await route.fulfill({status:state.status,contentType:state.html?'text/html':'application/json',headers:{'Retry-After':'120'},body:state.html?'<html>Sign in</html>':'{"error":"upstream_busy"}'});return;}
    const responses=[state.profile,state.tracks,state.profile];
    const service=createService({fetcher:async()=>new Response(JSON.stringify(wire(responses.shift())),{headers:{'Content-Type':'application/json'}})});
    const request=new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:route.request().postData()});
    const response=await service.fetch(request,{MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'synthetic'}),finish:async()=>{}})}});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  return state;
}
async function open(page){await page.locator('#settings-toggle').click();await page.locator('#player-import').click();}
async function preview(page){await open(page);await page.locator('input[value=maishift]').check();await page.locator('#player-maishift-url').fill('fictional-player');await page.locator('.player-actions button').first().click();await expect(page.locator('.player-profile-name').last()).toHaveText('Fictional Player');}
async function commit(page,remember=true){await preview(page);await page.locator('.player-dialog .player-remember input').setChecked(remember);await page.locator('.player-dialog .player-actions button').first().click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);}
async function age(page){await page.evaluate(async()=>{const db=await new Promise(resolve=>{const q=indexedDB.open('maimai-player-data',2);q.onsuccess=()=>resolve(q.result);});await new Promise((resolve,reject)=>{const t=db.transaction('datasets','readwrite'),s=t.objectStore('datasets'),q=s.get('active');q.onsuccess=()=>s.put({...q.result,source:{...q.result.source,lastAttempt:0}},'active');t.oncomplete=resolve;t.onabort=reject;});db.close();});}
async function refresh(page){await page.locator('#settings-toggle').click();await page.locator('#player-refresh').click();}

test('Maishift grades use exact integer boundaries and preserve unknown achievements',async({page})=>{
  await boot(page);
  const thresholds=[[0,'D'],[500000,'C'],[600000,'B'],[700000,'BB'],[750000,'BBB'],[800000,'A'],[900000,'AA'],[940000,'AAA'],[970000,'S'],[980000,'S+'],[990000,'SS'],[995000,'SS+'],[1000000,'SSS'],[1005000,'SSS+']];
  const examples=thresholds.flatMap(([n,grade],i)=>[[n,grade],...(i?[[n-1,thresholds[i-1][1]]]:[])]);
  examples.push([1005028,'SSS+'],[1006528,'SSS+'],[1010000,'SSS+'],[null,''],[-1,''],[1010001,''],[987654.5,''],['1005000','']);
  expect(await page.evaluate(rows=>rows.map(([value])=>maimaiPlayerMaishift.grade(value)),examples)).toEqual(examples.map(([,grade])=>grade));
});

test('a 6000-PB profile reaches preview and preserves every observation',async({page,context})=>{
  const state=await prepare(context),template=state.tracks.tracks[0];state.tracks.tracks=Array.from({length:6000},(_,i)=>({...template,i:i+1}));await boot(page);await commit(page);
  const counts=await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read(),data=await maimaiPlayerData.decode(s.active.bytes);return {pbs:maimaiPlayerData.current(data).pbs.size,records:Object.keys(data.records).length,plays:Object.keys(data.plays).length,exact:Object.values(data.records).every(r=>r.achievement===987654)};});
  expect(counts).toEqual({pbs:6000,records:6000,plays:0,exact:true});
});

async function mappedFixture(page){await page.waitForFunction(()=>!!window.maimaiResearchCatalog);return page.evaluate(()=>{
  const data=maimaiResearchCatalog,rows=data.catalog.slice(0,3),formats=['STD','STD','DX'],difficulties=['BASIC','MASTER','ADVANCED'];
  const mapping={schema_version:'maishift-mapping-1',provider:'maishift',game:'maimaidx',charts:{}};
  rows.forEach((c,i)=>{c.format=formats[i];c.difficulty=difficulties[i];mapping.charts['maishift:intl:'+(i+1)]={chart_id:c.chart_id,acceptance_basis:'reviewed',expected_source:{title:'Fictional Song',artist:'Fictional Artist',format:c.format,difficulty:c.difficulty}};});
  data.maishift_mapping=mapping;maimaiPersonal.configure(data);return rows.map(c=>c.chart_id);
});}

test('reviewed mappings show exact PBs and observation history without invented plays',async({page,context})=>{
  await prepare(context);await boot(page);const ids=await mappedFixture(page);await preview(page);
  await expect(page.locator('.player-dialog')).not.toContainText('Unmatched PB charts');
  await page.getByRole('button',{name:'Import & remember',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  const records=await page.evaluate(ids=>ids.map(id=>{const c=maimaiResearchCatalog.catalog.find(c=>c.chart_id===id);return {record:maimaiPersonal.record(c),lastPlayed:maimaiPersonal.lastPlayed(c),summary:maimaiPersonal.summary(c).textContent,details:maimaiPersonal.details(c).textContent};}),ids);
  expect(records.map(r=>r.record.achievement)).toEqual([987654,1009999,null]);
  expect(records.every(r=>r.lastPlayed===null&&r.details.includes('No recorded plays for this chart.'))).toBe(true);
  expect(records[0].summary).toContain('98.7654%');expect(records[1].summary).toContain('100.9999%');expect(records[2].summary).toContain('Achievement unknown');
  await page.locator('#settings-toggle').click();await page.locator('#player-toggle').click();
  expect(await page.evaluate(ids=>ids.every(id=>maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id))===null),ids)).toBe(true);
});

test('changed metadata and colliding regional targets stay unmatched without losing portable PBs',async({page,context})=>{
  const state=await prepare(context);await boot(page);const ids=await mappedFixture(page);state.tracks.songs[0].artist='Changed artist';await preview(page);
  await expect(page.locator('.player-dialog')).toContainText('Unmatched PB charts: 2');await page.getByRole('button',{name:'Import & remember',exact:true}).click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  expect(await page.evaluate(ids=>ids.map(id=>maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id))?.achievement??null),ids)).toEqual([null,null,null]);
  expect(await page.evaluate(id=>maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id))!==null,ids[2])).toBe(true);
  const count=await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();return maimaiPlayerData.current(await maimaiPlayerData.decode(s.active.bytes)).pbs.size;});expect(count).toBe(3);
  await page.evaluate(()=>{const d=maimaiResearchCatalog,m=d.maishift_mapping;m.charts['maishift:intl:99']={...m.charts['maishift:intl:3']};maimaiPersonal.configure(d);});
  expect(await page.evaluate(id=>maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id)),ids[2])).toBeNull();
});

test('proxy preview has explicit consent, region, precision and unmatched coverage; POST leaks no profile URL',async({page,context},testInfo)=>{
  const state=await prepare(context);await boot(page);
  await page.evaluate(()=>{window.requests=[];const original=fetch;window.fetch=(url,options)=>{if(String(url).includes('/api/player-import/'))requests.push({url:String(url),...options});return original(url,options);};});
  await open(page);await page.locator('input[value=maishift]').check();expect(state.calls).toBe(0);
  await expect(page.getByLabel('Remember and refresh')).toBeChecked();
  await page.locator('#player-maishift-url').fill('fictional-player');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('.player-dialog')).toContainText('3 PBs');await expect(page.locator('.player-dialog')).toContainText('Unmatched PB charts: 3');
  await expect(page.getByRole('button',{name:'Import & remember',exact:true})).toBeVisible();expect((await saved(page)).active).toBeNull();
  await expect(page.locator('.player-import-details')).toHaveCount(0);await page.screenshot({path:testInfo.outputPath('maishift-fictional-preview.png')});
  await page.getByRole('button',{name:'Import & remember',exact:true}).click();await expect.poll(async()=>!!(await saved(page)).active).toBe(true);
  const source=(await saved(page)).active.source;expect(source.type).toBe('maishift');expect(source.region).toBe('intl');expect(source.autoRefresh).toBe(true);
  const options=await page.evaluate(()=>requests[0]);expect(options.url).toBe(PATH);expect(options.credentials).toBe('omit');expect(options.referrerPolicy).toBe('no-referrer');expect(page.url()).not.toContain('fictional-player');
  const result=await page.evaluate(async()=>{const state=await maimaiPlayerStorage.read(),data=await maimaiPlayerData.decode(state.active.bytes);return {achievements:Object.values(data.records).map(r=>r.achievement),plays:Object.keys(data.plays),counts:Object.keys(data.charts).length,portable:JSON.stringify(data)};});
  expect(result.achievements).toContain(987654);expect(result.plays).toHaveLength(0);expect(result.counts).toBe(3);expect(result.portable).not.toContain('profileCreatedAt');
  await open(page);await expect(page.locator('input[value=maishift]')).toBeChecked();
});
test('Import once stores no refresh connection and remains available in this tab',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page,false);expect((await saved(page)).active).toBeNull();await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);expect(state.calls).toBe(1);await expect(page.locator('#player-refresh')).toBeHidden();
});
test('unchanged PBs with a newer profile timestamp create no history; corrected lower PB does',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const before=(await saved(page)).active;state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');await age(page);
  await page.locator('#settings-toggle').click();await page.locator('#player-toggle').click();await refresh(page);await expect.poll(async()=>(await saved(page)).active.source.sourceUpdatedAt).toBe(Date.parse('2026-09-21T00:00:00Z'));expect((await saved(page)).active.revision).toBe(before.revision);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  state.tracks.tracks[0].r.a=950000;state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:01Z');await age(page);await refresh(page);
  await expect.poll(async()=>page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();return maimaiPlayerData.current(await maimaiPlayerData.decode(s.active.bytes)).pbs.get('maishift:intl:1').achievement;})).toBe(950000);
});

test('changed PBs with equal or older source timestamps preserve saved history',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const before=(await saved(page)).active;
  state.tracks.tracks[0].r.a=950000;
  for(const [date,status]of [['2026-09-20T00:00:00Z','Could not refresh'],['2026-09-19T00:00:00Z','The source returned older data']]){
    state.profile.userRecord.profile.updatedAt=new Date(date);
    await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();const lease=await maimaiPlayerStorage.claim(s.token,true,Date.now()+1e9);await maimaiPlayerStorage.finish(s.token,lease.id,{lastAttempt:0,retryAt:0});});
    await refresh(page);await expect(page.locator('#player-status')).toContainText(status);
    const after=(await saved(page)).active;expect(after.revision).toBe(before.revision);expect(after.source.sourceUpdatedAt).toBe(before.source.sourceUpdatedAt);
    expect(await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read(),data=await maimaiPlayerData.decode(s.active.bytes);return {achievement:maimaiPlayerData.current(data).pbs.get('maishift:intl:1').achievement,records:Object.keys(data.records).length,plays:Object.keys(data.plays).length};})).toEqual({achievement:987654,records:3,plays:0});
  }
});

test('oversized expanded response fails without replacing remembered scores',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const before=(await saved(page)).active.revision;
  state.tracks={songs:[{title:'界'.repeat(512),artist:'語'.repeat(512),type:'STANDARD'}],tracks:Array.from({length:2000},(_,i)=>({s:0,i:i+1,d:'MASTER',r:{a:1000000}}))};
  state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');await age(page);await refresh(page);
  await expect(page.locator('#player-status')).toContainText('Could not refresh');expect((await saved(page)).active.revision).toBe(before);
});
test('username and region identify refresh; changed snapshot creation date is not a player switch',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const before=(await saved(page)).active.revision;
  state.profile.userRecord.profile.createdAt=new Date('2026-02-01T00:00:00Z');state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');await age(page);await refresh(page);await expect.poll(async()=>(await saved(page)).active.source.sourceUpdatedAt).toBe(Date.parse('2026-09-21T00:00:00Z'));expect((await saved(page)).active.revision).toBe(before);
  for(const field of ['handle','region']){
    const original=state.profile[field];state.profile[field]=field==='handle'?'different-player':'JAPAN';
    await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();const lease=await maimaiPlayerStorage.claim(s.token,true,Date.now()+1e9);await maimaiPlayerStorage.finish(s.token,lease.id,{lastAttempt:0,retryAt:0});});
    const calls=state.calls;await refresh(page);await expect.poll(()=>state.calls).toBe(calls+1);await expect.poll(async()=>((await saved(page)).active.source.retryAt||0)>Date.now()).toBe(true);await expect(page.locator('#player-status')).toContainText('Could not refresh');expect((await saved(page)).active.revision).toBe(before);state.profile[field]=original;
  }
});

test('throttling and login HTML preserve the remembered dataset',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const before=(await saved(page)).active.revision;
  for(const mode of ['throttle','html']){state.status=mode==='throttle'?429:200;state.html=mode==='html';await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();const lease=await maimaiPlayerStorage.claim(s.token,true,Date.now()+1e9);await maimaiPlayerStorage.finish(s.token,lease.id,{lastAttempt:0,retryAt:0});});await refresh(page);await expect.poll(async()=>((await saved(page)).active.source.retryAt||0)>Date.now()).toBe(true);expect((await saved(page)).active.revision).toBe(before);}
});
test('cross-tab Forget aborts a delayed proxy refresh and stale tabs cannot resurrect it',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);const other=await context.newPage();await boot(other);await age(page);
  let release,started;const waiting=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);state.delay=()=>{started();return held;};await refresh(page);await waiting;
  await other.locator('#settings-toggle').click();await other.locator('#player-forget').click();release();await expect.poll(async()=>(await saved(page)).active).toBeNull();await expect(page.locator('#player-refresh')).toBeHidden();await page.reload();await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
});
test('newer file import invalidates an outstanding proxy refresh',async({page,context})=>{
  const state=await prepare(context);await boot(page);await commit(page);await age(page);let release,started;const waiting=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);state.delay=()=>{started();return held;};await refresh(page);await waiting;
  const fixture=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));const bytes=gzipSync(Buffer.from(JSON.stringify(await page.evaluate(d=>maimaiPlayerData.reconcile(d),fixture))));
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:bytes});await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Import data',exact:true}).click();release();await expect(page.locator('#player-refresh')).toBeHidden();await expect(page.locator('#player-status')).not.toContainText('Fictional Player');
});
for(const [locale,region,excluded] of [['en','3 PBs','Records excluded for missing chart identity: 1'],['zh-Hans','3 项个人最佳成绩','因缺少谱面标识而排除的记录：1'],['ko','개인 최고 기록 3개','채보 식별 정보가 없어 제외된 기록: 1'],['ja','自己ベスト 3件','譜面の識別情報がないため除外された記録：1']])test(`localized Maishift preview ${locale} fits narrow screens and supports keyboard cancellation`,async({page,context})=>{
  const state=await prepare(context,{locale});state.tracks.tracks.push({s:9000,r:{a:987654}});await boot(page);await preview(page);await expect(page.locator('.player-dialog')).toContainText(region);await expect(page.locator('.player-dialog')).toContainText(excluded);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.keyboard.press('Escape');await expect(page.locator('.player-dialog')).not.toBeVisible();expect((await saved(page)).active).toBeNull();
});
