import bundled from '../../../src/maimai_intelligence/assets/version-artwork/manifest.json' with { type: 'json' };
import type { ArtworkPorts } from './chart-artwork';
import { createArtworkModel } from '../domain/artwork';
import { createChartArtwork } from './chart-artwork';

/** Global display assets; a song-scoped catalog must not restrict export choices. */
export function createScoreExportLogos(ports: Pick<ArtworkPorts, 'localization' | 'asset'>) {
  const data = { catalog: [], artwork: bundled },
    model = createArtworkModel(data),
    artwork = createChartArtwork({ ...ports, publicData: data, title: (chart) => chart.title });
  return Object.freeze({
    version: artwork.version,
    url(name: string) {
      const path = model.version(name);
      return model.accepted(path) ? ports.asset(path) : undefined;
    },
  });
}
