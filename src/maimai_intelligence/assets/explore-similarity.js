/* Ordered-structure-v3. Keep numerical policy aligned with analyzer/similarity.py. */
(() => {
  'use strict';
  const features = ['tap_fraction','hold_fraction','touch_fraction','star_fraction',
    'simultaneous_fraction','branches_per_head','mean_beat_interval',
    'beat_interval_variation','hold_occupancy','slide_movement_occupancy','slide_wait_occupancy'];
  const demands = ['onset_rate','peak_onset_rate','hold_occupancy','slide_movement_occupancy',
    'slide_wait_occupancy','max_concurrency'];
  const rateFamily = new Set(['onset_rate','peak_onset_rate']), numericTolerance = 0.000001;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const rounded = x => Math.round(x * 1e6) / 1e6;
  const fraction = x => finite(x) ? Math.min(1, Math.max(0,x)) : fraction(x?.fraction ?? 0);
  const counts = d => {
    if (d.ngrams) return d.ngrams;
    const tokens = d.sequence || [], n = Math.min(3,tokens.length), result = {};
    if (!n) return result;
    for (let i=0;i<=tokens.length-n;i++) {
      const key=JSON.stringify(tokens.slice(i,i+n)); result[key]=(result[key]||0)+1;
    }
    return result;
  };
  function compare(left,right) {
    const a=counts(left),b=counts(right),av=Object.values(a),bv=Object.values(b);
    const sc=Math.min(fraction(left.coverage),fraction(right.coverage));
    if (!av.length || !bv.length || sc<0.6) return null;
    const af=left.features||{},bf=right.features||{};
    const known=features.filter(k=>finite(af[k])&&finite(bf[k]));
    const coverage=sc*(0.75+0.25*known.length/features.length);
    if(coverage<0.6) return null;
    const common=Object.entries(a).reduce((n,[k,v])=>n+Math.min(v,b[k]||0),0);
    const sd=1-2*common/(av.reduce((n,x)=>n+x,0)+bv.reduce((n,x)=>n+x,0));
    const scalar=known.length ? known.reduce((n,k)=>n+Math.abs(af[k]-bf[k])/Math.max(Math.abs(af[k]),Math.abs(bf[k]),1),0)/known.length : 0;
    const sw=0.25*known.length/features.length;
    return {distance:rounded((0.75*sd+sw*scalar)/(0.75+sw)),coverage:rounded(coverage),
      sequence_distance:rounded(sd),matched_trigrams:common,shared_features:known};
  }
  const patterns = v => new Set(v.pattern_ids || (v.tags||[])
    .filter(t=>['detected','reviewed-present'].includes(t.status)).map(t=>t.pattern_id));
  function localRunRates(chart,pid,section) {
    if(!['pattern.two_position_alternation','pattern.same_position_repetition'].includes(pid)) return null;
    const tags=(chart.tags||[]).filter(t=>t.pattern_id===pid), occurrences=chart.occurrences||[];
    if(tags.length!==1||occurrences.length>100000) return null;
    const tag=tags[0];
    if(!['detected','reviewed-present'].includes(tag.status)||tag.coverage!=='complete'||
      tag.occurrences_truncated!==false||!Number.isInteger(tag.occurrence_count)||
      tag.occurrence_count<1||tag.occurrence_count>4096) return null;
    const selected=occurrences.filter(o=>o.pattern_id===pid);
    if(selected.length!==tag.occurrence_count) return null;
    const rates=[],seen=new Set();
    for(const o of selected) {
      const start=o.start_us,end=o.end_us,count=o.measurements?.onset_count,oid=o.occurrence_id;
      if(typeof oid!=='string'||!oid||seen.has(oid)||o.definition_version!=='0.1.0'||
        !['0.1.0','0.2.0'].includes(o.detector_version)||o.evidence?.timing!=='supported_section'||
        !Number.isInteger(count)||count<2||count>100000||!Number.isInteger(start)||
        !Number.isInteger(end)||start<0||start>=end-1||end-1>3600000000) return null;
      seen.add(oid);
      if(section&&!((section.start_us??end)<=start&&(section.end_us??start)>=end)) continue;
      rates.push((count-1)*1000000/(end-start-1));
    }
    return rates.length?rates:null;
  }
  function localRelation(qr,candidate,pid,mode,dimension,csection) {
    if(dimension!=='onset_rate') return null;
    const cr=localRunRates(candidate,pid,csection);
    if(!qr||!cr) return null;
    const qmin=Math.min(...qr),qmax=Math.max(...qr),cmin=Math.min(...cr),cmax=Math.max(...cr);
    let criterion;
    if(mode==='easier') {
      if(cmax>0.95*qmin) return null;
      criterion='candidate maximum <= 95% of query minimum';
    } else {
      if(cmin<1.05*qmax||cmax>1.25*qmin) return null;
      criterion='every candidate run is 105%..125% of every query run';
    }
    return {metric:'mean_onset_cadence_within_selected_runs',unit:'onsets/second',
      query:{min:rounded(qmin),max:rounded(qmax),occurrence_count:qr.length},
      candidate:{min:rounded(cmin),max:rounded(cmax),occurrence_count:cr.length},criterion,
      evidence_scope:'Complete retained v0.1.0 runs; (onset_count - 1) / first-to-last time. '+
        'Mean cadence does not establish peak cadence, ergonomics or learning benefit.'};
  }
  window.maimaiExploreSimilarity = (query,candidates,options={}) => {
    const mode=options.mode||'overall',dimension=options.lower_dimension||'onset_rate';
    if(!['overall','same-pattern','easier','next-step','discovery','section'].includes(mode)||!demands.includes(dimension)) return [];
    const pid=options.pattern_id, sid=options.section_id;
    if(['same-pattern','easier'].includes(mode)&&!pid) return [];
    const section=sid ? (query.sections||[]).find(s=>s.section_id===sid) : null;
    if((sid&&!section)||(mode==='section'&&!section)) return [];
    const q=section||query;
    if(pid&&!patterns(q).has(pid)) return [];
    let localQueryRates=null;
    if(['easier','next-step'].includes(mode)&&pid) {
      if(dimension!=='onset_rate') return [];
      localQueryRates=localRunRates(query,pid,section);
      if(!localQueryRates) return [];
    }
    const recorded=new Set(options.recorded_ids||[]), matches=[];
    for(const chart of candidates) {
      if(chart.chart_id===query.chart_id||(mode==='discovery'&&recorded.has(chart.chart_id))) continue;
      let best=null;
      for(const candidate of (section ? chart.sections||[] : [chart])) {
        if(pid&&!patterns(candidate).has(pid)) continue;
        const score=compare(q.descriptor||{},candidate.descriptor||{});
        if(!score||score.distance>0.6||!score.matched_trigrams) continue;
        const qm=q.metrics||{},cm=candidate.metrics||{},differences={};
        for(const k of demands) if(finite(qm[k])&&finite(cm[k])) differences[k]={query:qm[k],candidate:cm[k],delta:rounded(cm[k]-qm[k])};
        let local=null;
        if(['easier','next-step'].includes(mode)) {
          if(pid) {
            local=localRelation(localQueryRates,chart,pid,mode,dimension,section?candidate:null);
            if(!local) continue;
          }
          const selected=differences[dimension];
          if(!selected||selected.query<=0||Object.keys(differences).length!==demands.length) continue;
          const ratio=selected.candidate/selected.query;
          if(mode==='easier'&&ratio>0.95) continue;
          if(mode==='next-step'&&(ratio<1.05||ratio>1.25)) continue;
          if(mode==='easier') {
            if(Object.entries(differences).some(([k,d])=>k!==dimension&&d.candidate>d.query*1.25+0.1)) continue;
          } else {
            const selectedFamily=rateFamily.has(dimension)?rateFamily:new Set([dimension]);
            if(Object.entries(differences).some(([k,d])=>k!==dimension&&
              d.candidate>d.query*(selectedFamily.has(k)?1.25:1)+numericTolerance)) continue;
          }
        }
        const explanation=[`Shares ${score.matched_trigrams} ordered event-role/spacing trigrams.`,
          'Local sequence resemblance; ergonomics and learning benefit unverified.'];
        if(pid) explanation.splice(1,0,`Supporting occurrences of ${pid} in both settings.`);
        if(['easier','next-step'].includes(mode)) {const d=differences[dimension];explanation.splice(1,0,`${dimension}: ${d.query} → ${d.candidate}; other measured demands bounded by policy.`);}
        if(mode==='next-step') explanation.splice(2,0,'Only the selected demand family may increase; average and peak onset rates may covary.');
        if(local) explanation.push(`Selected-run mean onset cadence: ${local.query.min}–${local.query.max} → `+
          `${local.candidate.min}–${local.candidate.max} onsets/second. `+
          'Full retained run counts; local peak cadence and ergonomics unverified.');
        if(mode==='discovery') explanation.push('No recorded result in supplied overlay; play history may be incomplete.');
        const match={chart_id:chart.chart_id,section_id:candidate.section_id||null,...score,differences,explanation,
          policy_version:'ordered-structure-v3',transformation:'Authored relative button steps; reflection not normalized'};
        if(local) match.local_demand_relation=local;
        if(!best||match.distance<best.distance||(match.distance===best.distance&&(match.section_id||'')<(best.section_id||''))) best=match;
      }
      if(best) matches.push(best);
    }
    return matches.sort((a,b)=>a.distance-b.distance||(a.chart_id<b.chart_id?-1:a.chart_id>b.chart_id?1:0)||
      ((a.section_id||'')<(b.section_id||'')?-1:(a.section_id||'')>(b.section_id||'')?1:0)).slice(0,options.limit||20);
  };
})();
