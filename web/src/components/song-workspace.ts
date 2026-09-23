import {
  createChartCard,
  type ChartSummary,
  type ChartCardPresentation,
  type ChartCardComponents,
} from './chart-card';
import type { UsageAPI } from '../usage';

export interface SongWorkspaceModel<C extends ChartSummary> {
  charts: readonly C[];
  choices(chart: C): readonly C[];
  presentation: ChartCardPresentation<C>;
  components: ChartCardComponents<C>;
}
export interface SongWorkspaceActions {
  compare(chart: string): void;
  similar(chart: string): void;
  changed(listener: () => void): () => unknown;
  usage: Pick<UsageAPI, 'emit'>;
}
/** Owns only the current song's disclosure/difficulty choices, never browser filters. */
export class SongWorkspace<C extends ChartSummary> {
  private readonly expanded = new Set<string>();
  private readonly selected = new Map<string, string>();
  private readonly rows: HTMLElement;
  private readonly unsubscribe: () => unknown;
  private disposed = false;
  private international: boolean;
  constructor(
    private readonly root: HTMLElement,
    private readonly model: (international: boolean) => SongWorkspaceModel<C>,
    private readonly actions: SongWorkspaceActions,
    international: boolean,
  ) {
    this.international = international;
    this.rows = document.createElement('div');
    this.rows.className = 'songs song-workspace';
    const fallback = root.querySelector<HTMLElement>('.seo-table');
    if (!fallback) throw Error('Missing public chart fallback');
    fallback.after(this.rows);
    fallback.hidden = true;
    const first = model(international).charts[0];
    if (first) this.expanded.add(first.chart_id);
    this.render();
    this.unsubscribe = actions.changed(() => this.render());
  }
  region(international: boolean) {
    if (this.international === international) return;
    this.international = international;
    this.render();
  }
  private render() {
    if (this.disposed) return;
    const { charts, choices, presentation, components } = this.model(this.international);
    this.rows.replaceChildren();
    if (!charts.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      components.localization.text(
        empty,
        'The linked chart is unavailable in this catalog version. Search for the song below.',
      );
      this.rows.append(empty);
      return;
    }
    for (const [index, original] of charts.entries()) {
      const candidates = choices(original),
        key = original.chart_id,
        chart = candidates.find((c) => c.chart_id === this.selected.get(key)) ?? original;
      this.rows.append(
        createChartCard(
          { chart, choices: candidates, key, domKey: 'song-' + index },
          presentation,
          components,
          {
            expanded: () => this.expanded.has(key),
            expand: (value) => {
              if (value) this.expanded.add(key);
              else this.expanded.delete(key);
            },
            select: (id) => this.selected.set(key, id),
            compare: this.actions.compare,
            similar: this.actions.similar,
            usage: this.actions.usage,
          },
        ),
      );
    }
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.rows.remove();
    const fallback = this.root.querySelector<HTMLElement>('.seo-table');
    if (fallback) fallback.hidden = false;
  }
}
