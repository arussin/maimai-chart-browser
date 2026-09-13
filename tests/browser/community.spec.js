import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const forms=[
  ['anchored_trill','axis trill'],['scattered_taps','random stream'],
  ['touch_stream','scattered touch notes'],['touch_sweep','touch staircase'],
  ['touch_rotation','touch spin'],['repeated_slide_heads','same-start slide stream'],
  ['alternating_slide_heads','alternating slide stream'],['different_slide_speeds','mixed-speed slides'],
  ['extended_slide_wait','slide stop'],['return_slides','return slides'],
  ['cycles','Cycle pattern'],['slip_flip','Slipflip'],['death_scythe','Deathscythe'],
  ['sugarbitter','Shugabita'],['future','Future white'],['gekishou','Intense Voice'],
  ['hoshizora','Hoshizora'],['outlaw',"Outlaw's Lullaby"],
  ['amazing_mightyyy','Amemai Expert'],['magic_circle','rotating diagonal slides'],
];

for(let batch=0;batch<2;batch++)test(`new patterns connect English alias search, lessons and chart matches (${batch+1}/2)`,async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/community/?view=patterns');await expect(page.locator('.pattern-card')).toHaveCount(56);
  const requests=[];page.on('request',r=>requests.push(r.url()));
  const dialog=page.locator('#pattern-dialog');
  for(const[key,alias]of forms.slice(batch*10,(batch+1)*10)){
    const id='pattern.'+key;
    await page.locator('#patterns-tab').click();await page.locator('#pattern-search').fill(alias);
    const card=page.locator(`[data-pattern-id="${id}"]`);
    await expect(card).toBeVisible();await expect(card).not.toContainText('Find charts · 0');
    await card.locator('[data-open-pattern]').click();await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText(/^[\x00-\x7F]+$/);
    await dialog.locator('summary').click();await expect(dialog.getByRole('link',{name:/mai-notes/})).toHaveAttribute('href','https://mai-notes.com/tag');
    await dialog.getByRole('button',{name:'Find charts with this pattern',exact:true}).click();
    await expect(page.locator(`.song-row[data-chart-id="community-${key}"]`)).toBeVisible();
    expect(new URL(page.url()).searchParams.getAll('pattern-filter')).toEqual([id]);
    await page.locator('#pattern-filter-summary').click();await page.locator('#pattern-filter-search').fill(alias);
    await expect(page.locator(`[data-pattern-filter="${id}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});

test('community slide lessons retain curved geometry and accessible mobile layout',async({page})=>{
  await page.goto('/community/?view=patterns&pattern=pattern.slip_flip');
  const dialog=page.locator('#pattern-dialog');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Step',exact:true}).click();
  await expect(dialog.locator('.lesson-art')).toContainText('p loop');
  const paths=await dialog.locator('.field svg polyline').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('points')));
  expect(paths.some(d=>d.split(' ').length>10)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
