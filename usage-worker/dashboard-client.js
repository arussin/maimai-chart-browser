(() => {
'use strict';
const data=JSON.parse(document.getElementById('dashboard-data').textContent);
const el=id=>document.getElementById(id), number=value=>value===null?'—':value.toLocaleString('en-US');
const label=value=>value ? value.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()) : '—';
const dayKey=date=>new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const addDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const today=dayKey(new Date()), captureDay=dayKey(new Date(data.captured_at));
let visibleRows=[], exportUrl;
const node=(tag,text,className)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;};
const sum=rows=>rows.reduce((n,r)=>n+r.count,0);
const cell=(text,className)=>node('td',text,className);
const row=(values)=>{const tr=node('tr');values.forEach(value=>tr.append(typeof value==='object'?value:cell(value)));return tr;};
const ledger=new Map(data.coverage.map(r=>[r.day,r.status]));
function coverage(day){
 if(day<data.activation)return 'Before activation';
 if(day>captureDay)return 'Not captured';
 if(day===today||day===captureDay)return 'Incomplete day';
 return {complete:'Complete',partial:'Partial',off:'Off',unknown:'Unknown'}[ledger.get(day)]||'Unknown';
}
function setRange(){
 const range=el('range').value;
 if(range==='custom')return;
 let from=today,to=today;
 if(range==='7'||range==='30'){to=addDay(today,-1);from=addDay(to,1-Number(range));}
 if(range==='all')from=data.activation;
 el('from').value=from;el('to').value=to;
}
function meter(value,max,unknown=false){
 const wrap=node('div',undefined,'meter-wrap'+(unknown?' uncertain':''));
 const m=node('meter');m.min=0;m.max=Math.max(max,1);m.value=value||0;m.setAttribute('aria-label',value===null?'No measured count':number(value)+' received actions');wrap.append(m);return wrap;
}
function render(){
 const from=el('from').value,to=el('to').value,page=el('page').value,search=el('search').value.trim().toLowerCase();
 el('error').hidden=true;
 if(!from||!to||from>to||to>today||((Date.parse(to)-Date.parse(from))/86400000)>365){
   el('error').textContent='Choose an ordered date range of at most 366 days ending today or earlier.';el('error').hidden=false;el('download').disabled=true;return;
 }
 el('download').disabled=false;
 const days=[];for(let day=from;day<=to;day=addDay(day,1))days.push(day);
 const inRange=data.totals.filter(r=>r.day>=from&&r.day<=to);
 const rows=inRange.filter(r=>(!page||r.page===page)&&(!search||[r.event,r.page,r.detail,r.failure].join(' ').replaceAll('_',' ').toLowerCase().includes(search)));
 const complete=days.filter(day=>coverage(day)==='Complete').length;
 const recorded=rows.length>0, measurable=complete===days.length;
 const total=recorded||measurable?sum(rows):null;
 el('total').textContent=number(total);
 el('views').textContent=number(total===null?null:sum(rows.filter(r=>r.event==='page_view')));
 el('features').textContent=number(total===null?null:sum(rows.filter(r=>r.event!=='page_view')));
 el('complete').textContent=complete+' / '+days.length;
 el('coverage-caption').textContent=complete===days.length?'All selected days explicitly complete':'Unknown and incomplete days remain visible';
 el('range-caption').textContent=from+' → '+to+' · America/New_York · '+(page?label(page):'All pages')+(search?' · Filtered actions':'');
 const daily=days.map(day=>{const values=rows.filter(r=>r.day===day);return {day,status:coverage(day),count:values.length||coverage(day)==='Complete'?sum(values):null};});
 el('trend').replaceChildren();const max=Math.max(1,...daily.map(d=>d.count||0));
 daily.forEach(d=>{const line=node('div',undefined,'day-bar');line.append(node('span',d.day.slice(5),'date'),meter(d.count,max,d.status!=='Complete'),node('strong',number(d.count)),node('span',d.status,'day-status'));el('trend').append(line);});
 const pageTotals=new Map();rows.forEach(r=>pageTotals.set(r.page,(pageTotals.get(r.page)||0)+r.count));
 el('pages').replaceChildren();
 [...pageTotals].sort((a,b)=>b[1]-a[1]).forEach(([name,count])=>{const line=node('div',undefined,'page-bar');line.append(node('span',label(name)),node('strong',number(count)),meter(count,Math.max(1,...pageTotals.values())));el('pages').append(line);});
 if(!pageTotals.size)el('pages').append(node('p','No received page activity in this view.','empty'));
 const groups=new Map();rows.forEach(r=>{const key=JSON.stringify([r.event,r.page,r.detail,r.failure]);const old=groups.get(key);groups.set(key,{event:r.event,page:r.page,detail:r.detail,failure:r.failure,count:(old?.count||0)+r.count});});
 visibleRows=[...groups.values()].sort((a,b)=>b.count-a.count||a.event.localeCompare(b.event));
 el('actions').replaceChildren();
 visibleRows.forEach(r=>el('actions').append(row([label(r.event),label(r.page),label(r.detail),label(r.failure),cell(number(r.count),'number')])));
 el('row-count').textContent=visibleRows.length+' action combinations';el('empty').hidden=visibleRows.length>0;
 el('coverage').replaceChildren();[...daily].reverse().forEach(d=>el('coverage').append(row([d.day,cell(d.status,'status '+(d.status==='Complete'?'good':'')),cell(number(d.count),'number')])));
}
data.limitations.forEach(text=>el('limitations').append(node('li',text)));
[...new Set(data.totals.map(r=>r.page))].sort().forEach(value=>{const option=node('option',label(value));option.value=value;el('page').append(option);});
el('captured').textContent='Captured '+new Intl.DateTimeFormat('en-US',{timeZone:data.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(data.captured_at))+' ET';
const age=Date.now()-Date.parse(data.captured_at);
el('freshness').textContent=age>86400000?'Older snapshot':age>3600000?'Saved snapshot':'Recently refreshed';
el('activation').textContent='Collection began '+data.activation+' · Instrumentation v1';
el('notice').textContent='Private aggregate snapshot. '+(captureDay===data.activation?'Launch-day counts include acceptance activity. ':'')+'Coverage is '+(data.coverage.length?'shown in the ledger below.':'unknown until explicitly recorded.')+' No people or session counts are inferred.';
el('reload').addEventListener('click',()=>location.reload());
el('range').addEventListener('change',()=>{setRange();render();});
['from','to'].forEach(id=>el(id).addEventListener('change',()=>{el('range').value='custom';render();}));
el('page').addEventListener('change',render);el('search').addEventListener('input',render);
el('download').addEventListener('click',()=>{
 const keys=['event','page','detail','failure','received_count','from','through','timezone','coverage_note','captured_at'];
 const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
 const note='Received actions only; consult coverage ledger. Launch includes acceptance activity.';
 const lines=[keys,...visibleRows.map(r=>[r.event,r.page,r.detail,r.failure,r.count,el('from').value,el('to').value,data.timezone,note,data.captured_at])];
 const csv=lines.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n';
 if(exportUrl)URL.revokeObjectURL(exportUrl);
 exportUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 el('csv-preview').value=csv;el('save-csv').href=exportUrl;
 el('save-csv').download='maimai-private-usage-'+el('from').value+'-to-'+el('to').value+'.csv';
 el('export-dialog').showModal();
});
el('close-export').addEventListener('click',()=>el('export-dialog').close());
setRange();render();
})();
