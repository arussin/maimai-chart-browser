import { createView, regionalValues, type ChartNavigation } from '../catalog-query.ts';
import { normalizeGenres } from './catalog-genres.ts';
import type { CatalogChart, PublicCatalog } from '../runtime/catalog';

/** A song owns its regional projection; it never inherits browser filters or sorting. */
export function createSongModel(data: PublicCatalog, songID: string) {
  const charts = data.catalog.filter((chart) => chart.song_id === songID);
  const canonical = normalizeGenres(
    createView({
      ...data,
      catalog: charts,
      navigation: {
        ...data.navigation,
        charts: Object.fromEntries(
          charts.map((chart) => [chart.chart_id, data.navigation?.charts?.[chart.chart_id] || {}]),
        ),
      },
    }),
  );
  return (international: boolean) => {
    const records: Record<string, ChartNavigation> = {};
    const charts = canonical.catalog.map((chart) => {
      const projected = regionalValues(
        chart,
        canonical.navigation.charts[chart.chart_id],
        international,
      );
      records[chart.chart_id] = projected.navigation;
      return { ...chart, ...projected.fields };
    });
    return {
      charts,
      genre: (value: string) =>
        canonical.navigation.genres?.find((row) => row.id === value)?.label || 'Uncategorized',
      choices: (chart: CatalogChart) =>
        charts.filter(
          (other) =>
            other.format === chart.format &&
            (other.variant_id || 'ordinary') === (chart.variant_id || 'ordinary'),
        ),
      folder: (chart: CatalogChart, key: 'genre' | 'version') =>
        records[chart.chart_id]?.[key] || 'unknown',
      constant: (chart: CatalogChart) => {
        const record = records[chart.chart_id],
          value = record?.chart_constant;
        return (chart.variant_id
          ? record?.chart_id === chart.chart_id
          : record?.source_hash === chart.source_hash) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value > 0 &&
          value <= 15
          ? value
          : null;
      },
      constantSource: (chart: CatalogChart) =>
        records[chart.chart_id]?.metric_sources?.chart_constant,
      bpm: (chart: CatalogChart) => records[chart.chart_id]?.bpm ?? null,
    };
  };
}
