import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
// Resolve fixtures from repository root rather than the browser's served directory.
const fixtureURL=new URL('../../output/personal-fixture.json',import.meta.url);
async function personal(){return JSON.parse(await readFile(fixtureURL,'utf8'));}
async function open(page){await page.goto('/');await expect(page.locator('#explore-search')).toBeVisible();}
async function importValue(page,value){await page.locator('#site-import').setInputFiles({name:'results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}

test('romaji searches share aliases across Charts and both comparison pickers',async({page})=>{
  await page.goto('/romaji/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  for(const query of ['Umiyuri','UMIYURI KAITEITAN','umi yuri','umiyuri-kaiteitan','Ｕｍｉｙｕｒｉ']){
    await page.locator('#search').fill(query);await expect(page.locator('#songs .song-row')).toHaveCount(1);
    await expect(page.locator('#songs')).toContainText('ウミユリ海底譚');await expect(page.locator('#songs')).not.toContainText('Unrelated fictional artist');
  }
  await page.locator('#search').fill('ウミユリ');await expect(page.locator('#songs .song-row')).toHaveCount(2);
  await page.locator('#search').fill('Senbonzakura');await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await expect(page.locator('#songs')).toContainText('千本桜');
  await page.locator('#search').fill('Invented refrain');await expect(page.locator('#songs')).toContainText('Fictional study 3');
  await page.locator('#search').fill('Umiyuri');await setLevel(page,'min','11');await expect(page.locator('#songs .song-row')).toHaveCount(0);
  await page.locator('#level-clear').click();await expect(page.locator('#songs .song-row')).toHaveCount(1);
  const selectedTitle=await page.locator('#songs .chart-row').first().getAttribute('aria-label');
  await page.locator('#compare-tab').click();
  for(const [side,query,title]of [['left','umiyuri','ウミユリ海底譚'],['right','senbonzakura','千本桜']]){
    const input=page.locator('#compare-'+side+'-search');await input.fill(query);
    await expect(page.locator('#compare-'+side+'-choices button')).toHaveCount(1);
    await input.press('ArrowDown');await page.keyboard.press('Enter');await expect(input).toHaveValue(title);
  }
  await expect(page.locator('#direct-comparison')).toContainText('Chart measurements');
  expect(selectedTitle).toContain('ウミユリ海底譚');expect(page.url()).not.toContain('umiyuri');expect(requests).toEqual([]);
});

test('romaji matching works in Explore while keeping punctuation and unknown titles predictable',async({page})=>{
  await page.goto('/romaji-explore/');await expect(page.locator('#explore-search')).toBeVisible();
  const requests=[];page.on('request',r=>requests.push(r.url()));
  for(const query of ['umiyuri','umi yuri kaiteitan','n-buna Umiyuri']){
    await page.locator('#explore-search').fill(query);await expect(page.locator('#explore-count')).toContainText('1 matching');
    await expect(page.locator('#explore-list')).toContainText('ウミユリ海底譚');
  }
  await page.locator('#explore-search').fill('senbon zakura');await expect(page.locator('#explore-list')).toContainText('千本桜');
  await page.locator('#explore-search').fill('madeupnomatch');await expect(page.locator('#explore-count')).toContainText('0 matching');
  await page.locator('#explore-search').fill('!!!');await expect(page.locator('#explore-count')).toContainText('0 matching');
  await page.locator('#explore-search').fill('ウミユリ');await expect(page.locator('#explore-count')).toContainText('2 matching');
  expect(requests).toEqual([]);
});

test('search, filtering, detail and keyboard close remain usable',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await page.locator('#explore-search').fill('orbit');await expect(page.locator('#explore-count')).toContainText('2 matching');
  await page.locator('#explore-list [data-chart]').first().click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#explore-reset').click();await expect(page.locator('#explore-count')).toContainText('7 matching');
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('personal file renders prepared cards, makes no requests, clears and reloads cleanly',async({page})=>{
  await open(page);const requests=[];page.on('request',r=>requests.push(r.url()));
  await importValue(page,await personal());await expect(page.getByRole('button',{name:'My results',exact:true})).toBeVisible();
  await expect(page.locator('#personal-targets .explore-target').first()).toBeVisible();
  expect(requests).toEqual([]);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.locator('#site-clear').click();await expect(page.getByRole('button',{name:'My results',exact:true})).toHaveCount(0);
  await expect(page.locator('#personal-targets')).toBeHidden();await importValue(page,await personal());await page.reload();
  await expect(page.locator('#explore-search')).toBeVisible();await expect(page.locator('#site-clear')).toBeHidden();
});
test('invalid versions, missing charts and duplicate attempts fail without replacing valid data',async({page})=>{
  await open(page);await importValue(page,await personal());
  for(const edit of [x=>x.schema_version='9.0.0',x=>x.catalog.version='wrong',x=>x.overlay.entries[0].chart_id='missing',x=>x.overlay.entries[0].attempts.push(x.overlay.entries[0].attempts[0])]){
    const data=await personal();edit(data);await importValue(page,data);await expect(page.locator('#site-status')).toHaveAttribute('data-error','true');
    await expect(page.getByRole('button',{name:'My results',exact:true})).toBeVisible();
  }
});
test('personal metadata cannot be copied into shareable comparison URLs',async({page})=>{
  await open(page);const data=await personal();
  data.recommendations.cards[0].alternative_query={chart_id:data.recommendations.cards[0].chart_id,mode:'private-player-name'};
  await importValue(page,data);await expect(page.locator('#site-status')).toContainText('Invalid comparison mode');
  expect(page.url()).not.toContain('private-player-name');await expect(page.locator('#site-clear')).toBeHidden();
});
test('versioned chart links open exact details and missing releases are recoverable',async({page})=>{
  const data=await personal(),id=data.overlay.entries[0].chart_id;
  await page.goto('/?'+new URLSearchParams({catalog:data.catalog.id,version:data.catalog.version,chart:id}));
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog')).toContainText(id);
  await page.goto('/?catalog=gone&version=old');await expect(page.locator('#site-status')).toContainText('not available');
  await page.locator('#site-catalog').selectOption('1');await expect(page.locator('#explore-search')).toBeVisible();
  await page.goto('/?'+new URLSearchParams({catalog:data.catalog.id,version:data.catalog.version,chart:'missing'}));
  await expect(page.locator('#site-status')).toContainText('not present');await expect(page.locator('#explore-search')).toBeVisible();
});
test('accessible controls and mobile reflow with personal cards',async({page})=>{
  await open(page);await importValue(page,await personal());await expect(page.locator('#site-clear')).toBeVisible();
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations).toEqual([]);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('research browser combines filters and retains them while sorting',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?version=fixture-v5');await expect(page.locator('#loaded-count')).toHaveText('6');
  await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#songs')).toContainText('Fictional study 0');
  await page.locator('#search').fill('');
  await page.locator('#version-summary').click();
  await page.locator('#version-options').getByRole('checkbox',{name:'DX PRiSM PLUS',exact:true}).check();
  await page.keyboard.press('Escape');
  await setLevel(page,'min','11');
  await expect(page.locator('#songs .song-row')).toHaveCount(2);
  await selectDifficulties(page,['MASTER']);
  await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await page.locator('[data-sort-key=level]').click();
  await page.locator('[data-sort-key=level]').click();
  await expect(page.locator('#version-summary')).toHaveText('DX PRiSM PLUS');
  await expect(page.locator('#filter-min')).toHaveValue('11');
  await page.locator('#search').fill('not found');await expect(page.locator('#songs .song-row')).toHaveCount(0);
  await page.locator('#search').fill('');await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await page.locator('#reset-filters').click();await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await page.locator('#compare-tab').click();await expect(page.locator('#comparison-pickers')).toBeVisible();
  await expect(page.locator('#prepared-examples')).not.toHaveAttribute('open','');
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('three sort priorities break ties in order and reverse independently',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await page.locator('[data-sort-key=level]').click();await page.locator('[data-sort-key=level]').click();
  await page.locator('[data-sort-key=difficulty]').click({modifiers:['Shift']});
  await page.locator('#sort-keep').check();
  await page.locator('[data-sort-key=title]').click();await page.locator('[data-sort-key=title]').click();
  const titles=()=>page.locator('#songs .song-row').evaluateAll(rows=>rows.map(row=>row.dataset.title));
  expect(await titles()).toEqual(['Fictional study 4','Fictional study 3','Fictional study 5','Fictional study 1','Fictional study 2','Fictional study 0']);
  await page.locator('[data-sort-key=difficulty]').click();
  expect(await titles()).toEqual(['Fictional study 5','Fictional study 4','Fictional study 3','Fictional study 2','Fictional study 0','Fictional study 1']);
  await selectDifficulties(page,['RE:MASTER']);
  expect(await titles()).toEqual(['Fictional study 5']);
});

test('complete dictionary supports demos, keyboard close and stable links',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?version=fixture-v5');await page.locator('#patterns-tab').click();
  await expect(page.locator('#pattern-list .pattern-card')).toHaveCount(36);
  await expect(page.locator('#pattern-count')).toContainText('36 illustrated demos with contrasts');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.locator('#pattern-search').fill('two-position');
  await page.locator('[data-open-pattern="pattern.two_position_alternation"]').click();
  const dialog=page.locator('#pattern-dialog');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Step',exact:true}).click();await expect(dialog.locator('.demo-progress')).toHaveText('13% · 0.5 beats');
  await expect(dialog.locator('.field svg circle[fill="#b82d75"]')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Play demo',exact:true}).click();await expect(dialog.getByRole('button',{name:'Pause demo'})).toBeVisible();
  await dialog.getByRole('button',{name:'Pause demo'}).click();const link=page.url();expect(link).toContain('pattern=pattern.two_position_alternation');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.locator('[data-open-pattern="pattern.two_position_alternation"]')).toBeFocused();
  await page.locator('#pattern-search').fill('umiyuri');await page.locator('[data-open-pattern="pattern.umiyuri"]').click();
  await expect(dialog).toContainText('pair → intervening tap → next pair');await expect(dialog.getByRole('button',{name:'Play demo'})).toBeVisible();
  await dialog.getByRole('button',{name:'Contrasting example',exact:true}).click();await expect(dialog.locator('.lesson-caption')).toContainText('lacks this recurring phase relationship');
  expect(requests).toEqual([]);expect(errors).toEqual([]);
  await page.goto(link);await expect(dialog).toBeVisible();await expect(dialog).toContainText('two-position alternation');
});

test('research controls and pattern demos remain accessible and reflow at 200 percent',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  await page.locator('[data-sort-key=title]').focus();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.locator('#patterns-tab').click();
  await page.locator('[data-open-pattern="pattern.two_position_alternation"]').click();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('#pattern-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('version multi-select unions releases while retaining other filters',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await page.locator('#version-summary').click();
  const options=page.locator('#version-options');await options.getByRole('checkbox',{name:'DX PRiSM PLUS',exact:true}).check();
  await expect(page.locator('#songs .song-row')).toHaveCount(3);
  await options.getByRole('checkbox',{name:'DX',exact:true}).check();
  await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await expect(page.locator('#version-summary')).toHaveText('2 versions selected');
  await page.keyboard.press('Escape');await expect(page.locator('#version-summary')).toBeFocused();
  await setLevel(page,'min','11');await expect(page.locator('#songs .song-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Remove version DX PRiSM PLUS',exact:true}).click();
  await expect(page.locator('#songs .song-row')).toHaveCount(1);await expect(page.locator('#filter-min')).toHaveValue('11');
  await page.locator('#version-summary').click();await page.locator('#version-clear').click();
  await expect(page.locator('#songs .song-row')).toHaveCount(3);
  await options.getByRole('checkbox',{name:'DX',exact:true}).check();await page.locator('#version-summary').click();await setLevel(page,'min','10');
  await page.locator('#filter-min').fill('11');await page.getByRole('button',{name:'Remove version DX',exact:true}).click();
  await expect(page.locator('#version-summary')).toHaveText('All versions');await expect(page.locator('#filter-min')).toHaveValue('11');await expect(page.locator('#songs .song-row')).toHaveCount(3);
});

test('whole chart row responds to level, whitespace, Enter and Space',async({page})=>{
  await page.goto('/lab/');const row=page.locator('#songs .song-row').first(),button=row.locator('.chart-row');
  await row.locator('.chart-level').click();await expect(button).toHaveAttribute('aria-expanded','true');
  await button.focus();await page.keyboard.press('Space');await expect(button).toHaveAttribute('aria-expanded','false');
  await page.keyboard.press('Enter');await expect(row.locator('.chart-measurements')).toBeVisible();
  const box=await button.boundingBox();await button.click({position:{x:box.width-5,y:5}});await expect(button).toHaveAttribute('aria-expanded','false');
});

async function chooseComparisonChart(page,side,title){
  await page.locator('#compare-'+side+'-search').fill(title);
  await page.locator('#compare-'+side+'-choices').getByRole('button',{name:new RegExp(title)}).first().click();
}

test('any two catalog charts compare and survive a shared link',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?view=compare');await expect(page.locator('#loaded-count')).toHaveText('6');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  const firstSearch=page.locator('#compare-left-search');
  await firstSearch.fill('Fictional study');await firstSearch.press('ArrowDown');
  await page.keyboard.press('Escape');await expect(firstSearch).toBeFocused();
  await expect(page.locator('#compare-left-choices')).toBeHidden();
  await chooseComparisonChart(page,'left','Fictional study 4');
  await chooseComparisonChart(page,'right','Fictional study 2');
  await expect(page.locator('#direct-comparison .metric-comparison')).toBeVisible();
  await expect(page.locator('#direct-comparison')).toContainText('Fictional study 4');
  await expect(page.locator('#direct-comparison')).toContainText('Fictional study 2');
  const link=page.url();expect(link).toContain('left=');expect(link).toContain('right=');expect(requests).toEqual([]);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.goto(link);await expect(page.locator('#direct-comparison .metric-comparison')).toBeVisible();
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('any chart can find similar charts and choose a result for comparison',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/');await page.locator('#search').fill('Fictional study 4');
  await page.locator('#songs .chart-row').click();
  await page.locator('#songs').getByRole('button',{name:'Find similar',exact:true}).click();
  await expect(page.locator('#compare')).toBeVisible();
  await expect(page.locator('#similar-results .similar-chart').first()).toBeVisible();
  await page.locator('#similar-results [data-compare-chart]').first().click();
  await expect(page.locator('#direct-comparison .metric-comparison')).toBeVisible();
  await expect(page.locator('#direct-comparison')).toContainText('Fictional study 4');
  expect(errors).toEqual([]);
});

test('prepared passage playback still steps, plays and changes passages',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?view=compare');await page.locator('#prepared-examples>summary').click();
  await page.locator('#matches').getByRole('button',{name:'Compare passages',exact:true}).first().click();
  const panel=page.locator('#passages-0');await expect(panel.locator('.field svg')).toHaveCount(2);
  const before=await panel.locator('input[type=range]').inputValue();
  await panel.getByRole('button',{name:'Step',exact:true}).click();expect(await panel.locator('input[type=range]').inputValue()).not.toBe(before);
  await panel.getByRole('button',{name:'Play',exact:true}).click();await expect(panel.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Pause',exact:true}).click();
  const choices=panel.getByRole('combobox',{name:'Supporting passage'});if(await choices.locator('option').count()>1)await choices.selectOption('1');
  await expect(panel.locator('.field svg')).toHaveCount(2);expect(errors).toEqual([]);
});

test('song rows retain same-level difficulty choices and update exact chart actions',async({page})=>{
  await page.goto('/grouped/');await expect(page.locator('#songs .song-row')).toHaveCount(5);
  await page.locator('#search').fill('Fictional study 3');
  const row=page.locator('#songs .song-row'),picker=row.locator('.row-difficulty');
  await expect(picker.locator('option')).toHaveCount(2);
  await expect(row.locator('.chart-bpm')).toHaveText('160');
  await row.locator('.chart-level').click();await expect(row.locator('.chart-measurements')).toBeVisible();
  const before=await row.evaluate(el=>getComputedStyle(el).backgroundColor);
  const remaster=await picker.locator('option').filter({hasText:'RE:MASTER'}).getAttribute('value');
  await picker.selectOption(remaster);await expect(picker).toBeFocused();
  await expect(row).toHaveAttribute('data-difficulty','RE:MASTER');
  expect(await row.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(before);
  await expect(row.locator('.chart-measurements>h3')).toContainText('RE:MASTER');
  await setLevel(page,'min','11');await setLevel(page,'max','11');
  await expect(picker.locator('option')).toHaveCount(2);await expect(picker).toHaveValue(remaster);
  await selectDifficulties(page,['MASTER']);
  await expect(picker.locator('option')).toHaveCount(1);await expect(row).toHaveAttribute('data-difficulty','MASTER');
  await selectDifficulties(page,[]);await expect(picker).toHaveValue(remaster);
  await row.getByRole('button',{name:'Compare this chart',exact:true}).click();
  expect(new URL(page.url()).searchParams.get('left')).toBe(remaster);
  await expect(page.locator('#comparison-pickers')).toContainText('RE:MASTER');
});

test('YouTube searches follow difficulty and comparisons without background requests',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/grouped/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const requests=[];context.on('request',r=>requests.push({url:r.url(),referrer:r.headers().referer}));
  await page.locator('#search').fill('Fictional study 3');
  const row=page.locator('#songs .song-row'),link=row.locator('.youtube-search'),picker=row.locator('.row-difficulty');
  const original=await link.getAttribute('href');
  const remaster=await picker.locator('option').filter({hasText:'RE:MASTER'}).getAttribute('value');
  await picker.selectOption(remaster);
  const href=await link.getAttribute('href'),query=new URL(href).searchParams.get('search_query');
  expect(href).not.toBe(original);expect(query).toMatch(/^maimai Fictional study 3 (STD|DX) RE:MASTER$/);
  await expect(link).toHaveAttribute('aria-label',/YouTube search.*RE:MASTER.*new tab/);
  expect(requests).toEqual([]);
  // Fulfil the destination locally: exercise native navigation without contacting YouTube.
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Search destination</title>'}));
  const nextPage=context.waitForEvent('page');await link.focus();await link.press('Enter');const popup=await nextPage;
  await popup.waitForLoadState();expect(popup.url()).toBe(href);expect(await popup.evaluate(()=>window.opener===null)).toBe(true);
  expect(requests).toEqual([{url:href,referrer:undefined}]);await popup.close();requests.length=0;
  await expect(row.locator('.chart-row')).toHaveAttribute('aria-expanded','false');
  await row.locator('.chart-level').click();await row.getByRole('button',{name:'Find similar',exact:true}).click();
  await expect(page.locator('#comparison-pickers .youtube-search')).toHaveAttribute('href',href);
  const match=page.locator('#similar-results .similar-chart').first();await expect(match.locator('.youtube-search')).toBeVisible();
  const matchHref=await match.locator('.youtube-search').getAttribute('href');await match.getByRole('button',{name:/^Compare/}).click();
  await expect(page.locator('#comparison-pickers .youtube-search').nth(1)).toHaveAttribute('href',matchHref);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('YouTube queries preserve song punctuation and omit unknown titles and private fields',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const result=await page.evaluate(()=>{
    const link=window.maimaiChartLinks.youtube({title:'  曲 & # + ? / <test>  ',format:'STD',difficulty:'MASTER',artist:'Artist',chart_id:'internal-id',player:'private-player',achievement:99});
    const url=new URL(link.href);
    return {origin:url.origin,path:url.pathname,params:[...url.searchParams],hash:url.hash,blank:window.maimaiChartLinks.youtube({title:'   '}),missing:window.maimaiChartLinks.youtube({})};
  });
  expect(result).toEqual({origin:'https://www.youtube.com',path:'/results',params:[['search_query','maimai 曲 & # + ? / <test> STD MASTER']],hash:'',blank:null,missing:null});
});

test('pattern mappings connect rows, lesson discovery, filters and observed sections',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await expect(page.locator('#mapping-note')).toContainText('36 pattern / trait types checked');
  await expect(page.locator('.song-row>.chart-summary>.chart-flow svg')).toHaveCount(6);
  const id='pattern.two_position_alternation';await selectPatterns(page,[id]);
  const rows=page.locator('#songs .song-row');expect(await rows.count()).toBeGreaterThan(0);
  for(const row of await rows.all())await expect(row.locator('.chart-patterns')).toContainText('alternation');
  const first=rows.first();await first.locator('.chart-row').click();
  await expect(first.locator('.chart-pattern-detail .pattern-evidence')).not.toHaveCount(0);
  await first.locator('.span-button').first().click();await expect(first.locator('.flow-reading')).toContainText('highlighted');
  await expect(first.locator('.flow-highlight')).not.toHaveCount(0);
  await first.locator('.chart-patterns [data-pattern]').first().click();await expect(page.locator('#pattern-dialog')).toBeVisible();
  await page.locator('#pattern-dialog').getByRole('button',{name:'Find charts with this pattern',exact:true}).click();
  await expect(page.locator('#pattern-dialog')).toBeHidden();await expect(page.locator('#catalog')).toBeVisible();
  const link=page.url();expect(link).toContain('pattern-filter=');expect(requests).toEqual([]);
  await page.goto(link);await expect(page.locator('#pattern-filter-summary')).not.toHaveText('All patterns');
  await page.locator('#reset-filters').click();expect(page.url()).not.toContain('pattern-filter=');
  await page.locator('#patterns-tab').click();await expect(page.locator('[data-find-pattern="'+id+'"]').first()).toBeVisible();
  await expect(page.locator('[data-pattern-id="pattern.umiyuri"]')).toContainText('Find charts · 0');
  expect(errors).toEqual([]);
});

test('comparisons foreground patterns and share a vertical activity scale',async({page})=>{
  await page.goto('/lab/?view=compare');await expect(page.locator('#loaded-count')).toHaveText('6');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await chooseComparisonChart(page,'left','Fictional study 4');await chooseComparisonChart(page,'right','Fictional study 2');
  await expect(page.locator('#direct-comparison .pattern-comparison')).toBeVisible();
  await expect(page.locator('.flow-comparison svg')).toHaveCount(2);
  const scales=await page.locator('.flow-comparison svg').evaluateAll(items=>items.map(s=>[...s.querySelectorAll('.flow-axis')].slice(0,3).map(t=>t.textContent)));
  expect(scales[0]).toEqual(scales[1]);
  await page.locator('#find-similar').click();await expect(page.locator('#similar-results h2')).toHaveText('Similar patterns & demands');
  await expect(page.locator('#similar-results .match-patterns').first()).toBeVisible();
  await page.locator('#similar-priority').selectOption('measurements');await expect(page.locator('#similar-results h2')).toHaveText('Similar chart demands');
  await expect(page.locator('#similar-results .match-patterns')).toHaveCount(0);expect(requests).toEqual([]);
});

test('column sorting works by keyboard and keeps explicit priority order',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  await expect(page.locator('#sort-panel')).toHaveCount(0);
  const bpm=page.locator('[data-sort-key=bpm]');await bpm.focus();await page.keyboard.press('Enter');
  await expect(bpm).toHaveAttribute('aria-label',/priority 1, ascending/);
  await page.keyboard.press('Space');await expect(bpm).toHaveAttribute('aria-label',/descending/);
  await page.locator('#sort-keep').check();await page.locator('[data-sort-key=level]').click();
  await expect(page.locator('[data-sort-key=level]')).toHaveAttribute('aria-label',/priority 2/);
  await page.getByRole('button',{name:'Remove BPM sort priority',exact:true}).click();
  await expect(page.locator('[data-sort-key=level]')).toHaveAttribute('aria-label',/priority 1/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('unknown pattern coverage is not treated as absence or a pattern match',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const result=await page.evaluate(()=>{
    const data=JSON.parse(document.getElementById('challenge-data').textContent),left=data.catalog[0],right=data.catalog[1];
    const unknown={...right,source_hash:'wrong-source'};
    return {comparison:window.maimaiChartOverview.compare(left,unknown),record:window.maimaiChartOverview.get(unknown),patterns:window.maimaiChartOverview.patternIds};
  });
  expect(result.record).toBeNull();expect(result.comparison.patternDistance).toBeNull();
  expect(result.comparison.first).toEqual([]);expect(result.comparison.second).toEqual([]);
  expect(result.patterns).toContain('pattern.umiyuri');
});

test('pattern priority can promote a structural match and leaves unknown coverage last',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const result=await page.evaluate(()=>{
    const data=JSON.parse(document.getElementById('challenge-data').textContent),ids=['a-source','b-measurements','c-patterns','d-unknown'];
    const charts=ids.map((id,i)=>({...data.catalog[i===2?3:0],chart_id:id,song_id:id,song_family:id}));
    const index=window.maimaiChallengeMatching.createIndex(charts);
    return{plain:index.similar(ids[0]).map(r=>r.chart_id),patterns:index.similar(ids[0],{patternCompare:(_,c)=>({patternDistance:c.chart_id===ids[2]?0:c.chart_id===ids[1]?1:null})}).map(r=>r.chart_id)};
  });
  expect(result.plain[0]).toBe('b-measurements');
  expect(result.patterns).toEqual(['c-patterns','b-measurements','d-unknown']);
});

test('pattern comparison distinguishes frequency even when chart tags are identical',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const result=await page.evaluate(()=>{
    const data=JSON.parse(document.getElementById('challenge-data').textContent),[left,right]=data.catalog,overview=window.maimaiChartOverview;
    const record=overview.get(right),sourceHash=record.source_hash;Object.assign(record,structuredClone(overview.get(left)),{source_hash:sourceHash});
    const same=overview.compare(left,right);
    for(const tag of record.tags)if(overview.patternIds[tag[0]].startsWith('pattern.')&&tag[1]==='detected')tag[2]*=5;
    const changed=overview.compare(left,right);return{same,changed};
  });
  expect(result.same.patternDistance).toBe(0);expect(result.changed.shared).toEqual(result.same.shared);
  expect(result.changed.patternDistance).toBeGreaterThan(0);
});

test('BPM sorting keeps missing values last and completed lessons are visible',async({page})=>{
  await page.goto('/lab/');await page.locator('[data-sort-key=title]').focus();
  await page.locator('[data-sort-key=bpm]').click();
  const tempos=()=>page.locator('#songs .chart-bpm').allTextContents();
  expect(await tempos()).toEqual(['120','120','160','160','180','—']);
  await page.locator('[data-sort-key=bpm]').click();
  expect(await tempos()).toEqual(['180','160','160','120','120','—']);
  await page.locator('#patterns-tab').click();await page.locator('#pattern-search').fill('gallop');
  await expect(page.locator('.pattern-description')).toContainText('Repeat short-long timing pairs');
  await expect(page.locator('.pattern-card .lesson-art')).toHaveCount(1);
  await page.locator('#pattern-search').fill('umiyuri');
  await expect(page.locator('[data-pattern-id="pattern.umiyuri"] .pattern-description')).toContainText('launch the previous slide at the next pair');
});

test('all 36 lessons play, step, switch contrasts and preserve privacy',async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?view=patterns');await expect(page.locator('.pattern-card')).toHaveCount(36);
  await page.locator('#pattern-scope').selectOption('traits');await expect(page.locator('.pattern-card')).toHaveCount(14);
  await page.locator('#pattern-scope').selectOption('patterns');await expect(page.locator('.pattern-card')).toHaveCount(22);
  await page.locator('#pattern-scope').selectOption('all');
  const ids=await page.locator('[data-open-pattern]').evaluateAll(nodes=>nodes.map(n=>n.dataset.openPattern)),requests=[];
  page.on('request',r=>requests.push(r.url()));
  const dialog=page.locator('#pattern-dialog');
  for(const id of ids){
    await page.locator('[data-open-pattern="'+id+'"]').click();
    for(const name of ['Example','Contrasting example']){
      await dialog.getByRole('button',{name,exact:true}).click();
      const art=dialog.locator('.demo-stage>.lesson-art');await expect(art).toBeVisible();
      const before=await art.locator('.lesson-playhead').getAttribute('x1');
      await dialog.getByRole('button',{name:'Step',exact:true}).click();expect(await art.locator('.lesson-playhead').getAttribute('x1')).not.toBe(before);
      await dialog.getByRole('button',{name:'Play demo',exact:true}).click();await expect(dialog.getByRole('button',{name:'Pause demo',exact:true})).toBeVisible();
      await dialog.getByRole('button',{name:'Pause demo',exact:true}).click();
      await dialog.locator('input[type=range]').fill('1000');await expect(dialog.locator('.demo-progress')).toContainText('100%');
      await dialog.getByRole('button',{name:'Restart',exact:true}).click();await expect(dialog.locator('.demo-progress')).toContainText('0%');
    }
    await dialog.getByRole('button',{name:'Close pattern'}).click();
  }
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});

test('lesson contrasts keep equal graph scales and work with reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/lab/?view=patterns&pattern=trait.high_onset_density');
  const dialog=page.locator('#pattern-dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Play demo',exact:true})).toBeHidden();
  const labels=()=>dialog.locator('.lesson-art .lesson-axis').allTextContents(),scale=await labels();
  await dialog.getByRole('button',{name:'Contrasting example',exact:true}).click();expect(await labels()).toEqual(scale);
  await dialog.getByRole('button',{name:'Step',exact:true}).click();await expect(dialog.locator('.demo-progress')).toContainText('1 second');
  await expect(dialog.locator('.lesson-reading')).toContainText('3 inputs / s');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('public artwork sits left of rows, versions retain accessible multi-select and images stay local',async({page})=>{
  const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/artwork/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const row=page.locator('.song-row').filter({has:page.getByText('Fictional study 0',{exact:true})});
  const jacket=row.locator('.song-jacket');await expect(jacket).not.toHaveClass(/artwork-missing/);
  const bounds=await jacket.boundingBox(),title=await row.locator('.chart-row').boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(title.x);
  await jacket.click();await expect(row.locator('.chart-measurements')).toBeVisible();
  await expect(page.locator('.song-jacket.artwork-missing')).toHaveCount(5);
  await page.locator('#version-summary').click();
  const versions=page.locator('#version-options'),prism=versions.getByRole('checkbox',{name:'DX PRiSM PLUS',exact:true});
  await expect(prism.locator('..').locator('.version-logo')).not.toHaveClass(/artwork-missing/);
  await expect(prism.locator('..').locator('.version-count')).toContainText('3 charts');
  await prism.focus();await page.keyboard.press('Space');await expect(prism).toBeChecked();
  await versions.getByRole('checkbox',{name:'DX',exact:true}).check();
  await expect(page.locator('#version-summary')).toContainText('2 versions');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(requests.filter(url=>new URL(url).origin!=='http://127.0.0.1:8766')).toEqual([]);expect(errors).toEqual([]);
});

test('unavailable jacket files fall back without breaking chart interactions',async({page})=>{
  await page.route('**/media/*.webp',route=>route.fulfill({status:404,body:''}));
  await page.goto('/artwork/');await expect(page.locator('#loaded-count')).toHaveText('6');
  const row=page.locator('.song-row').first();await expect(row.locator('.song-jacket')).toHaveClass(/artwork-missing/);
  await expect(row.locator('.song-jacket img')).toHaveCount(0);await row.locator('.chart-row').click();await expect(row.locator('.chart-measurements')).toBeVisible();
});


async function setLevel(page,side,value){const field=page.locator('#filter-'+side);await field.fill(value);await field.press('Enter');}
async function selectDifficulties(page,values){
  if(!await page.locator('#difficulty-filter').evaluate(el=>el.open))await page.locator('#difficulty-summary').click();
  await page.locator('#difficulty-clear').click();
  for(const value of values)await page.locator('#difficulty-options').getByRole('checkbox',{name:value,exact:true}).check();
  await page.keyboard.press('Escape');
}

test('difficulty checkboxes combine choices and preserve matching row selections',async({page})=>{
  await page.goto('/grouped/');await expect(page.locator('.song-row')).toHaveCount(5);
  await selectDifficulties(page,['MASTER','RE:MASTER']);await expect(page.locator('#difficulty-summary')).toHaveText('2 difficulties selected');
  await page.locator('#search').fill('Fictional study 3');const row=page.locator('.song-row'),picker=row.locator('.row-difficulty');
  await expect(picker.locator('option')).toHaveCount(2);const remaster=await picker.locator('option').filter({hasText:'RE:MASTER'}).getAttribute('value');await picker.selectOption(remaster);
  await page.locator('[data-sort-key=level]').click();await expect(picker).toHaveValue(remaster);
  await page.getByRole('button',{name:'Remove difficulty MASTER',exact:true}).click();await expect(picker.locator('option')).toHaveCount(1);await expect(row).toHaveAttribute('data-difficulty','RE:MASTER');
  await page.locator('#difficulty-summary').click();const master=page.locator('#difficulty-options').getByRole('checkbox',{name:'MASTER',exact:true});await master.focus();await page.keyboard.press('Space');await page.keyboard.press('Escape');await expect(page.locator('#difficulty-summary')).toBeFocused();
  await expect(picker.locator('option')).toHaveCount(2);await expect(picker).toHaveValue(remaster);
  await page.locator('#reset-filters').click();await expect(page.locator('#difficulty-summary')).toHaveText('All difficulties');await expect(page.locator('.song-row')).toHaveCount(5);
});

test('level handles and typed plus values stay in sync, validate input and retain ordered bounds',async({page})=>{
  await page.goto('/levels/');await expect(page.locator('.song-row')).toHaveCount(6);
  const low=page.getByRole('slider',{name:'Minimum level',exact:true}),high=page.getByRole('slider',{name:'Maximum level',exact:true});
  await setLevel(page,'min','10+');await setLevel(page,'max','13.5');await expect(page.locator('#filter-max')).toHaveValue('13+');await expect(page.locator('.song-row')).toHaveCount(4);
  await expect(low).toHaveAttribute('aria-valuetext','Level 10+');await expect(high).toHaveAttribute('aria-valuetext','Level 13+');
  await low.focus();await low.press('ArrowRight');await high.focus();await high.press('ArrowLeft');await expect(page.locator('#filter-min')).toHaveValue('11');await expect(page.locator('#filter-max')).toHaveValue('12');await expect(page.locator('.song-row')).toHaveCount(2);
  await low.press('End');await expect(page.locator('#filter-min')).toHaveValue('12');await expect(page.locator('.song-row')).toHaveCount(1);await high.press('End');await expect(page.locator('#filter-max')).toHaveValue('14');
  await setLevel(page,'min','13.7');await expect(page.locator('#filter-min')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#level-error')).toContainText('Enter an available level');await expect(page.locator('.song-row')).toHaveCount(3);
  await page.locator('#filter-min').press('Escape');await expect(page.locator('#filter-min')).toHaveValue('12');await expect(page.locator('#level-error')).toBeEmpty();
  await setLevel(page,'max','11');await expect(page.locator('#filter-min')).toHaveValue('11');await expect(page.locator('#filter-max')).toHaveValue('11');
  await setLevel(page,'min','14');await expect(page.locator('#filter-max')).toHaveValue('14');
  await setLevel(page,'min','');await expect(page.locator('#filter-min')).toHaveValue('10');await expect(page.locator('.song-row')).toHaveCount(6);
  await setLevel(page,'min','１３＋');await expect(page.locator('#filter-min')).toHaveValue('13+');await page.locator('#level-clear').click();await expect(page.locator('.song-row')).toHaveCount(6);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('both level handles drag and a collapsed range can reopen by tapping the track',async({page})=>{
  await page.goto('/levels/');await expect(page.locator('.song-row')).toHaveCount(6);
  const track=page.locator('#level-range');await track.scrollIntoViewIfNeeded();const box=await track.boundingBox(),x=i=>box.x+12+(box.width-24)*i/5,y=box.y+box.height/2;
  await page.mouse.move(x(0),y);await page.mouse.down();await page.mouse.move(x(2),y,{steps:8});await page.mouse.up();await expect(page.locator('#filter-min')).toHaveValue('11');
  await page.mouse.move(x(5),y);await page.mouse.down();await page.mouse.move(x(3),y,{steps:8});await page.mouse.up();await expect(page.locator('#filter-max')).toHaveValue('12');
  await setLevel(page,'min','12');await expect(page.locator('.song-row')).toHaveCount(1);
  await track.click({position:{x:12,y:box.height/2}});await expect(page.locator('#filter-min')).toHaveValue('10');
  await track.click({position:{x:box.width-12,y:box.height/2}});await expect(page.locator('#filter-max')).toHaveValue('14');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('similar-chart filtering uses multiple difficulties and the selected level range',async({page})=>{
  await page.goto('/levels/');await expect(page.locator('.song-row')).toHaveCount(6);
  await selectDifficulties(page,['EXPERT','RE:MASTER']);await setLevel(page,'min','10+');await setLevel(page,'max','13+');
  await page.locator('#compare-tab').click();await chooseComparisonChart(page,'left','Fictional study 4');await page.locator('#similar-use-filters').check();await page.locator('#find-similar').click();
  const cards=page.locator('#similar-results .similar-chart');await expect(cards).toHaveCount(1);await expect(cards).toContainText('Fictional study 2');
  await page.locator('#catalog-tab').click();await page.locator('#reset-filters').click();await page.locator('#compare-tab').click();await page.locator('#find-similar').click();expect(await cards.count()).toBeGreaterThan(1);
});


async function selectPatterns(page,ids){
  if(!await page.locator('#pattern-filter').evaluate(el=>el.open))await page.locator('#pattern-filter-summary').click();
  await page.locator('#pattern-filter-search').fill('');
  if(await page.locator('#pattern-filter-clear').isEnabled())await page.locator('#pattern-filter-clear').click();
  for(const id of ids)await page.locator('[data-pattern-filter="'+id+'"]').check();
  await page.keyboard.press('Escape');
}

test('searchable pattern multi-select searches aliases, unions results and preserves links',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('.song-row')).toHaveCount(6);
  const requests=[];page.on('request',r=>requests.push(r.url()));
  const a='pattern.two_position_alternation',b='trait.steady_density',ids=()=>page.locator('.song-row').evaluateAll(rows=>rows.map(r=>r.dataset.chartId).sort());
  await selectPatterns(page,[a]);const first=await ids();await selectPatterns(page,[b]);const second=await ids();expect(first.length).toBeGreaterThan(0);expect(second.length).toBeGreaterThan(0);
  await page.locator('#pattern-filter-summary').click();await expect.poll(()=>page.locator('.pattern-filter-panel').evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight+1;})).toBe(true);const search=page.locator('#pattern-filter-search');await search.fill('TRILL');
  await expect(page.locator('#pattern-filter-options label:visible')).toHaveCount(1);await search.press('ArrowDown');const trill=page.locator('[data-pattern-filter="'+a+'"]');await expect(trill).toBeFocused();await page.keyboard.press('Space');await expect(trill).toBeChecked();
  await expect(page.locator('#pattern-filter-summary')).toHaveText('2 patterns selected');expect(await ids()).toEqual([...new Set([...first,...second])].sort());
  await search.fill('chord');await expect(page.locator('[data-pattern-filter="pattern.simultaneous_group"]')).toBeVisible();await expect(page.locator('[data-pattern-filter="pattern.chord_stream"]')).toBeVisible();
  await search.fill('no-such-pattern-xyz');await expect(page.locator('#pattern-filter-empty')).toBeVisible();await expect(page.locator('#pattern-filter-summary')).toHaveText('2 patterns selected');
  await page.keyboard.press('Escape');await expect(page.locator('#pattern-filter-summary')).toBeFocused();const link=page.url();expect(new URL(link).searchParams.getAll('pattern-filter')).toEqual([b,a]);expect(requests).toEqual([]);
  await page.goto(link);await expect(page.locator('#pattern-filter-summary')).toHaveText('2 patterns selected');expect(await ids()).toEqual([...new Set([...first,...second])].sort());
  await page.getByRole('button',{name:'Remove pattern Steady density',exact:true}).click();expect(await ids()).toEqual(first);expect(new URL(page.url()).searchParams.getAll('pattern-filter')).toEqual([a]);
  await page.locator('#reset-filters').click();await expect(page.locator('#pattern-filter-summary')).toHaveText('All patterns');await expect(page.locator('.song-row')).toHaveCount(6);expect(new URL(page.url()).searchParams.getAll('pattern-filter')).toEqual([]);
});

test('pattern search remains accessible, keeps other filters and passes selections to comparisons',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('.song-row')).toHaveCount(6);
  await setLevel(page,'min','11');await selectPatterns(page,['pattern.two_position_alternation','pattern.simultaneous_group']);
  const eligible=await page.locator('.song-row').evaluateAll(rows=>rows.map(r=>r.dataset.chartId));
  await page.locator('#pattern-filter-summary').click();await page.locator('#pattern-filter-search').fill('chord');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Escape');
  await page.locator('#compare-tab').click();await chooseComparisonChart(page,'left','Fictional study 0');await page.locator('#similar-use-filters').check();await page.locator('#find-similar').click();
  const matches=await page.locator('#similar-results [data-compare-chart]').evaluateAll(nodes=>nodes.map(n=>n.dataset.compareChart));expect(matches.length).toBeGreaterThan(0);expect(matches.every(id=>eligible.includes(id))).toBe(true);
  await page.locator('#catalog-tab').click();await page.locator('#pattern-filter-summary').click();await page.locator('#pattern-filter-clear').click();await expect(page.locator('#pattern-filter-summary')).toHaveText('All patterns');await expect(page.locator('#filter-min')).toHaveValue('11');await expect(page.locator('.song-row')).toHaveCount(3);
});
