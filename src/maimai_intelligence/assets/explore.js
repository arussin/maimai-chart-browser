"use strict";
window.maimaiMountExplorer = ({catalog, player = null, prepared = null, onNavigate = () => {}} = {}) => {
  const dataElement = document.getElementById("exploration-data");
  if (!catalog && !dataElement) return;
  window.maimaiExplore?.destroy?.();
  const pack = window.maimaiDecodeExplorationPack(catalog || JSON.parse(dataElement.textContent));
  const evaluationOnly = pack.evaluation_only === true;
  const overlay = evaluationOnly ? null : player || JSON.parse(document.getElementById("exploration-player-data")?.textContent || "null");
  const recommendations = evaluationOnly ? null : prepared || JSON.parse(document.getElementById("report-data")?.textContent || "{}").chartRecommendations;
  const charts = pack.charts || [];
  const patterns = pack.patterns || [];
  const byId = new Map(charts.map(chart => [chart.chart_id, chart]));
  const patternById = new Map(patterns.map(pattern => [pattern.pattern_id, pattern]));
  const results = new Map((overlay?.entries || []).map(entry => [entry.chart_id, entry]));
  const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const normal = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  const present = value => value == null ? "Unknown" : typeof value === "number" ? Number(value.toFixed(3)).toString() : safe(value);
  const clock = value => `${(Number(value) / 1000000).toFixed(2)}s`;
  const nice = value => String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
  const order = (a,b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const positiveTag = tag => ["detected", "reviewed-present"].includes(tag?.status);
  const absentTag = tag => tag?.status === "not-detected-with-supported-coverage";
  const nameOf = id => patternById.get(id)?.display_name || id;
  const listOptions = (values, label) => `<option value="">${safe(label)}</option>${[...new Set(values.filter(Boolean))].sort(order).map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join("")}`;
  const patternOptions = patterns.map(pattern => `<option value="${safe(pattern.pattern_id)}">${safe(pattern.display_name)}</option>`).join("");
  let host = document.getElementById("explore-view");
  const standalone = !!host?.dataset.catalogOnly;
  function showExplore(focus = false) {
    if (standalone) return;
    document.querySelectorAll(".tab").forEach(tab => {
      const active = tab.dataset.target === "explore";
      tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".view").forEach(view => {
      const active = view === host; view.hidden = !active; view.classList.toggle("active", active);
    });
    document.querySelector(".report").dataset.currentView = "explore";
    if (focus) document.getElementById("tab-explore").focus();
  }
  if (!host) {
    document.body.classList.add("has-explore");
    const tab = document.createElement("button");
    tab.id = "tab-explore"; tab.className = "tab"; tab.type = "button";
    tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", "explore-view"); tab.tabIndex = -1;
    tab.dataset.target = "explore"; tab.innerHTML = "<span>Explore</span>";
    document.querySelector(".tabs").append(tab);
    host = document.createElement("section"); host.id = "explore-view";
    host.className = "view"; host.dataset.view = "explore"; host.hidden = true;
    host.setAttribute("role", "tabpanel"); host.setAttribute("aria-labelledby", "tab-explore");
    document.querySelector(".report .footer").before(host);
    tab.addEventListener("click", () => showExplore());
    tab.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll(".tab")], index = tabs.indexOf(tab);
      const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.click(); next.focus();
    });
  }
  const scopeButtons = `${overlay ? '<button type="button" data-scope="mine">My results</button>' : ''}<button type="button" data-scope="all">Songs</button><button type="button" data-scope="patterns">Patterns</button>`;
  const difficulties = [...new Set(charts.map(chart => chart.difficulty))];
  const hasRating = [...results.values()].some(result => Number.isFinite(result.rate));
  host.innerHTML = `<header class="explore-heading"><div><span class="explore-eyebrow">maimai DX</span><h1>Explore</h1></div><button type="button" id="explore-about" class="explore-text-button">About this catalog</button></header>
    ${evaluationOnly ? '<p class="explore-evaluation" role="note">Public chart study · unverified transcriptions</p>' : ''}<p id="explore-coverage" class="explore-note"></p>
    <div class="explore-segments-control" id="explore-scope-buttons" role="group" aria-label="Browse">${scopeButtons}</div>
    <label class="explore-search">Search songs or patterns<input id="explore-search" type="search" placeholder="Song, romaji, artist or pattern…"></label>
    <details class="explore-quick-filter" id="explore-chart-filters"><summary>Filter level</summary><div class="explore-browse-tools" id="explore-chart-tools"><div class="explore-quick-chips" role="group" aria-label="Difficulty"><button type="button" data-difficulty="">All difficulties</button>${difficulties.map(value => `<button type="button" data-difficulty="${safe(value)}">${safe(value)}</button>`).join('')}</div>
    <div class="explore-small-controls"><label>Level<select id="explore-level">${listOptions(charts.map(chart => chart.level),'All levels')}</select></label><div class="explore-quick-chips" role="group" aria-label="Format"><button type="button" data-format="">All formats</button><button type="button" data-format="STD">STD</button><button type="button" data-format="DX">DX</button></div></div></div></details>
    <div class="explore-chips" id="explore-active"></div><div id="explore-query-tools" class="explore-quick-chips" role="group" aria-label="Similar charts" hidden></div>
    <div class="explore-results-heading"><p class="explore-count" id="explore-count" role="status" aria-live="polite"></p><button type="button" id="explore-reset" class="explore-text-button">Clear</button></div>
    <div class="explore-sort-line"><div class="explore-quick-chips" id="explore-sort-buttons" role="group" aria-label="Sort"><button type="button" data-sort="title">Name</button><button type="button" data-sort="constant">Level</button>${overlay ? `<button type="button" data-sort="rating" ${hasRating ? '' : 'disabled title="No recorded chart rating"'}>Rating</button>` : ''}</div><span class="explore-flow-legend" aria-label="Flow shows activity, from low to high"><span>Flow · activity</span><span>Low</span><i></i><span>High</span></span></div>
    <p class="explore-note explore-query-note" id="explore-query-note" hidden></p><div id="explore-list"></div><nav class="explore-pagination" aria-label="Chart result pages"><button type="button" id="explore-prev">Previous</button><span id="explore-page"></span><button type="button" id="explore-next">Next</button></nav>
    <div id="explore-state" hidden><select id="explore-scope">${overlay ? '<option value="mine">My results</option>' : ''}<option value="all">Songs</option><option value="patterns">Patterns</option></select>
    ${['difficulty','format','release','region','availability','analysis','naming','detector'].map(key => `<select id="explore-${key}"><option value=""></option>${listOptions(key==='difficulty'?difficulties:key==='format'?['STD','DX']:[], '')}</select>`).join('')}
    <select id="explore-result"><option value=""></option><option value="yes">Recorded result</option><option value="no">No recorded result</option></select>
    <select multiple id="explore-include">${patternOptions}</select><select multiple id="explore-exclude">${patternOptions}</select><select id="explore-pattern-mode"><option value="any">Any</option><option value="all">All</option></select><input id="explore-unknown" type="checkbox">
    ${['min','max','onsets','concurrency','occupancy','flow-coverage','occurrences','prevalence'].map(key => `<input id="explore-${key}" type="number" value="${['occurrences','prevalence'].includes(key)?'0':''}">`).join('')}
    <select id="explore-metric"><option value="density">Input-onset density</option><option value="estimated_demand">Estimated structural demand</option></select><select id="explore-scale"><option value="shared">Shared reference scale</option><option value="within">Within-chart shape</option></select>
    <select id="explore-mode">${['overall','same-pattern','easier','next-step','section','discovery'].map(value=>`<option value="${value}">${value}</option>`).join('')}</select><select id="explore-sort">${['title','constant','rating','density','result','recent','similarity'].map(value=>`<option value="${value}">${value}</option>`).join('')}</select>
    <p id="explore-scale-note"></p><span id="explore-flow-key"></span><p id="explore-coverage-detail"></p><dl class="explore-facts" id="explore-source-coverage"></dl></div>`;
  const $ = name => document.getElementById(`explore-${name}`);
  if (!charts.some(chart => chart.flow?.segments?.some(segment => segment.estimated_demand?.mean != null))) {
    $("metric").querySelector('[value="estimated_demand"]').disabled = true;
    $("metric").querySelector('[value="estimated_demand"]').textContent += " — unavailable in this pack";
  }
  if (!results.size) $("scope").value = "all";
  const counts = pack.coverage || {};
  $("coverage").textContent = `${charts.length} chart${charts.length===1?'':'s'}${evaluationOnly ? " · study" : ""}`;
  $("coverage-detail").textContent = `${charts.length} catalog charts · ${charts.filter(chart=>chart.analysis_status === "complete").length} complete analyses · ${charts.filter(chart=>chart.analysis_status === "partial").length} partial. ${counts.summary || "Coverage applies only to this prepared catalog."} ${counts.reviewed_named_patterns ?? 'Unknown'} reviewed named-pattern assignments. Exact chart variants; prepared offline. ${overlay ? `History: ${overlay.coverage?.scope || "scope unspecified"}; ${overlay.coverage?.history_complete ? "declared complete for its covered interval" : "incomplete or unknown coverage"}.` : "Catalog only; no player results."}`;
  // Synthetic scope must be visible without opening implementation details.
  if (/synthetic|fictional|authored/i.test(`${pack.catalog_id || ''} ${counts.summary || ''}`)) $("coverage").textContent += ' · Synthetic preview';
  $("source-coverage").innerHTML = [["source_available","Sources available"],["identity_resolved","Identity resolved"],["parse_supported","Parsing supported"],["missing","Missing sources"],["blocked","Blocked sources"],["unavailable","Unavailable analyses"]].map(([key,label]) => `<div><dt>${label}</dt><dd>${present(counts[key])}</dd></div>`).join('');
  let page = 0, query = null, activeMatches = new Map(), allDefinitions = false, sortDirection = null;
  const defaultDirection = sorting => ['rating','result','recent','density'].includes(sorting) ? -1 : 1;
  const PAGE_SIZE = 50;
  const colors = window.maimaiChartVisuals?.flowColors || ["#ccebed", "#91cbd0", "#52a7b1", "#187988", "#064b5c"];
  const patternArt = id => window.maimaiChartVisuals?.patternSvg(id) || '<span class="explore-pattern-placeholder">Definition only</span>';
  const selected = id => [...$(id).selectedOptions].map(option => option.value);
  const difficultyClass = chart => ({basic:'basic',advanced:'advanced',expert:'expert',master:'master','re:master':'remaster',remaster:'remaster'}[normal(chart.difficulty)] || 'unknown');
  const chartTile = chart => `<span class="explore-chart-tile explore-diff-${difficultyClass(chart)}" aria-hidden="true"><small>${safe(chart.format)}</small><strong>${safe(chart.level || '?')}</strong></span>`;
  const chartBadge = chart => `<span class="explore-chart-badge explore-diff-${difficultyClass(chart)}">${safe(chart.difficulty)} · ${safe(chart.format)}</span>`;
  function flowHtml(chart, expanded = false) {
    const metric = $("metric").value, scale = $("scale").value;
    const flow = chart.flow || {}, segments = flow.segments?.length ? flow.segments : Array.from({length:24}, () => ({coverage:0}));
    const metricScale = flow.scales?.[metric] || {};
    const bands = (metricScale.bands || []).filter(bound => bound > 0);
    const scaleSupported = scale === "within" || !!metricScale.id && bands.length > 0;
    const covered = segment => (segment[metric]?.coverage ?? segment.coverage) === 1;
    const known = segments.filter(segment => covered(segment) && segment[metric]?.mean != null);
    const max = Math.max(0, ...known.map(segment => segment[metric].peak ?? segment[metric].mean));
    const text = `${metric === "density" ? "Input-onset density, onsets/second" : "Estimated structural demand, arbitrary structural units"}; ${scale === "within" ? "within-chart shape, colors are not comparable between charts" : `shared scale ${metricScale.id || "unavailable"}`}; ${flow.basis || "chart span"}; ${known.length}/24 supported segments; ${max ? `peak ${max.toFixed(2)}` : known.length ? "valid zero activity" : "analysis unknown"}. Heights show intensity; dark notches mark peaks; hatching means unknown.`;
    const bars = segments.map(segment => {
      const values = segment[metric], unknown = !scaleSupported || !covered(segment) || values?.mean == null;
      if (unknown) return '<span class="flow-segment flow-unknown"></span>';
      const band = scale === "within" ? Math.min(4, Math.floor((max ? values.mean / max : 0) * 5)) : Math.min(4, bands.filter(bound => values.mean >= bound).length);
      const peak = values.peak > values.mean * 1.25 && values.peak - values.mean > .01;
      return `<span class="flow-segment${peak ? " flow-peak" : ""}${values.mean === 0 ? " flow-zero" : ""}" style="--flow-height:${2 + band * 2}px;--flow-color:${colors[band]}"></span>`;
    }).join("");
    const label = `${known.length && scaleSupported ? "Flow" : "Flow · unknown"}${scale === "within" ? " · relative" : ""}`;
    const strip = `<span class="flow-strip" role="img" aria-label="${safe(text)}" title="${safe(text)}">${bars}</span>`;
    return expanded ? strip : `<button type="button" class="explore-flow-button" data-chart="${safe(chart.chart_id)}" aria-label="Open Flow for ${safe(chart.title)} ${safe(chart.difficulty)} ${safe(chart.format)}"><span class="flow-label">${label}</span>${strip}</button>`;
  }
  function matchesFilters(chart) {
    const result = results.get(chart.chart_id), scope = $("scope").value;
    if (scope === "mine" && !result) return false;
    if ($("result")?.value === "yes" && !result || $("result")?.value === "no" && result) return false;
    const matchesSearch = window.maimaiSongSearch.query($("search").value);
    const chartPatterns=(chart.tags || []).filter(positiveTag).flatMap(tag=>{const pattern=patternById.get(tag.pattern_id);return [pattern?.display_name,...(pattern?.aliases || [])];});
    if (!matchesSearch(chart,chartPatterns)) return false;
    for (const key of ["difficulty","format","level","release","region","availability"]) if ($(key).value && chart[key] !== $(key).value) return false;
    if ($("analysis").value && chart.analysis_status !== $("analysis").value) return false;
    if ($("min").value !== "" && (chart.constant == null || chart.constant < Number($("min").value))) return false;
    if ($("max").value !== "" && (chart.constant == null || chart.constant > Number($("max").value))) return false;
    for (const [control,feature,direction] of [["onsets","onset_rate",1],["concurrency","max_concurrency",-1],["occupancy","slide_movement_occupancy",1]]) {
      if ($(control).value !== "" && (chart.metrics?.[feature] == null || direction * chart.metrics[feature] < direction * Number($(control).value))) return false;
    }
    if ($("flow-coverage").value !== "") {
      const segments = chart.flow?.segments || [];
      const coverage = segments.length ? segments.reduce((total,segment) => total + (segment[$("metric").value]?.coverage ?? segment.coverage ?? 0),0) / segments.length : null;
      if (coverage == null || coverage < Number($("flow-coverage").value)) return false;
    }
    const tags = new Map((chart.tags || []).map(tag => [tag.pattern_id, tag]));
    const included = selected("include"), excluded = selected("exclude");
    const evidenceMatches = id => (!$("naming").value || patternById.get(id)?.naming_origin === $("naming").value) && (!$("detector").value || patternById.get(id)?.detector_status === $("detector").value);
    const has = id => positiveTag(tags.get(id)) && evidenceMatches(id) && tags.get(id).occurrence_count != null && tags.get(id).occurrence_count >= Number($("occurrences").value) && tags.get(id).prevalence != null && tags.get(id).prevalence >= Number($("prevalence").value);
    if (included.length && !($("pattern-mode").value === "all" ? included.every(has) : included.some(has))) return false;
    if (!included.length && ($("naming").value || $("detector").value || Number($("occurrences").value) || Number($("prevalence").value)) && ![...tags.keys()].some(has)) return false;
    if (!excluded.every(id => absentTag(tags.get(id)) || (!positiveTag(tags.get(id)) && $("unknown").checked))) return false;
    return true;
  }
  function openQuery(next) {
    onNavigate(next);
    query = {...next}; page = 0; $("scope").value = "all";
    $("mode").value = next.mode || "overall"; $("sort").value = "similarity"; sortDirection = null;
    if (dialog.open) dialog.close(); showExplore(true); update();
  }
  function update() {
    host.querySelectorAll('[data-scope]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scope===$("scope").value)));
    for(const key of ['difficulty','format','sort']) host.querySelectorAll(`[data-${key}]`).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset[key]===$(key).value)));
    host.querySelectorAll('[data-sort]').forEach(button=>{
      const active=button.dataset.sort===$("sort").value, label={title:'Name',constant:'Level',rating:'Rating'}[button.dataset.sort];
      const direction=sortDirection ?? defaultDirection(button.dataset.sort);
      button.innerHTML=`${label}${active ? `<span aria-hidden="true"> ${direction===1?'↑':'↓'}</span>` : ''}`;
      button.setAttribute('aria-label',label);
      button.setAttribute('aria-description',active ? `Sorted ${direction===1?'ascending':'descending'}. Press again to reverse.` : `Sort ${defaultDirection(button.dataset.sort)===1?'ascending':'descending'}.`);
    });
    const glossary = $("scope").value === "patterns";
    $("query-note").hidden = true;
    $("chart-filters").hidden = glossary; $("sort-buttons").hidden = glossary; host.querySelector(".explore-flow-legend").hidden = glossary;
    $("query-tools").hidden = !query || glossary;
    $("query-tools").innerHTML = query ? [["overall","Similar songs"],...(query.pattern_id ? [["same-pattern","Same pattern"],["easier","Slower pattern"]] : [])].map(([mode,label])=>`<button type="button" data-query-mode="${mode}" aria-pressed="${$("mode").value===mode}">${label}</button>`).join("") : "";
    $("query-tools").querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>{$("mode").value=button.dataset.queryMode;page=0;update();}));
    $("scale-note").textContent = $("scale").value === "within" ? "Flow: within-chart shape. Colors describe progression inside each chart and must not be compared as absolute demand." : `Flow: ${$("metric").value === "density" ? "input-onset density, onsets/second" : "estimated structural demand"} on the shared, versioned scale. Raw observations are retained; unknown coverage is hatched.`;
    $("flow-key").textContent = `Flow · ${$("metric").value === 'density' ? 'density' : 'demand'}${$("scale").value === 'within' ? ' · relative' : ' · shared'}`;
    const active = [];
    for (const key of ["difficulty","format","level","release","region","availability","analysis","naming","detector","onsets","concurrency","occupancy","flow-coverage"]) if ($(key).value) active.push(`${nice(key)}: ${$(key).value}`);
    if ($("search").value) active.push(`search: ${$("search").value}`);
    if ($("min").value || $("max").value) active.push(`constant: ${$("min").value || "any"}–${$("max").value || "any"}`);
    for (const id of selected("include")) active.push(`include: ${nameOf(id)}`);
    for (const id of selected("exclude")) active.push(`exclude: ${nameOf(id)}${$("unknown").checked ? " (unknowns included)" : " (supported not-detection)"}`);
    $("reset").hidden = !active.length && !query && $("sort").value === "title" && (sortDirection ?? 1) === 1 && $("metric").value === "density" && $("scale").value === "shared";
    if (query) active.push(`query: ${byId.get(query.chart_id)?.title || query.chart_id} · ${nice($("mode").value)}${query.section_id ? ` · ${query.section_id}` : ""}${query.pattern_id ? ` · ${nameOf(query.pattern_id)}` : ""}`);
    $("active").innerHTML = active.map(value => `<span class="explore-chip">${safe(value)}</span>`).join("") + (query ? '<button type="button" id="explore-clear-query">Clear similarity query</button>' : "");
    $("clear-query")?.addEventListener("click", () => {query = null; $("sort").value = "title"; sortDirection = null; page = 0; update();});
    host.querySelector(".explore-pagination").hidden = glossary;
    if (glossary) {
      const shown = patterns.filter(pattern => ($("search").value.trim() || allDefinitions || charts.some(chart=>(chart.tags||[]).some(tag=>tag.pattern_id===pattern.pattern_id&&positiveTag(tag)))) && normal([pattern.display_name,pattern.description,...(pattern.aliases || [])].join(" ")).includes(normal($("search").value)) && (!$("naming").value || pattern.naming_origin === $("naming").value) && (!$("detector").value || pattern.detector_status === $("detector").value));
      $("count").textContent = `${shown.length} pattern${shown.length===1?'':'s'}`;
      $("query-note").hidden = true;
      $("list").innerHTML = `<button type="button" id="explore-definitions" class="explore-text-button">${allDefinitions ? "With chart matches" : "All definitions"}</button><p class="explore-example-key">Examples: circle = tap · star = slide head · dashed = wait. A/B are buttons.</p><div class="explore-glossary">${shown.map(pattern => {
        const count=charts.filter(chart=>(chart.tags||[]).some(tag=>tag.pattern_id===pattern.pattern_id&&positiveTag(tag))).length;
        return `<article class="explore-pattern" data-pattern-id="${safe(pattern.pattern_id)}"><button type="button" class="explore-pattern-art" data-pattern="${safe(pattern.pattern_id)}" aria-label="View ${safe(pattern.display_name)}">${patternArt(pattern.pattern_id)}</button><h2>${safe(pattern.display_name)}</h2><p class="explore-pattern-status">${safe(nice(pattern.naming_origin))} · ${count ? `${count} chart${count===1?'':'s'}` : 'No chart detections'}</p><p class="explore-secondary">${safe(nice(pattern.detector_status))}</p><button type="button" data-pattern-filter="${safe(pattern.pattern_id)}">Find charts</button></article>`;
      }).join("")}</div>`;
      $("definitions").addEventListener("click",()=>{allDefinitions=!allDefinitions;update();});bindRows(); return;
    }
    let matched = charts.filter(matchesFilters); activeMatches = new Map();
    let queryNote = "";
    if (query) {
      const source = byId.get(query.chart_id), mode = $("mode").value;
      if (mode === "discovery") matched = matched.filter(chart => !results.has(chart.chart_id));
      if (source && window.maimaiExploreSimilarity) {
        const matches = window.maimaiExploreSimilarity(source, matched, {...query, mode,
          pattern_id:query.pattern_id || selected("include")[0], limit:Math.max(1,matched.length)});
        activeMatches = new Map(matches.map(match => [match.chart_id, match]));
        matched = matched.filter(chart => activeMatches.has(chart.chart_id));
        queryNote = " Similarity uses shared supported evidence; an empty result may mean insufficient coverage or no adequate match.";
      } else { matched = []; queryNote = " Similarity is unavailable without a prepared structural descriptor and matching policy."; }
    }
    const sorting = $("sort").value;
    const value = chart => ({constant:chart.constant ?? (Number.isFinite(parseFloat(chart.level)) ? parseFloat(chart.level)+(String(chart.level).includes("+")?.5:0) : null),rating:results.get(chart.chart_id)?.rate,density:chart.metrics?.onset_rate,result:results.get(chart.chart_id)?.percent,recent:results.get(chart.chart_id)?.last_played,similarity:activeMatches.get(chart.chart_id)?.distance})[sorting];
    matched.sort((a,b) => {
      if (sorting === "title") return order(normal(a.title),normal(b.title)) * (sortDirection ?? 1) || order(a.chart_id,b.chart_id);
      const av = value(a), bv = value(b);
      if (av == null || bv == null) return (av == null ? 1 : 0) - (bv == null ? 1 : 0) || order(a.chart_id,b.chart_id);
      return (av - bv) * (sortDirection ?? defaultDirection(sorting)) || order(a.chart_id,b.chart_id);
    });
    const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE)); page = Math.min(page,pages-1);
    const shown = matched.slice(page * PAGE_SIZE,(page+1)*PAGE_SIZE);
    $("count").textContent = `${matched.length} matching chart${matched.length===1?'':'s'}${matched.length > PAGE_SIZE ? ` · ${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,matched.length)}` : ''}`;
    $("count").title = 'Unknown sort values appear last.';
    $("query-note").textContent = queryNote.trim(); $("query-note").hidden = !queryNote || !matched.length;
    $("page").textContent = `Page ${page+1} of ${pages}`; $("prev").disabled = page === 0; $("next").disabled = page === pages-1;
    $("list").innerHTML = shown.map(chart => {
      const result = results.get(chart.chart_id), tags = (chart.tags || []).filter(positiveTag), match = activeMatches.get(chart.chart_id);
      return `<article class="explore-row" data-chart-id="${safe(chart.chart_id)}"><div class="explore-song">${chartTile(chart)}<div class="explore-song-info"><button type="button" class="explore-title" data-chart="${safe(chart.chart_id)}">${safe(chart.title || chart.chart_id)}</button><div class="explore-identity">${chartBadge(chart)}<span class="explore-secondary">Lv ${safe(chart.level || '?')} · ${safe(chart.artist)}</span></div><div class="explore-row-tags">${tags.slice(0,2).map(tag => `<button type="button" class="explore-chip" data-pattern="${safe(tag.pattern_id)}" data-pattern-chart="${safe(chart.chart_id)}">${safe(nameOf(tag.pattern_id))}</button>`).join("")}${tags.length > 2 ? `<span class="explore-tag-more" title="${tags.length-2} more patterns in chart details">+${tags.length-2}</span>` : ""}${!tags.length && chart.analysis_status !== 'complete' ? '<span class="explore-secondary">Pattern coverage unknown</span>' : ''}</div>${match ? `<span class="explore-match-note">${safe(nice($("mode").value))} match · explanation in details</span>` : ""}</div></div><div class="explore-result">${overlay ? result?.percent != null ? `<strong>${result.percent.toFixed(4)}<small>%</small></strong><span class="explore-result-grade">${safe(result.grade || "Grade unknown")}</span>` : result ? "Recorded result · achievement unknown" : "No recorded result" : `<span class="explore-secondary explore-mobile-label">Constant</span><strong>${present(chart.constant)}</strong>`}</div>${`<div class="explore-row-actions">${flowHtml(chart)}<button type="button" class="explore-similar-button" data-similar="${safe(chart.chart_id)}" ${chart.descriptor ? "" : "disabled"}>Similar songs</button></div>`}</article>`;
    }).join("") || (query ? '<div class="explore-empty"><p>No close structural match in this catalog. Try browsing a shared pattern.</p><button type="button" id="explore-empty-patterns">Patterns</button></div>' : '<p class="explore-empty">No charts match these filters. Unknown analysis is not evidence of absence.</p>');
    $("empty-patterns")?.addEventListener('click',()=>{
      query=null;sortDirection=null;$("sort").value='title';$("search").value='';$("scope").value='patterns';page=0;
      update();host.querySelector('[data-scope="patterns"]').focus();
    });
    bindRows();
  }
  const dialog = document.createElement("dialog"); dialog.className = "explore-dialog";
  dialog.setAttribute("aria-labelledby", "explore-detail-title"); document.body.append(dialog);
  let previousFocus = null;
  function displayDialog(html, opener) {
    if (!dialog.open) previousFocus = opener || document.activeElement;
    dialog.innerHTML = html; if (!dialog.open) dialog.showModal();
    dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  }
  dialog.addEventListener("close", () => {const restored=previousFocus?.isConnected ? previousFocus : [...document.querySelectorAll("[data-chart]")].find(item=>item.dataset.chart===previousFocus?.dataset.chart&&item.className===previousFocus?.className&&item.getClientRects().length); restored?.focus();});
  function showPattern(patternId, chartId, opener) {
    const pattern = patternById.get(patternId); if (!pattern) return;
    displayDialog(`<header><div><h2 id="explore-detail-title">${safe(pattern.display_name)}</h2><p>${safe((pattern.aliases || []).join(" · "))}</p></div><button type="button" data-close aria-label="Close pattern details">Close</button></header><div class="explore-pattern-preview">${patternArt(patternId)}</div><p>${safe(pattern.description)}</p><p>Naming: ${safe(nice(pattern.naming_origin))}. Definition: ${safe(nice(pattern.definition_status))}. Detector: ${safe(nice(pattern.detector_status))}.</p><p>${safe((pattern.limitations || []).join(" "))}</p><p>Source IDs: ${safe((pattern.source_ids || []).join(", ") || "unknown")}</p><div class="explore-dialog-actions"><button type="button" id="explore-show-pattern">Find charts</button><button type="button" id="explore-without-pattern">Without this pattern</button></div><label class="explore-checkbox"><input type="checkbox" id="explore-without-unknown" ${$("unknown").checked ? "checked" : ""}>Include unknown analysis when excluding</label>${chartId ? '<button type="button" id="explore-pattern-sections">Supporting chart sections</button>' : ""}`, opener);
    $("show-pattern").addEventListener("click", () => applyPattern(patternId));
    $("without-pattern").addEventListener("click",()=>{$("unknown").checked=$("without-unknown").checked;applyPattern(patternId,true);});
    $("pattern-sections")?.addEventListener("click", () => showChart(chartId));
  }
  function showChart(id, opener, attemptPage = 0) {
    const chart = byId.get(id); if (!chart) return;
    onNavigate({chart_id:id});
    const result = results.get(id), tags = chart.tags || [], flow = chart.flow || {}, metric = $("metric").value;
    const metricValues = chart.metrics || {};
    const occurrences = chart.occurrences || [], sections = chart.sections || [];
    const tagMarkup = tag => `<p><button type="button" data-detail-pattern="${safe(tag.pattern_id)}">${safe(nameOf(tag.pattern_id))}</button> · ${safe(nice(tag.status))} · ${present(tag.occurrence_count)} observed occurrences · prevalence ${present(tag.prevalence)}<br><span class="explore-note">${safe(nice(patternById.get(tag.pattern_id)?.naming_origin))}; detector ${safe(nice(patternById.get(tag.pattern_id)?.detector_status))}. Coverage ${safe(tag.coverage || 'unspecified')}.${tag.coverage === 'partial' || tag.occurrences_truncated ? ' Observed counts and prevalence are lower bounds; unsupported or truncated occurrences may be missing.' : ''}</span></p>`;
    const timeLabel = flow.span_start_us != null && flow.span_end_us != null ? `chart time ${clock(flow.span_start_us)}–${clock(flow.span_end_us)}` : 'chart span unavailable';
    const scale = flow.scales?.[metric];
    const match = activeMatches.get(id);
    const attempts = result?.attempts || [], attemptPages = Math.max(1,Math.ceil(attempts.length / PAGE_SIZE));
    attemptPage = Math.max(0,Math.min(attemptPage,attemptPages-1));
    const shownAttempts = attempts.slice(attemptPage*PAGE_SIZE,(attemptPage+1)*PAGE_SIZE);
    const resultMarkup = result?.percent != null ? `${result.percent.toFixed(4)}% · ${safe(result.grade)} · rating ${present(result.rate)} · ${safe(result.lamp)}` : result ? `Recorded result; achievement unknown · rating ${present(result.rate)} · ${safe(result.lamp || 'lamp unknown')}` : 'No recorded result in the supplied history.';
    const attemptsMarkup = attempts.length ? `<p id="explore-attempt-status" role="status">Showing ${attemptPage*PAGE_SIZE+1}–${Math.min((attemptPage+1)*PAGE_SIZE,attempts.length)} of ${attempts.length} supplied attempts. History may be incomplete.</p><ol class="explore-attempts" aria-label="Supplied attempts">${shownAttempts.map(attempt => `<li data-attempt-id="${safe(attempt.attempt_id)}">${attempt.percent == null ? "Achievement unknown" : `${present(attempt.percent)}%`} · ${attempt.recorded_at == null ? 'Recorded time unknown' : new Date(attempt.recorded_at).toISOString()} · ${safe(attempt.lamp || 'Lamp unknown')}</li>`).join('')}</ol><div class="explore-pagination"><button type="button" id="explore-attempt-prev" ${attemptPage === 0 ? 'disabled' : ''}>Previous attempts</button><span>Page ${attemptPage+1} of ${attemptPages}</span><button type="button" id="explore-attempt-next" ${attemptPage === attemptPages-1 ? 'disabled' : ''}>Next attempts</button></div>` : '';
    const occurrenceMarkup = occurrence => `<li>${safe(nameOf(occurrence.pattern_id))} · chart time ${clock(occurrence.start_us)}–${clock(occurrence.end_us)} · ${safe(occurrence.occurrence_id)} <button type="button" data-occurrence="${safe(occurrence.occurrence_id)}">Find this pattern elsewhere</button><details><summary>Occurrence evidence</summary><p>${Object.entries(occurrence.evidence || {}).map(([key,value]) => `${safe(nice(key))}: ${safe(nice(value))}`).join('; ') || 'Evidence status not supplied.'}</p><p>Supporting input IDs: ${safe((occurrence.event_ids || []).join(', ') || 'not supplied')}. Path IDs: ${safe((occurrence.path_ids || []).join(', ') || 'not supplied')}. ${occurrence.evidence_truncated ? 'Representative IDs only; additional evidence omitted from the browser.' : ''}</p><p>${Object.entries(occurrence.measurements || {}).map(([key,value]) => `${safe(nice(key))}: ${present(value)}`).join('; ')}</p><p>Transformation: ${safe(occurrence.transform || 'unspecified')}.</p></details></li>`;
    displayDialog(`<header><div><h2 id="explore-detail-title">${safe(chart.title || id)}</h2><p>${safe(chart.artist)} · ${safe(chart.difficulty)} ${safe(chart.format)} · Lv ${safe(chart.level)} · ${safe(chart.revision)}</p></div><button type="button" data-close aria-label="Close chart details">Close</button></header>
      <details class="explore-provenance"><summary>Chart identity and source</summary><p class="explore-note">Exact ID: ${safe(id)}. Analysis ${safe(nice(chart.analysis_status))}; source ${safe(chart.source_id || "unknown")} ${safe(chart.source_revision || "")}; identity ${safe(chart.identity_status || "unknown")}; parsing ${safe(chart.parse_status || "unknown")}.</p></details>
      ${match ? `<section class="explore-match-detail"><h3>Why this chart matches</h3><p>${safe((match.explanation || []).join(' '))}</p></section>` : ''}
      ${overlay ? `<h3>Recorded results</h3><p>${resultMarkup} Available attempts: ${present(result?.attempt_count)}. Missing attempts are not zero lifetime plays.</p>${attemptsMarkup}` : ''}
      <div class="explore-controls explore-flow-controls"><label>Flow metric<select id="explore-detail-metric">${$("metric").innerHTML}</select></label><label>Flow scale<select id="explore-detail-scale">${$("scale").innerHTML}</select></label></div><h3>Flow · ${metric === "density" ? "input-onset density" : "estimated structural demand"}</h3><p>${safe(nice(flow.basis || "Chart span"))} · ${timeLabel}. ${safe($("scale-note").textContent)}</p>${flowHtml(chart,true)}
      <p class="explore-note">Reference ${safe(scale?.id || 'unavailable')}; ${safe(scale?.unit || 'units unspecified')}; bands ${safe(scale?.bands?.join(', ') || 'unavailable')}. ${$("scale").value === "within" ? 'Within-chart shape currently selected.' : 'Highest color includes the remaining upper range.'}</p>
      <p class="explore-note">Each segment shows a mean; a dark notch preserves a short peak. Hatching is unknown coverage, while a short solid line can be valid zero activity.</p>
      <details><summary>Segment times, means, peaks and feature channels</summary><ol class="explore-segments">${(flow.segments || []).map(segment => `<li>${clock(segment.start_us)}–${clock(segment.end_us)}: mean ${present(segment[metric]?.mean)}, peak ${present(segment[metric]?.peak)}; coverage ${segment.coverage == null ? "unknown" : `${Math.round(segment.coverage*100)}%`}. ${safe((segment.contributors || []).join(", "))}</li>`).join("") || "<li>Analysis unavailable</li>"}</ol></details>
      <h3>Supported structural measurements</h3><dl class="explore-facts">${Object.entries(metricValues).map(([key,value]) => `<div><dt>${safe(nice(key))}</dt><dd>${present(value)}</dd></div>`).join("") || "<div><dt>Coverage</dt><dd>Unknown</dd></div>"}</dl>
      <h3>Pattern evidence</h3>${tags.filter(positiveTag).map(tagMarkup).join("") || "<p>No detected or reviewed-present patterns in this profile.</p>"}<details><summary>Other pattern states (${tags.filter(tag => !positiveTag(tag)).length})</summary>${tags.filter(tag => !positiveTag(tag)).map(tagMarkup).join("") || "<p>No additional pattern evidence supplied.</p>"}</details>
      <ul>${occurrences.map(occurrenceMarkup).join("")}</ul>
      <h3>Chart sections</h3><ul>${sections.map(section => `<li>${clock(section.start_us)}–${clock(section.end_us)} <button type="button" data-section="${safe(section.section_id)}">Find similar section</button></li>`).join("") || "<li>No supported sections.</li>"}</ul>
      <button type="button" id="explore-similar" ${chart.descriptor ? "" : "disabled"}>Find similar overall</button><p class="explore-note">Structural resemblance and lower onset rate are measured relations, not a proven training benefit. Unsupported queries may return no adequate match.</p>`, opener);
    for(const key of ["metric","scale"]) {$("detail-"+key).value=$(key).value;$("detail-"+key).addEventListener("change",()=>{$(key).value=$("detail-"+key).value;update();renderTargets();showChart(id,null,attemptPage);$("detail-"+key).focus();});}
    $("similar").addEventListener("click", () => openQuery({chart_id:id,mode:"overall"}));
    for (const [direction,delta] of [['prev',-1],['next',1]]) $("attempt-"+direction)?.addEventListener('click', () => {
      showChart(id,null,attemptPage+delta);
      const requested=$("attempt-"+direction),fallback=$("attempt-"+(direction === 'next' ? 'prev' : 'next'));
      (requested.disabled ? fallback : requested)?.focus();
    });
    dialog.querySelectorAll("[data-detail-pattern]").forEach(button => button.addEventListener("click", () => showPattern(button.dataset.detailPattern,id)));
    dialog.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => openQuery({chart_id:id,mode:"section",section_id:button.dataset.section})));
    dialog.querySelectorAll("[data-occurrence]").forEach(button => button.addEventListener("click", () => {
      const occurrence = occurrences.find(item => item.occurrence_id === button.dataset.occurrence);
      const section = sections.find(item => item.start_us <= occurrence.start_us && item.end_us > occurrence.start_us);
      openQuery({chart_id:id,mode:"same-pattern",pattern_id:occurrence.pattern_id,occurrence_id:occurrence.occurrence_id,section_id:occurrence.section_id || section?.section_id});
    }));
  }
  function applyPattern(id, exclude = false) {
    onNavigate({pattern_id:id});
    if (dialog.open) dialog.close(); if($("scope").value === "patterns") $("search").value=""; $("scope").value = "all";
    query=null;sortDirection=null;$("sort").value='title';
    [...$(exclude ? "exclude" : "include").options].forEach(option => {option.selected = option.value === id;});
    [...$(exclude ? "include" : "exclude").options].filter(option=>option.value===id).forEach(option=>{option.selected=false;});
    page = 0; showExplore(true); update();
  }
  function bindRows() {
    $("list").querySelectorAll("[data-similar]").forEach(button=>button.addEventListener("click",()=>openQuery({chart_id:button.dataset.similar,mode:"overall"})));
    $("list").querySelectorAll("[data-chart]").forEach(button => button.addEventListener("click", () => showChart(button.dataset.chart,button)));
    $("list").querySelectorAll("[data-pattern]").forEach(button => button.addEventListener("click", () => showPattern(button.dataset.pattern,button.dataset.patternChart,button)));
    $("list").querySelectorAll("[data-pattern-filter]").forEach(button => button.addEventListener("click", () => applyPattern(button.dataset.patternFilter)));
  }
  function renderTargets() {
    if (evaluationOnly || !recommendations || !Array.isArray(recommendations.cards)) return;
    const legacy=document.querySelector('#targets-view .target-opportunities'), layout=document.querySelector('#targets-view .practice-layout');
    if(!standalone && (!legacy || !layout)) return;
    const usable=recommendations.cards.filter(card=>byId.has(card.chart_id));
    if(!usable.length) return;
    let targetHost=document.getElementById('explore-targets');
    if(standalone && !targetHost) {
      targetHost=document.createElement('section');targetHost.id='explore-targets';
      document.getElementById('personal-targets').append(targetHost);
    }
    if(!targetHost) {
      targetHost=document.createElement('section');targetHost.id='explore-targets';layout.before(targetHost);
      layout.id='explore-legacy-targets';layout.hidden=true;legacy.querySelector('h2').textContent='Rating snapshot suggestions';
      const switcher=document.createElement('div');switcher.className='explore-segments-control';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Targets view');
      switcher.innerHTML='<button type="button" data-target-view="next" aria-pressed="true">Next targets</button><button type="button" data-target-view="session" aria-pressed="false">Session details</button>';
      targetHost.before(switcher);switcher.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{const next=button.dataset.targetView==='next';targetHost.hidden=!next;layout.hidden=next;switcher.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));}));
    }
    targetHost.innerHTML=`<div class="explore-target-heading"><h2>Next targets</h2><span class="explore-secondary">${usable.length} suggestions</span></div><span class="explore-flow-legend" aria-label="Flow shows activity, from low to high"><span>Flow · activity</span><span>Low</span><i></i><span>High</span></span><div class="explore-target-grid">`+recommendations.cards.map((card,index)=>{
      const chart=byId.get(card.chart_id);if(!chart)return '';
      const category=['rating','practice','discovery'].includes(card.category)?card.category:'discovery';
      const current=card.previous_achievement ?? results.get(chart.chart_id)?.percent;
      const focus=category==='rating' && card.target_achievement!=null ? `<strong>${Number(card.target_achievement).toFixed(4)}<small>%</small></strong>${card.target_lamp ? `<span>${safe(card.target_lamp)}</span>` : ''}` : `<strong class="explore-pattern-goal">${safe((card.targeted_patterns||[]).map(nameOf).join(' · ') || 'Similar structure')}</strong>`;
      return `<article class="explore-target" data-category="${category}"><div class="explore-target-topline"><span class="explore-target-kind">${{rating:'Rating up',practice:'Pattern practice',discovery:'Discover'}[category]}</span><span class="explore-reachability">${card.reachability?.status && card.reachability.status!=='unknown' ? `${safe(nice(card.reachability.label||card.reachability.status))} · heuristic` : 'Readiness unknown'}</span></div><div class="explore-target-song">${chartTile(chart)}<div><h3>${safe(chart.title)}</h3>${chartBadge(chart)}</div></div><div class="explore-target-goal">${focus}</div>${card.gain_if_achieved!=null ? `<strong class="explore-target-gain">+${present(card.gain_if_achieved)} rating if achieved</strong>` : ''}<p class="explore-target-pb">${current==null ? 'No recorded result' : `PB ${Number(current).toFixed(4)}%`}</p>${category==='practice'&&card.targeted_patterns?.[0] ? `<div class="explore-target-pattern">${patternArt(card.targeted_patterns[0])}</div>` : ''}<div class="explore-target-actions">${flowHtml(chart)}<button type="button" data-alternative="${index}" aria-label="Find alternatives in Explore">Similar</button></div></article>`;
    }).join('')+'</div>';
    targetHost.querySelectorAll('[data-chart]').forEach(button=>button.addEventListener('click',()=>showChart(button.dataset.chart,button)));
    targetHost.querySelectorAll('[data-alternative]').forEach(button=>button.addEventListener('click',()=>{const card=recommendations.cards[Number(button.dataset.alternative)];openQuery({chart_id:card.chart_id,mode:'overall',...card.alternative_query});}));
  }
  for(const key of ['scope','difficulty','format','sort']) host.querySelectorAll(`[data-${key}]`).forEach(button=>button.addEventListener('click',()=>{
    if(key==='sort') sortDirection=$(key).value===button.dataset[key] ? -(sortDirection ?? defaultDirection(button.dataset[key])) : defaultDirection(button.dataset[key]);
    $(key).value=button.dataset[key];page=0;update();
  }));
  $("about").addEventListener('click',()=>displayDialog(`<header><h2 id="explore-detail-title">About this catalog</h2><button type="button" data-close>Close</button></header><p>${safe($("coverage-detail").textContent)}</p><dl class="explore-facts">${$("source-coverage").innerHTML}</dl>${evaluationOnly?'<p>Public transcriptions remain unverified against the game. Analysis does not establish redistribution permission.</p>':''}`,$("about")));
  host.querySelectorAll("input,select").forEach(input => input.addEventListener(input.tagName === "INPUT" ? "input" : "change", () => {if(input.id==='explore-sort') sortDirection=null; page = 0; update(); renderTargets();}));
  $("prev").addEventListener("click", () => {page--; update(); $("count").scrollIntoView({block:"nearest"});});
  $("next").addEventListener("click", () => {page++; update(); $("count").scrollIntoView({block:"nearest"});});
  $("reset").addEventListener("click", () => {
    host.querySelectorAll("input").forEach(input => {input.value = ["explore-occurrences","explore-prevalence"].includes(input.id) ? "0" : ""; if (input.type === "checkbox") input.checked = false;});
    host.querySelectorAll("select").forEach(select => {if (select.multiple) [...select.options].forEach(option => {option.selected = false;}); else select.selectedIndex = 0;});
    if (!results.size) $("scope").value = "all"; query = null; sortDirection = null; page = 0; update(); renderTargets();
  });
  const externalQuery = event => openQuery(event.detail);
  window.maimaiExplore = Object.freeze({open:openQuery,showChart,showPattern:applyPattern,flowHtml,
    destroy:()=>{dialog.remove();document.removeEventListener('maimai:explore',externalQuery);}});
  document.addEventListener("maimai:explore", externalQuery);
  update(); renderTargets();
};
if(document.getElementById('exploration-data')) window.maimaiMountExplorer();
