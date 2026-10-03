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
    { title: string; artist: string; path: string; regions?: Record<string, { path: string }> }
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
  const jackets = new Map(
    data.catalog.flatMap((chart) => {
      const item = chart.song_id ? art?.songs?.[chart.song_id] : undefined;
      return item?.title === chart.title && item?.artist === chart.artist
        ? [[chart.chart_id, { songId: chart.song_id, path: item.path }] as const]
        : [];
    }),
  );
  function accepted(path: unknown): path is string {
    return (
      typeof path === 'string' && /^media\/[a-f0-9]{64}\.webp$/.test(path) && !!art?.assets?.[path]
    );
  }
  function jacket(chart: ArtworkChart): string | undefined {
    const item = jackets.get(chart.chart_id);
    if (!item || item.songId !== chart.song_id) return;
    return (
      (chart.song_id
        ? art?.songs?.[chart.song_id]?.regions?.[chart.view_region || 'JP']?.path
        : undefined) || item.path
    );
  }
  return Object.freeze({ accepted, jacket, version: (name: string) => art?.versions?.[name] });
}
