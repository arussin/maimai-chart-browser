import {test,expect} from './fixtures.js';

// Existing control tests exercise the remembered-open state. Disclosure tests
// below separately cover first visits and persistence across pages.
test.beforeEach(async({page},testInfo)=>{
  if(testInfo.title.startsWith('filter disclosures'))return;
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-catalog-filters-collapsed','0');
    localStorage.setItem('maimai-personal-filters-collapsed','0');
  });
});
import AxeBuilder from '@axe-core/playwright';

const labels={en:'Find a chart','zh-Hans':'查找谱面',ko:'채보 찾기',ja:'譜面を探す'};
const choose=(page,locale)=>page.locator('.site-header [data-language="'+locale+'"]').click();
const settle=async page=>{await expect(page.locator('#songs .song-row').first()).toBeVisible();};

const cabinetGenres={
  en:['POPS & ANIME','niconico & VOCALOID™','東方Project','GAME & VARIETY','maimai','オンゲキ & CHUNITHM'],
  'zh-Hans':['流行&动漫','niconico＆VOCALOID™','东方Project','其他游戏','舞萌','音击/中二节奏'],
  ko:['POPS & ANIME','niconico & VOCALOID™','東方Project','GAME & VARIETY','maimai','オンゲキ & CHUNITHM'],
  ja:['POPS＆アニメ','niconico＆ボーカロイド','東方Project','ゲーム＆バラエティ','maimai','オンゲキ＆CHUNITHM']
};
const cabinetGenreIds=['POPSアニメ','niconicoボーカロイド','東方Project','ゲームバラエティ','maimai','オンゲキCHUNITHM'];

for(const width of [320,1280])test(`cabinet genre labels follow language without changing filters or version identities at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/registry/?version=duplicate-genres-fixture&view=catalog');await settle(page);
  const identities=()=>page.evaluate(()=>({navigation:maimaiResearchCatalog.navigation,charts:maimaiResearchCatalog.catalog.map(({chart_id,title,artist,format,difficulty,regional})=>({chart_id,title,artist,format,difficulty,regional}))}));
  const data=await identities();
  const versionNames=()=>page.locator('#version-options .version-name').evaluateAll(nodes=>nodes.map(n=>n.firstChild.textContent));
  const versions=await versionNames();
  const genre=page.locator('#filter-genre');
  for(const locale of ['en','zh-Hans','ko','ja','en']){
    await choose(page,locale);await expect(genre.locator('option')).toHaveCount(7);
    await expect(page.locator('.party-brand')).toHaveText('maimai.party');
    expect(await versionNames()).toEqual(versions);
    for(const [index,id]of cabinetGenreIds.entries()){
      const label=cabinetGenres[locale][index];
      await expect(genre.locator('option[value="'+id+'"]').first()).toHaveText(label);
      await genre.selectOption(id);
      await expect(page.locator('.chart-card-genre').first()).toHaveText(label);
      await expect(page.locator('#active-filters')).toContainText(label);
      expect(await genre.evaluate(n=>{
        const canvas=document.createElement('canvas'),style=getComputedStyle(n),context=canvas.getContext('2d');context.font=style.font;
        return context.measureText(n.selectedOptions[0].textContent).width<=n.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-20;
      })).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  // Translating the maimai genre must not rename a song, artist or release.
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='cabinet-literals';
    for(const value of ['maimai','MASTER','東方Project']){const node=document.createElement('span');maimaiI18n.literal(node,value);host.append(node);}
    document.body.append(host);
  });
  await genre.selectOption('maimai');
  const selected=await page.locator('.song-row').evaluateAll(rows=>rows.map(r=>r.dataset.chartId));
  await choose(page,'zh-Hans');await expect(genre).toHaveValue('maimai');
  expect(await page.locator('.song-row').evaluateAll(rows=>rows.map(r=>r.dataset.chartId))).toEqual(selected);
  await expect(page.locator('#cabinet-literals span')).toHaveText(['maimai','MASTER','東方Project']);
  expect(await identities()).toEqual(data);
});

test('cabinet difficulty names update in filters, chart controls and comparison while preserving IDs',async({page})=>{
  await page.goto('/registry/?search=ソテリア&view=catalog');await settle(page);
  const row=page.locator('#songs .song-row[data-difficulty=MASTER]');
  const selected=await row.getAttribute('data-chart-id');
  await row.locator('.chart-row').click();
  await page.locator('#difficulty-summary').click();
  await page.locator('#difficulty-options input[value="MASTER"]').check();
  for(const locale of ['zh-Hans','ko','ja','en']){
    await choose(page,locale);
    const label=locale==='zh-Hans'?'大师':'MASTER';
    await expect(page.locator('#difficulty-summary')).toHaveText(label);
    await expect(page.locator('#difficulty-options label[data-difficulty="MASTER"]')).toHaveText(label);
    await expect(row.locator('.row-difficulty option:checked')).toHaveText(label+' · 14');
    await expect(row.locator('.chart-difficulty-badge')).toHaveText(label);
    await expect(row.locator('.chart-row')).toHaveAttribute('aria-label',new RegExp(label));
    await expect(row.locator('.chart-row')).toHaveAttribute('aria-label',new RegExp({en:'Chart constant unknown','zh-Hans':'谱面定数未知',ko:'채보 상수 알 수 없음',ja:'譜面定数不明'}[locale]));
    await expect(row).toHaveAttribute('data-chart-id',selected);
    await expect(page.locator('#active-filters')).toContainText(label);
    await expect(row).toHaveAttribute('data-difficulty','MASTER');
  }
  await row.getByRole('button',{name:'Compare this chart',exact:true}).click();
  await choose(page,'zh-Hans');
  await expect(page.locator('#comparison-pickers .chosen-chart')).toContainText('大师');
  const right=page.locator('#compare-right-search');await right.fill('高级');
  await expect(page.locator('#compare-right-choices .chart-choice').first()).toContainText('高级');
  await right.press('ArrowDown');await right.press('Enter');
  await expect(page.locator('#comparison-status')).toContainText('大师');
  await expect(page.locator('#comparison-status')).toContainText('高级');
  for(const [id,zh]of [['BASIC','初级'],['ADVANCED','高级'],['EXPERT','专家'],['MASTER','大师'],['RE:MASTER','宗师']]){
    await expect(page.locator('#difficulty-options label[data-difficulty="'+id+'"]')).toHaveText(zh);
  }
  await choose(page,'en');await expect(page.locator('#comparison-status')).toContainText('MASTER');
  await expect(page.locator('#comparison-status')).toContainText('ADVANCED');
});

test('cabinet difficulty names reach chart activity accessibility labels',async({page})=>{
  await page.goto('/progressive/?view=catalog');await settle(page);
  // Initial personal-state restoration may replace rows; the catalog container is stable.
  await page.locator('#songs').scrollIntoViewIfNeeded();
  const graph=page.locator('#songs .chart-flow svg').first();await expect(graph).toBeVisible();
  const original=await graph.getAttribute('aria-label');
  for(const locale of ['zh-Hans','ko','ja','en']){
    await choose(page,locale);
    await expect(graph).not.toHaveAttribute('aria-label',/\[object Object\]/);
    if(locale==='zh-Hans')await expect(graph).toHaveAttribute('aria-label',/初级|高级|专家|大师|宗师/);
  }
  await expect(graph).toHaveAttribute('aria-label',original);
});

test('GitHub link follows the chosen README language and restores the English destination',async({page})=>{
  const repository='https://github.com/arussin/maimai-chart-browser';
  await page.goto('/registry/');await settle(page);await page.locator('#about-tab').click();
  const link=page.locator('a[data-localized-readme]');
  for(const locale of ['zh-Hans','ko','ja','en']){
    await choose(page,locale);
    await expect(link).toHaveAttribute('href',locale==='en'?repository:repository+'/blob/main/README.'+locale+'.md');
  }
  await choose(page,'ko');await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await expect(link).toHaveAttribute('href',repository+'/blob/main/README.ko.md');
});

test('Japanese, Simplified Chinese and Korean phone navigation stays on one line',async({page})=>{
  await page.goto('/registry/');await settle(page);
  for(const width of [320,360,375,390,414]){
    await page.setViewportSize({width,height:900});
    for(const locale of ['ja','zh-Hans','ko']){
      await choose(page,locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);
      const layout=await page.locator('.site-header nav').evaluate(nav=>({
        lines:[...nav.querySelectorAll(':scope > button > span:first-child')].map(label=>{
          const range=document.createRange();range.selectNodeContents(label);
          return new Set([...range.getClientRects()].filter(r=>r.width).map(r=>Math.round(r.top))).size;
        }),
        overflow:nav.scrollWidth>nav.clientWidth+1,
        outside:[...nav.children].some(n=>n.getBoundingClientRect().right>nav.getBoundingClientRect().right+1),
        crowded:[...nav.querySelectorAll(':scope > button > span:first-child')].some(label=>{
          const text=label.getBoundingClientRect(),button=label.parentElement.getBoundingClientRect();
          return text.left<button.left-1||text.right>button.right+1;
        }),
      }));
      expect(layout,locale+' at '+width+'px').toEqual({lines:[1,1,1,1],overflow:false,outside:false,crowded:false});
    }
  }
});

test('concise filter defaults retain the filter context for screen readers',async({page})=>{
  await page.goto('/registry/');await settle(page);
  for(const [locale,all,version,difficulty] of [
    ['ja','すべて','バージョン','難易度'],
    ['zh-Hans','全部','版本','难度'],
    ['ko','전체','버전','난이도'],
  ]){
    await choose(page,locale);
    await expect(page.locator('#version-summary')).toHaveText(all);
    await expect(page.locator('#version-summary')).toHaveAccessibleName(version+' '+all);
    await expect(page.locator('#difficulty-summary')).toHaveText(all);
    await expect(page.locator('#difficulty-summary')).toHaveAccessibleName(difficulty+' '+all);
    await expect(page.locator('#pattern-filter-summary')).toHaveText(all);
    const label=await page.locator('#pattern-filter-label').textContent();
    await expect(page.locator('#pattern-filter-summary')).toHaveAccessibleName(label+' '+all);
  }
  await choose(page,'en');
  await expect(page.locator('#version-summary')).toHaveText('All versions');
  await expect(page.locator('#difficulty-summary')).toHaveText('All difficulties');
});

test('all languages switch instantly, preserve state and return exact English text',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/registry/');await settle(page);
  await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row[data-difficulty=MASTER]');await expect(row).toHaveCount(1);
  const selected=await row.getAttribute('data-chart-id');
  const snapshot=()=>page.locator('body').evaluate(body=>{
    const clone=body.cloneNode(true);clone.querySelectorAll('script,.language-controls').forEach(n=>n.remove());
    return clone.textContent;
  });
  const original=await snapshot(),data=await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog));
  for(const locale of ['zh-Hans','ko','ja','en']){
    await choose(page,locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('#catalog h1')).toHaveText(labels[locale]);
    await expect(page.locator('#sort-keep')).toHaveAccessibleName({en:'Enable multi-sorting','zh-Hans':'启用多条件排序',ko:'다중 기준 정렬 사용',ja:'複数条件で並べ替え'}[locale]);
    await expect(page.locator('#search')).toHaveValue('ソテリア');
    await expect(row).toHaveAttribute('data-chart-id',selected);
    await expect(row).toContainText('ソテリア');await expect(row).toContainText(locale==='zh-Hans'?'大师':'MASTER');
    expect(await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog))).toBe(data);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  expect(await snapshot()).toBe(original);expect(errors).toEqual([]);
  const axe=await new AxeBuilder({page}).include('.language-controls').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});

test('browser preference, explicit persistence, cross-page choice and storage denial',async({browser})=>{
  const context=await browser.newContext({locale:'ko-KR'}),page=await context.newPage();
  await page.goto('/registry/');await settle(page);await expect(page.locator('html')).toHaveAttribute('lang','ko');
  await choose(page,'ja');await page.reload();await settle(page);await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.goto('/registry/support-return.html');await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await context.close();
  const denied=await browser.newContext({locale:'zh-CN'});
  await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Unavailable','SecurityError');}}));
  const second=await denied.newPage();await second.goto('/registry/');await settle(second);
  await expect(second.locator('html')).toHaveAttribute('lang','zh-Hans');await choose(second,'en');
  await expect(second.locator('#catalog h1')).toHaveText(labels.en);await denied.close();
});

test('multilingual search works independently of UI language and keeps titles literal',async({page})=>{
  await page.goto('/registry/');await settle(page);
  for(const locale of ['en','zh-Hans','ko','ja']){
    await choose(page,locale);
    for(const query of ['Soteria','そてりあ','소테리아','索特里亚','suo te li ya']){
      await page.locator('#search').fill(query);await expect(page.locator('#songs .song-row')).toHaveCount(4);
      await expect(page.locator('#songs .song-row').first()).toContainText('ソテリア');
    }
  }
  const values=await page.evaluate(()=>{
    const node=document.createElement('p');document.body.append(node);
    maimaiI18n.text(node,maimaiI18n.verbatim('Close'));maimaiI18n.staticText(document.body);maimaiI18n.setLocale('ko');
    const title=node.textContent;node.remove();
    const chart={title:'Before',artist:'Artist',aliases:[]},old=maimaiSongSearch.query('Before')(chart);
    chart.title='After';chart.aliases=['후'];
    return {title,old,new:maimaiSongSearch.query('후')(chart),stale:maimaiSongSearch.query('Before')(chart)};
  });
  expect(values).toEqual({title:'Close',old:true,new:true,stale:false});
});

test('pattern lessons, menus and accessibility text update without closing a lesson',async({page})=>{
  await page.goto('/registry/');await settle(page);await choose(page,'ko');
  await page.locator('#patterns-tab').click();
  const name=await page.locator('#pattern-list .pattern-card h2').first().textContent();
  await page.locator('#pattern-search').fill(name);await expect(page.locator('#pattern-list .pattern-card').first()).toBeVisible();
  await page.locator('[data-open-pattern]').first().click();
  const dialog=page.locator('#pattern-dialog');await expect(dialog).toBeVisible();
  const before=await dialog.textContent();await page.evaluate(()=>maimaiI18n.setLocale('ja'));
  await expect(dialog).toBeVisible();expect(await dialog.textContent()).not.toBe(before);
  await expect(dialog.getByRole('button',{name:'配置を閉じる',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('IME composition does not prematurely filter the song catalog',async({page})=>{
  await page.goto('/registry/');await settle(page);const count=await page.locator('#songs .song-row').count();
  await page.locator('#search').evaluate(input=>{input.dispatchEvent(new CompositionEvent('compositionstart'));input.value='소테리아';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await expect(page.locator('#songs .song-row')).toHaveCount(count);
  await page.locator('#search').evaluate(input=>input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await expect(page.locator('#songs .song-row')).toHaveCount(4);
});
