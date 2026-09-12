/* Searches use public chart metadata; no video is fetched or presumed verified. */
(()=>{'use strict';
function youtube(chart){
  const title=chart.title?.trim();if(!title)return null;
  const description=[title,chart.format,chart.difficulty].filter(Boolean).join(' ');
  const url=new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query','maimai '+description);
  const link=document.createElement('a');link.className='youtube-search';
  link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
  link.textContent='YouTube search ↗';
  link.setAttribute('aria-label','YouTube search for '+description+' (opens in a new tab)');
  link.title='Search for this chart on YouTube; results may include other versions.';
  return link;
}
window.maimaiChartLinks=Object.freeze({youtube});
})();
