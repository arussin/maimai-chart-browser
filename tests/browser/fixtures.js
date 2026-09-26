import {test as base, expect} from '@playwright/test';
import {isolatedTest} from './isolation.mjs';
const isolated = isolatedTest(base, {origins: [`http://127.0.0.1:${process.env.MAIMAI_TEST_PORT || 8766}`]});
// Compatibility names belong only to the test harness; deployed entries expose no service globals.
export const test = isolated.extend({
 context: async ({context}, use) => {
  await context.addInitScript(mapping=>{
   addEventListener('DOMContentLoaded',async()=>{
    const entry=document.querySelector('script[data-maimai-browser]');if(!entry)return;
    const {usage}=await import(entry.src);Object.defineProperty(window,'maimaiUsage',{configurable:true,writable:true,value:usage});
   });
   addEventListener('maimai:browser-ready',async()=>{
    const entry=document.querySelector('script[data-maimai-browser]');if(!entry)return;
    const {loadApplication}=await import(entry.src),application=await loadApplication();
    for(const [name,key]of Object.entries(mapping))Object.defineProperty(window,name,{configurable:true,writable:true,value:application.services[key]});
   });
  },{"maimaiI18n": "localization", "maimaiSettings": "settings", "maimaiPlayerRanges": "playerRanges", "maimaiPlayerData": "playerCore", "maimaiPlayerMaishift": "maishift", "maimaiPlayerSources": "playerSources", "maimaiPlayerStorage": "playerStorage", "maimaiPersonal": "personal", "maimaiChartVisuals": "visuals", "maimaiPatternLibrary": "patternLibrary", "maimaiChallengeMatching": "matching", "maimaiChartLinks": "chartLinks", "maimaiChartArtwork": "artwork", "maimaiFilterDisclosure": "filterDisclosure", "maimaiCatalogFilters": "catalogFilters", "maimaiChartOverview": "overview", "maimaiPatternFilter": "patternFilter", "maimaiRegistryBrowser": "registry", "maimaiChartComparison": "comparison", "maimaiBrowserState": "browserState", "maimaiPreviewField": "previewField", "maimaiSongSearch": "songSearch", "maimaiResearchCatalog": "publicData", "maimaiCatalogDetails": "catalogDetails", "maimaiCatalogQuery": "catalogQuery", "maimaiPlayerSession": "playerDomain", "maimaiSongPages": "songPages", "maimaiUsage": "usage", "maimaiViews": "views", "maimaiPlayerFeatures": "features", "maimaiPlayerContext": "playerContext"});
  await use(context);
 }
});
export {expect};
