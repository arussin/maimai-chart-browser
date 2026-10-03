import type { PublicCatalog } from './catalog';
import {
  PublicReader,
  decodeJSON,
  MiB,
  singleReference,
  type SingleVerifiedRef,
} from './verified-data';
interface SongBinding extends SingleVerifiedRef {
  schema_version: string;
  source_catalog_sha256: string;
  song_id: string;
  source_song_ids: string[];
}
export interface SongReference {
  song: string;
  catalog: string;
  asset?: unknown;
  binding?: unknown;
}
const validScope = (scope: unknown): scope is string[] =>
  Array.isArray(scope) &&
  scope.length > 0 &&
  scope.length <= 256 &&
  scope.every((id) => typeof id === 'string' && id.length > 0) &&
  new Set(scope).size === scope.length;

/** The trusted page binds release membership; immutable content retains canonical identities. */
export async function loadSongCatalog(
  reader: PublicReader,
  ref: SongReference,
): Promise<PublicCatalog> {
  if (!ref.song || !/^[a-f0-9]{64}$/.test(ref.catalog))
    throw Error('Invalid song catalog reference');
  let binding: SongBinding | undefined;
  if (ref.binding !== undefined) {
    if (!ref.binding || typeof ref.binding !== 'object') throw Error('Invalid song binding');
    binding = ref.binding as SongBinding;
    if (
      binding.schema_version !== 'maimai-song-binding-1' ||
      binding.source_catalog_sha256 !== ref.catalog ||
      binding.song_id !== ref.song ||
      !validScope(binding.source_song_ids) ||
      !binding.source_song_ids.includes(ref.song)
    )
      throw Error('Invalid song binding');
  }
  const asset = singleReference(binding ?? ref.asset, 'song-catalog', 8 * MiB);
  const value = decodeJSON<{
    schema_version: string;
    song_id: string;
    source_song_ids: string[];
    data: PublicCatalog;
  }>(await reader.verified(asset));
  const data = value?.data;
  const legacy =
    !binding &&
    value?.schema_version === 'maimai-song-catalog-1' &&
    data?.source_catalog_sha256 === ref.catalog;
  const shared =
    binding &&
    value?.schema_version === 'maimai-song-catalog-2' &&
    data &&
    !('source_catalog_sha256' in data) &&
    validScope(value.source_song_ids) &&
    value.source_song_ids.length === binding.source_song_ids.length &&
    value.source_song_ids.every((id, index) => id === binding.source_song_ids[index]);
  if (
    !(legacy || shared) ||
    value.song_id !== ref.song ||
    !validScope(value.source_song_ids) ||
    !value.source_song_ids.includes(ref.song) ||
    !data ||
    !['maimai-browser-catalog-1', 'maimai-browser-catalog-2'].includes(data.schema_version) ||
    !Array.isArray(data.catalog) ||
    !data.catalog.length ||
    data.catalog.length > 256 ||
    !data.navigation ||
    !data.snippets ||
    data.detail_buckets ||
    data.index_schema_version
  )
    throw Error('Invalid song catalog');
  const ids = new Set<string>();
  for (const chart of data.catalog) {
    if (
      !chart ||
      typeof chart.chart_id !== 'string' ||
      !chart.chart_id ||
      ids.has(chart.chart_id) ||
      !value.source_song_ids.includes(chart.song_id) ||
      (!(data.schema_version === 'maimai-browser-catalog-2' && chart.source_hash === undefined) &&
        (typeof chart.source_hash !== 'string' || !chart.source_hash)) ||
      typeof chart.title !== 'string' ||
      typeof chart.artist !== 'string' ||
      typeof chart.format !== 'string' ||
      typeof chart.difficulty !== 'string' ||
      chart.detail_bucket
    )
      throw Error('Invalid song chart identity');
    ids.add(chart.chart_id);
  }
  if (
    binding &&
    new Set(data.catalog.map((chart) => chart.song_id)).size !== binding.source_song_ids.length
  )
    throw Error('Incomplete song scope');
  for (const records of [data.navigation.charts, data.snippets, data.analysis?.charts])
    if (records && Object.keys(records).some((id) => !ids.has(id)))
      throw Error('Unrelated song records');
  for (const mapping of [data.provider_mapping, data.maishift_mapping])
    if (mapping && Object.values(mapping.charts).some((row) => !ids.has(row.chart_id)))
      throw Error('Unrelated song mapping');
  return binding ? { ...data, source_catalog_sha256: ref.catalog } : data;
}
