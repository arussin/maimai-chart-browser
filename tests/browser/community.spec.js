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

test('dictionary stays alphabetical and both slower speeds advance playback proportionally',async({page})=>{
  await page.clock.install({time:new Date('2026-09-13T12:00:00Z')});
  await page.goto('/community/?view=patterns');await expect(page.locator('.pattern-card')).toHaveCount(56);
  await expect(page.locator('#patterns-tab')).toHaveText('Pattern dictionary');
  await expect(page.locator('#compare-tab')).toHaveText('Compare charts');
  const names=await page.locator('.pattern-card h2').allTextContents();
  expect(names).toEqual([...names].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
  await page.clock.pauseAt(new Date('2026-09-13T12:01:00Z'));
  const dialog=page.locator('#pattern-dialog');
  for(const[id,unit,perSecond]of [['pattern.two_position_alternation','beats',2],['trait.high_onset_density','seconds',1]]){
    await page.locator(`[data-open-pattern="${id}"]`).click();
    const speed=dialog.getByRole('combobox',{name:'Demo speed'});
    await expect(speed.locator('option')).toHaveText(['0.1×','0.25×','0.5×','1×']);
    await expect(speed).toHaveValue('1');
    for(const value of ['0.1','0.25']){
      await speed.selectOption(value);await dialog.getByRole('button',{name:'Play demo',exact:true}).click();
      await page.clock.runFor(2000);
      await dialog.getByRole('button',{name:'Pause demo',exact:true}).click();
      const progress=await dialog.locator('.demo-progress').textContent();
      expect(Number(progress.split(' · ')[1].split(' ')[0])).toBeCloseTo(2*Number(value)*perSecond,1);
      expect(progress).toContain(unit.replace(/s$/,''));
      await dialog.getByRole('button',{name:'Restart',exact:true}).click();
      await expect(dialog.locator('input[type=range]')).toHaveValue('0');
    }
    await dialog.getByRole('button',{name:'Close pattern'}).click();
  }
});

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
    await expect(dialog.locator('details,summary')).toHaveCount(0);await expect(dialog).not.toContainText('Pattern references');
    await dialog.getByRole('button',{name:'Find charts with this pattern',exact:true}).click();
    await expect(page.locator(`.song-row[data-chart-id="community-${key}"]`)).toBeVisible();
    expect(new URL(page.url()).searchParams.getAll('pattern-filter')).toEqual([id]);
    await page.locator('#pattern-filter-summary').click();await page.locator('#pattern-filter-search').fill(alias);
    await expect(page.locator(`[data-pattern-filter="${id}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
  // Version badges load lazily from the local, content-addressed artwork package.
  // Pattern navigation still must not fetch catalog data or contact another host.
  expect(requests.filter(value=>{const url=new URL(value);return url.origin!==new URL(page.url()).origin||!/^\/community\/media\/[a-f0-9]{64}\.webp$/.test(url.pathname);})).toEqual([]);
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

test('simultaneous inputs stay gold in thumbnails, timelines and the simulator',async({page})=>{
  await page.goto('/community/?view=patterns');
  const dialog=page.locator('#pattern-dialog');
  const card=id=>page.locator(`[data-pattern-id="pattern.${id}"]`);
  const colors=notes=>notes.evaluateAll(nodes=>nodes.map(n=>({stroke:getComputedStyle(n).stroke,fill:getComputedStyle(n).fill})));
  const each=card('simultaneous_group').locator('.lesson-note');
  await expect(each).toHaveCount(6);
  expect(await colors(each)).toEqual(Array(6).fill({stroke:'rgb(148, 112, 0)',fill:'rgb(255, 241, 172)'}));
  await card('simultaneous_group').locator('[data-open-pattern]').click();
  await dialog.getByRole('button',{name:'Step',exact:true}).click();
  await expect(dialog.locator('.field svg circle[fill="#f4c430"]')).toHaveCount(2);
  const played=await colors(dialog.locator('.lesson-note.lesson-passed'));
  expect(played).toEqual(Array(2).fill({stroke:'rgb(148, 112, 0)',fill:'rgb(244, 196, 48)'}));
  await expect(dialog.locator('.field svg circle[fill="#b82d75"]')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close pattern'}).click();

  // A mixed star/tap pair uses gold for both; its next separate tap stays pink.
  await card('umiyuri').locator('[data-open-pattern]').click();
  await dialog.getByRole('button',{name:'Step',exact:true}).click();
  await expect(dialog.locator('.field svg circle[fill="#f4c430"]')).toHaveCount(2);
  expect((await colors(dialog.locator('.lesson-note.lesson-each'))).every(n=>n.stroke==='rgb(148, 112, 0)')).toBe(true);
  await dialog.getByRole('button',{name:'Step',exact:true}).click();
  await expect(dialog.locator('.field svg circle[fill="#f4c430"]')).toHaveCount(0);
  await expect(dialog.locator('.field svg circle[fill="#b82d75"]')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Close pattern'}).click();

  // Multiple paths from one physical star, or overlapping activity, are not EACH inputs.
  for(const id of ['same_head_slide_fan','moving_slide_overlap']){
    await expect(card(id).locator('.lesson-each')).toHaveCount(0);
    await card(id).locator('[data-open-pattern]').click();
    await dialog.getByRole('button',{name:'Step',exact:true}).click();
    await expect(dialog.locator('.field svg circle[fill="#f4c430"]')).toHaveCount(0);
    await dialog.getByRole('button',{name:'Close pattern'}).click();
  }
});
