import {test,expect} from '@playwright/test';

test('browsing and matching work without details; failed evidence can be retried',async({page})=>{
  const requested=[];page.on('request',r=>requested.push(r.url()));
  await page.route('**/chart-details/**',route=>route.abort());
  await page.goto('/progressive/');
  await expect(page.locator('#loaded-count')).toHaveText('6');
  await expect(page.locator('#lab-status')).toBeEmpty();
  await page.locator('#search').fill('Fictional study 0');
  await expect(page.locator('#songs .song-row')).toHaveCount(1);
  await page.locator('[data-sort-key=peak]').click();
  await page.locator('#songs .chart-row').click();
  await expect(page.locator('.chart-pattern-detail')).toContainText('Chart evidence could not be loaded');
  expect(requested.some(url=>/\/(catalog-parts|catalogs)\//.test(url))).toBe(false);
  await page.getByRole('button',{name:'Find similar',exact:true}).click();
  await expect(page.locator('#similar-results .similar-chart')).not.toHaveCount(0);
  await page.locator('#catalog-tab').click();
  await page.unroute('**/chart-details/**');
  await page.locator('.chart-pattern-detail').getByRole('button',{name:'Retry loading chart',exact:true}).click();
  await expect(page.locator('.chart-pattern-detail svg')).toBeVisible();
  await expect(page.locator('.chart-pattern-detail .pattern-evidence')).not.toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('linked comparisons retain exact pattern results and cache verified details in the session',async({page})=>{
  await page.goto('/lab/');
  await expect(page.locator('#loaded-count')).toHaveText('6');
  const original=await page.evaluate(()=>{
    const data=window.maimaiResearchCatalog,[a,b]=data.catalog;
    return {left:a.chart_id,right:b.chart_id,comparison:window.maimaiChartOverview.compare(a,b),matches:window.maimaiChallengeMatching.createIndex(data.catalog).similar(a.chart_id,{patternCompare:window.maimaiChartOverview.compare})};
  });
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto('/progressive/?version=fixture-v5&view=compare&left='+encodeURIComponent(original.left)+'&right='+encodeURIComponent(original.right));
  await expect(page.locator('#direct-comparison')).toContainText('Patterns in common');
  for(const graph of await page.locator('#direct-comparison .flow-comparison .chart-flow').all()){
    await graph.scrollIntoViewIfNeeded();
  }
  await expect(page.locator('#direct-comparison .flow-comparison svg')).toHaveCount(2);
  const actual=await page.evaluate(()=>{
    const data=window.maimaiResearchCatalog,[a,b]=data.catalog;
    return {comparison:window.maimaiChartOverview.compare(a,b),matches:window.maimaiChallengeMatching.createIndex(data.catalog).similar(a.chart_id,{patternCompare:window.maimaiChartOverview.compare})};
  });
  expect(actual).toEqual({comparison:original.comparison,matches:original.matches});
  await page.locator('#find-similar').click();
  await expect(page.locator('#similar-results .similar-chart')).not.toHaveCount(0);
  await page.locator('#find-similar').click();
  const detailRequests=requests.filter(url=>url.includes('/chart-details/'));
  expect(new Set(detailRequests).size).toBe(detailRequests.length);
  expect(requests.some(url=>/\/(catalog-parts|catalogs)\//.test(url))).toBe(false);
  expect(requests.every(url=>new URL(url).origin==='http://127.0.0.1:8766')).toBe(true);
  expect(errors).toEqual([]);
});

test('capacity startup fetches a smaller index and only requests visible chart evidence',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Capacity network budget uses desktop');
  const requests=[],sizes=[];
  page.on('request',r=>requests.push(r.url()));
  page.on('response',r=>{if(r.url().includes('/catalog-index/'))sizes.push(Number(r.headers()['content-length']));});
  await page.goto('/progressive-capacity/');
  await expect(page.locator('#catalog-count')).toHaveText('7,000 matching charts in 1,750 song / format rows');
  await expect(page.locator('#songs .chart-flow svg').first()).toBeVisible();
  expect(sizes).toHaveLength(1);expect(sizes[0]).toBeLessThan(10*1024*1024);
  expect(requests.filter(url=>url.includes('/chart-details/')).length).toBeLessThanOrEqual(40);
  expect(requests.some(url=>/\/(catalog-parts|catalogs)\//.test(url))).toBe(false);
  const before=requests.filter(url=>url.includes('/chart-details/')).length;
  await page.locator('#songs .song-row').last().scrollIntoViewIfNeeded();
  await expect(page.locator('#songs .song-row').last().locator('.chart-flow svg')).toBeVisible();
  expect(requests.filter(url=>url.includes('/chart-details/')).length).toBeGreaterThan(before);
});
