/** Public identity is stable. Regional preferences produce disposable view projections. */
export type Values = Record<string, unknown>;
export interface Regional extends Values {
  metadata?: Values;
}
export interface Chart extends Values {
  chart_id: string;
  title: string;
  artist: string;
  level?: string;
  title_state?: string;
  regional?: Record<string, Regional>;
}
export interface ChartNavigation extends Values {
  chart_id?: string;
  source_hash?: string;
  source_path?: string;
  chart_constant?: number;
  bpm?: number | null;
  genre?: string;
  version?: string;
  metric_sources?: Record<string, { provider: string; region: string; release?: string }>;
}
export interface Navigation extends Values {
  charts: Record<string, ChartNavigation>;
  genres?: { id: string; label: string }[];
  versions?: string[];
}
export interface Catalog extends Values {
  catalog: Chart[];
  navigation?: Navigation;
}
const known = (value: unknown) =>
  value !== null && value !== undefined && value !== '' && value !== 'unknown';
export function createView<T extends Catalog>(data: T): T {
  return {
    ...data,
    catalog: data.catalog.map((c) => ({
      ...c,
      regional:
        c.regional &&
        Object.fromEntries(
          Object.entries(c.regional).map(([region, row]) => [
            region,
            { ...row, metadata: row.metadata && { ...row.metadata } },
          ]),
        ),
    })),
    navigation: data.navigation && {
      ...data.navigation,
      charts: Object.fromEntries(
        Object.entries(data.navigation.charts).map(([id, row]) => [id, { ...row }]),
      ),
      genres: data.navigation.genres?.map((row) => ({ ...row })),
    },
  };
}
export function regionalValues(chart: Chart, navigation: Values, international: boolean) {
  const fields: Values = {
    title: chart.title,
    artist: chart.artist,
    level: chart.level,
    title_state: chart.title_state,
    metadata_region: chart.metadata_region,
    view_region: international ? 'INTL' : 'JP',
  };
  const nav = { ...navigation };
  if (international) {
    const entry = chart.regional?.INTL;
    for (const field of ['title', 'artist'])
      if (known(entry?.metadata?.[field])) fields[field] = entry?.metadata?.[field];
    if (known(entry?.metadata?.title)) {
      fields.metadata_region = 'INTL';
      if (entry?.metadata?.title !== chart.title)
        fields.title_state = String(entry?.metadata?.title).trim() ? 'present' : 'missing';
    }
    if (known(entry?.level)) fields.level = entry?.level;
    for (const field of ['genre', 'version'])
      if (
        known(entry?.metadata?.[field === 'genre' ? 'catcode' : 'version']) &&
        known(entry?.[field])
      )
        nav[field] = entry?.[field];
    for (const [field, scopes] of Object.entries(
      (navigation.regional_metrics ?? {}) as Record<string, Values>,
    )) {
      if (!known(scopes.INTL)) continue;
      nav[field] = scopes.INTL;
      const source = (navigation.regional_metric_sources as Record<string, Values> | undefined)?.[
        field
      ]?.INTL;
      if (source) nav.metric_sources = { ...(nav.metric_sources as Values), [field]: source };
    }
  }
  return { fields, navigation: nav };
}
export function titleLabel(chart: Pick<Chart, 'title' | 'title_state'>, locale = 'en'): string {
  const translations: Record<string, [string, string]> = {
    en: ['Untitled (intentional)', 'Title unavailable'],
    ja: ['無題（意図的な空欄）', '曲名不明'],
    ko: ['무제 (의도적 공백)', '제목 정보 없음'],
    'zh-Hans': ['无题（有意留空）', '曲名未知'],
  };
  const labels = translations[locale] ?? translations.en;
  return chart.title_state === 'intentional_blank'
    ? labels[0]
    : chart.title_state === 'missing'
      ? labels[1]
      : chart.title;
}
