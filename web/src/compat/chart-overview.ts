import { createAnalysisModel } from '../domain/analysis-model';
import type { PublicCatalog } from '../runtime/catalog';
import { createChartSections } from '../components/chart-sections';
import { sectionPreferences } from '../runtime/section-preferences';
import type { TextView } from '../components/chart-card';
import { createChartOverview, type OverviewPorts } from '../views/chart-overview.js';
import * as query from '../catalog-query';
const facade = (globalThis.window ?? globalThis) as unknown as Record<string, unknown>;
const publicData = (facade.maimaiResearchCatalog ??
  JSON.parse(document.getElementById('challenge-data')!.textContent!)) as PublicCatalog;
const analysis = createAnalysisModel(publicData.analysis, publicData.catalog);
// The public analysis entry point also supports DOM-free Python parity checks.
const overview = document.body
  ? createChartOverview({
      root: document.body,
      definitions: JSON.parse(document.getElementById('pattern-data')!.textContent!),
      sections: createChartSections(
        document.body,
        { chart: true, player: true },
        (facade.maimaiI18n as Pick<TextView, 'text'>) || {
          text: (node, value) => {
            node.textContent = String(value);
          },
        },
        sectionPreferences('maimai-chart-sections-v1'),
      ),
      localization: facade.maimaiI18n as OverviewPorts['localization'],
      publicData,
      analysis,
      catalogDetails: facade.maimaiCatalogDetails as OverviewPorts['catalogDetails'],
      catalogQuery: query,
      patternLibrary: facade.maimaiPatternLibrary as OverviewPorts['patternLibrary'],
    })
  : Object.freeze({
      ...analysis,
      patternIds: publicData.analysis?.patterns ?? [],
      definition: (id: string) => publicData.analysis?.definitions?.[id] ?? null,
    });
Object.assign(facade, { maimaiChartOverview: overview });
