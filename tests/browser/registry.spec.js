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
import {createHash} from 'node:crypto';

test('metadata-only search, difficulty selection, comparison and detail absence work without detail downloads',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const requests=[];page.on('request',r=>{if(r.url().includes('/chart-details/'))requests.push(r.url());});
  await page.goto('/registry/?search=ソテリア');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const row=page.locator('#songs .song-row[data-difficulty=MASTER]');await expect(page.locator('#songs .song-row')).toHaveCount(4);
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
  await expect(page.locator('#filter-region [aria-checked="true"]')).toHaveAttribute('data-region','');
  let row=page.locator('#songs .song-row[data-difficulty=ADVANCED]').filter({hasText:/ソテリア|Soteria fixture/});
  const japanOnly=page.locator('#songs .song-row').filter({hasText:'ANiMA'}).first();
  const internationalOnly=page.locator('#songs .song-row').filter({hasText:'International fixture song'}).first();
  await expect(japanOnly).toBeVisible();await expect(internationalOnly).toBeVisible();
  row=page.locator('#songs .song-row[data-difficulty=ADVANCED]').filter({hasText:/ソテリア|Soteria fixture/});
  await expect(row).toHaveAttribute('data-version','maimai DX CiRCLE PLUS');
  await expect(row.locator('.chart-constant')).toHaveText('8.2');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/JP/);
  const original=await page.evaluate(()=>JSON.stringify({catalog:maimaiResearchCatalog.catalog,navigation:maimaiResearchCatalog.navigation}));
  await preference.focus();await preference.press('Space');
  await expect(preference).toBeChecked();
  await expect(page.locator('#filter-region [aria-checked="true"]')).toHaveAttribute('data-region','');
  await expect(circlePlus).toHaveAttribute('title','4 song / format entries, 16 charts');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  await expect(japanOnly).toBeVisible();await expect(internationalOnly).toBeVisible();
  await expect(row).toHaveAttribute('data-level','7');
  await expect(row).toHaveAttribute('data-version','maimai DX CiRCLE');
  await expect(row.locator('.chart-constant')).toHaveText('7.4');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/INTL/);
  await expect(japanOnly).toHaveAttribute('data-version','maimai DX CiRCLE PLUS');
  row=page.locator('#songs .song-row[data-difficulty=EXPERT]').filter({hasText:/ソテリア|Soteria fixture/});
  await expect(row.locator('.chart-constant')).toHaveText('12.1');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title',/JP/);
  await expect(row.locator('.chart-bpm')).toHaveText('160');
  await preference.uncheck();
  expect(await page.evaluate(()=>JSON.stringify({catalog:maimaiResearchCatalog.catalog,navigation:maimaiResearchCatalog.navigation}))).toBe(original);
  row=page.locator('#songs .song-row[data-difficulty=ADVANCED]').filter({hasText:/ソテリア|Soteria fixture/});
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
  const row=page.locator('#songs .song-row[data-difficulty=MASTER]');
  await expect(row).toHaveAttribute('data-difficulty','MASTER');
  await expect(row.locator('.player-achievement')).toContainText('97.0000%');
  await expect(row.getByRole('button',{name:'Find similar',exact:true})).toBeDisabled();
});


test('regional labels preserve the jacket through repeated preference, difficulty and comparison changes',async({page})=>{
  await page.goto('/registry/?search=ソテリア');
  const row=page.locator('#songs .song-row[data-difficulty=MASTER]'),preference=page.getByRole('checkbox',{name:'Use maimai international data',exact:true});
  await expect(row).toHaveCount(1);
  const jacket=row.locator('.song-jacket');
  await expect(jacket).not.toHaveClass(/artwork-missing/);
  const source=await jacket.locator('img').getAttribute('src');
  for(let i=0;i<2;i++){
    await preference.check();await expect(row).toContainText('Soteria fixture');
    await expect(jacket).not.toHaveClass(/artwork-missing/);
    await expect(jacket.locator('img')).toHaveAttribute('src',source);
    await expect(jacket).not.toHaveClass(/artwork-missing/);
    await row.getByRole('button',{name:'Compare this chart'}).click();
    await expect(page.locator('#compare-left-search')).toHaveValue(/Soteria fixture/);
    await page.locator('#catalog-tab').click();await preference.uncheck();
    await expect(row).toContainText('ソテリア');await expect(jacket).not.toHaveClass(/artwork-missing/);
  }
  await preference.check();await page.locator('#reset-filters').click();
  await expect(preference).not.toBeChecked();
  await expect(page.locator('#songs .song-row').filter({hasText:'ソテリア'}).first().locator('.song-jacket')).not.toHaveClass(/artwork-missing/);
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
  await page.locator('#personal-lamp-button').click();await page.locator('#personal-lamp-choices [data-value="FULL COMBO"]').click();
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
  await page.locator('#personal-lamp-button').click();await page.locator('#personal-lamp-choices [data-value="FULL COMBO"]').click();
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
    if(selected){await page.locator('#format-DX').click();await page.locator('#use-international-data').check();await page.locator('#personal-lamp-button').click();await page.locator('#personal-lamp-choices [data-value="FULL COMBO"]').click();await page.locator('#personal-min').fill('90');}
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


test('version logos use mapped assets and the shared missing-artwork fallback',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#songs .song-row').first()).toBeVisible();
  const names=await page.evaluate(()=>{
    const names=Object.keys(maimaiResearchCatalog.artwork.versions);
    for(const name of names){const logo=maimaiChartArtwork.version(name);logo.classList.add('version-logo-regression');document.body.prepend(logo);}
    const missing=maimaiChartArtwork.version('Fictional unavailable version');missing.id='missing-version-regression';document.body.prepend(missing);
    return names;
  });
  expect(names.length).toBeGreaterThan(0);
  const logos=page.locator('.version-logo-regression');await expect(logos.locator('img')).toHaveCount(names.length);
  for(const logo of await logos.all()){
    await expect(logo.locator('img')).toHaveAttribute('src',/^media\/[a-f0-9]{64}\.webp$/);
    await expect(logo).not.toHaveClass(/artwork-missing/);
    expect(await logo.locator('img').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
  }
  await expect(page.locator('#missing-version-regression')).toHaveClass(/artwork-missing/);
  await expect(page.locator('#missing-version-regression img')).toHaveCount(0);
});

const genreVectors=JSON.parse(await readFile(new URL('../fixtures/genre-aliases.json',import.meta.url),'utf8'));

test('shared genre vectors normalize only reviewed historical aliases and are idempotent',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#filter-region')).toBeVisible();
  const result=await page.evaluate(vectors=>{
    const records=vectors.flatMap(v=>v.aliases.flatMap(raw=>[raw,'sega:'+raw].map(genre=>({genre,expected:v.id,label:v.label}))));
    const data={schema_version:'maimai-browser-catalog-2',navigation:{charts:Object.fromEntries(records.map((r,i)=>[i,{genre:r.genre}])),genres:records.map(r=>({id:r.genre,label:r.label}))},catalog:records.map(r=>({regional:{INTL:{genre:r.genre}}}))};
    maimaiRegistryBrowser.normalize(data);
    const once=JSON.stringify(data);maimaiRegistryBrowser.normalize(data);
    return {idempotent:once===JSON.stringify(data),charts:Object.values(data.navigation.charts).map(r=>r.genre),regional:data.catalog.map(c=>c.regional.INTL.genre),expected:records.map(r=>r.expected),genres:data.navigation.genres};
  },genreVectors);
  expect(result.idempotent).toBe(true);expect(result.charts).toEqual(result.expected);expect(result.regional).toEqual(result.expected);
  expect(result.genres).toHaveLength(6);
  for(const vector of genreVectors)expect(result.genres).toContainEqual({id:vector.id,label:vector.label});
});

test('immutable historical duplicate genres collapse before filters initialize',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/registry/?version=duplicate-genres-fixture&view=catalog');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  const select=page.locator('#filter-genre');
  await expect(select.locator('option')).toHaveCount(7);
  const manifest=await (await page.request.get('/registry/manifest.json')).json();
  const release=manifest.releases.find(entry=>entry.version==='duplicate-genres-fixture');
  const parts=await Promise.all(release.parts.map(async part=>(await page.request.get('/registry/'+part.path)).body()));
  const raw=JSON.parse(Buffer.concat(parts).toString('utf8'));
  expect(raw.navigation.genres.some(g=>g.id.startsWith('sega:'))).toBe(true);
  for(const vector of genreVectors){
    const before=raw.catalog.filter(c=>[vector.id,...vector.aliases.map(a=>'sega:'+a)].includes(raw.navigation.charts[c.chart_id].genre));
    expect(before.length).toBeGreaterThan(0);
    await expect(select.locator('option').filter({hasText:new RegExp('^'+vector.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})).toHaveCount(1);
    await select.selectOption(vector.id);
    await expect(page.locator('#catalog-count')).toHaveText(before.length+' charts found');
    await page.locator('#use-international-data').check();
    await expect(page.locator('#catalog-count')).toHaveText(before.length+' charts found');
  }
  expect(errors).toEqual([]);
});

test('unreviewed historical genres fail before normalization changes any data',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#filter-region')).toBeVisible();
  const results=await page.evaluate(()=>{
    const original={schema_version:'maimai-browser-catalog-2',navigation:{genres:[{id:'maimai',label:'maimai'}],charts:{one:{genre:'sega:POPS&ANIME'}}},catalog:[{chart_id:'one',regional:{JP:{genre:'maimai',metadata:{catcode:'maimai'}}}}]};
    const paths=[['navigation','genres',0,'id'],['navigation','charts','one','genre'],['catalog',0,'regional','JP','genre'],['catalog',0,'regional','JP','metadata','catcode']];
    return paths.flatMap(path=>['sega:Future＆Category™','pops&anime','custom:unknown','',null].map(value=>{
      const data=structuredClone(original);let row=data;for(const key of path.slice(0,-1))row=row[key];row[path.at(-1)]=value;
      const before=JSON.stringify(data);let error='';try{maimaiRegistryBrowser.normalize(data);}catch(e){error=e.message;}
      return {error,unchanged:before===JSON.stringify(data)};
    }));
  });
  for(const result of results){expect(result.error).toBe('This catalog contains an unrecognized genre and needs review.');expect(result.unchanged).toBe(true);}
});

test('an unreviewed catalog shows a localized error instead of publishing genre options',async({page})=>{
  const manifest=await(await page.request.get('/registry/manifest.json')).json();
  const entry=manifest.releases.find(r=>r.version==='duplicate-genres-fixture');
  const data=await(await page.request.get('/registry/'+entry.startup.path)).json();
  data.navigation.genres.push({id:'sega:Future category',label:'Future category'});
  const bytes=Buffer.from(JSON.stringify(data)),sha=createHash('sha256').update(bytes).digest('hex');
  entry.startup={path:'catalog-index/'+sha+'.json',sha256:sha,bytes:bytes.length};
  await page.route('**/registry/manifest.json',route=>route.fulfill({json:manifest}));
  await page.route('**/registry/'+entry.startup.path,route=>route.fulfill({body:bytes,contentType:'application/json'}));
  await page.goto('/registry/?version=duplicate-genres-fixture');
  const messages={en:'This catalog contains an unrecognized genre and needs review.','zh-Hans':'此曲目目录包含未识别的曲风分类，需要审核。',ko:'이 곡 목록에 알 수 없는 장르가 포함되어 있어 검토가 필요합니다.',ja:'この楽曲カタログには未対応のジャンルが含まれているため、確認が必要です。'};
  for(const [locale,message]of Object.entries(messages)){
    await page.locator('.site-header [data-language="'+locale+'"]').click();
    await expect(page.locator('#lab-status')).toHaveText(message);
  }
  await expect(page.locator('#songs .song-row')).toHaveCount(0);
  await expect(page.locator('#filter-genre option')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('version')).toBe('duplicate-genres-fixture');
  expect(await page.evaluate(()=>window.maimaiResearchCatalog===undefined)).toBe(true);
});

test('clean catalog URLs follow a changed manifest default on reload without acquiring a pin',async({page})=>{
  await page.goto('/registry/?view=catalog');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  expect(new URL(page.url()).searchParams.has('version')).toBe(false);
  await expect(page.locator('#filter-genre option[value="東方Project"]')).toHaveCount(0);
  await page.route('**/registry/manifest.json',async route=>{
    const response=await route.fetch(),manifest=await response.json();manifest.default='duplicate-genres-fixture';
    await route.fulfill({response,json:manifest});
  });
  await page.reload();await expect(page.locator('#filter-genre option[value="東方Project"]')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has('version')).toBe(false);
});

test('explicit historical URLs stay pinned and Open latest removes only the version parameter',async({page})=>{
  await page.goto('/registry/?version=duplicate-genres-fixture&view=catalog&search=fixture');
  await expect(page.locator('#filter-genre option[value="東方Project"]')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('version')).toBe('duplicate-genres-fixture');
  await expect(page.locator('#lab-status')).toContainText('You are viewing an older catalog.');
  const link=page.getByRole('link',{name:'Open the latest catalog'}),latest=new URL(await link.getAttribute('href'));
  expect(latest.searchParams.has('version')).toBe(false);expect(latest.searchParams.get('view')).toBe('catalog');expect(latest.searchParams.get('search')).toBe('fixture');
  await link.click();await expect(page.locator('#catalog-count')).toContainText('charts found');
  expect(new URL(page.url()).searchParams.has('version')).toBe(false);
  await expect(page.locator('#filter-genre option[value="東方Project"]')).toHaveCount(0);
  await expect(page.locator('#search')).toHaveValue('fixture');
});

test('regional availability filters rows, counts, comparison eligibility and chips independently of metadata',async({page})=>{
  // Observe the comparison component's public eligibility callback, not its search picker
  // (direct pair selection intentionally allows all charts).
  await page.addInitScript(()=>{
    let comparison;
    Object.defineProperty(window,'maimaiChartComparison',{configurable:true,get:()=>comparison,set:value=>{
      comparison={...value,mount(options){window.testEligibleIds=options.eligibleIds;return value.mount(options);}};
    }});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const remote=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))remote.push(r.url());});
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  const region=page.locator('#filter-region'),preference=page.locator('#use-international-data');
  const jp=page.locator('#songs .song-row').filter({hasText:'ANiMA'}).first(),intl=page.locator('#songs .song-row').filter({hasText:'International fixture song'}).first();
  await expect(jp).toBeVisible();await expect(intl).toBeVisible();
  await expect(region.locator('[role=radio]')).toHaveText(['All regions','JP','International']);
  await preference.check();await expect(region.locator('[aria-checked="true"]')).toHaveAttribute('data-region','');await expect(page.locator('#catalog-count')).toHaveText('26 charts found');
  await preference.uncheck();await region.locator('[data-region="JP"]').click();
  await expect(page.locator('#catalog-count')).toHaveText('16 charts found');await expect(jp).toBeVisible();await expect(intl).toHaveCount(0);
  await expect(preference).not.toBeChecked();await expect(page.locator('#catalog-filter-count')).toHaveText('1 active');
  expect(await page.evaluate(()=>testEligibleIds().length)).toBe(16);
  await region.locator('[data-region="INTL"]').click();await expect(preference).toBeChecked();
  await expect(page.locator('#catalog-count')).toHaveText('8 charts found');await expect(intl).toBeVisible();await expect(jp).toHaveCount(0);
  expect((await page.locator('#catalog-count').boundingBox()).height).toBeGreaterThan(10);
  await expect(page.locator('#songs')).toContainText('Soteria fixture');await expect(page.locator('#catalog-filter-count')).toHaveText('2 active');
  expect(await page.evaluate(()=>testEligibleIds().length)).toBe(8);
  expect(await page.evaluate(()=>testEligibleIds().every(id=>maimaiResearchCatalog.catalog.find(c=>c.chart_id===id).regional.INTL.listing==='listed'))).toBe(true);
  await preference.uncheck();await expect(region.locator('[aria-checked="true"]')).toHaveAttribute('data-region','INTL');await expect(page.locator('#catalog-count')).toHaveText('8 charts found');await expect(page.locator('#songs')).toContainText('ソテリア');
  for(const value of ['JP','']){
    await region.locator('[data-region="INTL"]').click();await expect(preference).toBeChecked();
    await region.locator('[data-region="'+value+'"]').click();await expect(preference).not.toBeChecked();
    await expect(page.locator('#songs')).toContainText('ソテリア');await expect(page.locator('#songs')).not.toContainText('Soteria fixture');
    await expect(page.locator('#catalog-count')).toHaveText(value?'16 charts found':'26 charts found');
    await expect(page.locator('#catalog-filter-count')).toHaveText(value?'1 active':'');
  }
  await region.locator('[data-region="INTL"]').click();await expect(preference).toBeChecked();
  await page.getByRole('button',{name:'Remove International filter',exact:true}).click();
  await expect(region.locator('[aria-checked="true"]')).toHaveAttribute('data-region','');await expect(preference).not.toBeChecked();await expect(page.locator('#catalog-count')).toHaveText('26 charts found');await expect(page.locator('#songs')).toContainText('ソテリア');
  await region.locator('[data-region="INTL"]').click();await page.locator('#reset-filters').click();
  await expect(region.locator('[aria-checked="true"]')).toHaveAttribute('data-region','');await expect(preference).not.toBeChecked();await expect(page.locator('#catalog-filter-count')).toBeEmpty();await expect(page.locator('#active-filters')).toBeEmpty();
  expect(await page.evaluate(()=>testEligibleIds().length)).toBe(26);
  expect(await page.evaluate(()=>[undefined,'unknown','not_observed_in_latest_capture','listed'].map(listing=>maimaiRegistryBrowser.matchesRegion({regional:{JP:{listing}}},'JP')))).toEqual([false,false,false,true]);
  expect(errors).toEqual([]);expect(remote).toEqual([]);
});

for(const width of [280,320,1280])for(const locale of ['en','zh-Hans','ko','ja'])test(`availability control fits ${locale} at ${width}px in all three states`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/registry/');
  await expect(page.locator('#filter-region')).toBeVisible();await page.locator('.site-header [data-language="'+locale+'"]').click();
  const expected={en:['All regions','JP','International'],'zh-Hans':['全部地区','日本','国际版'],ko:['모든 지역','일본','국제판'],ja:['すべての地域','日本','海外版']}[locale];
  await expect(page.locator('#filter-region [role=radio]')).toHaveText(expected);
  for(const value of ['','JP','INTL']){
    await page.locator('#filter-region [data-region="'+value+'"]').click();
    expect(await page.locator('#filter-region [role=radio]').evaluateAll(nodes=>nodes.every(node=>{
      const box=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
      return [...range.getClientRects()].every(rect=>rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1);
    }))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  if(width===320&&locale==='en')await page.screenshot({path:test.info().outputPath('availability-mobile.png'),animations:'disabled',fullPage:true});
});


test('availability segments support radio keyboard navigation and place metadata on the right',async({page})=>{
  await page.setViewportSize({width:1280,height:900});await page.goto('/registry/');
  const radios=page.locator('#filter-region [role=radio]');
  await radios.nth(0).focus();await radios.nth(0).press('ArrowRight');
  await expect(radios.nth(1)).toBeFocused();await expect(radios.nth(1)).toHaveAttribute('aria-checked','true');
  await radios.nth(1).press('End');await expect(radios.nth(2)).toBeFocused();await expect(page.locator('#use-international-data')).toBeChecked();
  await radios.nth(2).press('Home');await expect(radios.nth(0)).toBeFocused();await expect(radios.nth(0)).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#use-international-data')).not.toBeChecked();
  await expect(page.locator('#filter-region [aria-checked="true"]')).toHaveCount(1);
  const region=await page.locator('#filter-region').boundingBox(),metadata=await page.locator('.international-data-option').boundingBox(),genre=await page.locator('#filter-genre').boundingBox();
  const format=await page.getByRole('group',{name:'Chart format',exact:true}).boundingBox();
  expect(region.x).toBeGreaterThanOrEqual(format.x+format.width);expect(Math.abs(region.y-format.y)).toBeLessThan(8);
  expect(metadata.x).toBeGreaterThanOrEqual(region.x+region.width);expect(Math.abs(metadata.y-region.y)).toBeLessThan(8);expect(region.y+region.height).toBeLessThan(genre.y);
});
