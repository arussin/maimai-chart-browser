import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(process.env.MAIMAI_BROWSER_OUTPUT||fileURLToPath(new URL('../../output/browser-tests/',import.meta.url)));
const storageKey='maimai.party.analytics.v1',measurementId='G-FP9V9NF63J';
const sdkURL='https://www.googletagmanager.com/gtag/js?id='+measurementId;
const granted={choice:'granted',expires:Date.now()+86400000};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
// Serve synthetic fixtures under the production origin without contacting the site
// or Google. Every external request is captured and fulfilled/blocked locally.
async function hosted(context,{sdk='window.__analyticsStubLoaded=true;',fail=false}={}){
  const external=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['maimai.party','www.maimai.party','preview.invalid','127.0.0.1'].includes(url.hostname)){
      external.push({url:request.url(),body:request.postData()||'',headers:await request.allHeaders()});
      if(request.url()===sdkURL){
        if(fail)return route.abort('blockedbyclient');
        return route.fulfill({contentType:'application/javascript',body:sdk});
      }
      return route.fulfill({status:204,body:''});
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if(!path.startsWith(root.replace(/[\\/]$/,'')+sep))return route.abort();
    try{return await route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)});}
    catch{return route.fulfill({status:404,body:'Missing fixture'});}
  });
  return external;
}
async function ready(page,path='/lab/',origin='https://maimai.party'){
  await page.goto(origin+path,{waitUntil:'domcontentloaded'});
  if(path.startsWith('/lab'))await expect(page.locator('#loaded-count')).toHaveText('6');
  else await expect(page.locator('#explore-search')).toBeVisible();
}
async function allow(page){await page.locator('#analytics-notice [data-analytics-choice=granted]').click();}
async function settings(page){await page.locator('#settings-toggle').click();await page.locator('#analytics-settings').click();}
async function off(page){
  await settings(page);
  await page.locator('#analytics-dialog [data-analytics-choice=denied]').click();
}
async function events(page){return page.evaluate(()=>(window.dataLayer||[]).filter(x=>x[0]==='event').map(x=>Array.from(x)));}
async function importPersonal(page){
  const data=JSON.parse(await readFile(new URL('../../output/personal-fixture.json',import.meta.url),'utf8'));
  data.overlay.entries[0].attempts[0].attempt_id='PRIVATE_ATTEMPT_ANALYTICS_SENTINEL';
  await page.locator('#site-import').setInputFiles({name:'PRIVATE_PLAYER_ANALYTICS_SENTINEL.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#site-clear')).toBeVisible();
}

test('versioned settings scripts refresh returning visitors with an older cached analytics file',async({page,context})=>{
  await hosted(context);
  for(const path of ['/lab/','/']){
    const asset=path==='/lab/'?'lab/analytics.js':'assets/analytics.js';
    await page.route('https://maimai.party/'+asset,route=>route.fulfill({contentType:'application/javascript',body:'window.__staleAnalyticsUsed=true;'}));
    await ready(page,path);
    expect(await page.evaluate(()=>window.__staleAnalyticsUsed===true)).toBe(false);
    for(const name of ['analytics.js','settings-menu.js']){
      const src=await page.locator('script[src*="'+name+'"]').getAttribute('src');
      expect(new URL(src,page.url()).searchParams.get('v')).toMatch(/^[a-f0-9]{16}$/);
    }
    await settings(page);await expect(page.locator('#analytics-dialog')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#settings-toggle')).toBeFocused();
  }
});

test('analytics never loads on local, insecure or unrelated preview origins',async({page,context})=>{
  const external=await hosted(context);
  for(const origin of ['http://127.0.0.1:8766','http://maimai.party','https://preview.invalid']){
    await page.goto(origin+'/');
    await expect(page.locator('.party-footer')).toBeAttached();
    await page.locator('#settings-toggle').click();
    await expect(page.locator('#analytics-settings')).toHaveAttribute('aria-disabled','true');
    await expect(page.locator('#analytics-unavailable')).toBeVisible();
    await expect(page.locator('#analytics-notice')).toBeHidden();
    expect(await page.evaluate(()=>({storage:localStorage.length,tag:!!window.dataLayer}))).toEqual({storage:0,tag:false});
  }
  expect(external).toEqual([]);
});

test('analytics waits for opt-in and remembers a refusal across reloads',async({page,context})=>{
  const external=await hosted(context);await ready(page);
  await expect(page.locator('#analytics-notice')).toBeVisible();
  expect(external).toEqual([]);expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
  await page.reload();await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await expect(page.locator('#analytics-notice')).toBeHidden();
  expect(external).toEqual([]);expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).choice,storageKey)).toBe('denied');
});

test('analytics only counts broad views and excludes all URL, search and chart values',async({page,context})=>{
  const external=await hosted(context);
  await ready(page,'/lab/?view=catalog&q=PRIVATE_SEARCH&utm_source=PRIVATE_CAMPAIGN&email=PRIVATE_EMAIL#PRIVATE_HASH');
  await allow(page);await page.waitForFunction(()=>window.__analyticsStubLoaded);
  await page.locator('#search').fill('PRIVATE_SEARCH');await page.locator('#search').fill('');
  await page.locator('[data-sort-key=title]').click();
  await page.locator('#songs .chart-row').first().click();
  await page.locator('#patterns-tab').click();await page.locator('#patterns-tab').click();
  await page.locator('#pattern-search').fill('two-position');
  await page.locator('[data-open-pattern="pattern.two_position_alternation"]').click();
  await page.keyboard.press('Escape');await page.locator('#compare-tab').click();
  await page.locator('#compare-left-search').fill('Fictional study');
  await page.locator('#about-tab').click();
  await page.locator('#catalog-tab').click();
  const rows=await events(page);
  expect(rows.map(x=>x[2].page_location)).toEqual(['charts','patterns','compare','about','charts'].map(x=>'https://maimai.party/'+x));
  expect(rows.every(x=>x[1]==='page_view'&&x[2].page_referrer==='')).toBe(true);
  const queue=await page.evaluate(()=>window.dataLayer.map(x=>Array.from(x)));
  expect(JSON.stringify(queue)).not.toMatch(/PRIVATE_|Fictional|pattern\.two_position|fixture-v5/);
  const consent=queue.find(x=>x[0]==='consent')[2];
  expect(consent).toEqual({analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  const config=queue.find(x=>x[0]==='config')[2];expect(config.send_page_view).toBe(false);
  expect(external.map(x=>x.url)).toEqual([sdkURL]);expect(external[0].headers.referer).toBeUndefined();
});

test('analytics settings preserve imported results while revoking collection and deleting cookies',async({page,context})=>{
  const external=await hosted(context);await ready(page,'/','https://www.maimai.party');
  await allow(page);await page.waitForFunction(()=>window.__analyticsStubLoaded);
  const before=await events(page);await importPersonal(page);
  await page.locator('#explore-search').fill('PRIVATE_SEARCH');
  await context.addCookies(['_ga','_ga_FP9V9NF63J'].map(name=>({name,value:'test',domain:'.maimai.party',path:'/',secure:true})));
  await off(page);await expect(page.locator('#site-clear')).toBeVisible();
  await expect(page.locator('#explore-search')).toHaveValue('PRIVATE_SEARCH');
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(id=>window['ga-disable-'+id],measurementId)).toBe(true);
  await page.locator('#site-clear').click();await expect(page.locator('#site-clear')).toBeHidden();
  expect(await events(page)).toEqual(before);
  expect(JSON.stringify(external)).not.toContain('PRIVATE_');
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([storageKey]);
});

for(const signal of ['globalPrivacyControl','doNotTrack'])test('analytics honors '+signal+' even with a previous opt-in',async({page,context})=>{
  await context.addInitScript(({key,record,signal})=>{
    localStorage.setItem(key,JSON.stringify(record));
    Object.defineProperty(navigator,signal,{value:signal==='doNotTrack'?'1':true});
  },{key:storageKey,record:granted,signal});
  const external=await hosted(context);await ready(page);
  await expect(page.locator('#analytics-notice')).toBeHidden();
  await settings(page);
  await expect(page.locator('#analytics-status')).toContainText('your browser requests privacy');
  await expect(page.locator('#analytics-dialog [data-analytics-choice=granted]')).toBeDisabled();
  expect(external).toEqual([]);
});

test('analytics handles expired choices, unavailable storage and blocked scripts',async({page,context})=>{
  const external=await hosted(context,{fail:true});
  await context.addInitScript(key=>{
    localStorage.setItem(key,JSON.stringify({choice:'granted',expires:1}));
    Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};
  },storageKey);
  await ready(page);await expect(page.locator('#analytics-notice')).toBeVisible();expect(external).toEqual([]);
  await allow(page);await expect(page.locator('#analytics-status')).toContainText('could not load');
  await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await off(page);await expect(page.locator('#analytics-notice')).toBeHidden();
});

test('analytics choice is synchronized across tabs and may be enabled again',async({page,context})=>{
  const external=await hosted(context);await ready(page);
  const other=await context.newPage();await ready(other);await allow(page);
  await expect(other.locator('#analytics-notice')).toBeHidden();
  await other.waitForFunction(()=>window.__analyticsStubLoaded);
  await off(page);await other.waitForFunction(id=>window['ga-disable-'+id]===true,measurementId);
  const before=await events(other);await other.locator('#patterns-tab').click();expect(await events(other)).toEqual(before);
  await settings(page);await page.locator('#analytics-dialog [data-analytics-choice=granted]').click();
  await other.waitForFunction(id=>window['ga-disable-'+id]===false,measurementId);
  expect((await events(other)).at(-1)[2].page_location).toBe('https://maimai.party/patterns');
  expect(external.filter(x=>x.url===sdkURL)).toHaveLength(2);
});

test('analytics notice, privacy text and settings support keyboard, screen readers and mobile widths',async({page,context},testInfo)=>{
  await hosted(context);await ready(page);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.locator('#analytics-notice').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
  await page.screenshot({path:testInfo.outputPath('analytics-notice.png')});
  await page.locator('#analytics-notice a').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#privacy')).toHaveAttribute('open','');
  await expect(page.locator('#privacy summary')).toBeFocused();
  await page.locator('#settings-toggle').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#player-import')).toBeFocused();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  await expect(page.locator('#analytics-settings')).toBeFocused();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.locator('#analytics-dialog')).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.locator('#analytics-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('analytics-settings.png')});
  await page.keyboard.press('Escape');await expect(page.locator('#settings-toggle')).toBeFocused();
  await page.keyboard.press('Enter');await page.keyboard.press('Escape');await expect(page.locator('#settings-menu')).toBeHidden();
  await expect(page.locator('#settings-toggle')).toBeFocused();
  await page.keyboard.press('Enter');await page.mouse.click(2,2);await expect(page.locator('#settings-menu')).toBeHidden();
  await expect(page.locator('#analytics-dialog')).toBeHidden();
});

test('imported player card remains accessible outside the Settings action menu',async({page,context})=>{
  await hosted(context);await ready(page);
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../output/player-accessibility.gz',import.meta.url)));
  await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect(page.locator('.player-dialog')).toBeHidden();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#player-status')).toBeVisible();
  await expect(page.getByRole('menu',{name:'Settings'})).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('issue reporting supports keyboard access in public and personal browsers without sending page data',async({page,context})=>{
  const external=await hosted(context),issueURL='https://github.com/arussin/maimai-chart-browser/issues/new',requests=[];
  await context.route(issueURL,async route=>{
    const request=route.request();
    requests.push({url:request.url(),headers:await request.allHeaders(),body:request.postData()});
    await route.fulfill({contentType:'text/html',body:'<!doctype html><title>New issue fixture</title>'});
  });
  for(const [origin,path] of [['https://maimai.party','/lab/'],['https://preview.invalid','/']]){
    await ready(page,path+'?search=PRIVATE_SEARCH#PRIVATE_HASH',origin);
    const link=page.locator('#report-issue');
    await page.locator('#settings-toggle').focus();await page.keyboard.press('ArrowUp');
    await expect(link).toBeFocused();await expect(link).toBeEnabled();
    await expect(link).toHaveAttribute('href',issueURL);
    await expect(link).toHaveAttribute('rel','noopener noreferrer');
    await page.keyboard.press('ArrowUp');await expect(page.locator('#analytics-settings')).toBeFocused();
    await page.keyboard.press('End');await expect(link).toBeFocused();
    const hasPlayerImport=await page.locator('#player-import').count()>0;
    await page.keyboard.press('Home');await expect(page.locator(hasPlayerImport?'#player-import':'#analytics-settings')).toBeFocused();
    await page.keyboard.press('ArrowDown');await expect(hasPlayerImport?page.locator('.player-import-help'):link).toBeFocused();
    await page.keyboard.press('Escape');await expect(page.locator('#settings-toggle')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    const opened=context.waitForEvent('page');
    if(path==='/lab/'){
      // Reproduce browsers that blur the current item without focusing a clicked link.
      await link.evaluate(node=>node.addEventListener('mousedown',event=>{
        event.preventDefault();document.activeElement.blur();
      },{once:true}));
      await link.click();
    }else await page.keyboard.press('Enter');
    const popup=await opened;await expect(popup).toHaveURL(issueURL);
    await expect(popup).toHaveTitle('New issue fixture');
    expect(await popup.evaluate(()=>window.opener===null)).toBe(true);
    await popup.close();await expect(page.locator('#settings-menu')).toBeHidden();
    await expect(page.locator('#settings-toggle')).toBeFocused();
  }
  expect(requests).toHaveLength(2);
  expect(requests.every(request=>request.url===issueURL&&!request.headers.referer&&!request.body)).toBe(true);
  expect(external).toEqual([]);
});

test('analytics Google tag serializes safe pages and honors opt-out, including a delayed script',async({page,context})=>{
  test.skip(!process.env.GA_SDK_PATH,'Optional local audit using the official tag; all outgoing hits are intercepted.');
  const sdk=await readFile(process.env.GA_SDK_PATH,'utf8');
  const external=await hosted(context,{sdk});
  await ready(page,'/lab/?view=catalog&search=PRIVATE_SEARCH&utm_source=PRIVATE_CAMPAIGN&gclid=PRIVATE_CLICK&email=PRIVATE_EMAIL#PRIVATE_HASH');
  await allow(page);
  await expect.poll(()=>external.filter(x=>x.url.includes('/g/collect')).length).toBeGreaterThan(0);
  await page.locator('#patterns-tab').click();
  await expect.poll(()=>external.filter(x=>(x.url+x.body).includes('patterns')).length,{timeout:15000}).toBeGreaterThan(0);
  // Consent revocation must also disable the SDK's own engagement events.
  await off(page);const count=external.length;
  await page.locator('#compare-tab').click();await page.waitForTimeout(1500);
  await page.goto('about:blank');expect(external).toHaveLength(count);
  expect(decodeURIComponent(JSON.stringify(external))).not.toMatch(/PRIVATE_|fixture-v5|\/lab\//);
  expect(external.filter(x=>x.url.includes('/g/collect')).every(x=>!x.headers.referer)).toBe(true);
  expect(await context.cookies()).toEqual([]);
  const deferred=await context.newPage();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await deferred.route(sdkURL,async route=>{await gate;await route.fulfill({contentType:'application/javascript',body:sdk});});
  await ready(deferred);await settings(deferred);
  await deferred.locator('#analytics-dialog [data-analytics-choice=granted]').click();
  await off(deferred);release();
  await deferred.waitForTimeout(6500);await deferred.goto('about:blank');
  expect(external).toHaveLength(count);
});

test('settings work before the catalog loads and after a catalog failure',async({page,context})=>{
  const external=await hosted(context);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/manifest.json',async route=>{await gate;await route.fulfill({status:503,body:'Unavailable'});});
  await page.goto('https://maimai.party/lab/?view=about',{waitUntil:'domcontentloaded'});
  await settings(page);await expect(page.locator('#analytics-dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#settings-toggle')).toBeFocused();
  release();await expect(page.locator('#lab-status')).toContainText('could not be loaded');
  await page.locator('#settings-toggle').press('ArrowUp');await expect(page.locator('#report-issue')).toBeFocused();
  await expect(page.locator('#report-issue')).toBeEnabled();await page.keyboard.press('Escape');
  await settings(page);await expect(page.locator('#analytics-dialog')).toBeVisible();
  expect(external).toEqual([]);
});
