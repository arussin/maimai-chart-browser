import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

async function chooseBadge(page,field,value){await page.locator('#personal-'+field+'-button').click();await page.locator('#personal-'+field+'-choices [data-value="'+value+'"]').click();}

test.beforeEach(async({page})=>page.addInitScript(()=>{
  localStorage.setItem('maimai-catalog-filters-collapsed','0');
  localStorage.setItem('maimai-personal-filters-collapsed','0');
}));

async function configure(page,data){
  await expect(page.locator('#catalog-count strong')).toHaveText('6');
  await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await page.evaluate(async data=>{
    await maimaiPersonal.ready;
    const catalog=maimaiResearchCatalog,mapping={schema_version:'provider-mapping-1',charts:{}};
    const shift={schema_version:'maishift-mapping-1',provider:'maishift',game:'maimaidx',charts:{}};
    Object.values(data.charts).forEach((r,i)=>{
      const c=catalog.catalog[i];
      mapping.charts[r.chartID]={chart_id:c.chart_id,source_hash:c.source_hash};
      shift.charts[r.chartID]={chart_id:c.chart_id,acceptance_basis:'reviewed',expected_source:{title:r.title,artist:r.artist,format:r.format,difficulty:r.difficulty}};
    });
    catalog.maishift_mapping=shift;maimaiPersonal.configure(catalog,mapping);
  },data);
}

for(const source of ['session-file','session-hosted','maishift-file'])test(`${source}: all combo and sync badges filter, restore and retain original observations`,async({page,context})=>{
  await page.goto('/lab/');await expect(page.locator('#catalog-count strong')).toHaveText('6');await expect(page.locator('#songs .song-row')).toHaveCount(6);await page.evaluate(()=>maimaiPersonal.ready);
  const template=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
  const data=await page.evaluate(async({template,shift})=>{
    const core=maimaiPlayerData,baseChart=Object.values(template.charts)[0],baseRecord=Object.values(template.records)[0];
    const player=shift?{provider:'maishift',game:'maimaidx',username:'fictional',displayName:'Fictional',key:'maishift:maimaidx:intl:fictional'}:template.player;
    const data={format:template.format,schemaVersion:1,player,charts:{},records:{},plays:{},snapshots:{},captures:{}};
    const lamps=shift?['FULL_COMBO','FULL_COMBO_PLUS','ALL_PERFECT','ALL_PERFECT_PLUS','','future-value']:['FULL COMBO','FULL COMBO+','ALL PERFECT','ALL PERFECT+','','future-value'];
    const syncs=shift?['FULL_SYNC','FULL_SYNC_PLUS','FULL_SYNC_DX','FULL_SYNC_DX_PLUS','SYNC_PLAY','future-value']:['FS','FS+','FDX','FDX+','SYNC PLAY','future-value'];
    const pbs={};
    for(const [i,c]of maimaiResearchCatalog.catalog.slice(0,6).entries()){
      const id=shift?'maishift:intl:'+(i+1):'chart-'+i;
      data.charts[id]={...baseChart,chartID:id,songID:c.song_id,title:c.title,artist:c.artist,format:c.format,difficulty:c.difficulty};
      const r={...baseRecord,chartID:id,lamp:lamps[i],sync:syncs[i],timeAchieved:shift?null:1000};
      const hash=await core.digest(r);data.records[hash]=r;pbs[id]=hash;if(!shift)data.plays['fictional-play-'+i]=hash;
    }
    const snap={capturedAt:4000,phase:'after',complete:!shift,versions:[],pbs};const sid=await core.digest(snap);data.snapshots[sid]=snap;
    const capture={capturedAt:4000,sourceKind:'fixture',sourceID:'fictional',sessionID:'',historyCoverage:shift?'pb-observations':'retained-window',playIDs:Object.keys(data.plays),snapshotIDs:[sid]};
    data.captures[await core.digest(capture)]=capture;data.revision=await core.digest(data);return data;
  },{template,shift:source==='maishift-file'});
  await configure(page,data);
  const bytes=gzipSync(Buffer.from(JSON.stringify(data)));
  if(source==='session-hosted'){
    const sha=createHash('sha256').update(bytes).digest('hex'),offer=await page.evaluate(d=>maimaiPlayerData.offer(d),data);
    await context.route('https://fictional-report.example/**',route=>route.fulfill(route.request().url().endsWith('latest.json')?{contentType:'application/json',body:JSON.stringify({...offer,object:{path:'/report/party/data/'+sha+'.gz',sha256:sha,bytes:bytes.length}})}:{contentType:'application/gzip',body:bytes}));
    await page.locator('#settings-toggle').click();await page.locator('#player-import').click();
    await page.getByLabel('Hosted Session Report',{exact:true}).check();await page.getByLabel('Hosted Session Report URL',{exact:true}).fill('https://fictional-report.example/report/');await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:'Import & remember',exact:true}).click();
  }else{
    await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:bytes});
    await page.getByLabel('Remember on this device',{exact:true}).check();await page.getByRole('button',{name:'Import data',exact:true}).click();
  }
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  const revision=await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active.revision);
  const expected=[['fc','fs'],['fc+','fs+'],['ap','fdx'],['ap+','fdx+'],['sync'],[]];
  for(let restore=0;restore<2;restore++){
    if(restore){await page.reload();await configure(page,data);}
    expect(await page.evaluate(()=>maimaiResearchCatalog.catalog.slice(0,6).map(c=>[...maimaiPersonal.summary(c).querySelectorAll('.player-icon')].map(n=>n.dataset.icon)))).toEqual(expected);
    for(const [field,values]of [['lamp',['FULL COMBO','FULL COMBO+','ALL PERFECT','ALL PERFECT+']],['sync',['FS','FS+','FSD','FSD+','SYNC']]]){
      for(const [i,value]of values.entries()){
        await chooseBadge(page,field,value);
        expect(await page.evaluate(()=>maimaiResearchCatalog.catalog.slice(0,6).map(c=>maimaiPersonal.matches(c)))).toEqual(expected.map((_,j)=>i===j));
        await expect(page.locator('#songs .player-icon[data-icon="'+expected[i][field==='lamp'?0:expected[i].length-1]+'"]')).not.toHaveCount(0);
      }
      await chooseBadge(page,field,'');
    }
    expect(await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();return (await maimaiPlayerData.decode(s.active.bytes)).records;})).toEqual(data.records);
    expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active.revision)).toBe(revision);
  }
  const badges=await page.evaluate(async()=>{
    const c=maimaiResearchCatalog.catalog[3],details=maimaiPersonal.details(c);document.body.append(details);
    const icons=[...details.querySelectorAll('.player-icon')];const output=await Promise.all(icons.map(async n=>{
      const url=getComputedStyle(n).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1],image=new Image();image.src=url||'';
      try{await image.decode();return {icon:n.dataset.icon,decoded:image.naturalWidth>0};}catch{return {icon:n.dataset.icon,decoded:false};}
    }));details.remove();return output;
  });
  expect(badges.length).toBeGreaterThanOrEqual(4);expect(badges.every(b=>b.decoded)).toBe(true);
  const button=page.locator('#personal-lamp-button'),menu=page.locator('#personal-lamp-choices');
  await button.focus();await button.press('ArrowDown');await expect(menu).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('Enter');
  await expect(button).toBeFocused();await expect(page.locator('#personal-lamp')).toHaveValue('ALL PERFECT+');
  await button.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.locator('#personal-lamp')).toHaveValue('ALL PERFECT+');
  for(const locale of ['en','zh-Hans','ko','ja']){
    await page.locator('[data-language="'+locale+'"]').click();await button.click();
    await expect(menu.locator('.player-icon')).toHaveCount(4);
    expect(await menu.evaluate(n=>n.getBoundingClientRect().left>=0&&n.getBoundingClientRect().right<=innerWidth&&[...n.querySelectorAll('button')].every(b=>b.scrollWidth<=b.clientWidth+1))).toBe(true);
    await page.keyboard.press('Escape');
  }
  await button.click();expect((await new AxeBuilder({page}).include('.player-badge-field').include('#personal-lamp-choices').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});

test('level and difficulty filtering keeps every matching difficulty, with exact deep links',async({page})=>{
  await page.goto('/registry/?search=ソテリア');await expect(page.locator('#songs .song-row')).toHaveCount(4);
  expect(await page.locator('#songs .song-row').evaluateAll(rows=>rows.map(r=>r.dataset.difficulty))).toEqual(['MASTER','EXPERT','ADVANCED','BASIC']);
  const before=await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog));
  await page.locator('#filter-min').fill('8');await page.locator('#filter-min').press('Enter');
  const rows=page.locator('#songs .song-row');await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll(rows=>rows.map(r=>r.dataset.difficulty).sort())).toEqual(['ADVANCED','EXPERT','MASTER']);
  await page.locator('#filter-min').fill('14');await page.locator('#filter-min').press('Enter');await expect(rows).toHaveCount(1);await expect(rows).toHaveAttribute('data-difficulty','MASTER');
  await page.locator('#level-clear').click();await expect(rows).toHaveCount(4);
  await page.locator('#difficulty-summary').click();await page.locator('#difficulty-options input[value="EXPERT"]').check();await page.locator('#difficulty-options input[value="MASTER"]').check();
  await expect(rows).toHaveCount(2);await page.locator('#difficulty-summary').click();
  const id=await rows.last().getAttribute('data-chart-id');
  await page.evaluate(id=>{const u=new URL(location);u.searchParams.set('view','catalog');u.searchParams.set('chart',id);history.replaceState(null,'',u);dispatchEvent(new PopStateEvent('popstate'));},id);
  await expect(page.locator('.song-row[data-chart-id="'+id+'"] .chart-measurements')).toBeVisible();
  await page.locator('#difficulty-summary').click();await page.locator('#difficulty-clear').click();await expect(rows).toHaveCount(4);
  expect(await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog))).toBe(before);
});

test('difficulty changes stay in their row, preserve focus and refresh, and respect filters and exact links',async({page})=>{
  await page.goto('/registry/?search=ソテリア&view=catalog');
  const rows=page.locator('#songs .song-row');await expect(rows).toHaveCount(4);
  const ids=await rows.evaluateAll(rows=>rows.map(r=>r.dataset.chartId)),original=await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog));
  const row=page.locator('.song-row[data-row-key="'+ids[0]+'"]'),picker=row.locator('.row-difficulty');
  await row.locator('.chart-row').click();await picker.focus();await row.scrollIntoViewIfNeeded();
  const before=await row.evaluate(n=>{window.unchangedSibling=n.nextElementSibling;return {y:n.getBoundingClientRect().y,scroll:scrollY};});
  await picker.selectOption(ids[1]);await expect(row).toHaveAttribute('data-chart-id',ids[1]);await expect(row).toHaveAttribute('data-difficulty','EXPERT');
  await expect(picker).toBeFocused();await expect(row.locator('.chart-difficulty-badge')).toHaveText('EXPERT');
  expect(await rows.evaluateAll(rows=>rows.map(r=>r.dataset.rowKey))).toEqual(ids);
  expect(await row.evaluate(n=>n.nextElementSibling===window.unchangedSibling)).toBe(true);
  expect(await row.evaluate(n=>n.getBoundingClientRect().y)).toBeCloseTo(before.y,0);expect(await page.evaluate(()=>scrollY)).toBe(before.scroll);
  await page.evaluate(()=>dispatchEvent(new Event('maimai-personal-change')));await expect(picker).toHaveValue(ids[1]);
  await row.getByRole('button',{name:'Compare this chart',exact:true}).click();expect(new URL(page.url()).searchParams.get('left')).toBe(ids[1]);
  await page.evaluate(id=>{const u=new URL(location);u.searchParams.set('view','catalog');u.searchParams.set('chart',id);history.replaceState(null,'',u);dispatchEvent(new PopStateEvent('popstate'));},ids[0]);
  await expect(picker).toHaveValue(ids[0]);await expect(row.locator('.chart-measurements')).toBeVisible();
  await picker.selectOption(ids[1]);await page.locator('#filter-min').fill('14');await page.locator('#filter-min').press('Enter');
  await expect(rows).toHaveCount(1);await expect(picker).toHaveValue(ids[0]);await expect(picker.locator('option')).toHaveCount(1);
  await page.locator('#level-clear').click();await expect(rows).toHaveCount(4);await expect(picker).toHaveValue(ids[0]);
  await picker.selectOption(ids[1]);await page.locator('[data-sort-key=difficulty]').click();
  expect(new Set(await rows.evaluateAll(rows=>rows.map(r=>r.dataset.chartId))).size).toBe(4);
  expect(await rows.evaluateAll(rows=>rows.map(r=>r.dataset.difficulty))).toEqual(['BASIC','ADVANCED','EXPERT','MASTER']);
  expect(await page.evaluate(()=>JSON.stringify(maimaiResearchCatalog.catalog))).toBe(original);
});

test('English titles add faithful romaji and other languages retain original titles at narrow widths',async({page})=>{
  await page.goto('/registry/?search=ソテリア');const row=page.locator('#songs .song-row').first();
  await expect(row.locator('.song-romaji')).toHaveText('soteria');
  await expect.poll(()=>row.evaluate(n=>n.isConnected&&parseFloat(getComputedStyle(n.querySelector('.song-title')).fontSize)>parseFloat(getComputedStyle(n.querySelector('.song-romaji')).fontSize))).toBe(true);
  const before=await row.locator('.song-title').textContent();
  for(const locale of ['en','zh-Hans','ko','ja','en']){
    await page.locator('[data-language="'+locale+'"]').click();
    if(locale==='en')await expect(row.locator('.song-romaji')).toBeVisible();else await expect(row.locator('.song-romaji')).toBeHidden();
    await expect(row.locator('.song-title')).toHaveText(before);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
