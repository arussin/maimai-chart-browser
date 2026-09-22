import {test,expect} from './fixtures.js';

// Mount the synthetic release at the production root without external requests.
test.beforeEach(async({page,baseURL})=>{
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==baseURL){await route.abort();return;}
    const response=await route.fetch({url:baseURL+'/registry'+url.pathname+url.search});
    await route.fulfill({response});
  });
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-catalog-filters-collapsed','0');
    window.navigationEvents=[];
    addEventListener('maimai:navigation',event=>window.navigationEvents.push(event.detail));
  });
});

async function ledger(request){return (await request.get('/registry/permalinks.json')).json();}
async function ready(page){await expect.poll(()=>page.evaluate(()=>!!window.maimaiBrowserState)).toBe(true);}
const songPath=(locale,slug)=>'/'+locale+'/songs/'+encodeURIComponent(slug)+'/';

test('static song pages have four explicit languages, canonical identity and no catalog startup',async({page,request})=>{
  const map=await ledger(request),slug=Object.values(map.songs).find(value=>/[^\x00-\x7f]/.test(value));
  expect(slug).toBeTruthy();
  for(const [locale,htmlLanguage]of [['en','en'],['ja','ja'],['ko','ko'],['zh-hans','zh-Hans']]){
    const requests=[];page.on('request',request=>requests.push(request.url()));
    await page.goto(songPath(locale,slug));
    await expect(page.locator('main[data-seo-page="song"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang',htmlLanguage);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://maimai.party'+songPath(locale,slug));
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(5);
    await page.locator('[data-seo-international]').check();
    expect(await page.evaluate(()=>[...document.querySelectorAll('[data-seo-jp]')].every(node=>node.textContent===node.dataset.seoIntl))).toBe(true);
    expect(requests.some(url=>/catalog-index|chart-details|lab-loader/.test(url))).toBe(false);
    expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'song'}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('song navigation keeps browser mounted and restores controls, expansions, focus and scroll',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const catalogRequests=[];page.on('request',request=>{if(request.url().includes('/catalog-index/'))catalogRequests.push(request.url());});
  await page.goto('/');await ready(page);
  await page.locator('#search').fill('ソテリア');
  await page.locator('#use-international-data').check();
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.focus();
  const before=await page.evaluate(()=>{window.browserIdentity=document.querySelector('main:not([data-seo-page])');return window.maimaiBrowserState.capture();});
  await link.click();await expect(page.locator('#seo-route-view')).toBeVisible();await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party'+new URL(page.url()).pathname);
  expect(await page.evaluate(()=>window.browserIdentity.isConnected)).toBe(true);
  await page.goBack();await expect(page.locator('#songs')).toBeVisible();await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party/');
  await expect(page.locator('#search')).toHaveValue('ソテリア');
  await expect(page.locator('#use-international-data')).toBeChecked();
  const restored=await page.evaluate(()=>window.maimaiBrowserState.capture());
  for(const key of ['auxiliary','search','genre','format','versions','sortRules','chartFilters','patterns','region','personal','visible','selectedCharts','expandedRows','history','disclosures','locale'])expect(restored[key],key).toEqual(before[key]);
  await expect.poll(()=>page.evaluate(()=>document.activeElement.id)).toBe(before.focus);
  await expect.poll(()=>page.evaluate(()=>Math.abs(scrollY-history.state.maimaiBrowserState.scroll[1]))).toBeLessThan(2);
  expect(catalogRequests).toHaveLength(1);
  await page.goForward();await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.locator('#seo-route-view [data-back-results]').click();await expect(page.locator('#search')).toHaveValue('ソテリア');
  expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'charts'},{page:'song'},{page:'charts'},{page:'song'},{page:'charts'}]);
  expect(errors).toEqual([]);
});

test('full reload of a song route restores only local browser controls through return action',async({page})=>{
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.click();
  await expect(page.locator('#seo-route-view')).toBeVisible();await page.reload();
  await expect(page.locator('main[data-seo-page="song"]')).toBeVisible();
  expect(await page.evaluate(()=>!!window.maimaiBrowserState)).toBe(false);
  await page.locator('[data-back-results]').click();await ready(page);
  await expect(page.locator('#search')).toHaveValue('ソテリア');
  expect(await page.evaluate(()=>Object.keys(history.state.maimaiBrowserState))).not.toContain('scores');
});

test('version page enhances once and explicitly selects its version without duplicate lifecycle events',async({page,request})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const map=await ledger(request),[version,slug]=Object.entries(map.versions)[0];
  await page.goto('/ja/versions/'+encodeURIComponent(slug)+'/');await ready(page);
  await expect(page.locator('[data-version-browser]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  expect(await page.evaluate(()=>window.maimaiBrowserState.capture().versions)).toEqual([version]);
  expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'version'}]);
  expect(errors).toEqual([]);
});


test('browser-origin version navigation enhances immediately and restores the preceding song and browser',async({page})=>{
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.click();
  const versionLink=page.locator('#seo-route-view a[data-song-page]').first();await expect(versionLink).toBeVisible();
  const version=await versionLink.textContent();await versionLink.click();
  await expect(page.locator('#songs')).toBeVisible();expect(await page.evaluate(()=>window.maimaiBrowserState.capture().versions)).toEqual([version]);
  await page.goBack();await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.goBack();await expect(page.locator('#search')).toHaveValue('ソテリア');
  expect(await page.evaluate(()=>window.maimaiBrowserState.capture().versions)).toEqual([]);
  expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'charts'},{page:'song'},{page:'version'},{page:'song'},{page:'charts'}]);
});


test('failed history-route fetch falls back to the matching full static document',async({page})=>{
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.click();
  await expect(page.locator('#seo-route-view')).toBeVisible();const songURL=page.url();
  await page.goBack();await expect(page.locator('#songs')).toBeVisible();
  await page.route('**/en/songs/**',route=>route.request().resourceType()==='fetch'?route.fulfill({status:503,body:'Unavailable'}):route.fallback());
  await page.goForward();await expect(page.locator('main[data-seo-page=song]')).toBeVisible();
  await expect(page).toHaveURL(songURL);expect(await page.evaluate(()=>!!window.maimaiBrowserState)).toBe(false);
});


test('lean static foundations preserve aggregate stylesheet pixels in every locale',async({browser,page,request,baseURL},testInfo)=>{
  test.setTimeout(90000);
  const map=await ledger(request),song=Object.values(map.songs)[0],version=Object.values(map.versions)[0];
  for(const locale of ['en','ja','ko','zh-hans'])for(const [kind,slug]of [['songs',song],['versions',version]]){
    const path='/'+locale+'/'+kind+'/'+encodeURIComponent(slug)+'/',response=await request.get('/registry'+path),html=(await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    // One DOM isolates the stylesheet change from separate-context glyph rasterization.
    // Scripts are stripped while keeping Firefox's font-readiness API usable.
    const context=await browser.newContext({viewport:page.viewportSize()});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==baseURL)return route.abort();
      if(url.pathname===path)return route.fulfill({contentType:'text/html',body:html});
      const response=await route.fetch({url:baseURL+'/registry'+url.pathname+url.search});return route.fulfill({response});
    });
    const document=await context.newPage();await document.goto(baseURL+path);
    const capture=async()=>{await document.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});return document.screenshot({fullPage:true,animations:'disabled'});};
    const lean=await capture();
    await document.evaluate(async()=>{const sheet=window.aggregateComparisonSheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/challenge-review.css';await new Promise((resolve,reject)=>{sheet.onload=resolve;sheet.onerror=reject;document.head.append(sheet);});document.documentElement.classList.remove('seo-static');});
    const aggregate=await capture();
    await document.evaluate(()=>{window.aggregateComparisonSheet.remove();delete window.aggregateComparisonSheet;document.documentElement.classList.add('seo-static');});
    const returned=await capture();
    for(const [label,image]of [['aggregate',aggregate],['returned-lean',returned]]){
      // Compare decoded RGBA pixels, not PNG compression or metadata bytes.
      const difference=await document.evaluate(async({left,right})=>{
        const images=await Promise.all([left,right].map(async source=>{const image=new Image();image.src='data:image/png;base64,'+source;await image.decode();return image;}));
        if(images[0].width!==images[1].width||images[0].height!==images[1].height)return -1;
        const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(images[0],0,0);const a=ctx.getImageData(0,0,canvas.width,canvas.height).data;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(images[1],0,0);const b=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])count++;return count;
      },{left:lean.toString('base64'),right:image.toString('base64')});
      if(difference){await testInfo.attach(locale+'-'+kind+'-lean',{body:lean,contentType:'image/png'});await testInfo.attach(locale+'-'+kind+'-'+label,{body:image,contentType:'image/png'});}
      expect(difference,locale+' '+kind+' '+label+' decoded pixels').toBe(0);
    }
    await context.close();
  }
});

for(const reload of [false,true])test(`song language navigation preserves the original browser snapshot (${reload?'reloaded':'mounted'})`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  await page.locator('#use-international-data').check();await page.locator('[data-sort-key=title]').click();
  // Nonempty personal control settings, without importing or copying any player records.
  await page.evaluate(()=>{const state=maimaiBrowserState.capture();state.personal={...state.personal,grade:['SSS'],min:'97',rateMin:'100'};maimaiBrowserState.restore(state);});
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.focus();
  const before=await page.evaluate(()=>maimaiBrowserState.capture());expect(before.personal.grade).toEqual(['SSS']);
  await link.click();await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.locator('#seo-route-view [data-seo-international]').uncheck();
  if(reload){await page.reload();await expect(page.locator('main[data-seo-page=song]')).toBeVisible();await page.locator('header a[hreflang=ja]').click();}
  else await page.locator('.site-header [data-language=ja]').click();
  await expect(page).toHaveURL(/\/ja\/songs\//);await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party'+new URL(page.url()).pathname);
  const main=page.locator('main[data-seo-page=song]');await expect(main.locator('.seo-primary')).toHaveText('譜面ブラウザーで開く');
  await expect(main.locator('[data-seo-international]')).not.toBeChecked();
  if(!reload){expect(await page.evaluate(()=>maimaiI18n.locale)).toBe('ja');expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'charts'},{page:'song'},{page:'song'}]);}
  await main.locator('[data-back-results]').click();await ready(page);await expect(page.locator('#songs')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang',before.locale);expect(await page.evaluate(()=>maimaiI18n.locale)).toBe(before.locale);
  const after=await page.evaluate(()=>maimaiBrowserState.capture());
  for(const key of ['auxiliary','search','genre','format','versions','sortRules','chartFilters','patterns','region','personal','visible','selectedCharts','expandedRows','history','disclosures','locale'])expect(after[key],key).toEqual(before[key]);
  await expect.poll(()=>page.evaluate(()=>document.activeElement.id)).toBe(before.focus);
  await expect.poll(()=>page.evaluate(()=>Math.abs(scrollY-history.state.maimaiBrowserState.scroll[1]))).toBeLessThan(2);
  if(!reload){expect(await page.evaluate(()=>localStorage.getItem('maimai-language-v1'))).toBe('ja');expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'charts'},{page:'song'},{page:'song'},{page:'charts'}]);}
  expect(errors).toEqual([]);
});

test('version language navigation keeps controls and restores route locale without activation loops',async({page,request})=>{
  const map=await ledger(request),[version,slug]=Object.entries(map.versions)[0];
  await page.goto('/ja/versions/'+encodeURIComponent(slug)+'/');await ready(page);await page.locator('#search').fill('ソテリア');
  await page.locator('.site-header [data-language=ko]').click();await expect(page).toHaveURL(/\/ko\/versions\//);
  await expect(page.locator('html')).toHaveAttribute('lang','ko');await expect(page.locator('#search')).toHaveValue('ソテリア');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party'+new URL(page.url()).pathname);
  await expect(page.locator('#catalog-tab')).toHaveText('채보');
  expect(await page.evaluate(()=>maimaiBrowserState.capture().versions)).toEqual([version]);
  await page.goBack();await expect(page).toHaveURL(/\/ja\/versions\//);await expect(page.locator('html')).toHaveAttribute('lang','ja');
  expect(await page.evaluate(()=>maimaiI18n.locale)).toBe('ja');await expect(page.locator('#search')).toHaveValue('ソテリア');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party'+new URL(page.url()).pathname);
  expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'version'},{page:'version'},{page:'version'}]);
  await page.locator('.site-header [data-language=ko]').click();await expect(page).toHaveURL(/\/ko\/versions\//);
  await page.locator('#patterns-tab').click();await expect(page).toHaveURL(/\/\?view=patterns$/);
  await expect(page.locator('html')).toHaveAttribute('lang','ko');expect(await page.evaluate(()=>maimaiI18n.locale)).toBe('ko');
});


test('a delayed route ledger never steals focus after the user resumes typing',async({page})=>{
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.focus();await link.click();
  await expect(page.locator('#seo-route-view')).toBeVisible();await page.reload();
  let release;const gate=new Promise(resolve=>{release=resolve;});let waiting=false;
  await page.route('**/permalinks.json',async route=>{waiting=true;await gate;await route.fallback();});
  await page.locator('[data-back-results]').click();await ready(page);await expect.poll(()=>waiting).toBe(true);
  await page.locator('#search').fill('ソテリア ');const scroll=await page.evaluate(()=>scrollY);
  release();await expect(page.locator('#songs a[data-song-page]').first()).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#search')).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBe(scroll);
});

for(const sourceReload of [false,true])test(`Open in browser commits its explicit target and one page view (${sourceReload?'reloaded':'mounted'})`,async({page,baseURL,fixtureOrigins})=>{
  fixtureOrigins.synthetic('https://maimai.party');
  const batches=[];
  await page.addInitScript(()=>{window.maimaiUsageEnabled=true;localStorage.setItem('maimai.party.analytics.v1',JSON.stringify({choice:'denied',expires:Date.now()+86400000}));});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.hostname!=='maimai.party')return route.abort();
    if(url.pathname==='/__usage'){batches.push(JSON.parse(route.request().postData()));return route.fulfill({status:204,body:''});}
    const response=await route.fetch({url:baseURL+'/registry'+url.pathname+url.search});await route.fulfill({response});
  });
  await page.goto('https://maimai.party/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.click();await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.locator('.site-header [data-language=ja]').click();await expect(page).toHaveURL(/\/ja\/songs\//);
  if(sourceReload)await page.reload();
  await page.evaluate(()=>maimaiUsage.flush());batches.length=0;
  await page.locator('main[data-seo-page=song] .seo-primary[data-open-browser]').click();await expect(page.locator('#songs')).toBeVisible();
  await page.evaluate(()=>maimaiUsage.flush());
  expect(batches.flatMap(batch=>batch.events).filter(row=>row.event==='page_view')).toEqual([{event:'page_view',page:'charts',detail:'',failure:'',count:1}]);
  const requested=new URL(page.url()).searchParams;expect(requested.get('lang')).toBe('ja');
  expect(await page.evaluate(()=>history.state.maimaiOpenBrowser)).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('lang','ja');expect(await page.evaluate(()=>maimaiI18n.locale)).toBe('ja');
  const target=page.locator('[data-row-key="'+requested.get('chart')+'"]');await expect(target).toBeInViewport();await expect(target.locator('a[data-song-page]')).toBeVisible();
  await page.goBack();await expect(page.locator('main[data-seo-page=song]')).toBeVisible();await page.goForward();
  await expect(page.locator('#songs')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(target).toBeInViewport();await expect(target.locator('a[data-song-page]')).toBeVisible();
  await page.reload();await ready(page);await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(target).toBeInViewport();await expect(target.locator('a[data-song-page]')).toBeVisible();
});


test('direct static language changes preserve the explicit international-data choice',async({page,request})=>{
  const map=await ledger(request),slug=Object.values(map.songs)[0];
  await page.goto(songPath('en',slug));await page.locator('[data-seo-international]').check();
  await page.locator('header a[hreflang=ja]').click();
  await expect(page).toHaveURL(songPath('ja',slug));await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(page.locator('[data-seo-international]')).toBeChecked();
  expect(await page.evaluate(()=>history.state.maimaiReturn)).toBeUndefined();
  expect(await page.evaluate(()=>!!window.maimaiBrowserState)).toBe(false);
});


test('version browser to song and results restores version metadata and exact browsing state',async({page,request})=>{
  const map=await ledger(request),slug=map.versions['maimai DX CiRCLE PLUS'];expect(slug).toBeTruthy();
  await page.goto('/ja/versions/'+encodeURIComponent(slug)+'/');await ready(page);
  await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.focus();
  const before=await page.evaluate(()=>({url:location.href,title:document.title,canonical:document.querySelector('link[rel=canonical]').href,state:maimaiBrowserState.capture()}));
  await link.click();await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.locator('#seo-route-view [data-back-results]').click();await expect(page).toHaveURL(before.url);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',before.canonical);await expect(page).toHaveTitle(before.title);
  await expect(page.locator('html')).toHaveAttribute('lang','ja');await expect(page.locator('#songs')).toBeVisible();
  const after=await page.evaluate(()=>maimaiBrowserState.capture());
  for(const key of ['search','versions','sortRules','chartFilters','patterns','region','personal','visible','selectedCharts','expandedRows','disclosures','locale'])expect(after[key],key).toEqual(before.state[key]);
  await expect.poll(()=>page.evaluate(()=>document.activeElement.id)).toBe(before.state.focus);
  await expect.poll(()=>page.evaluate(()=>Math.abs(scrollY-history.state.maimaiBrowserState.scroll[1]))).toBeLessThan(2);
  expect(await page.evaluate(()=>window.navigationEvents)).toEqual([{page:'version'},{page:'song'},{page:'version'}]);
});

test('a later root tab selection supersedes a pending song navigation',async({page})=>{
  await page.goto('/');await ready(page);await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();
  let release,started;const gate=new Promise(resolve=>release=resolve),requestStarted=new Promise(resolve=>started=resolve);
  await page.route('**/en/songs/**',async route=>{started();await gate;await route.fallback();});
  await link.click();await requestStarted;await page.locator('#patterns-tab').click();
  await expect(page.locator('#patterns')).toBeVisible();release();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\?view=patterns$/);await expect(page.locator('#patterns')).toBeVisible();
  await expect(page.locator('#seo-route-view')).toBeHidden();
});

test('remembered personal sorting survives return while player storage is still loading',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-personal-filters-collapsed','0');
    const open=IDBFactory.prototype.open;
    IDBFactory.prototype.open=function(...args){
      const request=open.apply(this,args);
      const descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');
      Object.defineProperty(request,'onsuccess',{configurable:true,set(handler){descriptor.set.call(request,async event=>{
        if(sessionStorage.getItem('fixture-delay-player')==='1'){
          window.fixtureStorageHeld=true;await new Promise(resolve=>window.fixtureReleaseStorage=resolve);
        }
        handler?.call(request,event);
      });}});
      return request;
    };
  });
  await page.goto('/');await ready(page);await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  const {readFile}=await import('node:fs/promises'),{gzipSync}=await import('node:zlib');
  const template=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  const data=await page.evaluate(value=>maimaiPlayerData.reconcile(value),template);
  await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.getByLabel('Remember on this device',{exact:true}).check();await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  await page.locator('[data-sort-key=rating]').click();await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();await link.click();
  await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.evaluate(()=>sessionStorage.setItem('fixture-delay-player','1'));await page.reload();
  await page.locator('[data-back-results]').click();await ready(page);await expect.poll(()=>page.evaluate(()=>window.fixtureStorageHeld)).toBe(true);
  await page.evaluate(()=>{sessionStorage.removeItem('fixture-delay-player');fixtureReleaseStorage();});await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
  expect(await page.evaluate(()=>maimaiBrowserState.capture().sortRules)).toEqual([{key:'rating',direction:-1}]);
});
