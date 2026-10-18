import {test,expect} from './fixtures.js';
import {selectImportMethod} from './player-import-fixture.mjs';
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
 for(const batch of counts)for(const row of batch.events)expect(Object.keys(row).sort()).toEqual(batch.version===1?['count','detail','event','failure','page']:['count','duration','instrumentation','mode','operation','outcome','reason','source','stage']);
 const persisted=await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(k=>/usage/i.test(k)));expect(persisted).toEqual([]);
});
test('opening imports checks visibility without emitting import attempts or provider activity',async({page,context})=>{
 const {counts,external}=await hosted(context),configurationRequests=[],providerRequests=[];
 let malformed=false;
 await context.route('https://maimai.party/api/player-import/oauth/connectors',async route=>{
  const request=route.request();configurationRequests.push({url:request.url(),method:request.method()});
  await route.fulfill({status:200,contentType:'application/json',body:malformed?'{invalid':JSON.stringify({schemaVersion:1,methods:{'file:tomomai':true}})});
 });
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.pathname.startsWith('/api/player-import/')&&!(request.method()==='GET'&&url.pathname==='/api/player-import/oauth/connectors'&&!url.search))providerRequests.push(request.url());
 });
 await page.goto('https://maimai.party/');
 await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
 await page.locator('#player-import-primary').click();
 await expect(page.locator('#player-import-dialog [data-import-service="tomomai"]')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#player-import-dialog')).toBeHidden();
 malformed=true;await page.locator('#player-import-primary').click();
 await expect(page.locator('#player-import-dialog')).toContainText('You can still upload a Session Report file.');
 await expect(page.locator('#player-import-dialog [data-import-service]')).toHaveCount(1);
 await expect(page.locator('#player-import-dialog [data-import-service="session-report"]')).toBeVisible();
 await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.flatMap(batch=>batch.events);
 expect(rows.filter(row=>row.event==='import_opened').reduce((total,row)=>total+row.count,0)).toBe(2);
 expect(rows.filter(row=>row.event?.startsWith('provider_')||/^import_(?:started|previewed|confirmed|completed|failed|cancelled)$/.test(row.event))).toEqual([]);
 const diagnostics=rows.filter(row=>row.operation==='connector_config');
 expect(diagnostics.reduce((total,row)=>total+row.count,0)).toBe(2);
 expect(diagnostics).toEqual(expect.arrayContaining([
  expect.objectContaining({source:'none',mode:'automatic',stage:'complete',outcome:'success',reason:'none',count:1}),
  expect.objectContaining({source:'none',mode:'automatic',stage:'response',outcome:'failed',reason:'malformed_response',count:1}),
 ]));
 expect(configurationRequests).toEqual(Array.from({length:2},()=>({url:'https://maimai.party/api/player-import/oauth/connectors',method:'GET'})));
 expect(providerRequests).toEqual([]);expect(external).toEqual([]);
});
test('Tomomai file chooser logs finite preview, saved import, and malformed-file outcomes',async({page,context})=>{
 const {counts,external}=await hosted(context),providerRequests=[];
 await context.route('https://maimai.party/api/player-import/oauth/connectors',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:1,methods:{'file:tomomai':true}})}));
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.pathname.startsWith('/api/player-import/')&&!(request.method()==='GET'&&url.pathname==='/api/player-import/oauth/connectors'&&!url.search))providerRequests.push(request.url());
 });
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 const snapshot=await page.evaluate(async()=>{
  await maimaiPersonal.ready;
  const chart=maimaiResearchCatalog.catalog[0];
  return {fetchedAt:'2026-10-01T12:00:00Z',displayName:'PRIVATE-TOMOMAI-DISPLAY',songs:[{songId:'abcdefgh:i11',songName:chart.title,artist:chart.artist,type:chart.format,difficulty:chart.difficulty,achievement:987643,fc:'fc',fs:'',dxScore:null,level:chart.level||'',levelPrecise:null}]};
 });
 const choose=async data=>{
  await page.locator('#settings-toggle').click();await page.locator('#player-import').click();
  await selectImportMethod(page,'file:tomomai');
  await page.locator('#player-file-account').fill('PRIVATE-TOMOMAI-ACCOUNT');await page.locator('#player-file-region').selectOption('intl');
  const choosing=page.waitForEvent('filechooser');await page.locator('#player-import-dialog .player-actions button').first().click();
  await (await choosing).setFiles({name:'PRIVATE-TOMOMAI-FILE.json',mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
 };
 const amount=(event,failure)=>counts.flatMap(batch=>batch.events).filter(row=>row.event===event&&row.detail==='file:tomomai'&&(failure===undefined||row.failure===failure)).reduce((sum,row)=>sum+row.count,0);
 await choose(snapshot);await expect(page.locator('#player-import-dialog .player-remember')).toBeVisible();
 expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active)).toBeNull();
 await page.evaluate(()=>maimaiUsage.flush());
 expect(amount('import_started')).toBe(1);expect(amount('import_previewed')).toBe(1);expect(amount('import_confirmed')).toBe(0);expect(amount('import_completed')).toBe(0);
 await page.locator('#player-import-dialog .player-remember input').check();await page.locator('#player-import-dialog .player-actions button').first().click();
 await expect(page.locator('#player-import-dialog')).toBeHidden();
 await expect.poll(()=>page.evaluate(async()=>typeof (await maimaiPlayerStorage.read()).active?.revision)).toBe('string');
 await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
 const saved=await page.evaluate(async()=>{
  const {active}=await maimaiPlayerStorage.read(),data=await maimaiPlayerData.decode(active.bytes);
  return {revision:active.revision,key:data.player.key,achievement:Object.values(data.records)[0].achievement};
 });
 expect(saved.key).toBe('tomomai:maimaidx:intl:PRIVATE-TOMOMAI-ACCOUNT');expect(saved.achievement).toBe(987643);
 await choose('{invalid');await expect(page.locator('#player-import-dialog')).toContainText('Choose a valid JSON export for the selected source.');
 expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active?.revision)).toBe(saved.revision);
 await page.evaluate(()=>maimaiUsage.flush());
 for(const [event,count] of [['import_started',2],['import_previewed',1],['import_confirmed',1],['import_completed',1],['import_failed',1],['import_cancelled',0]])expect(amount(event),event).toBe(count);
 expect(amount('import_failed','invalid')).toBe(1);
 const diagnostics=counts.filter(batch=>batch.version===2).flatMap(batch=>batch.events).filter(row=>row.operation==='import'&&row.source==='file:tomomai');
 expect(diagnostics.reduce((sum,row)=>sum+row.count,0)).toBe(2);
 expect(diagnostics).toEqual(expect.arrayContaining([
  expect.objectContaining({mode:'manual',stage:'commit',outcome:'success',reason:'none',count:1}),
  expect.objectContaining({mode:'manual',stage:'decode',outcome:'failed',reason:'malformed_response',count:1}),
 ]));
 const rows=counts.flatMap(batch=>batch.events),stages=rows.filter(row=>/^import_(?:started|previewed|confirmed|completed|failed|cancelled)$/.test(row.event));
 expect(stages.every(row=>row.detail==='file:tomomai')).toBe(true);expect(rows.filter(row=>row.event?.startsWith('provider_'))).toEqual([]);
 for(const batch of counts)for(const row of batch.events)expect(Object.keys(row).sort()).toEqual(batch.version===1?['count','detail','event','failure','page']:['count','duration','instrumentation','mode','operation','outcome','reason','source','stage']);
 expect(JSON.stringify(counts)).not.toMatch(/PRIVATE-TOMOMAI|abcdefgh:i11|987643|2026-10-01T12:00:00Z/);
 expect(providerRequests).toEqual([]);expect(external).toEqual([]);
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

async function prepareExport(page){
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
}

for(const fault of ['renderer_module','canvas_context','preview_preparation','artwork_failed'])test('export diagnostic boundary '+fault,async({page,context})=>{
 const {counts,external}=await hosted(context);await prepareExport(page);
 if(fault==='renderer_module')await page.route('**/score-export-canvas-*.js',route=>route.abort());
 if(fault==='artwork_failed')await page.route('**/score-export-afterglow-artwork-*.js',route=>route.abort());
 if(fault==='canvas_context')await page.evaluate(()=>HTMLCanvasElement.prototype.getContext=()=>null);
 if(fault==='preview_preparation')await page.evaluate(()=>{
  const decode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=function(){return this.id==='player-export-preview'?Promise.reject(new Error('PRIVATE-SENTINEL')):decode.call(this);};
 });
 await page.locator('#player-export-best50').click();await page.locator('#player-export-generate').click();
 if(fault==='artwork_failed')await expect(page.locator('#player-export-download')).toBeVisible();
 else await expect(page.locator('#player-export-status')).toContainText('could not be created');
 await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.filter(b=>b.version===2).flatMap(b=>b.events).filter(r=>r.operation==='image_export');
 expect(rows.reduce((n,r)=>n+r.count,0)).toBe(1);
 expect(rows[0]).toMatchObject({reason:fault,outcome:fault==='artwork_failed'?'degraded':'failed'});
 expect(JSON.stringify(counts)).not.toContain('PRIVATE-SENTINEL');expect(external).toEqual([]);
});

for(const action of ['close','replace'])test('render '+action+' is a single cancellation or supersession',async({page,context})=>{
 const {counts}=await hosted(context);await prepareExport(page);
 await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=function(callback){window.releaseUsagePNG=()=>callback(null);});
 await page.locator('#player-export-best50').click();await page.locator('#player-export-generate').click();
 await page.waitForFunction(()=>!!window.releaseUsagePNG);
 if(action==='close')await page.keyboard.press('Escape');
 else await page.evaluate(()=>document.getElementById('player-forget').click());
 await expect(page.locator('#player-export-dialog')).not.toBeVisible();
 await page.evaluate(()=>releaseUsagePNG());await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.filter(b=>b.version===2).flatMap(b=>b.events).filter(r=>r.operation==='image_export');
 expect(rows.reduce((n,r)=>n+r.count,0)).toBe(1);expect(rows[0].outcome).toBe(action==='close'?'cancelled':'superseded');
 expect(counts.flatMap(b=>b.events).some(r=>r.event==='score_export_failed')).toBe(false);
});

test('comparison exceptions are finite and deliberate same-chart selections are not failures',async({page,context})=>{
 const {counts}=await hosted(context);await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#compare-tab').click();
 const choose=async(side,title)=>{await page.locator('#compare-'+side+'-search').fill(title);await page.locator('#compare-'+side+'-choices [role=option]').first().click();};
 await choose('left','Fictional study 0');await choose('right','Fictional study 0');await page.evaluate(()=>maimaiUsage.flush());
 expect(counts.flatMap(b=>b.events).filter(r=>r.operation==='comparison'&&r.outcome==='failed')).toEqual([]);
 await page.locator('#compare-right-search').fill('Fictional study 1');
 await page.evaluate(()=>document.getElementById('direct-comparison').replaceChildren=()=>{throw Error('PRIVATE-SENTINEL');});
 await page.locator('#compare-right-choices [role=option]').first().click();await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.flatMap(b=>b.events).filter(r=>r.operation==='comparison');
 expect(rows.reduce((n,r)=>n+r.count,0)).toBe(1);expect(rows[0]).toMatchObject({reason:'unknown',stage:'compute',outcome:'failed'});
 expect(JSON.stringify(counts)).not.toContain('PRIVATE-SENTINEL');
});

test('similar exceptions and empty matches have different outcomes',async({page,context})=>{
 const {counts}=await hosted(context);await page.addInitScript(()=>localStorage.setItem('maimai-catalog-filters-collapsed','0'));await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#compare-tab').click();await page.locator('#compare-left-search').fill('Fictional study 0');await page.locator('#compare-left-choices [role=option]').first().click();
 await page.evaluate(()=>document.getElementById('similar-results').replaceChildren=()=>{throw Error('PRIVATE-SENTINEL');});
 await page.locator('#find-similar').click();await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.flatMap(b=>b.events).filter(r=>r.operation==='similar');
 expect(rows.reduce((n,r)=>n+r.count,0)).toBe(1);expect(rows[0]).toMatchObject({reason:'unknown',outcome:'failed'});
 await page.evaluate(()=>delete document.getElementById('similar-results').replaceChildren);
 await page.locator('#similar-priority').selectOption('measurements');
 await page.locator('#catalog-tab').click();await page.locator('#filter-bpm-operator').selectOption('lte');await page.locator('#filter-bpm-value').fill('1');await page.locator('#filter-bpm-value').press('Enter');await expect(page.locator('#catalog-count strong')).toHaveText('0');
 await page.locator('#compare-tab').click();await page.locator('#similar-use-filters').check();await page.locator('#find-similar').click();await page.evaluate(()=>maimaiUsage.flush());
 expect(counts.flatMap(b=>b.events).some(r=>r.operation==='similar'&&r.outcome==='empty'&&r.reason==='no_matches')).toBe(true);
 expect(JSON.stringify(counts)).not.toContain('PRIVATE-SENTINEL');
});

test('export actions count explicit intent and current outcomes without private values or restored choices',async({page,context})=>{
 const {counts,external}=await hosted(context);
 await prepareExport(page);
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
 await page.locator('.player-export-achievement').first().click();await expect(page.locator('#player-export-partner')).toHaveCount(0);
 await page.evaluate(()=>{const encode=HTMLCanvasElement.prototype.toBlob;window.restoreUsagePNG=()=>HTMLCanvasElement.prototype.toBlob=encode;HTMLCanvasElement.prototype.toBlob=function(callback){window.releaseUsagePNG=()=>new Promise(resolve=>encode.call(this,blob=>{callback(blob);resolve();},'image/png'));};});
 await page.locator('#player-export-generate').click();await page.waitForFunction(()=>!!window.releaseUsagePNG);
 // Closing cancels this render; its delayed encoder must not fill the reopened dialog.
 await close();await expect(page.locator('.player-export-achievement').first()).toBeFocused();await page.locator('.player-export-achievement').first().click();
 await page.evaluate(async()=>{restoreUsagePNG();await releaseUsagePNG();});
 await expect(page.locator('#player-export-download')).toBeHidden();await flush();
 expect(amount('score_export_completed','achievement_pb')).toBe(0);expect(amount('score_export_failed','achievement_pb')).toBe(0);
 await generate();await close();await page.locator('.player-export-play').first().click();await generate();await download();
 await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);});
 await page.locator('#player-export-generate').click();await expect(page.locator('#player-export-status')).toContainText('could not be created');await close();
 await page.evaluate(()=>document.getElementById('player-forget').click());await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);await flush();
 for(const [kind,started] of [['best50',1],['achievement_pb',2],['achievement_play',2]]){
  expect(amount('score_export_started',kind)).toBe(started);expect(amount('score_export_completed',kind)).toBe(1);
 }
 expect(amount('score_export_opened','best50')).toBe(2);expect(amount('score_export_opened','achievement_pb')).toBe(2);expect(amount('score_export_opened','achievement_play')).toBe(1);
 expect(amount('score_export_failed','achievement_play')).toBe(1);expect(amount('score_export_download_clicked','best50')).toBe(1);expect(amount('score_export_download_clicked','achievement_play')).toBe(1);
 expect(amount('score_export_option_changed','partner')).toBe(0);expect(amount('data_action','clear')).toBe(1);expect(amount('data_action','forget')).toBe(0);
 const diagnostics=counts.filter(b=>b.version===2).flatMap(b=>b.events).filter(r=>r.operation==='image_export');
 const outcomes=(kind,outcome,reason)=>diagnostics.filter(r=>r.source===kind&&r.outcome===outcome&&(!reason||r.reason===reason)).reduce((n,r)=>n+r.count,0);
 expect(outcomes('achievement_pb','cancelled','none')).toBe(1);expect(outcomes('achievement_pb','superseded')).toBe(0);expect(outcomes('achievement_play','failed','png_encoding')).toBe(1);
 expect(diagnostics.find(row=>row.source==='achievement_pb'&&row.outcome==='cancelled')).toMatchObject({mode:'manual',stage:'encode',reason:'none',count:1});
 expect(diagnostics.reduce((n,r)=>n+r.count,0)).toBe(5);
 expect(JSON.stringify(counts)).not.toMatch(/PRIVATE-SENTINEL|private-export-chart|private-song|private-source|private-session|kanadera|derakkuma|magical|prismplus/i);expect(external).toEqual([]);
});
