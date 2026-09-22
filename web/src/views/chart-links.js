/** Existing DOM behavior with explicit module dependencies. */
export function createChartLinks(ports) {
let chartLinks;
/* Searches use public chart metadata; no video is fetched or presumed verified. */
(()=>{'use strict';
const i18n=ports.localization||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

let playerLinks=null,identityVersion=1;
function configure(index){identityVersion=index?.version==='mai-notes-links-2'?2:1;playerLinks=['mai-notes-links-1','mai-notes-links-2'].includes(index?.version)?index.charts:null;}
function youtube(chart){
  const title=chart.title?.trim();if(!title)return null;
  const description=[title,chart.format,chart.difficulty].filter(Boolean).join(' ');
  const url=new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query','maimai '+description);
  const link=document.createElement('a');link.className='youtube-search';link.onclick=()=>ports.usage?.emit('resource_opened',undefined,'youtube');
  link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
  i18n.text(link, 'YouTube search ↗');
  i18n.attribute(link, 'aria-label', 'YouTube search for '+description+' (opens in a new tab)');
  i18n.attribute(link, 'title', 'Search for this chart on YouTube; results may include other versions.');
  return link;
}
function maiNotes(chart){
  const record=playerLinks?.[chart.chart_id];
  if(!record||(identityVersion===1&&(!chart.source_hash||record.source_hash!==chart.source_hash))||record.format!==chart.format||record.difficulty!==chart.difficulty||
      typeof record.id!=='string'||!(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/).test(record.id))return null;
  const link=document.createElement('a');link.className='mai-notes-player';link.onclick=()=>ports.usage?.emit('resource_opened',undefined,'mai_notes');
  link.href='https://mai-notes.com/player.html?chart='+record.id;
  link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
  i18n.text(link, 'mai-notes simai player ↗');
  i18n.attribute(link, 'aria-label', 'mai-notes simai player for '+[chart.title,chart.format,chart.difficulty].join(' ')+' (opens in a new tab)');
  return link;
}
function group(chart){
  const links=[youtube(chart),maiNotes(chart)].filter(Boolean);
  if(!links.length)return null;
  const row=document.createElement('div');row.className='chart-external-links';row.append(...links);return row;
}
chartLinks=Object.freeze({youtube,maiNotes,group,configure});
})();

return chartLinks;
}
