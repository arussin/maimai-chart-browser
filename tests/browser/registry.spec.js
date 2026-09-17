import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

test('metadata-only search, difficulty selection, comparison and detail absence work without detail downloads',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const requests=[];page.on('request',r=>{if(r.url().includes('/chart-details/'))requests.push(r.url());});
  await page.goto('/registry/?search=ソテリア');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const row=page.locator('#songs .song-row');await expect(row).toHaveCount(1);
  await row.locator('.row-difficulty').selectOption({label:'MASTER · 14'});
  await expect(row.locator('.chart-constant')).toHaveText('—');
  await expect(row.getByRole('button',{name:'Find similar',exact:true})).toBeDisabled();
  await row.locator('.chart-row').click();
  await expect(row.locator('.registry-metadata')).toHaveCount(0);
  await expect(row.locator('.chart-measurements')).not.toContainText('Metadata:');
  await expect(row.locator('.chart-measurements')).toContainText('Unknown');
  await expect(row.getByRole('button',{name:'Retry loading chart'})).toHaveCount(0);
  expect(requests).toEqual([]);
  await row.getByRole('button',{name:'Compare this chart'}).click();
  await expect(page.locator('#find-similar')).toBeDisabled();
  const input=page.locator('#compare-right-search');await input.fill('Fictional study 0');
  await input.press('ArrowDown');await input.press('Enter');
  await expect(page.locator('#direct-comparison')).toContainText('not enough shared measurement coverage');
  await expect(page.locator('.metric-comparison')).toContainText('Unknown');
  await page.locator('#catalog-tab').click();await page.locator('#search').fill('そてりあ');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('listing context keeps regional levels separate and restores All known',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('22 charts found');
  await page.locator('#filter-region').selectOption('INTL');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const row=page.locator('#songs .song-row');
  await row.locator('.row-difficulty').selectOption({label:'ADVANCED · 7'});
  await expect(row).toHaveAttribute('data-level','7');
  await expect(row).toHaveAttribute('data-version','maimai DX CiRCLE');
  await page.locator('#filter-region').selectOption('JP');
  await expect(row.filter({hasText:'ソテリア'})).toHaveAttribute('data-level','8');
  await page.locator('#reset-filters').click();
  await expect(page.locator('#filter-region')).toHaveValue('');
  await expect(page.locator('#catalog-count')).toHaveText('22 charts found');
});

test('legacy chart and pair links resolve in current inventory and remain unchanged in old releases',async({page})=>{
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('22 charts found');
  const [old,id]=await page.evaluate(()=>Object.entries(maimaiResearchCatalog.legacy_ids)[0]);
  await page.goto('/registry/?view=catalog&chart='+encodeURIComponent(old));
  await expect(page.locator('#songs .song-row[data-chart-id="'+id+'"] .chart-measurements')).toBeVisible();
  await page.goto('/registry/?version=legacy-fixture&view=catalog&chart='+encodeURIComponent(old));
  await expect(page.locator('#songs .song-row[data-chart-id="'+old+'"] .chart-measurements')).toBeVisible();
  await page.goto('/registry/?view=compare&left='+encodeURIComponent(old));
  await expect(page.locator('#compare-left-search')).not.toHaveValue('');
  await expect(page.locator('#find-similar')).toBeEnabled();
});

test('a schema-1 synthetic player file maps to a metadata-only chart without qualifying analysis',async({page})=>{
  await page.goto('/registry/?search=ソテリア');await expect(page.locator('#catalog-count')).toHaveText('4 charts found');
  const template=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  await page.locator('input[type=file]').setInputFiles({name:'fictional-player.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(template)))});
  await page.getByRole('button',{name:'Import data',exact:true}).click();
  const row=page.locator('#songs .song-row');
  await expect(row).toHaveAttribute('data-difficulty','MASTER');
  await expect(row.locator('.player-achievement')).toContainText('97.0000%');
  await expect(row.getByRole('button',{name:'Find similar',exact:true})).toBeDisabled();
});
