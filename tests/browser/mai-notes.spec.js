import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const route of ['/mai-notes/','/mai-notes-progressive/']){
  test('exact mai-notes links follow difficulty with no background requests '+route,async({page,context},testInfo)=>{
    const external=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
    context.on('request',r=>{if(new URL(r.url()).hostname==='mai-notes.com')external.push({url:r.url(),referer:r.headers().referer});});
    await page.goto(route);await expect(page.locator('#loaded-count')).toHaveText('6');
    await page.locator('#search').fill('Fictional study 3');
    let row=page.locator('#songs .song-row[data-difficulty="RE:MASTER"]');const link=row.locator('.mai-notes-player');
    await expect(link).toHaveText('mai-notes simai player ↗');
    const first=await page.locator('#songs .song-row[data-difficulty=MASTER] .mai-notes-player').getAttribute('href');
    await expect(row.locator('.chart-external-links .youtube-search')).toBeVisible();
    const next=await link.getAttribute('href');
    expect(next).not.toBe(first);await expect(link).toHaveAttribute('aria-label',/RE:MASTER.*new tab/);
    expect(external).toEqual([]);
    const url=new URL(next);expect(url.pathname).toBe('/player.html');expect([...url.searchParams.keys()]).toEqual(['chart']);
    await context.route('https://mai-notes.com/**',r=>r.fulfill({contentType:'text/html',body:'<title>Authored player destination</title>'}));
    const opened=context.waitForEvent('page');await link.focus();await link.press('Enter');const popup=await opened;
    await popup.waitForLoadState();expect(popup.url()).toBe(next);expect(await popup.evaluate(()=>opener===null)).toBe(true);await popup.close();
    expect(external).toEqual([{url:next,referer:undefined}]);
    await expect(row.locator('.chart-row')).toHaveAttribute('aria-expanded','false');
    await row.locator('.chart-row').click();await row.getByRole('button',{name:'Compare this chart',exact:true}).click();
    await expect(page.locator('#comparison-pickers .mai-notes-player')).toHaveAttribute('href',next);
    await page.reload();await expect(page.locator('#comparison-pickers .mai-notes-player')).toHaveAttribute('href',next);
    await page.getByRole('button',{name:'Charts',exact:true}).click();await page.locator('#search').fill('Fictional study 0');row=page.locator('#songs .song-row');
    await expect(row.locator('.mai-notes-player')).toHaveCount(0);await expect(row.locator('.youtube-search')).toBeVisible();
    await page.locator('#search').fill('Fictional study 3');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('#songs').analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath('mai-notes-row.png')});
    expect(errors).toEqual([]);
  });
}

test('legacy catalogs stay usable and invalid links cannot carry private data',async({page})=>{
  await page.goto('/lab/');await expect(page.locator('#loaded-count')).toHaveText('6');
  await expect(page.locator('.mai-notes-player')).toHaveCount(0);
  const result=await page.evaluate(()=>{
    const c=window.maimaiResearchCatalog.catalog[0],id='00000000-0000-0000-0000-000000000001';
    const record={id,source_hash:c.source_hash,format:c.format,difficulty:c.difficulty};
    const configure=r=>window.maimaiChartLinks.configure({version:'mai-notes-links-1',charts:{[c.chart_id]:r}});
    configure(record);const href=window.maimaiChartLinks.maiNotes({...c,player:'PRIVATE_SENTINEL',achievement:99}).href;
    configure({...record,id:'https://example.com/PRIVATE_SENTINEL'});const unsafe=window.maimaiChartLinks.maiNotes(c);
    configure({...record,source_hash:'stale'});const stale=window.maimaiChartLinks.maiNotes(c);
    configure({...record,difficulty:'wrong'});const wrong=window.maimaiChartLinks.maiNotes(c);
    window.maimaiChartLinks.configure({version:'unsupported',charts:{[c.chart_id]:record}});
    return {href,unsafe,stale,wrong,unsupported:window.maimaiChartLinks.maiNotes(c)};
  });
  expect(result).toEqual({href:'https://mai-notes.com/player.html?chart=00000000-0000-0000-0000-000000000001',unsafe:null,stale:null,wrong:null,unsupported:null});
});
