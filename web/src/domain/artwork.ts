/** Artwork is a display projection. It cannot authorize identity or regional membership. */
export interface ArtworkChart {
  chart_id: string;
  title: string;
  artist: string;
  song_id?: string;
  view_region?: string;
  [key: string]: unknown;
}
interface ArtworkManifest {
  version: string;
  songs?: Record<
    string,
    {
      title: string;
      artist: string;
      path: string;
      regions?: Record<string, { path: string; title?: string; artist?: string }>;
    }
  >;
  assets?: Record<string, unknown>;
  versions?: Record<string, string>;
}
function readArtwork(value: unknown): ArtworkManifest | undefined {
  if (!value || typeof value !== 'object') return;
  const manifest = value as Partial<ArtworkManifest>;
  if (manifest.version !== 'public-artwork-1') return;
  return manifest as ArtworkManifest;
}
export function createArtworkModel(data: { catalog: readonly ArtworkChart[]; artwork?: unknown }) {
  const art = readArtwork(data.artwork);
  const identities = new Map(data.catalog.map((chart) => [chart.chart_id, chart]));
  const jackets = new Map(
    data.catalog.flatMap((chart) => {
      const item = chart.song_id ? art?.songs?.[chart.song_id] : undefined;
      return item?.title === chart.title && item?.artist === chart.artist
        ? [[chart.chart_id, { ...item, songId: chart.song_id }] as const]
        : [];
    }),
  );
  function accepted(path: unknown): path is string {
    return (
      typeof path === 'string' && /^media\/[a-f0-9]{64}\.webp$/.test(path) && !!art?.assets?.[path]
    );
  }
  function selection(chart: ArtworkChart) {
    const item = jackets.get(chart.chart_id);
    if (!item || item.songId !== chart.song_id) return;
    const region = chart.view_region || 'JP',
      regional = item.regions?.[region];
    return {
      path: regional?.path || item.path,
      title: regional?.path ? (regional.title ?? item.title) : item.title,
      artist: regional?.path ? (regional.artist ?? item.artist) : item.artist,
      region,
    };
  }
  const jacket = (chart: ArtworkChart) => selection(chart)?.path;
  function identity(chart: ArtworkChart) {
    const canonical = identities.get(chart.chart_id);
    if (!canonical || canonical.song_id !== chart.song_id || !canonical.song_id) return;
    const region = chart.view_region || 'JP',
      projected = selection(chart);
    return {
      songId: canonical.song_id,
      title: projected?.title ?? canonical.title,
      artist: projected?.artist ?? canonical.artist,
      region,
      thumbnail: projected && accepted(projected.path) ? projected.path : undefined,
    };
  }
  return Object.freeze({
    accepted,
    jacket,
    selection,
    identity,
    version: (name: string) => art?.versions?.[name],
  });
}
