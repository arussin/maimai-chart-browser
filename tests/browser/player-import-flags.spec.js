import {test, expect} from './fixtures.js';
import {selectImportMethod} from './player-import-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const flagsPath='**/api/player-import/oauth/connectors';
const dialog=page=>page.locator('#player-import-dialog');
const services=page=>dialog(page).locator('[data-import-service]:visible');
const all=['file','report','maishift','kamaitachi','diving-fish','lxns','file:tomomai','file:mai-tools','file:dxrating','file:jietng','file:aqua','file:tachi'];
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('maimai-language-v1','en'));});
async function boot(page){await page.goto('/lab/');await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);}
async function openImport(page){await page.locator('#player-import-primary').click();await expect(dialog(page)).toBeVisible();}
async function closeImport(page){await page.keyboard.press('Escape');await expect(dialog(page)).toBeHidden();}
async function flagFixture(context,methods){const state={methods,status:200,malformed:false,reads:0};await context.route(flagsPath,route=>{state.reads++;return route.fulfill({status:state.status,contentType:'application/json',body:state.malformed?'{invalid':JSON.stringify({schemaVersion:1,methods:state.methods})});});return state;}
async function ids(page){return services(page).evaluateAll(nodes=>nodes.map(node=>node.dataset.importService));}
test('one-screen chooser starts collapsed in region order with report options and help in place',async({page})=>{
 await boot(page);await openImport(page);
 await expect(dialog(page).locator('[data-import-choice],[data-import-back],.player-import-walkthroughs')).toHaveCount(0);
 expect(await ids(page)).toEqual(['maishift','kamaitachi','diving-fish','lxns','session-report','tomomai','mai-tools','dxrating','jietng','aqua','tachi']);
 await expect(dialog(page).locator('.player-import-region>h3')).toHaveText(['International and Japan','Mainland China','Session Report','Official game exports','Private servers']);
 await expect(dialog(page).locator('.player-service-body:visible')).toHaveCount(0);
 await expect(dialog(page).locator('[data-service-toggle=maishift]')).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page.locator('#player-service-body-maishift')).toBeVisible();
 await selectImportMethod(page,'file:tachi');
 await expect(page.locator('[data-import-service=tachi]')).toContainText('Score observations only');
 await expect(page.locator('[data-import-service=kamaitachi]')).toBeVisible();
 await selectImportMethod(page,'report');await expect(page.locator('#player-report-url')).toBeVisible();
 await expect(dialog(page).getByRole('radio')).toHaveCount(2);
 await expect(dialog(page).getByRole('link',{name:'About Session Report imports'})).toBeVisible();
});
test('defaults permit local files before a held override and late disable explains the change without resetting the form',async({page,context})=>{
 let release;const held=new Promise(resolve=>release=resolve);
 await context.route(flagsPath,async route=>{await held;await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:1,methods:{file:true}})}).catch(()=>{});});
 await boot(page);await openImport(page);await selectImportMethod(page,'file:tomomai');
 await page.locator('#player-file-account').fill('fictional-draft');await expect(dialog(page).getByRole('button',{name:'Choose file',exact:true})).toBeEnabled();
 release();await expect(dialog(page)).toContainText('This import method is temporarily unavailable.');
 await expect(page.locator('#player-file-account')).toHaveValue('fictional-draft');await expect(dialog(page).getByRole('button',{name:'Choose file',exact:true})).toBeDisabled();
 await selectImportMethod(page,'file');await expect(dialog(page).getByRole('button',{name:'Choose file',exact:true})).toBeEnabled();
});
test('runtime off/on overrides are reread, all-off is respected, failures retain bundled defaults',async({page,context})=>{
 const state=await flagFixture(context,{file:true,'file:tomomai':true});await boot(page);
 for(const methods of [{file:true,'file:tomomai':true},{file:true},{'file:tomomai':true}]){
 state.methods=methods;await openImport(page);await expect(services(page)).toHaveCount(Object.keys(methods).length);await closeImport(page);
 }
 state.methods={};await openImport(page);await expect(dialog(page)).toContainText('No import options are available right now.');await expect(services(page)).toHaveCount(0);await closeImport(page);
 for(const mode of ['unavailable','malformed']){state.status=mode==='unavailable'?503:200;state.malformed=mode==='malformed';await openImport(page);await selectImportMethod(page,'file:dxrating');await expect(page.locator('#player-file-account')).toBeVisible();await closeImport(page);}
 expect(state.reads).toBe(6);
});
test('a delayed provider capability result cannot undo a runtime disable',async({page,context})=>{
 let releaseFlags,releaseCapabilities;
 const flags=new Promise(resolve=>releaseFlags=resolve),capabilities=new Promise(resolve=>releaseCapabilities=resolve);
 await context.route(flagsPath,async route=>{await flags;await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:1,methods:{file:true}})});});
 await context.route('**/api/player-import/oauth/capabilities',async route=>{await capabilities;await route.fulfill({contentType:'application/json',body:JSON.stringify({providers:{'diving-fish':{enabled:true},lxns:{enabled:true}}})});});
 await boot(page);await openImport(page);await selectImportMethod(page,'diving-fish');
 await expect(dialog(page)).toContainText('Checking connection availability');releaseFlags();
 await expect(dialog(page)).toContainText('This import method is temporarily unavailable.');
 const response=page.waitForResponse('**/api/player-import/oauth/capabilities');releaseCapabilities();await(await response).finished();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(dialog(page).locator('.player-service-body:visible .player-actions button')).toBeDisabled();
 await expect(dialog(page)).toContainText('This import method is temporarily unavailable.');
});
test('closing a pending check prevents its late result from overwriting a newer chooser',async({page,context})=>{
 let reads=0,release;const held=new Promise(resolve=>release=resolve);
 await context.route(flagsPath,async route=>{const first=++reads===1;if(first)await held;await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:1,methods:first?{}:{'file:tomomai':true}})}).catch(()=>{});});
 await boot(page);await openImport(page);await expect.poll(()=>reads).toBe(1);await closeImport(page);await openImport(page);await selectImportMethod(page,'file:tomomai');await expect(services(page)).toHaveCount(1);release();await expect(page.locator('#player-file-account')).toBeVisible();await expect(dialog(page)).not.toContainText('No import options are available right now.');
});
test('hiding methods preserves a remembered dataset and leaves data controls available',async({page,context})=>{
 const state=await flagFixture(context,{file:true});await boot(page);
 const raw=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
 const data=await page.evaluate(raw=>maimaiPlayerData.reconcile(raw),raw);
 await openImport(page);await selectImportMethod(page,'file');const chooser=page.waitForEvent('filechooser');await dialog(page).getByRole('button',{name:'Choose file',exact:true}).click();
 await(await chooser).setFiles({name:'fictional-session.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
 await page.getByLabel('Remember on this device',{exact:true}).check();await page.getByRole('button',{name:'Import data',exact:true}).click();await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
 const saved=await page.evaluate(()=>maimaiPlayerStorage.read());expect(saved.active).not.toBeNull();state.methods={};await openImport(page);await expect(dialog(page)).toContainText('No import options are available right now.');expect(await page.evaluate(()=>maimaiPlayerStorage.read())).toEqual(saved);await closeImport(page);await page.locator('#settings-toggle').click();await expect(page.locator('#player-forget')).toBeVisible();
});
for(const locale of ['en','ja','ko','zh-Hans','id'])for(const width of [320,360,375,390,414,1280])test('chooser routes, errors and controls fit: '+locale+' '+width,async({page,context},testInfo)=>{
 await flagFixture(context,Object.fromEntries(all.map(method=>[method,true])));await boot(page);await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);
  await page.setViewportSize({width,height:900});await openImport(page);
  await expect(page.locator('html')).toHaveAttribute('lang',locale);
  if(['en','ja'].includes(locale)&&[360,1280].includes(width))await page.screenshot({path:testInfo.outputPath(`after-${locale}-${width}.png`)});
  for(const method of [null,'maishift','file:dxrating','file:aqua','file:tachi','report']){
   if(method)await selectImportMethod(page,method);
   const layout=await dialog(page).evaluate(root=>{
    const bounds=root.getBoundingClientRect(),controls=[...root.querySelectorAll('button,a,input,select')].filter(n=>n.getClientRects().length);
    const clipped=controls.filter(node=>{const box=node.getBoundingClientRect();if(node.scrollWidth>node.clientWidth+1)return true;if(node.matches('input,select'))return false;const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].some(r=>r.width&&(r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1));}).map(n=>n.textContent);
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,contained:controls.every(n=>{const r=n.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right;}),clipped};
   });expect(layout).toEqual({overflow:false,contained:true,clipped:[]});
  }await closeImport(page);
});
for(const locale of ['en','ja','ko','zh-Hans','id'])test('file recovery guidance fits at 360px in '+locale,async({page,context},testInfo)=>{
 await flagFixture(context,Object.fromEntries(all.map(method=>[method,true])));await boot(page);
 await page.evaluate(locale=>maimaiI18n.setLocale(locale),locale);await page.setViewportSize({width:360,height:800});
 for(const buffer of [Buffer.from('{broken'),Buffer.from(JSON.stringify([{sheetId:'private-sentinel-invalid',achievement:100}]))]){
  await openImport(page);await selectImportMethod(page,'file:dxrating');await page.locator('#player-file-account').fill('fictional');
  const chooser=page.waitForEvent('filechooser');await dialog(page).locator('.player-service-body:visible .player-actions button').click();
  await(await chooser).setFiles({name:'export.json',mimeType:'application/json',buffer});
  await expect(dialog(page).locator('.player-message-actions')).toBeVisible();await expect(dialog(page)).not.toContainText('private-sentinel');
  expect(await dialog(page).evaluate(node=>node.scrollWidth<=node.clientWidth+1&&[...node.querySelectorAll('button')].every(button=>button.scrollWidth<=button.clientWidth+1))).toBe(true);
  await dialog(page).screenshot({path:testInfo.outputPath(`error-${locale}-${buffer[1]}.png`)});await closeImport(page);
 }
});
