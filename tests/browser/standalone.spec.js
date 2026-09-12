import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
// Resolve fixtures from repository root rather than the browser's served directory.
const fixtureURL=new URL('../../output/personal-fixture.json',import.meta.url);
async function personal(){return JSON.parse(await readFile(fixtureURL,'utf8'));}
async function open(page){await page.goto('/');await expect(page.locator('#explore-search')).toBeVisible();}
async function importValue(page,value){await page.locator('#site-import').setInputFiles({name:'results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}

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
  await page.goto('/lab/?version=fixture-v3');await expect(page.locator('#loaded-count')).toHaveText('6');
  await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#songs')).toContainText('Fictional study 0');
  await page.locator('#search').fill('');
  await page.locator('#version-summary').click();
  await page.locator('#version-options').getByRole('checkbox',{name:'DX PRiSM PLUS',exact:true}).check();
  await page.keyboard.press('Escape');
  await page.locator('#filter-min').selectOption('11');
  await expect(page.locator('#songs .song-row')).toHaveCount(2);
  await page.locator('#filter-difficulty').selectOption('MASTER');
  await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await page.locator('#sort-panel summary').click();await page.locator('#sort-key-0').selectOption('level');
  await page.locator('#sort-direction-0').click();
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
  await page.locator('#sort-panel summary').click();
  await page.locator('#sort-key-0').selectOption('level');await page.locator('#sort-direction-0').click();
  await page.locator('#sort-key-1').selectOption('difficulty');
  await page.locator('#sort-key-2').selectOption('title');await page.locator('#sort-direction-2').click();
  const titles=()=>page.locator('#songs .song-row').evaluateAll(rows=>rows.map(row=>row.dataset.title));
  expect(await titles()).toEqual(['Fictional study 4','Fictional study 3','Fictional study 5','Fictional study 1','Fictional study 2','Fictional study 0']);
  await page.locator('#sort-direction-1').click();
  expect(await titles()).toEqual(['Fictional study 5','Fictional study 4','Fictional study 3','Fictional study 2','Fictional study 0','Fictional study 1']);
  await page.locator('#filter-difficulty').selectOption('RE:MASTER');
  expect(await titles()).toEqual(['Fictional study 5']);
});

test('complete dictionary supports demos, keyboard close and stable links',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?version=fixture-v3');await page.locator('#patterns-tab').click();
  await expect(page.locator('#pattern-list .pattern-card')).toHaveCount(36);
  await expect(page.locator('#pattern-count')).toContainText('14 illustrated demos');
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.locator('#pattern-search').fill('two-position');
  await page.locator('[data-open-pattern="pattern.two_position_alternation"]').click();
  const dialog=page.locator('#pattern-dialog');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Step',exact:true}).click();await expect(dialog.locator('.demo-progress')).toHaveText('7%');
  await expect(dialog.locator('.field svg circle[fill="#b82d75"]')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Play demo',exact:true}).click();await expect(dialog.getByRole('button',{name:'Pause demo'})).toBeVisible();
  await dialog.getByRole('button',{name:'Pause demo'}).click();const link=page.url();expect(link).toContain('pattern=pattern.two_position_alternation');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.locator('[data-open-pattern="pattern.two_position_alternation"]')).toBeFocused();
  await page.locator('#pattern-search').fill('umiyuri');await page.locator('[data-open-pattern="pattern.umiyuri"]').click();
  await expect(dialog).toContainText('A demo is awaiting review');await expect(dialog.getByRole('button',{name:'Play demo'})).toHaveCount(0);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
  await page.goto(link);await expect(dialog).toBeVisible();await expect(dialog).toContainText('two-position alternation');
});

test('research controls and pattern demos remain accessible and reflow at 200 percent',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  await page.locator('#sort-panel summary').click();
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
  await page.locator('#filter-min').selectOption('11');await expect(page.locator('#songs .song-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Remove version DX PRiSM PLUS',exact:true}).click();
  await expect(page.locator('#songs .song-row')).toHaveCount(1);await expect(page.locator('#filter-min')).toHaveValue('11');
  await page.locator('#version-summary').click();await page.locator('#version-clear').click();
  await expect(page.locator('#songs .song-row')).toHaveCount(3);
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
  await expect(page.locator('#direct-comparison table')).toBeVisible();
  await expect(page.locator('#direct-comparison')).toContainText('Fictional study 4');
  await expect(page.locator('#direct-comparison')).toContainText('Fictional study 2');
  const link=page.url();expect(link).toContain('left=');expect(link).toContain('right=');expect(requests).toEqual([]);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.goto(link);await expect(page.locator('#direct-comparison table')).toBeVisible();
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
  await expect(page.locator('#direct-comparison table')).toBeVisible();
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
