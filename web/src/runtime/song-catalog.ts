import type { PublicCatalog } from './catalog';
import { PublicReader, decodeJSON, MiB, singleReference } from './verified-data';
export interface SongReference {
  song: string;
  catalog: string;
  asset: unknown;
}
/** Validate the independently pinned song projection before any view or player join sees it. */
export async function loadSongCatalog(
  reader: PublicReader,
  ref: SongReference,
): Promise<PublicCatalog> {
  const asset = singleReference(ref.asset, 'song-catalog', 8 * MiB);
  if (!ref.song || !/^[a-f0-9]{64}$/.test(ref.catalog))
    throw Error('Invalid song catalog reference');
  const value = decodeJSON<{
    schema_version: string;
    song_id: string;
    source_song_ids: string[];
    data: PublicCatalog;
  }>(await reader.verified(asset));
  const data = value?.data;
  if (
    value?.schema_version !== 'maimai-song-catalog-1' ||
    value.song_id !== ref.song ||
    !Array.isArray(value.source_song_ids) ||
    !value.source_song_ids.includes(ref.song) ||
    !data ||
    data.source_catalog_sha256 !== ref.catalog ||
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
  for (const records of [data.navigation.charts, data.snippets, data.analysis?.charts])
    if (records && Object.keys(records).some((id) => !ids.has(id)))
      throw Error('Unrelated song records');
  for (const mapping of [data.provider_mapping, data.maishift_mapping])
    if (mapping && Object.values(mapping.charts).some((row) => !ids.has(row.chart_id)))
      throw Error('Unrelated song mapping');
  return data;
}
