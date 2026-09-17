/* Display-only artwork from the verified public catalog, with same-site images only. */
(()=>{'use strict';
const data=window.maimaiResearchCatalog??=JSON.parse(document.getElementById('challenge-data').textContent),art=data.artwork;
const jackets=new Map(data.catalog.filter(c=>{const item=art?.songs?.[c.song_id];return item?.title===c.title&&item?.artist===c.artist;}).map(c=>[c.chart_id,{songId:c.song_id,path:art.songs[c.song_id].path}]));
function image(path,className,label){
  const box=document.createElement('span');box.className=className+' artwork-missing';
  box.title=label+' unavailable';box.setAttribute('role','img');box.setAttribute('aria-label',label+' unavailable');
  if(className==='song-jacket')box.textContent='♪';
  if(art?.version!=='public-artwork-1'||!/^media\/[a-f0-9]{64}\.webp$/.test(path||'')||!art.assets?.[path])return box;
  const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
  img.onload=()=>{box.classList.remove('artwork-missing');box.title=label;box.setAttribute('aria-label',label);};
  img.onerror=()=>{img.remove();box.classList.add('artwork-missing');box.title=label+' unavailable';box.setAttribute('aria-label',label+' unavailable');if(className==='song-jacket')box.textContent='♪';};
  box.replaceChildren(img);img.src=path;return box;
}
function jacket(chart){const item=jackets.get(chart.chart_id);return image(item?.songId===chart.song_id?item.path:null,'song-jacket','Jacket for '+chart.title);}
function version(name){const box=image(art?.versions?.[name],'version-logo',name+' logo');box.setAttribute('aria-hidden','true');box.removeAttribute('role');box.removeAttribute('aria-label');return box;}
window.maimaiChartArtwork=Object.freeze({jacket,version});
})();
