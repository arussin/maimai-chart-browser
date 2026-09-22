import {createChartOverview} from '../views/chart-overview.js';
import * as query from '../catalog-query';
const facade=(globalThis.window??globalThis) as unknown as Record<string,unknown>;
Object.assign(facade,{maimaiChartOverview:createChartOverview({browserState:{sections:{chart:true,player:true}},localization:facade.maimaiI18n,publicData:facade.maimaiResearchCatalog,catalogDetails:facade.maimaiCatalogDetails,catalogQuery:query,patternLibrary:facade.maimaiPatternLibrary,playerContext:facade.maimaiPlayerContext,usage:undefined})});
