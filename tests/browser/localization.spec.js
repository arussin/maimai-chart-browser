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
import AxeBuilder from '@axe-core/playwright';

const labels={en:'Find a chart','zh-Hans':'查找谱面',ko:'채보 찾기',ja:'譜面を探す'};
const choose=(page,locale)=>page.locator('.site-header [data-language="'+locale+'"]').click();
const settle=async page=>{await expect(page.locator('#songs .song-row').first()).toBeVisible();};

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
  const row=page.locator('#songs .song-row');await expect(row).toHaveCount(1);
  await row.locator('.row-difficulty').selectOption({label:'MASTER · 14'});
  const selected=await row.locator('.row-difficulty').inputValue();
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
    await expect(row.locator('.row-difficulty')).toHaveValue(selected);
    await expect(row).toContainText('ソテリア');await expect(row).toContainText('MASTER');
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
      await page.locator('#search').fill(query);await expect(page.locator('#songs .song-row')).toHaveCount(1);
      await expect(page.locator('#songs .song-row')).toContainText('ソテリア');
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
  await expect(page.locator('#songs .song-row')).toHaveCount(1);
});
