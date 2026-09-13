import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('comparison autocomplete starts empty and reaches every chart independently of visible catalog rows',async({page,isMobile})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/chart-details/**',route=>route.abort());
  await page.goto('/progressive-capacity/');
  await expect(page.locator('#songs .song-row')).toHaveCount(40);
  await page.locator('#search').fill('Capacity study 0000');
  await expect(page.locator('#songs .song-row')).toHaveCount(1);
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
  await page.getByRole('button',{name:'Show more matches',exact:true}).click();
  await expect(page.locator('#comparison-pickers').getByRole('option')).toHaveCount(40);
  const choice=page.locator('#comparison-pickers').getByRole('option').nth(35);
  if(isMobile)await choice.tap();else await choice.click();
  expect(new URL(page.url()).searchParams.get('right')).toBe('synthetic:capacity:35');
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
