import {test,expect} from '@playwright/test';

// Existing control tests exercise the remembered-open state. Disclosure tests
// below separately cover first visits and persistence across pages.
test.beforeEach(async({page},testInfo)=>{
  if(testInfo.title.startsWith('filter disclosures'))return;
  await page.addInitScript(()=>{
    localStorage.setItem('maimai-catalog-filters-collapsed','0');
    localStorage.setItem('maimai-personal-filters-collapsed','0');
  });
});
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';

async function importOffscreenPBs(page){
  // All scored songs start beyond the first 1,600 song rows. BASIC has no PB.
  // Detail downloads fail deliberately: ranking must use the complete startup index.
  await page.route('**/chart-details/**',route=>route.abort());
  await page.goto('/progressive-capacity/');
  await expect(page.locator('#catalog-count')).toHaveText('7,000 charts found');
  await expect(page.locator('#songs .song-row')).toHaveCount(40);
  const template=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  const dataset=await page.evaluate(async template=>{
    await maimaiPersonal.ready;
    const core=maimaiPlayerData,catalog=maimaiResearchCatalog,record=Object.values(template.records)[0],chart=Object.values(template.charts)[0];
    const data={format:template.format,schemaVersion:template.schemaVersion,player:template.player,charts:{},records:{},plays:{},snapshots:{},captures:{}};
    const mapping={schema_version:'provider-mapping-1',charts:{}},pbs={},when=1780000000000;
    async function add(index,achievement,rate,grade,time){
      const c=catalog.catalog[index],id='provider-'+index;
      mapping.charts[id]={chart_id:c.chart_id,source_hash:c.source_hash};
      data.charts[id]={...chart,chartID:id,songID:c.song_id,title:c.title,format:c.format,difficulty:c.difficulty};
      const r={...record,chartID:id,achievement,rate,grade,timeAchieved:time},ref=await core.digest(r);
      data.records[ref]=r;data.plays['play-'+index]=ref;pbs[id]=ref;
    }
    for(let i=0;i<100;i++)await add((1600+i)*4+3,900000+i*1000,100+i*2,i>=95?'SS+':i>=90?'SS':i>=80?'S+':i>=70?'S':'AA',when+i*1000);
    // Same song, different winning difficulty depending on the selected sort.
    await add(1699*4+2,1005000,150,'SSS+',when-1000);
    const snap={capturedAt:when+100000,phase:'after',complete:true,versions:[],pbs},sid=await core.digest(snap);
    data.snapshots[sid]=snap;
    const capture={capturedAt:snap.capturedAt,sourceKind:'fixture',sourceID:'fixture',sessionID:'',historyCoverage:'retained-window',playIDs:Object.keys(data.plays),snapshotIDs:[sid]};
    data.captures[await core.digest(capture)]=capture;data.revision=await core.digest(data);
    maimaiPersonal.configure(catalog,mapping);
    return data;
  },template);
  await page.locator('input[type=file]').setInputFiles({name:'fictional-player.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(dataset)))});
  await page.getByRole('button',{name:'Import data',exact:true}).click();
  await expect(page.locator('.player-dialog')).toBeHidden();
  await expect(page.locator('#songs .song-row').first()).toHaveAttribute('data-title','Capacity study 0000');
  return page.getByRole('group',{name:'Personal chart scope',exact:true});
}

test('personal sorts rank offscreen PB difficulties across the complete catalog before pagination',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await importOffscreenPBs(page);
  const rows=page.locator('#songs .song-row'),sort=key=>page.locator('.player-sorting [data-sort-key='+key+']');
  await expect(page.locator('.player-sorting button').first()).toHaveAttribute('data-sort-key','rating');
  await expect(sort('rating')).toHaveAccessibleName('Your RT unsorted');
  await expect(sort('rating').locator('.sort-label')).toHaveText('Your RT');
  for(const [key,id]of [['achievement',6798],['grade',6798],['rating',6799],['lastPlayed',6799]]){
    await sort(key).click();
    await expect(sort(key)).toHaveAttribute('aria-label',/descending/);
    await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:'+id);
    await expect(rows).toHaveCount(40);
  }
  // Every difficulty is independent; changing sort reaches the other PB too.
  await sort('achievement').click();
  await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:6798');
  await sort('rating').click();
  await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:6799');
  await page.locator('#more').click();
  await expect(rows).toHaveCount(80);
  const ranked=Array.from({length:100},(_,i)=>({id:(1600+i)*4+3,rate:100+i*2,title:1600+i}));ranked.push({id:6798,rate:150,title:1699});ranked.sort((a,b)=>b.rate-a.rate||a.title-b.title);
  expect(await rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.chartId))).toEqual(ranked.slice(0,80).map(r=>'synthetic:capacity:'+r.id));
  await sort('rating').click();
  await expect(sort('rating')).toHaveAttribute('aria-label',/ascending/);
  // Unknown BASIC charts stay last; the EXPERT and MASTER PBs both remain listed.
  await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:6403');
  await expect(rows).toHaveCount(40);
  await expect(rows.locator('.player-chart-rating')).toHaveCount(40);
  expect(errors).toEqual([]);
});

test('My PBs is one click, works while minimized, and combines with grade and achievement filters',async({page})=>{
  const scope=await importOffscreenPBs(page),rows=page.locator('#songs .song-row');
  await scope.getByRole('button',{name:'My PBs',exact:true}).click();
  await expect(page.locator('#catalog-count')).toHaveText('101 charts found');
  await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:6403');
  await expect(rows.locator('.player-chart-rating')).toHaveCount(40);
  await page.getByRole('group',{name:'Filter by grade',exact:true}).getByRole('button',{name:'SSS+',exact:true}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-chart-id','synthetic:capacity:6798');
  await page.locator('#personal-min').fill('100.6');
  await expect(page.locator('#catalog-count')).toHaveText('0 charts found');
  await page.getByRole('button',{name:'Clear personal filters',exact:true}).click();
  await expect(scope.getByRole('button',{name:'All charts',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#catalog-count')).toHaveText('7,000 charts found');
  await page.locator('.player-filters .player-filter-toggle').click();
  await expect(page.locator('.player-filters .player-filter-toggle')).toHaveAttribute('aria-expanded','false');
  await scope.getByRole('button',{name:'My PBs',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-count')).toHaveText('101 charts found');
  await scope.getByRole('button',{name:'No PB yet',exact:true}).click();
  await expect(page.locator('#catalog-count')).toHaveText('6,899 charts found');
  await expect(rows.locator('.player-chart-rating')).toHaveCount(0);
  await page.locator('.player-filters .player-filter-toggle').click();
  await expect(page.locator('.player-filters .player-filter-reveal')).toHaveCSS('opacity','1');
  const axe=await new AxeBuilder({page}).include('.player-filters').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
