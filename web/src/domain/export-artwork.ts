import bundled from '../../../src/maimai_intelligence/assets/export-artwork/manifest.json' with { type: 'json' };
import type { ArtworkChart, createArtworkModel } from './artwork';

interface ExportArtworkManifest {
  version: string;
  jackets: Record<
    string,
    { title: string; artist: string; thumbnail: string | null; path: string }
  >;
  assets: Record<string, { sha256: string; bytes: number; width: number; height: number }>;
}

/** Load only for PNG generation. Reviewed display assets never establish chart identity. */
export function resolveExportJacket(
  artwork: ReturnType<typeof createArtworkModel>,
  chart: ArtworkChart,
  manifest: ExportArtworkManifest = bundled,
): string | undefined {
  const selection = artwork.identity(chart);
  if (!selection) return;
  const fallback = selection.thumbnail;
  // There is no reviewed CN artwork projection. Preserve its existing accepted image.
  if (!['JP', 'INTL'].includes(selection.region) || manifest.version !== 'score-export-jackets-2')
    return fallback;
  const entry = manifest.jackets?.[`${selection.songId}/${selection.region}`],
    asset = entry && manifest.assets?.[entry.path];
  return entry &&
    entry.title === selection.title &&
    entry.artist === selection.artist &&
    entry.thumbnail === (fallback ?? null) &&
    asset &&
    /^media\/[a-f0-9]{64}\.webp$/.test(entry.path) &&
    entry.path === `media/${asset.sha256}.webp` &&
    Number.isSafeInteger(asset.bytes) &&
    asset.bytes > 0 &&
    asset.bytes <= 512 * 1024 &&
    Number.isSafeInteger(asset.width) &&
    Number.isSafeInteger(asset.height) &&
    asset.width > 128 &&
    asset.height > 128 &&
    asset.width <= 512 &&
    asset.height <= 512
    ? entry.path
    : fallback;
}
