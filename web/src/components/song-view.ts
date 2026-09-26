import { SongWorkspace } from './song-workspace';
import { createSongModel } from '../domain/song-model';
import { titleLabel } from '../catalog-query';
import type { PublicCatalog, CatalogChart } from '../runtime/catalog';
import type { ChartCardComponents } from './chart-card';
import type { SongWorkspaceModel } from './song-workspace';
import type { UsageAPI } from '../usage';
export interface SongViewPorts {
  data: PublicCatalog;
  components: ChartCardComponents<CatalogChart>;
  romaji(chart: CatalogChart): string;
  compare(id: string, similar: boolean): void;
  changed(listener: () => void): () => unknown;
  usage: UsageAPI;
}
/** A song uses the same cards and player session without constructing the whole browser. */
export function mountSongView(root: HTMLElement, international: boolean, ports: SongViewPorts) {
  const songID = root.querySelector<HTMLElement>('[data-song-id]')?.dataset.songId;
  if (!songID) throw Error('Missing public song identity');
  const song = createSongModel(ports.data, songID);
  const i18n = ports.components.localization;
  const difficulties = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
  const model = (international: boolean): SongWorkspaceModel<CatalogChart> => {
    const projection = song(international);
    return {
      charts: projection.charts,
      choices: projection.choices,
      presentation: {
        title: (chart) =>
          titleLabel(chart, i18n.locale) || (chart.title.trim() ? chart.title : '〈Blank title〉'),
        patterns: () => [],
        folder: projection.folder,
        constant: projection.constant,
        constantSource: projection.constantSource,
        bpm: projection.bpm,
        speed: (chart) => chart.demand?.cadence?.mean_onsets_s ?? null,
        romaji: ports.romaji,
        difficultyRank: (chart) => {
          const rank = difficulties.indexOf(chart.difficulty.toUpperCase());
          return rank < 0 ? null : rank;
        },
        genre: projection.genre,
      },
      components: ports.components,
    };
  };
  return new SongWorkspace(
    root,
    model,
    {
      compare: (id) => ports.compare(id, false),
      similar: (id) => ports.compare(id, true),
      changed: ports.changed,
      usage: ports.usage,
    },
    international,
  );
}
