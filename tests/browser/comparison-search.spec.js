import {test,expect} from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';

test('comparison autocomplete starts empty and reaches every chart independently of visible catalog rows',async({page,isMobile})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/chart-details/**',route=>route.abort());
  await page.goto('/progressive-capacity/');
  await expect(page.locator('#songs .song-row')).toHaveCount(40);
  await page.locator('#search').fill('Capacity study 0000');
  await expect(page.locator('#songs .song-row')).toHaveCount(4);
  await page.locator('#compare-tab').click();
  const left=page.getByRole('combobox',{name:'First chart',exact:true}),right=page.getByRole('combobox',{name:'Second chart',exact:true});
  for(const input of [left,right]){
    await input.focus();await expect(input).toHaveAttribute('aria-expanded','false');
    await input.press('ArrowDown');await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(0);
    await input.fill('   ');await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(0);
    await input.fill('');
  }
  await expect(page.locator('#compare-right-search-status')).toContainText('Search all 7,000 charts');
  await left.fill('Capacity study 1749 MASTER');
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(1);
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveAttribute('data-choice','synthetic:capacity:6999');
  await left.press('ArrowDown');await expect(left).toBeFocused();await left.press('Enter');
  await expect(left).toHaveAttribute('aria-expanded','false');
  expect(new URL(page.url()).searchParams.get('left')).toBe('synthetic:capacity:6999');
  await right.fill('Capacity study');
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(20);
  await expect(page.locator('#compare-right-search-status')).toContainText('20 of 7,000');
  const more=page.getByRole('button',{name:'Show more matches',exact:true});
  if(isMobile)await more.tap();else await more.click();
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(40);
  const choice=page.locator('#comparison-pickers').getByRole('option').nth(35);
  if(isMobile)await choice.tap();else await choice.click();
  await expect(page).toHaveURL(url=>url.searchParams.get('right')==='synthetic:capacity:35');
  await expect(page.locator('#direct-comparison .metric-comparison')).toBeVisible();
  await page.locator('#comparison-clear').click();
  await expect(left).toBeFocused();await expect(left).toHaveValue('');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Show more matches',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard autocomplete crosses result batches, dismisses cleanly and remains accessible',async({page})=>{
  await page.goto('/progressive-capacity/?view=compare');
  const left=page.getByRole('combobox',{name:'First chart',exact:true}),right=page.getByRole('combobox',{name:'Second chart',exact:true});
  await left.fill('Capacity study');
  for(let i=0;i<22;i++)await left.press('ArrowDown');
  await expect(page.locator('#comparison-pickers').getByRole('option',{selected:true})).toHaveAttribute('data-choice','synthetic:capacity:21');
  await expect(left).toBeFocused();await left.press('ArrowUp');
  await expect(page.locator('#comparison-pickers').getByRole('option',{selected:true})).toHaveAttribute('data-choice','synthetic:capacity:20');
  const axe=await new AxeBuilder({page}).include('#comparison-pickers').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await left.press('Escape');await expect(left).toHaveAttribute('aria-expanded','false');
  await expect(left).not.toHaveAttribute('aria-activedescendant',/.+/);
  await left.press('ArrowDown');await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(20);
  await right.focus();await expect(left).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(0);
  await right.fill('Not a real song query');await expect(right).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#compare-right-search-status')).toContainText('No matching charts');
  await right.fill('Capacity study 1749');await right.press('ArrowDown');await right.press('Enter');
  await expect(right).toHaveValue('Capacity study 1749');await expect(right).toHaveAttribute('aria-expanded','false');
  await right.press('Tab');await right.focus();await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(0);
});


test('public snapshot restores comparison and similarity choices without retaining player records',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await page.locator('#compare-tab').click();
  for(const [side,title]of [['left','Fictional study 0'],['right','Fictional study 1']]){
    const input=page.locator('#compare-'+side+'-search');await input.fill(title);await input.press('ArrowDown');await input.press('Enter');
  }
  await page.locator('#similar-priority').selectOption('measurements');await page.locator('#similar-use-filters').check();await page.locator('#find-similar').click();
  const matches=await page.locator('#similar-results [data-compare-chart]').evaluateAll(nodes=>nodes.map(node=>node.dataset.compareChart));expect(matches.length).toBeGreaterThan(0);
  const snapshot=await page.evaluate(()=>maimaiBrowserState.capture());
  await page.locator('#comparison-clear').click();await expect(page.locator('#direct-comparison')).toBeEmpty();
  await page.locator('#similar-priority').selectOption('patterns');await page.locator('#similar-use-filters').uncheck();
  expect(await page.evaluate(value=>maimaiBrowserState.restore(value),snapshot)).toBe(true);
  await expect(page.locator('#direct-comparison')).not.toBeEmpty();await expect(page.locator('#compare-left-search')).toHaveValue('Fictional study 0');
  await expect(page.locator('#similar-priority')).toHaveValue('measurements');await expect(page.locator('#similar-use-filters')).toBeChecked();
  expect(await page.locator('#similar-results [data-compare-chart]').evaluateAll(nodes=>nodes.map(node=>node.dataset.compareChart))).toEqual(matches);
  expect(snapshot.personal).not.toHaveProperty('records');expect(snapshot.personal).not.toHaveProperty('sources');
});
