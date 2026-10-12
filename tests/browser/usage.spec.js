import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
const root=resolve(process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests');
test.beforeEach(async({fixtureOrigins})=>{fixtureOrigins.synthetic('https://maimai.party');});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
async function hosted(context,{gpc=false,dnt=false,disabled=false,fail=false}={}){
 const counts=[],external=[];
 await context.addInitScript(({gpc,dnt,disabled})=>{
  Object.defineProperty(navigator,'globalPrivacyControl',{value:gpc});Object.defineProperty(navigator,'doNotTrack',{value:dnt?'1':'0'});
  window.maimaiUsageEnabled=!disabled;
  localStorage.setItem('maimai.party.analytics.v1',JSON.stringify({choice:'denied',expires:Date.now()+86400000}));
 },{gpc,dnt,disabled});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='maimai.party'){external.push(url.href);return route.fulfill({status:204,body:''});}
  if(url.pathname==='/__usage'){counts.push(JSON.parse(request.postData()));return route.fulfill({status:fail?503:204,body:''});}
  const file=resolve(root,'lab','.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+sep))return route.abort();
  try{await route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}
  catch{await route.fulfill({status:404,body:''});}
 });
 return {counts,external};
}
test('actual user hooks produce only finite page/actions after GA refusal',async({page,context})=>{
 const {counts,external}=await hosted(context);
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#search').fill('PRIVATE-SENTINEL');await page.locator('#search').fill('');
 await page.locator('#settings-toggle').click();await page.locator('#settings-toggle').click();
 await page.locator('#about-tab').click();await page.locator('#catalog-tab').click();
 await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.flatMap(b=>b.events);expect(rows.some(r=>r.event==='page_view')).toBe(true);expect(rows.some(r=>r.event==='settings_opened')).toBe(true);expect(rows.some(r=>r.event==='search_used')).toBe(true);
 expect(JSON.stringify(counts)).not.toContain('PRIVATE-SENTINEL');expect(external).toEqual([]);
 expect(await page.evaluate(()=>window.dataLayer)).toBeUndefined();
 for(const row of rows)expect(Object.keys(row).sort()).toEqual(['count','detail','event','failure','page']);
 const persisted=await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(k=>/usage/i.test(k)));expect(persisted).toEqual([]);
});
for(const option of [{gpc:true},{dnt:true},{disabled:true}])test('collection suppression '+JSON.stringify(option),async({page,context})=>{
 const {counts}=await hosted(context,option);await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#settings-toggle').click();await page.evaluate(()=>maimaiUsage.flush());expect(counts).toEqual([]);
});
test('collector failure and restoration leave the browser usable without replay',async({page,context})=>{
 const {counts}=await hosted(context,{fail:true});await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.evaluate(()=>maimaiUsage.flush());const before=counts.length;await page.evaluate(()=>maimaiUsage.flush());expect(counts).toHaveLength(before);
 await page.evaluate(()=>maimaiUsage.suspend(()=>maimaiUsage.emit('settings_opened')));await page.evaluate(()=>maimaiUsage.flush());expect(counts).toHaveLength(before);
 await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#catalog-count strong')).toHaveText('1');
});

test('BPM emits only its finite category and never replays on restore', async ({ page, context }) => {
  const { counts, external } = await hosted(context);
  await page.addInitScript(() => localStorage.setItem('maimai-catalog-filters-collapsed', '0'));
  await page.goto('https://maimai.party/');
  await expect(page.locator('#filter-bpm-value')).toBeVisible();
  await page.locator('#filter-bpm-operator').selectOption('gte');
  await page.evaluate(() => maimaiUsage.flush());
  expect(counts.flatMap(batch => batch.events).filter(row => row.detail === 'bpm')).toHaveLength(0);
  await page.locator('#filter-bpm-value').fill('173.125');
  await page.locator('#filter-bpm-value').press('Enter');
  await page.locator('#filter-bpm-value').press('Tab');
  await page.evaluate(() => maimaiUsage.flush());
  const events = counts.flatMap(batch => batch.events).filter(row => row.detail === 'bpm');
  expect(events).toHaveLength(1);
  expect(events[0].event).toBe('filter_first_used');
  expect(events[0].count).toBe(1);
  const before = JSON.stringify(counts);
  await page.evaluate(() => { maimaiBrowserState.restore(maimaiBrowserState.capture()); maimaiUsage.flush(); });
  expect(JSON.stringify(counts)).toBe(before);
  expect(before).not.toContain('173.125');
  expect(external).toEqual([]);
});

test('export actions count explicit intent and current outcomes without private values or restored choices',async({page,context})=>{
 const {counts,external}=await hosted(context);
 await page.addInitScript(()=>localStorage.setItem('maimai-chart-sections-v1',JSON.stringify({chart:false,player:false})));
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 const data=await page.evaluate(async()=>{
  await maimaiPersonal.ready;
  const core=maimaiPlayerData,catalog=maimaiResearchCatalog,first=catalog.catalog[0],id='private-export-chart';
  const chart={chartID:id,songID:'private-song',title:first.title,artist:first.artist,format:first.format,difficulty:first.difficulty,level:'14',constant:140,displayVersion:'PRiSM PLUS',inGameID:null};
  const record={chartID:id,achievement:1005000,grade:'SSS+',rate:315,lamp:'ALL PERFECT',sync:'',constant:140,displayVersion:'PRiSM PLUS',timeAchieved:null,dxScore:null,maxDxScore:null,maxCombo:null,fast:null,slow:null,miss:null,good:null,great:null,perfect:null,pcrit:null};
  const ref=await core.digest(record),play={...record,achievement:970000,timeAchieved:Date.UTC(2026,9,10),pcrit:400},played=await core.digest(play);
  const snapshot={capturedAt:Date.UTC(2026,9,11),phase:'after',complete:true,versions:['PRiSM PLUS'],pbs:{[id]:ref}},sid=await core.digest(snapshot);
  const capture={capturedAt:snapshot.capturedAt,sourceKind:'sync',sourceID:'private-source',sessionID:'private-session',historyCoverage:'retained-window',playIDs:['private-play'],snapshotIDs:[sid]};
  const body={format:'maimai-player-data',schemaVersion:1,player:{key:'kamaitachi:maimaidx:private-sentinel',provider:'kamaitachi',game:'maimaidx',username:'PRIVATE-SENTINEL',displayName:'PRIVATE-SENTINEL'},charts:{[id]:chart},records:{[ref]:record,[played]:play},plays:{'private-play':played},snapshots:{[sid]:snapshot},captures:{[await core.digest(capture)]:capture}};
  const data={...body,revision:await core.digest(body)};await core.validate(data);
  maimaiPersonal.configure(catalog,{schema_version:'provider-mapping-1',charts:{[id]:{chart_id:first.chart_id,source_hash:first.source_hash}}});
  const url=new URL(location.href);url.searchParams.set('chart',first.chart_id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));
  return data;
 });
 await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
 await page.locator('#player-import-dialog .player-remember input').uncheck();await page.locator('#player-import-dialog .player-actions button').first().click();
 await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
 // The real UI sends the completed local import promptly, without calling flush
 // from this test or waiting for the ordinary ten-second batching timer.
 await expect.poll(()=>counts.flatMap(batch=>batch.events).filter(row=>row.event==='import_completed'&&row.detail==='file').reduce((sum,row)=>sum+row.count,0),{timeout:3000}).toBe(1);
 for(const event of ['import_started','import_previewed','import_confirmed'])
  expect(counts.flatMap(batch=>batch.events).filter(row=>row.event===event&&row.detail==='file').reduce((sum,row)=>sum+row.count,0)).toBe(1);
 const flush=()=>page.evaluate(()=>maimaiUsage.flush());
 const amount=(event,detail)=>counts.flatMap(batch=>batch.events).filter(row=>row.event===event&&row.detail===detail).reduce((sum,row)=>sum+row.count,0);
 const generate=async()=>{await page.locator('#player-export-generate').click();await expect(page.locator('#player-export-download')).toBeVisible();};
 const close=async()=>{await page.keyboard.press('Escape');await expect(page.locator('#player-export-dialog')).not.toBeVisible();};
 const download=async()=>{const event=page.waitForEvent('download');await page.locator('#player-export-download').click();await event;};
 await flush();
 await page.locator('#player-export-best50').click();await flush();
 expect(amount('score_export_opened','best50')).toBe(1);expect(amount('score_export_option_changed','version')).toBe(0);
 await page.locator('#player-export-version-button').click();await page.getByRole('option',{name:'maimai DX PRiSM PLUS',exact:true}).click();await flush();
 expect(amount('score_export_option_changed','version')).toBe(0);
 await page.locator('#player-export-version-button').click();await page.getByRole('option',{name:'maimai DX MAGiCAL',exact:true}).click();
 await generate();await download();await close();await page.locator('#player-export-best50').click();
 await expect(page.locator('#player-export-version')).toHaveValue('magical');await close();await flush();
 expect(amount('score_export_option_changed','version')).toBe(1);
 await page.locator('.player-export-achievement').first().click();await page.locator('#player-export-partner').selectOption('kanadera-magical');
 await page.evaluate(()=>{const encode=HTMLCanvasElement.prototype.toBlob;window.restoreUsagePNG=()=>HTMLCanvasElement.prototype.toBlob=encode;HTMLCanvasElement.prototype.toBlob=function(callback){window.releaseUsagePNG=()=>encode.call(this,callback,'image/png');};});
 await page.locator('#player-export-generate').click();await page.waitForFunction(()=>!!window.releaseUsagePNG);
 await page.locator('#player-export-partner').selectOption('derakkuma-magical');await page.evaluate(()=>{restoreUsagePNG();releaseUsagePNG();});
 await expect(page.locator('#player-export-download')).toBeHidden();await flush();
 expect(amount('score_export_completed','achievement_pb')).toBe(0);expect(amount('score_export_failed','achievement_pb')).toBe(0);
 await generate();await close();await page.locator('.player-export-play').first().click();await generate();await download();
 await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);});
 await page.locator('#player-export-generate').click();await expect(page.locator('#player-export-status')).toContainText('could not be created');await close();
 await page.evaluate(()=>document.getElementById('player-forget').click());await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);await flush();
 for(const [kind,started] of [['best50',1],['achievement_pb',2],['achievement_play',2]]){
  expect(amount('score_export_started',kind)).toBe(started);expect(amount('score_export_completed',kind)).toBe(1);
 }
 expect(amount('score_export_opened','best50')).toBe(2);expect(amount('score_export_opened','achievement_pb')).toBe(1);expect(amount('score_export_opened','achievement_play')).toBe(1);
 expect(amount('score_export_failed','achievement_play')).toBe(1);expect(amount('score_export_download_clicked','best50')).toBe(1);expect(amount('score_export_download_clicked','achievement_play')).toBe(1);
 expect(amount('score_export_option_changed','partner')).toBe(2);expect(amount('data_action','clear')).toBe(1);expect(amount('data_action','forget')).toBe(0);
 expect(JSON.stringify(counts)).not.toMatch(/PRIVATE-SENTINEL|private-export-chart|private-song|private-source|private-session|kanadera|derakkuma|magical|prismplus/i);expect(external).toEqual([]);
});
