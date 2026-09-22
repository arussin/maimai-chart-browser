import {createLocalization} from './views/localization.js';
import {createSongSearch} from './views/song-search.js';
import {createSettingsMenu} from './views/settings-menu.js';
import {createPlayerRanges} from './views/player-ranges.js';
import {createPlayerDataCore} from './views/player-data-core.js';
import {createPlayerMaishift} from './views/player-maishift.js';
import {createPlayerSources} from './views/player-sources.js';
import {createPlayerStorage} from './views/player-storage.js';
import {createPlayerData} from './views/player-data.js';
import {createFeatureAnnouncements} from './views/feature-announcements.js';
import {createSupportClient} from './views/support-client.js';
import {createSupportStripe} from './views/support-stripe.js';
import {createChartVisuals} from './views/chart-visuals.js';
import {createPatternLibrary} from './views/pattern-library.js';
import {createChallengeMatching} from './views/challenge-matching.js';
import {createChartLinks} from './views/chart-links.js';
import {createChartArtwork} from './views/chart-artwork.js';
import {createChartFilters} from './views/chart-filters.js';
import {createChartOverview} from './views/chart-overview.js';
import {createPatternFilter} from './views/pattern-filter.js';
import {createRegistryBrowser} from './views/registry-browser.js';
import {createChartComparison} from './views/chart-comparison.js';
import {createChallengeReview} from './views/challenge-review.js';
import type supportConfig from '../../src/maimai_intelligence/assets/support-config.json';
import {createAnalytics} from './views/analytics.js';
import * as catalogQuery from './catalog-query';
import * as playerDomain from './player-session';
import {createTabs} from './runtime/tabs';
import {BrowserState} from './runtime/browser-state';
import {historyPort} from './runtime/history';
import {loadCatalog,type PublicCatalog} from './runtime/catalog';
import {PublicReader,decodeJSON} from './runtime/verified-data';
import type {NavigationCoordinator} from './runtime/navigation';
import type {UsageAPI} from './usage';
import type {BrowserPort,BrowserSnapshot,LocalizationPort,PageMetadata} from './runtime/contracts';
export interface BrowserConfiguration {
 messages:Record<string,unknown>;flags:Record<string,string>;search:unknown;theme:unknown;lessons:unknown;
 features:{maishift:boolean};pilot:boolean;support:typeof supportConfig;
}
export interface Application {browser:BrowserPort;localization:LocalizationPort;services:Record<string,unknown>}
export interface ApplicationOptions {configuration?:BrowserConfiguration;data?:PublicCatalog;usage:UsageAPI;navigation:NavigationCoordinator;onLocalization:(value:LocalizationPort)=>void}
async function mountShell(reader:PublicReader):Promise<PageMetadata|undefined>{
 if(document.querySelector('main:not([data-seo-page])'))return;
 const bytes=await reader.read('browser-shell.html',2*1024*1024);
 const parsed=new DOMParser().parseFromString(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'text/html');
 const shell=parsed.querySelector<HTMLTemplateElement>('template[data-browser-shell]');
 if(!shell)throw Error('The research browser could not start.');
 const wrapper=document.createElement('div');wrapper.dataset.versionBrowser='';wrapper.hidden=true;wrapper.append(document.importNode(shell.content,true));
 for(const node of wrapper.querySelectorAll<HTMLElement>('[src],[href]'))for(const key of ['src','href']){const value=node.getAttribute(key);if(value&&!value.startsWith('#'))node.setAttribute(key,new URL(value,reader.base).href);}
 document.body.append(wrapper);
 for(const sheet of parsed.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')){
  const url=new URL(sheet.getAttribute('href')!,reader.base);
  if(url.origin!==location.origin)throw Error('Invalid public data reference');
  if([...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].some(node=>new URL(node.href).pathname===url.pathname))continue;
  const copy=sheet.cloneNode(true) as HTMLLinkElement;copy.href=url.href;document.head.append(copy);
 }
 return {title:parsed.title,language:parsed.documentElement.lang,nodes:[...parsed.head.querySelectorAll('link[rel=canonical],link[rel=alternate][hreflang],meta[name=description],meta[property^="og:"],meta[name^="twitter:"]')].map(node=>node.cloneNode(true) as Element)};
}
/** The same dependency graph builds the hosted and self-contained offline applications. */
export async function createApplication(options:ApplicationOptions):Promise<Application>{
 const {usage,navigation}=options,reader=new PublicReader(new URL(document.querySelector<HTMLMetaElement>('meta[name=maimai-browser-base]')?.content||'.',location.href));
 const metadata=await mountShell(reader),browserState=new BrowserState();
 const configuration=options.configuration??decodeJSON<BrowserConfiguration>(await reader.read('browser-config.json',4*1024*1024));
 const catalogJob=options.data?Promise.resolve({canonical:options.data,data:options.data,details:undefined,latest:true,version:''}):loadCatalog(reader,new URLSearchParams(location.search).get('version'));
 const localization=createLocalization({configuration}) as LocalizationPort&{text:(node:Node,value:string)=>void};options.onLocalization(localization);
 const settings=createSettingsMenu({localization,usage});
 const views=createTabs(navigation,localization);
 const playerContext=configuration.pilot?Object.freeze({pilot:true,key:(name:string)=>'maimai-pilot-maishift-v1:'+name}):undefined;
 if(configuration.pilot){
  const banner=document.createElement('aside');banner.id='maishift-browser-pilot';banner.className='maishift-browser-pilot';
  const title=document.createElement('strong'),description=document.createElement('span');localization.text(title,'Maishift browser preview');localization.text(description,'Test scores are saved separately from the main site.');banner.append(title,description);document.querySelector('main')!.prepend(banner);
 }
 const playerCore=createPlayerDataCore({}),maishift=createPlayerMaishift({playerCore});
 const playerSources=createPlayerSources({playerContext,playerCore,features:configuration.features,maishift});
 const playerStorage=createPlayerStorage({playerContext});
 const playerRanges=createPlayerRanges({usage,localization,maishift});
 const {filterDisclosure,catalogFilters}=createChartFilters({browserState,localization,playerContext,usage});
 // Private imports and settings remain usable even while public catalog data is unavailable.
 let overview:ReturnType<typeof createChartOverview>;
 const personal=createPlayerData({browserState,overview:{section:(...args:unknown[])=>overview.section(...args)},filterDisclosure,localization,playerContext,playerCore,maishift,playerRanges,playerDomain,playerSources,playerStorage,settings,songPages:navigation,usage,historyPort});
 if(!configuration.pilot){
  createFeatureAnnouncements({localization,playerSources,settings});
  const supportClient=createSupportClient({supportConfig:configuration.support});
  createSupportStripe({localization,supportClient,historyPort});
  createAnalytics({localization,settings,historyPort});
 }
 const loaded=await catalogJob,publicData=loaded.data,catalogDetails=loaded.details;
 const songSearch=createSongSearch({configuration}),visuals=createChartVisuals({configuration}),matching=createChallengeMatching({});
 const chartLinks=createChartLinks({localization,usage});
 const artwork=createChartArtwork({catalogQuery,localization,publicData,songPages:navigation});
 let patternLibrary:ReturnType<typeof createPatternLibrary>,previewField:ReturnType<typeof createChallengeReview>['previewField'];
 overview=createChartOverview({browserState,catalogDetails,catalogQuery,localization,patternLibrary:{show:(...args:unknown[])=>patternLibrary.show(...args)},playerContext,publicData,usage});
 patternLibrary=createPatternLibrary({overview,localization,previewField:(...args:unknown[])=>previewField!(...args),usage,configuration});
 const patternFilter=createPatternFilter({browserState,localization,usage}),registry=createRegistryBrowser({browserState,catalogQuery,localization,usage});
 const comparison=createChartComparison({browserState,catalogQuery,matching,artwork,chartLinks,overview,localization,personal,registry,songSearch,usage,historyPort});
 const controller=navigation.silent(()=>createChallengeReview({browserState,catalogFilters,catalogQuery,artwork,comparison,chartLinks,overview,filterDisclosure,localization,patternFilter,patternLibrary,personal,registry,publicData,songPages:navigation,songSearch,usage,views,historyPort,onPreviewField:(value:typeof previewField)=>{previewField=value;}}));
 previewField=controller.previewField;
 if(!controller.browserState)throw Error('The research browser could not start.');
 const browser:BrowserPort=Object.freeze({capture:()=>browserState.capture(),restore:(value:BrowserSnapshot)=>browserState.restore(value),version:(value:string)=>browserState.version(value),open:()=>browserState.open(),ready:personal.ready});
 navigation.attach(browser,metadata);
 document.querySelectorAll<HTMLElement>('main[data-seo-page],body>.site-header').forEach(node=>{if(metadata)node.hidden=true;});
 const wrapper=document.querySelector<HTMLElement>('[data-version-browser]');if(wrapper){wrapper.hidden=false;document.documentElement.classList.remove('seo-static');}
 const status=document.getElementById('lab-status');
 if(status&&!status.dataset.catalogError){localization.text(status,'');if(!loaded.latest){localization.text(status,'You are viewing an older catalog. ');const link=document.createElement('a'),latest=new URL(location.href);latest.searchParams.delete('version');link.href=latest.href;localization.text(link,'Open the latest catalog');status.append(link);}}
 window.dispatchEvent(new Event('maimai:browser-ready'));
 return {browser,localization,services:{localization,settings,views,playerRanges,playerCore,maishift,playerSources,playerStorage,playerDomain,personal,visuals,patternLibrary,matching,chartLinks,artwork,filterDisclosure,catalogFilters,overview,patternFilter,registry,comparison,browserState:browser,previewField,publicData:loaded.canonical,catalogDetails,catalogQuery,songPages:navigation,songSearch,usage,features:configuration.features,playerContext}};
}
