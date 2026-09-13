import {test,expect} from '@playwright/test';

// Capacity budgets on a fixed synthetic dataset. These are regression checks,
// not field Core Web Vitals or a claim about Internet download speed.
for(const route of ['capacity','progressive-capacity'])test(route+': 7000-chart startup and interactions stay within performance budgets',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Capacity timing uses one desktop configuration');
  await page.addInitScript(()=>{
    window.capacityTiming={parses:[],events:[]};
    const parse=JSON.parse;
    JSON.parse=function(text,...args){const start=performance.now(),value=parse.call(this,text,...args);if(typeof text==='string'&&text.length>1e6)window.capacityTiming.parses.push(performance.now()-start);return value;};
    for(const type of ['input','click'])document.addEventListener(type,event=>{
      if(!event.target.closest('#search,[data-sort-key],#find-similar'))return;
      const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.capacityTiming.events.push({type,ms:performance.now()-start})));
    },true);
  });
  await page.goto('/'+route+'/');
  await expect(page.locator('#catalog-count')).toHaveText('7,000 charts found');
  await expect(page.locator('#lab-status')).toBeEmpty();
  const startup=await page.evaluate(()=>({readyMs:performance.now(),parses:window.capacityTiming.parses}));
  expect(startup.parses).toHaveLength(1);
  expect(startup.readyMs).toBeLessThan(5000);
  await expect(page.locator('#songs .song-row')).toHaveCount(40);
  for(const query of ['Capacity','Capacity study 1','Capacity study 00','Capacity study 0000']){
    await page.locator('#search').fill(query);
    await expect.poll(()=>page.evaluate(()=>window.capacityTiming.events.filter(x=>x.type==='input').length)).toBeGreaterThanOrEqual(['Capacity','Capacity study 1','Capacity study 00','Capacity study 0000'].indexOf(query)+1);
  }
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  await page.locator('#search').fill('');
  await expect(page.locator('#catalog-count')).toHaveText('7,000 charts found');
  await page.locator('[data-sort-key=peak]').click();
  await expect.poll(()=>page.evaluate(()=>window.capacityTiming.events.filter(x=>x.type==='click').length)).toBe(1);
  const interactions=await page.evaluate(()=>window.capacityTiming.events);
  expect(Math.max(...interactions.map(x=>x.ms))).toBeLessThan(350);
  await page.locator('#songs .chart-row').first().click();
  await page.getByRole('button',{name:'Compare this chart',exact:true}).click();
  await page.locator('#find-similar').click();
  await expect(page.locator('#similar-results .similar-chart')).toHaveCount(8);
  await expect.poll(()=>page.evaluate(()=>window.capacityTiming.events.filter(x=>x.type==='click').length)).toBe(2);
  const similarity=await page.evaluate(()=>window.capacityTiming.events.at(-1).ms);
  expect(similarity).toBeLessThan(1000);
  const result={route,charts:7000,rows:1750,startup,interactions,similarity};
  console.log('Browser capacity timings:',JSON.stringify(result));
  await testInfo.attach('capacity-timings.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
