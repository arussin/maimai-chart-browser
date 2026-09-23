import type { Catalog, Values } from '../catalog-query';
// Explicit JP/INTL aliases; shared regression vectors: tests/fixtures/genre-aliases.json.
const genres: readonly [string, string, readonly string[]][] = [
  ['POPSアニメ', 'POPS & ANIME', ['POPS＆アニメ', 'POPS＆ANIME']],
  [
    'niconicoボーカロイド',
    'niconico & VOCALOID™',
    ['niconico＆ボーカロイド', 'niconico＆VOCALOID', 'niconico＆VOCALOID™', 'niconico & VOCALOID'],
  ],
  ['東方Project', '東方Project', ['Touhou Project']],
  ['ゲームバラエティ', 'GAME & VARIETY', ['ゲーム＆バラエティ', 'GAME＆VARIETY']],
  ['maimai', 'maimai', []],
  [
    'オンゲキCHUNITHM',
    'オンゲキ & CHUNITHM',
    ['オンゲキ＆CHUNITHM', 'ONGEKI＆CHUNITHM', 'ONGEKI & CHUNITHM'],
  ],
];
const labels = new Map(genres.map(([id, label]) => [id, label]));
const aliases = new Map(
  genres.flatMap(([id, label, raw]) =>
    [id, label, ...raw].map((value) => [value.normalize('NFKC').trim(), id]),
  ),
);
export function genreId(value: unknown) {
  const id =
    typeof value === 'string' &&
    aliases.get(
      value
        .replace(/^sega:/, '')
        .normalize('NFKC')
        .trim(),
    );
  if (!id) throw new Error('This catalog contains an unrecognized genre and needs review.');
  return id;
}
export function normalizeGenres<T extends Catalog & { schema_version: string }>(data: T): T {
  if (data.schema_version !== 'maimai-browser-catalog-2' || !data.navigation) return data;
  const navigation = data.navigation,
    referenced = new Set<string>(),
    remapped: [Values, string][] = [];
  for (const item of navigation.genres || []) genreId(item.id);
  function remap(row: Values) {
    const id = genreId(row.genre);
    remapped.push([row, id]);
    referenced.add(id);
  }
  for (const row of Object.values(navigation.charts || {})) remap(row);
  // The metadata toggle must not reintroduce a historical alias after normalization.
  for (const chart of data.catalog || []) {
    if (chart.chart_id !== undefined) genreId(navigation.charts?.[chart.chart_id]?.genre);
    for (const region of Object.values(chart.regional || {})) {
      if (Object.hasOwn(region, 'genre')) remap(region);
      if (Object.hasOwn(region.metadata || {}, 'catcode')) genreId(region.metadata?.catcode);
    }
  }
  // Validate everything before mutating any in-memory chart.
  for (const [row, id] of remapped) row.genre = id;
  navigation.genres = [...referenced].sort().map((id) => ({ id, label: labels.get(id)! }));
  return data;
}
