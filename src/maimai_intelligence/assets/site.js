/* Public same-origin catalogs; personal files remain in memory and never drive requests. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), MAX_BYTES = 32 * 1024 * 1024;
  let manifest, overlaySchema, release, pack, personal = null, loading = 0, routing = false;
  const status = (message, error = false) => { $('site-status').textContent = message; $('site-status').dataset.error = String(error); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const modes = new Set(['overall','same-pattern','easier','next-step','section','discovery']);
  function require(condition, message) { if (!condition) throw new Error(message); }
  async function readPublic(path, expected) {
    const url = new URL(path, location.href);
    require(url.origin === location.origin && !url.username && !url.password && !url.search && !url.hash, 'Invalid catalog address');
    const response = await fetch(url, {credentials:'omit', redirect:'error', referrerPolicy:'no-referrer'});
    require(response.ok, 'Could not load catalog files. Reload to try again.');
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if(done) break;
        total += value.byteLength; require(total <= MAX_BYTES, 'Catalog file is too large'); chunks.push(value);
      }
    } catch(error) { await reader.cancel(); throw error; }
    const bytes = new Uint8Array(total); let offset = 0;
    for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    if(expected) {
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      require(sha === expected, 'Catalog integrity check failed');
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  function shape(value, schema, depth = 0) {
    require(depth < 25, 'Personal file is too deeply nested');
    if(Array.isArray(schema)) {
      require(Array.isArray(value) && value.length <= 100000, 'Invalid personal list');
      value.forEach(item=>shape(item,schema[0],depth+1));
    } else if(object(schema)) {
      require(object(value) && Object.keys(value).every(key=>Object.hasOwn(schema,key)), 'Unknown personal-data fields');
      for(const [key,item] of Object.entries(value)) shape(item,schema[key],depth+1);
    } else {
      const nullable = schema.endsWith('?'), kind = schema.replace('?','');
      require(nullable && value === null || typeof value === kind && (kind !== 'number' || Number.isFinite(value)), 'Invalid personal-data value');
    }
  }
  function validBundle(bundle) {
    require(object(bundle) && bundle.format === 'maimai-personal' && bundle.schema_version === '1.0.0', 'Unsupported personal file version');
    require(Object.keys(bundle).every(k=>['format','schema_version','catalog','snapshot_id','cutoff_ms','engine_version','settings','mapping_sha256','overlay','recommendations','chart_summaries'].includes(k)), 'Unknown personal-file fields');
    require(!pack.evaluation_only, 'This research catalog cannot use personal results');
    require(object(bundle.catalog) && ['id','version','sha256'].every(k=>bundle.catalog[k]===release[k]), 'This file belongs to a different catalog version. Select its catalog first.');
    require(['0.1.0','0.2.0'].includes(bundle.engine_version), 'Unsupported recommendation engine version');
    require(typeof bundle.snapshot_id === 'string' && /^[a-f0-9]{64}$/.test(bundle.snapshot_id), 'Invalid snapshot identity');
    require(typeof bundle.mapping_sha256 === 'string' && /^[a-f0-9]{64}$/.test(bundle.mapping_sha256), 'Invalid mapping identity');
    require(Number.isSafeInteger(bundle.cutoff_ms) && bundle.cutoff_ms >= 0 && bundle.cutoff_ms < 8.64e15, 'Invalid snapshot date');
    shape(bundle.overlay,overlaySchema);
    const overlay = bundle.overlay, ids = new Set(pack.charts.map(c=>c.chart_id)), seen = new Set(), attempts = new Set();
    require(Array.isArray(overlay.entries) && object(overlay.coverage) && overlay.coverage.cutoff_ms === bundle.cutoff_ms, 'Missing personal history coverage');
    const timestamp = value => value == null || Number.isSafeInteger(value) && value>=0 && value<=bundle.cutoff_ms;
    for(const entry of overlay.entries) {
      require(ids.has(entry.chart_id) && !seen.has(entry.chart_id), 'Personal results contain missing or duplicate charts');seen.add(entry.chart_id);
      require(timestamp(entry.last_played) && timestamp(entry.pb_achieved_at), 'Result date lies outside the snapshot');
      require(entry.percent == null || entry.percent >= 0 && entry.percent <= 101, 'Invalid achievement');
      require(entry.attempt_count == null || Number.isSafeInteger(entry.attempt_count) && entry.attempt_count>=0, 'Invalid attempt count');
      for(const attempt of entry.attempts || []) {
        require(typeof attempt.attempt_id==='string' && attempt.attempt_id && !attempts.has(attempt.attempt_id) && timestamp(attempt.recorded_at), 'Invalid or duplicate play attempt');
        attempts.add(attempt.attempt_id);
      }
    }
    const recommendations = bundle.recommendations;
    require(object(recommendations) && Array.isArray(recommendations.cards) && recommendations.cards.length<=60, 'Invalid prepared recommendations');
    const cardIds = new Set();
    for(const card of recommendations.cards) {
      require(object(card) && ids.has(card.chart_id) && !cardIds.has(card.chart_id) && ['rating','practice','discovery'].includes(card.category), 'Invalid recommendation chart');cardIds.add(card.chart_id);
      for(const key of ['target_achievement','previous_achievement','gain_if_achieved']) require(card[key]==null || typeof card[key]==='number' && Number.isFinite(card[key]) && card[key]>=0, 'Invalid recommendation number');
      require(card.targeted_patterns==null || Array.isArray(card.targeted_patterns) && card.targeted_patterns.every(x=>pack.patterns.some(p=>p.pattern_id===x)), 'Invalid recommendation patterns');
      require(card.alternative_query==null || object(card.alternative_query) && (!card.alternative_query.chart_id || ids.has(card.alternative_query.chart_id)), 'Invalid alternative chart');
      const alternative=card.alternative_query;
      if(alternative){
        require(!alternative.mode || modes.has(alternative.mode),'Invalid comparison mode');
        require(!alternative.pattern_id || pack.patterns.some(p=>p.pattern_id===alternative.pattern_id),'Invalid comparison pattern');
        require(!alternative.section_id || pack.charts.find(c=>c.chart_id===alternative.chart_id)?.sections?.some(s=>s.section_id===alternative.section_id),'Invalid comparison section');
      }
    }
    return bundle;
  }
  function navigate(query) {
    if(routing) return;
    // Only public catalog identities and known comparison modes enter shareable URLs.
    const chart=pack.charts.find(c=>c.chart_id===query.chart_id);
    if(query.chart_id && !chart)return;
    const allowed={chart_id:chart?.chart_id};
    if(query.pattern_id && pack.patterns.some(p=>p.pattern_id===query.pattern_id))allowed.pattern_id=query.pattern_id;
    if(query.section_id && chart?.sections?.some(s=>s.section_id===query.section_id))allowed.section_id=query.section_id;
    if(modes.has(query.mode))allowed.mode=query.mode;
    const url = new URL(location.href); url.search = '';
    url.searchParams.set('catalog',release.id);url.searchParams.set('version',release.version);
    for(const [key,field] of [['chart','chart_id'],['section','section_id'],['pattern','pattern_id'],['mode','mode']]) if(allowed[field]) url.searchParams.set(key,allowed[field]);
    if(url.href!==location.href) history.pushState(null,'',url);
  }
  function route() {
    const params = new URLSearchParams(location.search), chartId = params.get('chart'), sectionId = params.get('section'), patternId = params.get('pattern');
    const chart = pack.charts.find(c=>c.chart_id===chartId);
    if(chartId && !chart) {status('This chart is not present in this catalog version. You can still browse the catalog.',true);return;}
    if(sectionId && !chart?.sections?.some(s=>s.section_id===sectionId)) {status('This section is not present in this catalog version.',true);return;}
    if(patternId && !pack.patterns.some(p=>p.pattern_id===patternId)) {status('This pattern is not present in this catalog version.',true);return;}
    routing = true;
    try {
      if(chartId && (sectionId || params.get('mode'))) window.maimaiExplore.open({chart_id:chartId,section_id:sectionId,pattern_id:patternId,mode:params.get('mode') || 'section'});
      else if(chartId) window.maimaiExplore.showChart(chartId);
      else if(patternId) window.maimaiExplore.showPattern(patternId);
    } finally { routing = false; }
  }
  function mount() {
    $('personal-targets').replaceChildren();$('personal-targets').hidden = !personal;
    window.maimaiMountExplorer({catalog:pack,player:personal?.overlay,prepared:personal?.recommendations,onNavigate:navigate});
    $('site-clear').hidden = !personal;
    $('site-personal-note').textContent = personal ? `Results as of ${new Date(personal.cutoff_ms).toISOString().slice(0,10)} · prepared suggestions · history may be incomplete. Results stay in this tab.` : pack.evaluation_only ? 'Research catalog · personal results require a reviewed chart mapping and a qualified catalog.' : 'Open a personal file prepared by the downloader or your report library. Your results stay in this tab.';
  }
  async function load(entry) {
    const ticket = ++loading; personal = null; $('site-import').disabled = true; $('site-clear').hidden=true;
    $('personal-targets').replaceChildren();$('personal-targets').hidden=true;
    window.maimaiExplore?.destroy?.();$('explore-view').replaceChildren();status('Loading charts…');
    const downloaded = await readPublic(entry.path,entry.sha256);
    if(ticket!==loading) return;
    const decoded = window.maimaiDecodeExplorationPack(downloaded);
    require(decoded.schema_version==='1.0.0' && decoded.catalog_id===entry.id && Array.isArray(decoded.charts) && Array.isArray(decoded.patterns), 'Unsupported catalog');
    require(!!decoded.evaluation_only===entry.evaluation_only,'Catalog research status does not match its manifest');
    pack=decoded;release=entry;mount();$('site-import').disabled=!!pack.evaluation_only;status('');route();
  }
  function selectedEntry() {
    const params = new URLSearchParams(location.search), id=params.get('catalog'), version=params.get('version');
    const desired = id || version ? {id,version} : manifest.default;
    const entry = manifest.catalogs.find(c=>c.id===desired.id && c.version===desired.version);
    require(entry,'This catalog version is not available. Choose a catalog to continue.');
    $('site-catalog').value = String(manifest.catalogs.indexOf(entry));return entry;
  }
  $('site-import').addEventListener('change',async event=>{
    const file = event.target.files[0], current = loading; event.target.value='';if(!file)return;
    try {
      require(file.size<=MAX_BYTES,'Personal file exceeds 32 MiB');
      const contents = JSON.parse(await file.text());
      if(current!==loading) return;
      personal=validBundle(contents);mount();status('Personal results opened. Nothing was uploaded.');
    } catch(error) { status(error.message,true); }
  });
  $('site-clear').addEventListener('click',()=>{personal=null;mount();status('Personal results cleared.');$('site-import').focus();});
  $('site-catalog').addEventListener('change',()=>{
    const entry = manifest.catalogs[Number($('site-catalog').value)], url = new URL(location.href);url.search='';url.searchParams.set('catalog',entry.id);url.searchParams.set('version',entry.version);history.pushState(null,'',url);
    load(entry).catch(error=>status(error.message,true));
  });
  window.addEventListener('popstate',()=>{try{const entry=selectedEntry();if(entry===release){mount();route();}else load(entry).catch(error=>status(error.message,true));}catch(error){status(error.message,true);}});
  (async()=>{
    [manifest,overlaySchema] = await Promise.all([readPublic('manifest.json'),readPublic('assets/overlay-schema.json')]);
    require(manifest.schema_version==='1.0.0' && Array.isArray(manifest.catalogs) && manifest.catalogs.length>0,'Unsupported catalog manifest');
    if(manifest.research_lab?.path==='lab/' && typeof manifest.research_lab.version==='string'){
      $('site-lab').href='lab/?'+new URLSearchParams({version:manifest.research_lab.version});$('site-lab').hidden=false;
    }
    for(const [index,entry] of manifest.catalogs.entries()) {
      require(typeof entry.id==='string' && typeof entry.version==='string' && /^[a-f0-9]{64}$/.test(entry.sha256) && entry.path===`catalogs/${entry.sha256}.json`, 'Invalid catalog manifest entry');
      const option=document.createElement('option');option.value=String(index);option.textContent=`${entry.label} · ${entry.version}`;$('site-catalog').append(option);
    }
    $('site-catalog').disabled=false;await load(selectedEntry());
  })().catch(error=>status(error.message,true));
})();
