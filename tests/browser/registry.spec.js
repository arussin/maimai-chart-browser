import {test,expect} from '@playwright/test';

// Existing control tests exercise the remembered-open state. Disclosure tests
// below separately cover first visits and persistence across pages.
test.beforeEach(async({page},testInfo)=>{
  if(testInfo.title.startsWith('filter disclosures'))return;
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-catalog-filters-collapsed','0');
    localStorage.setItem('maimai-personal-filters-collapsed','0');
  });
});
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

test('metadata-only search, difficulty selection, comparison and detail absence work without detail downloads',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const requests=[];page.on('request',r=>{if(r.url().includes('/chart-details/'))requests.push(r.url());});
  await page.goto('/registry/?search=ソテリア');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const row=page.locator('#songs .song-row');await expect(row).toHaveCount(1);
  await row.locator('.row-difficulty').selectOption({label:'MASTER · 14'});
  await expect(row.locator('.chart-constant')).toHaveText('—');
  await expect(row.getByRole('button',{name:'Find similar',exact:true})).toBeDisabled();
  await row.locator('.chart-row').click();
  await expect(row.locator('.registry-metadata')).toHaveCount(0);
  await expect(row.locator('.chart-measurements')).not.toContainText('Metadata:');
  await expect(row.locator('.chart-measurements')).toContainText('Unknown');
  await expect(row.getByRole('button',{name:'Retry loading chart'})).toHaveCount(0);
  expect(requests).toEqual([]);
  await row.getByRole('button',{name:'Compare this chart'}).click();
  await expect(page.locator('#find-similar')).toBeDisabled();
  const input=page.locator('#compare-right-search');await input.fill('Fictional study 0');
  await input.press('ArrowDown');await input.press('Enter');
  await expect(page.locator('#direct-comparison')).toContainText('not enough shared measurement coverage');
  await expect(page.locator('.metric-comparison')).toContainText('Unknown');
  await page.locator('#catalog-tab').click();await page.locator('#search').fill('そてりあ');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('regional preference keeps every chart, prefers Japan by default and falls back per field',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  const circlePlus=page.locator('#version-options label').filter({hasText:'DX CiRCLE PLUS'});
  await expect(circlePlus).toHaveAttribute('title','5 song / format entries, 20 charts');
  const preference=page.getByRole('checkbox',{name:'Use maimai international data',exact:true});
  await expect(preference).not.toBeChecked();
  await expect(page.locator('#filter-region')).toHaveCount(0);
  const row=page.locator('#songs .song-row').filter({hasText:/ソテリア|Soteria fixture/});
  const japanOnly=page.locator('#songs .song-row').filter({hasText:'ANiMA'});
  const internationalOnly=page.locator('#songs .song-row').filter({hasText:'International fixture song'});
  await expect(japanOnly).toBeVisible();await expect(internationalOnly).toBeVisible();
  await row.locator('.row-difficulty').selectOption({label:'ADVANCED · 8'});
  await expect(row).toHaveAttribute('data-version','maimai DX CiRCLE PLUS');
  await expect(row.locator('.chart-constant')).toHaveText('8.2');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/JP/);
  const original=await page.evaluate(()=>JSON.stringify({catalog:maimaiResearchCatalog.catalog,navigation:maimaiResearchCatalog.navigation}));
  await preference.focus();await preference.press('Space');
  await expect(preference).toBeChecked();
  await expect(circlePlus).toHaveAttribute('title','4 song / format entries, 16 charts');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  await expect(japanOnly).toBeVisible();await expect(internationalOnly).toBeVisible();
  await expect(row).toHaveAttribute('data-level','7');
  await expect(row).toHaveAttribute('data-version','maimai DX CiRCLE');
  await expect(row.locator('.chart-constant')).toHaveText('7.4');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/INTL/);
  await expect(japanOnly).toHaveAttribute('data-version','maimai DX CiRCLE PLUS');
  await row.locator('.row-difficulty').selectOption({label:'EXPERT · 12'});
  await expect(row.locator('.chart-constant')).toHaveText('12.1');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/JP/);
  await expect(row.locator('.chart-bpm')).toHaveText('160');
  await preference.uncheck();
  expect(await page.evaluate(()=>JSON.stringify({catalog:maimaiResearchCatalog.catalog,navigation:maimaiResearchCatalog.navigation}))).toBe(original);
  await row.locator('.row-difficulty').selectOption({label:'ADVANCED · 8'});
  await expect(row.locator('.chart-constant')).toHaveText('8.2');
  await preference.check();await page.locator('#reset-filters').click();
  await expect(preference).not.toBeChecked();
  await expect(circlePlus).toHaveAttribute('title','5 song / format entries, 20 charts');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('legacy chart and pair links resolve in current inventory and remain unchanged in old releases',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  const [old,id]=await page.evaluate(()=>Object.entries(maimaiResearchCatalog.legacy_ids)[0]);
  await page.goto('/registry/?view=catalog&chart='+encodeURIComponent(old));
  await expect(page.locator('#songs .song-row[data-chart-id="'+id+'"] .chart-measurements')).toBeVisible();
  await page.goto('/registry/?version=legacy-fixture&view=catalog&chart='+encodeURIComponent(old));
  await expect(page.locator('#songs .song-row[data-chart-id="'+old+'"] .chart-measurements')).toBeVisible();
  await page.goto('/registry/?view=compare&left='+encodeURIComponent(old));
  await expect(page.locator('#compare-left-search')).not.toHaveValue('');
  await expect(page.locator('#find-similar')).toBeEnabled();
});

test('a schema-1 synthetic player file maps to a metadata-only chart without qualifying analysis',async({page})=>{
  await page.goto('/registry/?search=ソテリア');await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const template=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  await page.locator('input[type=file]').setInputFiles({name:'fictional-player.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(template)))});
  await page.getByRole('button',{name:'Import data',exact:true}).click();
  const row=page.locator('#songs .song-row');
  await expect(row).toHaveAttribute('data-difficulty','MASTER');
  await expect(row.locator('.player-achievement')).toContainText('97.0000%');
  await expect(row.getByRole('button',{name:'Find similar',exact:true})).toBeDisabled();
});


test('regional labels preserve the jacket through repeated preference, difficulty and comparison changes',async({page})=>{
  await page.goto('/registry/?search=ソテリア');
  const row=page.locator('#songs .song-row'),preference=page.getByRole('checkbox',{name:'Use maimai international data',exact:true});
  await expect(row).toHaveCount(1);
  const jacket=row.locator('.song-jacket');
  await expect(jacket).not.toHaveClass(/artwork-missing/);
  const source=await jacket.locator('img').getAttribute('src');
  for(let i=0;i<2;i++){
    await preference.check();await expect(row).toContainText('Soteria fixture');
    await expect(jacket).not.toHaveClass(/artwork-missing/);
    await expect(jacket.locator('img')).toHaveAttribute('src',source);
    await row.locator('.row-difficulty').selectOption({label:'MASTER · 14'});
    await expect(jacket).not.toHaveClass(/artwork-missing/);
    await row.getByRole('button',{name:'Compare this chart'}).click();
    await expect(page.locator('#compare-left-search')).toHaveValue(/Soteria fixture/);
    await page.locator('#catalog-tab').click();await preference.uncheck();
    await expect(row).toContainText('ソテリア');await expect(jacket).not.toHaveClass(/artwork-missing/);
  }
  await preference.check();await page.locator('#reset-filters').click();
  await expect(preference).not.toBeChecked();
  await expect(page.locator('#songs .song-row').filter({hasText:'ソテリア'}).locator('.song-jacket')).not.toHaveClass(/artwork-missing/);
});

test('filter disclosures default closed, count active groups and remember independent choices',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/registry/');
  const toggle=page.locator('#catalog-filters-toggle'),box=page.locator('#catalog-filters');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(box).toHaveAttribute('title','Click to expand');
  await expect(page.locator('#catalog-filter-content > div')).toHaveAttribute('inert','');
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await page.locator('#use-international-data').check();
  await page.locator('#difficulty-summary').click();
  await page.locator('#difficulty-options input').first().check();
  await page.locator('#difficulty-options input').nth(1).check();
  await expect(page.locator('#catalog-filter-count')).toHaveText('2 active');
  await toggle.click();await expect(page.locator('#catalog-filter-count')).toHaveText('2 active');
  await page.locator('#reset-filters').click();await expect(page.locator('#catalog-filter-count')).toBeEmpty();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();
  // Test personal controls without importing or persisting any player data.
  await page.evaluate(()=>document.querySelector('[data-personal-controls]').hidden=false);
  const personal=page.locator('[data-personal-controls] .player-filter-toggle');
  await expect(personal).toHaveAttribute('aria-expanded','false');
  await expect(personal).toHaveAttribute('title','Click to expand');
  await personal.click();await expect(personal).toHaveAttribute('aria-expanded','true');
  await page.locator('#personal-lamp').selectOption('FULL COMBO');
  await expect(page.locator('.player-filter-count').last()).toHaveText('1 active');
  await personal.click();
  await page.getByRole('button',{name:'Clear personal filters',exact:true}).click();
  await expect(personal).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.player-filter-count').last()).toBeEmpty();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(personal).toHaveAttribute('aria-expanded','false');
  const second=await context.newPage();await second.goto('/registry/');
  await expect(second.locator('#catalog-filters-toggle')).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('filters-expanded.png'),animations:'disabled'});
  await toggle.click();await page.screenshot({path:test.info().outputPath('filters-collapsed.png'),animations:'disabled'});
});

test('filter disclosures still toggle when browser storage is unavailable',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked')};Storage.prototype.setItem=()=>{throw new Error('blocked')};});
  await page.goto('/registry/');
  const toggle=page.locator('#catalog-filters-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
});


test('filter disclosures preview keeps scopes, aligned headings and removable chips in their sections',async({page})=>{
  await page.goto('/registry/filter-preview.html');
  const personal=page.locator('[data-personal-controls]'),general=page.locator('#catalog-filters');
  await expect(personal).toBeVisible();
  await expect(page.locator('.catalog-controls [data-recorded="yes"]')).toBeVisible();
  await expect(general.locator('.player-filter-toggle')).toHaveAttribute('aria-expanded','false');
  await expect(general.locator('.player-filter-body')).toHaveAttribute('inert','');
  await expect(general.locator('#format-DX')).toHaveCount(1);
  for(const root of [general,personal]){
    await expect(root.locator('.filter-empty')).toBeVisible();
    await expect(root.locator('.filter-disclosure-clear')).toBeHidden();
  }
  const first=await general.locator('.filter-disclosure-hint').boundingBox(),second=await personal.locator('.filter-disclosure-hint').boundingBox();
  expect(Math.abs(first.x-second.x)).toBeLessThan(1);
  await page.locator('#catalog-filters-toggle').click();
  await page.locator('#format-DX').click();
  await page.locator('#use-international-data').check();
  await page.locator('#catalog-filters-toggle').click();
  await expect(general.locator('.filter-chip')).toHaveCount(2);
  await expect(general.locator('.filter-chip').first()).toBeVisible();
  await page.locator('.catalog-controls [data-recorded="yes"]').click();
  await expect(personal.locator('.filter-chip')).toHaveText('My PBs ×');
  const active=await personal.locator('.filter-disclosure-hint').boundingBox();expect(active.x).toBe(second.x);
  await page.screenshot({path:test.info().outputPath('both-filters-collapsed.png'),animations:'disabled'});
  await personal.locator('.filter-chip').click();
  await expect(page.locator('.catalog-controls [data-recorded=""]')).toHaveAttribute('aria-pressed','true');
  await page.locator('#reset-filters').click();
  for(const root of [general,personal]){
    await expect(root.locator('.player-filter-toggle')).toHaveAttribute('aria-expanded','false');
    await expect(root.locator('.filter-empty')).toBeVisible();
    await expect(root.locator('.filter-disclosure-clear')).toBeHidden();
  }
  await page.locator('#catalog-filters-toggle').click();await personal.locator('.player-filter-toggle').click();
  await page.locator('#personal-lamp').selectOption('FULL COMBO');
  await expect(personal.locator('.filter-chip')).toHaveText('Combo: FULL COMBO ×');
  await personal.locator('.filter-chip').click();await expect(page.locator('#personal-lamp')).toHaveValue('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('both-filters-expanded.png'),animations:'disabled',fullPage:true});
});

for(const width of [280,320,390,1280])for(const locale of ['en','zh-Hans','ko','ja'])test(`filter disclosures keep ${locale} text within heading columns at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/registry/filter-preview.html');
  const personal=page.locator('[data-personal-controls]');await expect(personal).toBeVisible();
  const toggles=page.locator('#catalog-filters-toggle, [data-personal-controls] .player-filter-toggle');
  await page.locator('.site-header [data-language="'+locale+'"]').click();
  for(const selected of [false,true]){
    for(const toggle of await toggles.all())if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    if(selected){await page.locator('#format-DX').click();await page.locator('#use-international-data').check();await page.locator('#personal-lamp').selectOption('FULL COMBO');await page.locator('#personal-min').fill('90');}
    else{await page.locator('#reset-filters').evaluate(n=>n.click());await personal.locator('.filter-disclosure-clear').evaluate(n=>n.click());}
    for(const expanded of [true,false]){
      for(const toggle of await toggles.all())if(await toggle.getAttribute('aria-expanded')!==String(expanded))await toggle.click();
      const failures=await toggles.evaluateAll(nodes=>nodes.flatMap(node=>{
        return [...node.children].filter(n=>!n.classList.contains('player-filter-chevron')&&n.textContent).flatMap(n=>{
          const box=n.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);
          return [...range.getClientRects()].filter(r=>r.left<box.left-1||r.right>box.right+1).map(()=>({text:n.textContent,width:box.width}));
        });
      }));
      expect(failures,`expanded=${expanded}, active=${selected}`).toEqual([]);
      const positions=await toggles.evaluateAll(nodes=>nodes.map(n=>n.querySelector('.filter-disclosure-hint').getBoundingClientRect().left));
      expect(Math.abs(positions[0]-positions[1])).toBeLessThan(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      if(locale==='ja'&&width===320&&selected&&expanded)await page.screenshot({path:test.info().outputPath('japanese-expanded-active.png'),animations:'disabled'});
    }
  }
});


test('MAGiCAL logo is available when retained catalogs have no artwork mapping',async({page})=>{
  await page.goto('/registry/');
  await expect(page.locator('#songs .song-row').first()).toBeVisible();
  await page.evaluate(()=>{
    const logo=maimaiChartArtwork.version('maimai DX MAGiCAL');
    logo.id='magical-logo-regression';document.body.prepend(logo);
  });
  const logo=page.locator('#magical-logo-regression');
  await expect(logo.locator('img')).toHaveAttribute('src','version-magical.png');
  await expect(logo).not.toHaveClass(/artwork-missing/);
  expect(await logo.locator('img').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
});
