import {test,expect} from './fixtures.js';
test.beforeEach(async({fixtureOrigins})=>{for(const origin of ["https://public-report.example"])fixtureOrigins.synthetic(origin);});
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const manifest='https://public-report.example/fixture/party/latest.json';
async function boot(page){await page.goto('/lab/');await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);}
async function fixture(page){const data=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));return page.evaluate(d=>maimaiPlayerData.reconcile(d),data);}
async function mock(context,page,data,{status=200,html=false,delay=null}={}){
  const bytes=gzipSync(Buffer.from(JSON.stringify(data))),sha=createHash('sha256').update(bytes).digest('hex'),offer=await page.evaluate(d=>maimaiPlayerData.offer(d),data);
  await context.route('https://public-report.example/**',async route=>{
    if(route.request().url().endsWith('latest.json')){if(delay)await delay();await route.fulfill({status,contentType:html?'text/html':'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:html?'<html>Sign in</html>':JSON.stringify({...offer,object:{path:'/fixture/party/data/'+sha+'.gz',sha256:sha,bytes:bytes.length}})});}
    else await route.fulfill({contentType:'application/gzip',headers:{'Access-Control-Allow-Origin':'*'},body:bytes});
  });
}
async function openImport(page){await page.locator('#settings-toggle').click();await page.locator('#player-import').click();}
async function importReport(page,remember=true){await openImport(page);await page.getByLabel('Hosted Session Report',{exact:true}).check();await page.getByLabel('Hosted Session Report URL',{exact:true}).fill(manifest);await page.getByLabel('Remember and refresh').setChecked(remember);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:remember?'Import & remember':'Import once',exact:true}).click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);if(remember)await expect.poll(async()=>!!(await saved(page)).active?.source).toBe(true);}
async function saved(page){return page.evaluate(()=>maimaiPlayerStorage.read());}
async function age(page){await page.evaluate(async()=>{const db=await new Promise(resolve=>{const q=indexedDB.open('maimai-player-data',2);q.onsuccess=()=>resolve(q.result);});await new Promise((resolve,reject)=>{const t=db.transaction('datasets','readwrite'),s=t.objectStore('datasets'),q=s.get('active');q.onsuccess=()=>s.put({...q.result,source:{...q.result.source,lastAttempt:0}},'active');t.oncomplete=resolve;t.onabort=reject;});db.close();});}

test('source selection makes no requests; blocked Maishift and announcement tell the truth',async({page},testInfo)=>{
  await boot(page);let requests=0;page.on('request',r=>{if(r.url().includes('shiftpsh')||r.url().includes('public-report'))requests++;});await openImport(page);
  await expect(page.getByRole('radio')).toHaveCount(3);await expect(page.getByLabel('Upload a file',{exact:true})).toBeChecked();
  await page.getByLabel('Upload a file',{exact:true}).focus();await page.keyboard.press('ArrowDown');await expect(page.getByLabel('Hosted Session Report',{exact:true})).toBeChecked();
  await page.getByLabel('Maishift',{exact:true}).check();await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();await expect(page.locator('.player-dialog')).toContainText('not available yet');expect(requests).toBe(0);
  await expect(page.locator('.feature-announcement')).toBeHidden();await expect(page.locator('#feature-announcement-replay')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByLabel('Hosted Session Report',{exact:true}).check();await page.screenshot({path:testInfo.outputPath('import-sources.png')});
});

test('public source previews and remembers atomically; requests omit credentials and referrers',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);
  await page.evaluate(()=>{const original=window.fetch;window.sourceOptions=[];window.fetch=(url,options)=>{if(String(url).includes('public-report'))window.sourceOptions.push(options);return original(url,options);};});
  await importReport(page);const state=await saved(page);expect(state.active.source.url).toBe(manifest);expect(state.active.source.playerKey).toBe(data.player.key);expect(state.active.source.generation).toBe(state.control.version);
  await expect(page.locator('#player-status .player-profile .player-profile-link')).toHaveAttribute('href',manifest);await expect(page.locator('#player-status > a')).toHaveCount(0);await expect(page.locator('#player-status .player-storage-label')).toContainText('Last Updated:');
  expect(await page.evaluate(()=>sourceOptions.every(o=>o.credentials==='omit'&&o.referrerPolicy==='no-referrer'&&o.redirect==='error'))).toBe(true);
  await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);expect((await saved(page)).active.revision).toBe(state.active.revision);await openImport(page);await expect(page.getByLabel('Hosted Session Report',{exact:true})).toBeChecked();
});

test('one-time source import reloads in this tab without storing a connection',async({page,context})=>{
  await boot(page);await mock(context,page,await fixture(page));await importReport(page,false);expect((await saved(page)).active).toBeNull();await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);await expect(page.locator('#player-refresh')).toBeHidden();
});

test('installation URLs with or without a trailing slash read only the documented manifest',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);
  const result=await page.evaluate(async()=>{
    const base='https://public-report.example/fixture',accepted=[base,base+'/',base+'/index.html',base+'/party/latest.json'];
    return {manifests:accepted.map(url=>maimaiPlayerSources.reportURL(url).manifest),revision:(await maimaiPlayerSources.readReport(base)).data.revision,unsupported:[base+'/history',base+'/archive/page.html',base+'/party/',base+'//',base+'.html'].map(url=>maimaiPlayerSources.reportURL(url).manifest)};
  });
  expect(result.manifests).toEqual(Array(4).fill(manifest));expect(result.revision).toBe(data.revision);expect(result.unsupported).toEqual(Array(5).fill(null));
});

test('report recovery actions remain separated and accessible on narrow localized screens',async({page,context},testInfo)=>{
  await boot(page);await mock(context,page,await fixture(page),{html:true});
  for(const width of [320,430,1280])for(const locale of ['en','zh-Hans','ko','ja']){
    await page.setViewportSize({width,height:932});await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);
    await openImport(page);await page.locator('input[value=report]').check();await page.locator('#player-report-url').fill('https://public-report.example/fixture');await page.locator('.player-dialog .player-actions button').first().click();
    const actions=page.locator('.player-message-actions');await expect(actions.locator('a')).toHaveAttribute('href','https://public-report.example/fixture');
    const layout=await actions.evaluate(root=>{const a=root.querySelector('a'),b=root.querySelector('button'),ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),d=root.closest('dialog'),dr=d.getBoundingClientRect();return {separated:ar.right+10<=br.left||br.right+10<=ar.left||ar.bottom+10<=br.top||br.bottom+10<=ar.top,targets:[a,b].every(n=>n.getBoundingClientRect().height>=44),contained:[ar,br].every(r=>r.left>=dr.left&&r.right<=dr.right),clipped:[a,b].some(n=>n.scrollWidth>n.clientWidth+1),overflow:document.documentElement.scrollWidth>innerWidth+1,labels:[a,b].map(n=>n.textContent)};});
    expect(layout.separated).toBe(true);expect(layout.targets).toBe(true);expect(layout.contained).toBe(true);expect(layout.clipped).toBe(false);expect(layout.overflow).toBe(false);if(locale!=='en')expect(layout.labels).not.toContain('Open report');
    await expect(actions.locator('button')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(actions.locator('a')).toBeFocused();
    if(width===430)await page.screenshot({path:testInfo.outputPath('report-recovery-'+locale+'.png')});
    await page.keyboard.press('Escape');await expect(page.locator('.player-dialog')).not.toBeVisible();
  }
});

test('unchanged refresh preserves hidden results and dataset history',async({page,context})=>{
  await boot(page);await mock(context,page,await fixture(page));await importReport(page);const before=await saved(page);await age(page);
  await page.locator('#settings-toggle').click();await page.locator('#player-toggle').click();await page.locator('#settings-toggle').click();await page.locator('#player-refresh').click();
  await expect.poll(async()=>((await saved(page)).active.source.lastChecked)).toBeGreaterThan(before.active.source.lastChecked);expect((await saved(page)).active.revision).toBe(before.active.revision);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await expect(page.locator('#player-refresh')).toBeEnabled();await expect(page.locator('#player-status > small')).toHaveCount(1);await expect(page.locator('#player-status')).not.toContainText('Your saved data is up to date.');
});

test('a login response preserves saved scores and offers report recovery',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);const before=(await saved(page)).active.revision;await context.unroute('https://public-report.example/**');await mock(context,page,data,{html:true});await age(page);await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  await expect.poll(()=>page.locator('#player-status').textContent()).toContain('Could not refresh');expect((await saved(page)).active.revision).toBe(before);await expect(page.locator('.player-dialog')).not.toBeVisible();
});

test('Forget aborts a pending refresh and prevents resurrection across tabs',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);const other=await context.newPage();await boot(other);await age(page);
  await context.unroute('https://public-report.example/**');let release,started;const held=new Promise(resolve=>release=resolve),start=new Promise(resolve=>started=resolve);await mock(context,page,data,{delay:()=>{started();return held;}});
  await page.locator('#settings-toggle').click();await page.locator('#player-refresh').click();await start;
  await other.locator('#settings-toggle').click();await other.locator('#player-forget').click();release();
  await expect.poll(async()=>(await saved(page)).active).toBeNull();await expect(page.locator('#player-refresh')).toBeHidden();await other.reload();await expect.poll(()=>other.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await other.evaluate(()=>maimaiPersonal.ready);expect(await other.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
  await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
});

test('storage rejects stale commits, old clients, and duplicate refresh leases',async({page,context})=>{
  await boot(page);await mock(context,page,await fixture(page));await importReport(page);await age(page);
  const outcome=await page.evaluate(async()=>{const s=maimaiPlayerStorage,state=await s.read();const claims=await Promise.all([s.claim(state.token,false),s.claim(state.token,false)]);await s.forget();let rejected=false;try{await s.save(state.active,state.token);}catch{rejected=true;}const old=await new Promise(resolve=>{const q=indexedDB.open('maimai-player-data',1);q.onerror=()=>resolve(true);q.onsuccess=()=>{q.result.close();resolve(false);};});return {leases:claims.filter(Boolean).length,rejected,old};});
  expect(outcome).toEqual({leases:1,rejected:true,old:true});
});

test('public adapter rejects substituted payloads and unsafe endpoints',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);const result=await page.evaluate(async()=>{const invalid=['http://report.example/x/','https://user:pass@report.example/x/','https://report.example/x/?token=secret','https://report.example/x/#private'];return invalid.map(url=>{try{maimaiPlayerSources.reportURL(url);return false;}catch{return true;}});});expect(result).toEqual([true,true,true,true]);
  await context.route('**/fixture/party/data/*.gz',route=>route.fulfill({body:Buffer.from('invalid')}));const failed=await page.evaluate(async url=>{try{await maimaiPlayerSources.readReport(url);return false;}catch{return true;}},manifest);expect(failed).toBe(true);expect((await saved(page)).active).toBeNull();
});

test('a newer corrected PB may be lower and a partial snapshot retains other observations',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);const prior=await saved(page);
  const corrected=await page.evaluate(async d=>{const core=maimaiPlayerData,old=core.current(d).pbs.get('chart'),record={...old,achievement:960000},rid=await core.digest(record);d.records[rid]=record;const snapshot={capturedAt:5000,phase:'after',complete:false,versions:[],pbs:{chart:rid}};d.snapshots[await core.digest(snapshot)]=snapshot;d.player.displayName='A corrected name';const {revision,...body}=d;d.revision=await core.digest(body);return d;},data);
  await context.unroute('https://public-report.example/**');await mock(context,page,corrected);await age(page);await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  await expect.poll(async()=>(await saved(page)).active.source.sourceRevision).toBe(corrected.revision);
  const result=await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read(),d=await maimaiPlayerData.decode(s.active.bytes);return {score:maimaiPlayerData.current(d).pbs.get('chart').achievement,plays:Object.keys(d.plays).length,name:d.player.displayName};});
  expect(result).toEqual({score:960000,plays:1,name:'A corrected name'});expect((await saved(page)).active.revision).not.toBe(prior.active.revision);
});

test('a file import supersedes a slow refresh without reconnecting the old report',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);await age(page);await context.unroute('https://public-report.example/**');
  let release,started;const held=new Promise(resolve=>release=resolve),start=new Promise(resolve=>started=resolve);await mock(context,page,data,{delay:()=>{started();return held;}});
  await page.locator('#settings-toggle').click();await page.locator('#player-refresh').click();await start;
  await page.locator('input[type=file]').setInputFiles({name:'player.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.getByLabel('Remember on this device',{exact:true}).check();await page.getByRole('button',{name:'Import data',exact:true}).click();release();
  await expect.poll(async()=>(await saved(page)).active?.source).toBeNull();await expect(page.locator('#player-refresh')).toBeHidden();
});

test('storage denial reports failure without losing an active temporary import',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page,false);
    // Exercise real IndexedDB failure while preserving the active temporary view.
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.apply(this,args);};});
  await openImport(page);await page.getByLabel('Hosted Session Report',{exact:true}).check();await page.getByLabel('Hosted Session Report URL',{exact:true}).fill(manifest);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Player data could not be imported',exact:true})).toBeVisible();expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
});

test('upstream throttling records backoff without replacing scores',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);const before=(await saved(page)).active.revision;await age(page);await context.unroute('https://public-report.example/**');
  await context.route('https://public-report.example/**',route=>route.fulfill({status:429,headers:{'Retry-After':'120'},body:''}));await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  await expect.poll(async()=>(await saved(page)).active.source.retryAt??0).toBeGreaterThan(Date.now()+60000);expect((await saved(page)).active.revision).toBe(before);
});

test('announcement waits for a modal, shows once, replays, and survives Forget',async({page,context})=>{
  // Enable only the capability fixture. No production/debug switch is shipped.
  await context.route('**/browser-config.json*',async route=>{const response=await route.fetch();await route.fulfill({response,body:JSON.stringify({...await response.json(),features:{maishift:true}})});});
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const d=document.createElement('dialog');d.id='blocking-fixture';d.textContent='Fixture';document.body.append(d);d.showModal();},{once:true}));
  await boot(page);await expect(page.locator('.feature-announcement')).toBeHidden();expect(await page.evaluate(()=>localStorage.getItem('maimai-announcement:player-import-sources-v1'))).toBeNull();
  await page.evaluate(()=>document.getElementById('blocking-fixture').close());await expect(page.locator('.feature-announcement')).toBeVisible();expect(await page.evaluate(()=>document.activeElement.closest('.feature-announcement')===null)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('maimai-announcement:player-import-sources-v1'))).toBe('seen');
  await page.getByRole('button',{name:'Got it',exact:true}).click();await page.evaluate(()=>maimaiPlayerStorage.forget());await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);await page.evaluate(()=>document.getElementById('blocking-fixture').close());await expect(page.locator('.feature-announcement')).toBeHidden();
  await page.locator('#settings-toggle').click();await page.locator('#feature-announcement-replay').click();await expect(page.locator('.feature-announcement')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#settings-toggle')).toBeFocused();
});

test('source selection remains localized and usable in all four languages',async({page})=>{
  await boot(page);for(const locale of ['en','zh-Hans','ko','ja']){
    await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);await openImport(page);await expect(page.locator('input[name=player-source]')).toHaveCount(3);const copy=await page.locator('.player-source-options').innerText();if(locale!=='en')expect(copy).not.toContain('Upload a file');
    await page.locator('input[value=report]').check();await expect(page.locator('#player-report-url')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.keyboard.press('Escape');
  }
});

test('unchecking remembering on the connected source revokes future automatic reads',async({page,context})=>{
  await boot(page);await mock(context,page,await fixture(page));await importReport(page);await importReport(page,false);
  await expect.poll(async()=>(await saved(page)).active).toBeNull();await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  const other=await context.newPage();await boot(other);expect(await other.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
});

test('upgrading a legacy database preserves its v1 dataset without enabling refresh',async({page})=>{
  const data=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8')),bytes=[...gzipSync(Buffer.from(JSON.stringify(data)))];
  await page.goto('/missing-fixture');await page.evaluate(async({data,bytes})=>{
    const db=await new Promise(resolve=>{const q=indexedDB.open('maimai-player-data',1);q.onupgradeneeded=()=>q.result.createObjectStore('datasets');q.onsuccess=()=>resolve(q.result);});
    await new Promise(resolve=>{const t=db.transaction('datasets','readwrite');t.objectStore('datasets').put({revision:data.revision,bytes:new Uint8Array(bytes)},'active');t.oncomplete=resolve;});db.close();
  },{data,bytes});await boot(page);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);expect((await saved(page)).active.revision).toBe(data.revision);await expect(page.locator('#player-refresh')).toBeHidden();
});

test('cancelled reads cannot clear the busy state of a newer import',async({page,context})=>{
  await boot(page);const data=await fixture(page);let started,release;const start=new Promise(r=>started=r),held=new Promise(r=>release=r);await mock(context,page,data,{delay:()=>{started();return held;}});
  await openImport(page);await page.getByLabel('Hosted Session Report',{exact:true}).check();await page.getByLabel('Hosted Session Report URL',{exact:true}).fill(manifest);await page.getByRole('button',{name:'Continue',exact:true}).click();await start;
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('input[type=file]').setInputFiles({name:'file.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();release();
  await page.getByRole('button',{name:'Import data',exact:true}).click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);expect((await saved(page)).active).toBeNull();
});

test('announcement suppression falls back to the tab session when device preferences fail',async({page,context})=>{
  await context.route('**/browser-config.json*',async route=>{const response=await route.fetch();await route.fulfill({response,body:JSON.stringify({...await response.json(),features:{maishift:true}})});});
  await page.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&key.startsWith('maimai-announcement:'))throw new DOMException('Storage unavailable','QuotaExceededError');return set.call(this,key,value);};});
  await boot(page);await expect(page.locator('.feature-announcement')).toBeVisible();await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('maimai-announcement:player-import-sources-v1'))).toBe('seen');await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('.feature-announcement')).toBeHidden();
});

test('Forget invalidates a pending commit before compression and storage complete',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);const other=await context.newPage();await boot(other);
  await page.locator('input[type=file]').setInputFiles({name:'pending.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible();
  await page.evaluate(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);let held=true;crypto.subtle.digest=async(...args)=>{if(held){held=false;window.commitWaiting=true;await new Promise(resolve=>window.releaseCommit=resolve);}return digest(...args);};});
  await page.getByRole('button',{name:'Import data',exact:true}).click();await page.waitForFunction(()=>window.commitWaiting);
  await other.locator('#settings-toggle').click();await other.locator('#player-forget').click();await expect.poll(async()=>(await saved(other)).active).toBeNull();
  await page.evaluate(()=>window.releaseCommit());await expect(page.locator('#player-refresh')).toBeHidden();expect((await saved(page)).active).toBeNull();await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(false);
});

test('a changed refresh preserves the selected chart and expanded PB history',async({page,context})=>{
  await boot(page);const data=await fixture(page);await mock(context,page,data);await importReport(page);
  await page.evaluate(()=>{const data=maimaiResearchCatalog,c=data.catalog[0];maimaiPersonal.configure(data,{schema_version:'provider-mapping-1',charts:{chart:{chart_id:c.chart_id,source_hash:c.source_hash}}});const url=new URL(location.href);url.searchParams.set('chart',c.chart_id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));});
  const url=page.url();await page.locator('.player-pb-toggle').click();await expect(page.locator('.player-pb-toggle')).toHaveAttribute('aria-expanded','true');
  const changed=await page.evaluate(async data=>{const core=maimaiPlayerData,snapshot={...Object.values(data.snapshots).at(-1),capturedAt:5000};data.snapshots[await core.digest(snapshot)]=snapshot;const {revision,...body}=data;data.revision=await core.digest(body);return data;},data);
  await context.unroute('https://public-report.example/**');await mock(context,page,changed);await age(page);await page.evaluate(()=>dispatchEvent(new Event('online')));
  await expect.poll(async()=>(await saved(page)).active.source.sourceRevision).toBe(changed.revision);expect(page.url()).toBe(url);await expect(page.locator('.player-pb-toggle')).toHaveAttribute('aria-expanded','true');
});
