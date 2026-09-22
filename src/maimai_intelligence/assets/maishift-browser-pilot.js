/* Included only by the separate browser pilot build. No URL flag enables this. */
(()=>{'use strict';
if(globalThis.maimaiPlayerContext)return;
if(!location.pathname.endsWith('/pilot/maishift/browser/')&&!location.pathname.endsWith('/pilot/maishift/browser/index.html'))return;
Object.defineProperty(globalThis,'maimaiPlayerContext',{value:Object.freeze({pilot:true,key:name=>'maimai-pilot-maishift-v1:'+name})});
const i18n=window.maimaiI18n,banner=document.createElement('aside');banner.id='maishift-browser-pilot';banner.className='maishift-browser-pilot';
const title=document.createElement('strong'),description=document.createElement('span');
i18n.text(title,'Maishift browser preview');i18n.text(description,'Test scores are saved separately from the main site.');
banner.append(title,description);document.querySelector('main').prepend(banner);
})();
