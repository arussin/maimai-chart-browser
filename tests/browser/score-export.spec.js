import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const privateName='PRIVATE_EXPORT_SENTINEL';
const dialog=page=>page.locator('#player-export-dialog');

async function boot(page){
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-language-v1','en');
    localStorage.setItem('maimai-chart-sections-v1',JSON.stringify({chart:false,player:false}));
    const paint=CanvasRenderingContext2D.prototype.fillText;
    window.exportPaintText=[];
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.exportPaintText.push(String(text));return paint.call(this,text,...args);};
    const encode=HTMLCanvasElement.prototype.toBlob;
    window.exportCanvasLabels=[];
    HTMLCanvasElement.prototype.toBlob=function(...args){window.exportCanvasLabels.push(this.getAttribute('aria-label')||'');return encode.apply(this,args);};
  });
  await page.goto('/lab/');
  await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);
  await page.evaluate(()=>maimaiPersonal.ready);
  await expect(page.locator('#catalog-count strong')).toHaveText('6');
}

async function fixture(page,{version=true,missingAchievement=false,zeroRating=false}={}){
  return page.evaluate(async({version,missingAchievement,zeroRating,privateName})=>{
    const core=maimaiPlayerData,catalog=maimaiResearchCatalog,first=catalog.catalog[0];
    const body={format:'maimai-player-data',schemaVersion:1,player:{key:'kamaitachi:maimaidx:private_export_sentinel',provider:'kamaitachi',game:'maimaidx',username:'PRIVATE_EXPORT_SENTINEL',displayName:privateName},charts:{},records:{},plays:{},snapshots:{},captures:{}};
    const pbs={};
    for(let i=0;i<52;i++){
      const chartID='export-chart-'+i,displayVersion=i<36?'maimaiでらっくす PRiSM':'maimaiでらっくす PRiSM PLUS';
      body.charts[chartID]={chartID,songID:'export-song-'+i,title:i===0?first.title:'Fictional song '+i,artist:i===0?first.artist:'Fictional artist',format:i===0?first.format:'DX',difficulty:i===0?first.difficulty:'MASTER',level:'14',constant:140,displayVersion,inGameID:null};
      const record={chartID,achievement:missingAchievement?null:1005000-i,grade:missingAchievement?'':'SSS+',rate:missingAchievement?null:zeroRating?0:315-i,lamp:i===0?'ALL PERFECT':'FULL COMBO',sync:i===0?'FSD+':'',constant:140,displayVersion,timeAchieved:null,dxScore:null,maxDxScore:null,maxCombo:500,fast:0,slow:0,miss:0,good:0,great:2,perfect:12,pcrit:480};
      const ref=await core.digest(record);body.records[ref]=record;pbs[chartID]=ref;
    }
    const played={...body.records[pbs['export-chart-0']],achievement:970000,grade:'S',rate:280,lamp:'CLEAR',sync:'',timeAchieved:Date.UTC(2026,8,12,17),dxScore:2300,maxDxScore:2500,maxCombo:112,fast:4,slow:7,miss:2,good:3,great:10,perfect:23,pcrit:400};
    const playedRef=await core.digest(played);body.records[playedRef]=played;body.plays['fictional-export-play']=playedRef;
    const snapshot={capturedAt:Date.UTC(2026,8,13),phase:'after',complete:true,versions:version?['maimaiでらっくす PRiSM PLUS']:[],pbs};
    const snapshotID=await core.digest(snapshot);body.snapshots[snapshotID]=snapshot;
    const capture={capturedAt:snapshot.capturedAt,sourceKind:'sync',sourceID:'fictional-export',sessionID:'fictional-export-session',historyCoverage:'retained-window',playIDs:Object.keys(body.plays),snapshotIDs:[snapshotID]};
    body.captures[await core.digest(capture)]=capture;
    const data={...body,revision:await core.digest(body)};
    await core.validate(data);
    maimaiPersonal.configure(catalog,{schema_version:'provider-mapping-1',charts:{'export-chart-0':{chart_id:first.chart_id,source_hash:first.source_hash}}});
    const url=new URL(location.href);url.searchParams.set('chart',first.chart_id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));
    return data;
  },{version,missingAchievement,zeroRating,privateName});
}

async function importData(page,data){
  await page.locator('input[type=file]').setInputFiles({name:'fictional-export.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.locator('.player-dialog .player-remember input').check();
  await page.locator('.player-dialog .player-actions button').first().click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
}

async function generate(page){
  await page.evaluate(()=>{window.exportPaintText=[];window.exportCanvasLabels=[];});
  await page.locator('#player-export-generate').click();
  const download=page.locator('#player-export-download');
  // Artwork may use its full 5s deadline. Allow another 5s for lazy modules,
  // the 2000x5380 Best 50 canvas, PNG encoding and preview decoding on CI.
  // One shared bound still requires the real downloadable, decoded result.
  await expect.poll(async()=>({
    visible:await download.isVisible(),
    blob:/^blob:/.test(await download.getAttribute('href')||''),
    decoded:await page.locator('#player-export-preview').evaluate(img=>img.complete&&img.naturalWidth>0),
  }),{timeout:10000,message:'Export must finish artwork, PNG encoding and preview preparation'}).toEqual({visible:true,blob:true,decoded:true});
  return download;
}

async function downloadedPNG(page,download,testInfo,name){
  const event=page.waitForEvent('download');await download.click();const file=await event;
  expect(file.suggestedFilename()).toMatch(/\.png$/i);
  const path=testInfo?testInfo.outputPath(name):await file.path();
  if(testInfo)await file.saveAs(path);
  const bytes=await readFile(path);
  expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(1000);
  expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(700);
  return bytes;
}

async function fits(page){
  const result=await dialog(page).evaluate(root=>({
    page:document.documentElement.scrollWidth<=innerWidth+1,
    dialog:root.getBoundingClientRect().left>=-1&&root.getBoundingClientRect().right<=innerWidth+1,
    clipped:[...root.querySelectorAll('button,label,select,a')].filter(n=>n.getBoundingClientRect().width&&n.clientWidth&&n.scrollWidth>n.clientWidth+1).map(n=>n.id||n.className),
  }));
  expect(result).toEqual({page:true,dialog:true,clipped:[]});
}

test('Best 50 uses the imported version and downloads a local PNG without changing or transmitting player data',async({page},testInfo)=>{
  await boot(page);await expect(page.locator('#player-export-best50')).toBeHidden();
  const data=await fixture(page);await importData(page,data);
  const requests=[];page.on('request',request=>requests.push(request.url()+' '+(request.postData()||'')));
  await page.locator('#player-export-best50').click();await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#player-export-version')).not.toHaveValue('');
  const download=await generate(page);await downloadedPNG(page,download,testInfo,'best50.png');
  const text=await page.evaluate(()=>exportPaintText.join(''));
  expect(text).toContain(privateName);expect(text).toMatch(/35/);expect(text).toMatch(/15/);
  expect(requests.join('\n')).not.toContain(privateName);
  expect(requests.join('\n')).not.toContain('private_export_sentinel');
  expect(await page.evaluate(async()=>{const saved=await maimaiPlayerStorage.read();return (await maimaiPlayerData.decode(saved.active.bytes)).revision;})).toBe(data.revision);
  await page.keyboard.press('Escape');await expect(dialog(page)).not.toBeVisible();await expect(page.locator('#player-export-best50')).toBeFocused();
});

test('export canvas and artwork stay unloaded until Generate and unused partners never load',async({page})=>{
  const requested=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(/\/score-export-[^/]+\.js$/.test(path))requested.push(path);});
  await boot(page);await importData(page,await fixture(page));
  expect(requested).toEqual([]);
  await page.locator('#player-export-best50').click();await expect(dialog(page)).toBeVisible();
  expect(requested).toEqual([]);
  await generate(page);
  expect(requested.some(path=>path.includes('/score-export-canvas-'))).toBe(true);
  expect(requested.some(path=>path.includes('/score-export-afterglow-artwork-'))).toBe(true);
  expect(requested.filter(path=>path.includes('/score-export-artwork-'))).toEqual([]);
  expect(requested.some(path=>path.includes('/score-export-result-artwork-'))).toBe(true);
  expect(requested.filter(path=>path.includes('/score-export-partner-'))).toEqual([]);
  await page.keyboard.press('Escape');await page.locator('.player-export-achievement').first().click();
  await expect(page.locator('#player-export-partner')).toHaveCount(0);
  expect(requested.filter(path=>path.includes('/score-export-partner-'))).toEqual([]);
  await generate(page);
  expect(requested.some(path=>path.includes('/score-export-result-artwork-'))).toBe(true);
  expect(requested.filter(path=>path.includes('/score-export-artwork-'))).toEqual([]);
  expect(requested.filter(path=>path.includes('/score-export-partner-'))).toEqual([]);
});

test('an import without version evidence requires a choice and changing version discards the previous preview',async({page})=>{
  await boot(page);await importData(page,await fixture(page,{version:false}));
  await page.locator('#player-export-best50').click();
  const version=page.locator('#player-export-version');await expect(version).toHaveValue('');await expect(page.locator('#player-export-generate')).toBeDisabled();
  const options=await version.locator('option').evaluateAll(nodes=>nodes.filter(n=>n.value).map(n=>({value:n.value,label:n.textContent})));
  const selected=options.find(n=>/PRiSM PLUS/i.test(n.label));expect(selected).toBeTruthy();
  await page.locator('#player-export-version-button').click();
  await page.getByRole('option',{name:selected.label,exact:true}).click();
  await generate(page);
  await page.locator('#player-export-version-button').click();
  await page.getByRole('option',{name:'maimai DX MAGiCAL',exact:true}).click();
  await expect(page.locator('#player-export-download')).toBeHidden();
});

test('all release logos remain available newest first with a detected import and keyboard selection',async({page})=>{
  await boot(page);await importData(page,await fixture(page));
  await page.locator('#player-export-best50').click();
  const button=page.locator('#player-export-version-button'),list=page.locator('#player-export-version-choices');
  await expect(page.locator('#player-export-version')).toHaveValue('prismplus');
  await button.click();
  const options=list.getByRole('option');await expect(options).toHaveCount(28);
  const names=await options.allTextContents();
  expect(names.slice(0,4)).toEqual(['maimai DX MAGiCAL','maimai DX CiRCLE PLUS','maimai DX CiRCLE','maimai DX PRiSM PLUS']);
  expect(names.at(-1)).toBe('maimai');
  expect(names.filter(name=>name==='maimai DX PRiSM PLUS')).toHaveLength(1);
  await expect(options.first().locator('.version-logo img')).toHaveCount(1);
  await expect(options.locator('.version-logo img')).toHaveCount(28);
  await expect.poll(()=>options.first().locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await expect(page.locator('#player-export-version')).toHaveValue('magical');
  await expect(button).toBeFocused();await expect(list).toBeHidden();
  await button.click();await page.keyboard.press('End');await page.keyboard.press('Enter');
  await expect(page.locator('#player-export-version')).toHaveValue('original');
  await expect(page.locator('#player-export-generate')).toBeDisabled();
  await expect(page.locator('#player-export-summary')).toContainText('Best 50 began with Splash PLUS');
  await button.click();await page.keyboard.press('Escape');
  await expect(list).toBeHidden();await expect(dialog(page)).toBeVisible();await expect(button).toBeFocused();
  await button.click();await page.getByRole('option',{name:'maimai DX PRiSM PLUS',exact:true}).click();
  await expect(page.locator('#player-export-summary')).toContainText('35/35');
  await expect(page.locator('#player-export-summary')).toContainText('15/15');
});

test('achievement export distinguishes a PB from a recorded play and does not invent missing judgments',async({page},testInfo)=>{
  await boot(page);await importData(page,await fixture(page));
  await page.locator('.player-export-achievement').first().click();
  await downloadedPNG(page,await generate(page),testInfo,'achievement-pb.png');
  let text=await page.evaluate(()=>[...exportPaintText,...exportCanvasLabels].join(''));
  expect(text).toMatch(/100\.5000/);expect(text).not.toMatch(/97\.0000/);expect(text).not.toMatch(/critical perfect/i);expect(await page.evaluate(()=>exportPaintText)).not.toContain('480');
  expect(text).toContain('Current reconstructed rating');expect(text).toContain('14510');expect(await page.evaluate(()=>exportPaintText)).toContain('315');
  await page.keyboard.press('Escape');await page.locator('.player-export-play').first().click();
  await downloadedPNG(page,await generate(page),testInfo,'achievement-play.png');
  text=await page.evaluate(()=>[...exportPaintText,...exportCanvasLabels].join(''));
  expect(text).toMatch(/97\.0000/);expect(text).not.toMatch(/100\.5000/);expect(text).toContain('2300');expect(text).toMatch(/critical perfect/i);expect(await page.evaluate(()=>exportPaintText)).toContain('400');
  expect(text).toContain('Current reconstructed rating');expect(text).toContain('14510');expect(await page.evaluate(()=>exportPaintText)).toContain('280');
});

test('achievement profile rating preserves a real zero and a later unknown profile does not reuse it',async({page})=>{
  await boot(page);await importData(page,await fixture(page,{zeroRating:true}));
  await expect(page.locator('#player-status .player-rating')).toHaveAttribute('aria-label','Reconstructed rating 0');
  await page.locator('.player-export-achievement').first().click();await generate(page);
  let text=await page.evaluate(()=>[...exportPaintText,...exportCanvasLabels].join(''));
  expect(text).toContain('Current reconstructed rating');expect(text).toMatch(/Current reconstructed rating\s*0/);expect(await page.evaluate(()=>exportPaintText)).toContain('0');
  await page.keyboard.press('Escape');await importData(page,await fixture(page,{version:false}));
  await expect(page.locator('#player-status .player-rating')).toHaveAttribute('aria-label','Rating unknown');
  await page.locator('.player-export-achievement').first().click();await generate(page);
  text=await page.evaluate(()=>[...exportPaintText,...exportCanvasLabels].join(''));
  expect(text).not.toContain('Current reconstructed rating');expect(text).not.toContain('Current imported rating');expect(await page.evaluate(()=>exportPaintText)).toContain('315');
});

test('manual version survives exports and reload while unused partner preferences remain intact',async({page},testInfo)=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('maimai-score-export-preferences-v1'))localStorage.setItem('maimai-score-export-preferences-v1',JSON.stringify({schemaVersion:1,versionID:'prismplus',partnerKey:'kanadera-magical'}));});
  await boot(page);await importData(page,await fixture(page));
  await page.locator('#player-export-best50').click();
  await page.locator('#player-export-version-button').click();
  await page.getByRole('option',{name:'maimai DX MAGiCAL',exact:true}).click();
  await expect(dialog(page)).toContainText('Using your saved version choice. Check that it matches this record.');
  await page.keyboard.press('Escape');
  await page.locator('.player-export-achievement').first().click();
  await expect(page.locator('#player-export-partner')).toHaveCount(0);
  await downloadedPNG(page,await generate(page),testInfo,'achievement-no-partner.png');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('maimai-score-export-preferences-v1')))).toEqual({schemaVersion:1,versionID:'magical',partnerKey:'kanadera-magical'});
  await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  await fixture(page); // Restore the synthetic chart mapping after the actual reload.
  await page.locator('#player-export-best50').click();
  await expect(page.locator('#player-export-version')).toHaveValue('magical');
  await expect(dialog(page)).toContainText('Using your saved version choice. Check that it matches this record.');
  await page.keyboard.press('Escape');await page.locator('.player-export-achievement').first().click();
  await expect(page.locator('#player-export-partner')).toHaveCount(0);
  await page.keyboard.press('Escape');await page.evaluate(()=>document.getElementById('player-forget').click());
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active)).toBeNull();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('maimai-score-export-preferences-v1')))).toEqual({schemaVersion:1,versionID:'magical',partnerKey:'kanadera-magical'});
});

test('invalid stored export choices fall back to detected version and no partner',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('maimai-score-export-preferences-v1',JSON.stringify({schemaVersion:1,versionID:'unknown-release',partnerKey:'https://untrusted.invalid/character.png'})));
  await boot(page);await importData(page,await fixture(page));
  await page.locator('#player-export-best50').click();await expect(page.locator('#player-export-version')).toHaveValue('prismplus');
  await expect(dialog(page)).toContainText('Version detected from your imported report.');
  await page.keyboard.press('Escape');await page.locator('.player-export-achievement').first().click();
  await expect(page.locator('#player-export-partner')).toHaveCount(0);
});

test('Escape removes the generated preview and private modal content and revokes its download URL',async({page})=>{
  await boot(page);await importData(page,await fixture(page));
  await page.evaluate(()=>{
    const original=URL.revokeObjectURL.bind(URL);window.revokedExportURLs=[];
    URL.revokeObjectURL=url=>{window.revokedExportURLs.push(url);original(url);};
  });
  await page.locator('.player-export-achievement').first().click();
  const download=await generate(page),url=await download.getAttribute('href');
  await expect(page.locator('#player-export-preview')).toHaveAttribute('src',/^data:image\/png/);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(dialog(page).locator('*')).toHaveCount(0);
  expect(await dialog(page).textContent()).toBe('');
  expect(await page.evaluate(()=>revokedExportURLs)).toContain(url);
});

for(const action of ['hide','forget','version'])test(action+' during PNG encoding discards the export and rejects late completion',async({page})=>{
  await boot(page);await importData(page,await fixture(page));
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob,createURL=URL.createObjectURL.bind(URL);
    window.pendingExportPNG=null;window.exportObjectURLs=[];
    URL.createObjectURL=blob=>{const url=createURL(blob);window.exportObjectURLs.push(url);return url;};
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){window.pendingExportPNG={canvas:this,callback,type,quality};};
    window.releaseExportPNG=async()=>{
      HTMLCanvasElement.prototype.toBlob=original;
      const pending=window.pendingExportPNG;window.pendingExportPNG=null;
      await new Promise(resolve=>original.call(pending.canvas,blob=>{pending.callback(blob);queueMicrotask(resolve);},pending.type,pending.quality));
      await Promise.resolve();
    };
  });
  await page.locator(action==='version'?'#player-export-best50':'.player-export-achievement').first().click();
  await page.locator('#player-export-generate').click();
  await expect.poll(()=>page.evaluate(()=>!!window.pendingExportPNG)).toBe(true);
  await expect(page.locator('#player-export-generate')).toBeDisabled();
  if(action==='version'){
      await page.locator('#player-export-version-button').click();
      await page.getByRole('option',{name:'maimai DX MAGiCAL',exact:true}).click();
    await page.evaluate(()=>releaseExportPNG());
    await expect(page.locator('#player-export-download')).toBeHidden();
    await expect(page.locator('#player-export-generate')).toBeEnabled();
    expect(await page.evaluate(()=>exportObjectURLs)).toEqual([]);
    await generate(page);
    return;
  }
  // A different owner effect can hide/clear the profile while this modal is inert.
  // Exercise the existing actions without bypassing their data lifecycle.
  await page.evaluate(action=>document.getElementById(action==='hide'?'player-toggle':'player-forget').click(),action);
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await expect(dialog(page)).not.toBeVisible();
  await expect(dialog(page).locator('*')).toHaveCount(0);
  if(action==='forget'){
    await expect(page.locator('#player-import-dialog')).toContainText('Player data cleared');
    expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active)).toBeNull();
  }
  await page.evaluate(()=>releaseExportPNG());
  await expect(dialog(page)).not.toBeVisible();
  await expect(dialog(page).locator('*')).toHaveCount(0);
  await expect(page.locator('#player-export-preview,#player-export-download')).toHaveCount(0);
  expect(await page.evaluate(()=>exportObjectURLs)).toEqual([]);
});

for(const locale of ['en','zh-Hans','ko','ja','id'])test('export controls fit at narrow widths and update language: '+locale,async({page},testInfo)=>{
  await boot(page);await importData(page,await fixture(page));
  await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);
  await page.locator('#player-export-best50').click();
  for(const width of [640,320,280]){
    await page.setViewportSize({width,height:900});await fits(page);
    await page.locator('#player-export-version-button').click();await fits(page);
    await page.keyboard.press('Escape');await expect(dialog(page)).toBeVisible();
  }
  if(locale!=='en')await expect(page.locator('#player-export-generate')).not.toHaveText('Create image');
  await generate(page);await fits(page);await dialog(page).screenshot({path:testInfo.outputPath('best50-'+locale+'-280.png')});
  await page.keyboard.press('Escape');await page.locator('.player-export-achievement').first().click();await fits(page);
  await expect(page.locator('#player-export-partner')).toHaveCount(0);await fits(page);
  await generate(page);await fits(page);await dialog(page).screenshot({path:testInfo.outputPath('achievement-'+locale+'-280.png')});
  const captions={en:'Current reconstructed rating','zh-Hans':'当前重建的 Rating',ko:'현재 재구성한 레이팅',ja:'現在の再計算レーティング',id:'Rating hasil rekonstruksi saat ini'};
  expect(await page.evaluate(()=>[...exportPaintText,...exportCanvasLabels].join(''))).toContain(captions[locale]);
});
