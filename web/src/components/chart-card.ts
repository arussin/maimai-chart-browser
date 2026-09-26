import type { UsageAPI } from '../usage';
import type { Locale } from '../runtime/contracts';

export type LocalizedText =
  | string
  | number
  | { literal: string }
  | { parts: LocalizedText[]; separator: string }
  | { message: string; values: LocalizedText[] };
export interface TextView {
  readonly locale: Locale;
  text(node: Node, value: LocalizedText): void;
  attribute(node: Element, name: string, value: LocalizedText): void;
  verbatim(value: unknown): LocalizedText;
  parts(values: LocalizedText[], separator: string): LocalizedText;
  message(source: string, values: LocalizedText[]): LocalizedText;
  option(label: LocalizedText, value: string): HTMLOptionElement;
}
export interface ChartSummary {
  chart_id: string;
  song_id: string;
  source_hash: string;
  title: string;
  artist: string;
  format: string;
  difficulty: string;
  level?: string;
  demand?: Record<string, Record<string, number | null>> | null;
}
export interface ChartCardPresentation<C extends ChartSummary> {
  title(chart: C): string;
  folder(chart: C, mode: 'genre' | 'version'): string;
  genre(value: string): string;
  constant(chart: C): number | null;
  constantSource(chart: C): { provider: string; region: string; release?: string } | undefined;
  bpm(chart: C): number | null;
  speed(chart: C): number | null;
  romaji(chart: C): string;
  difficultyRank(chart: C): number | null;
  patterns(): string[];
}
export interface ChartCardComponents<C extends ChartSummary> {
  localization: TextView;
  artwork: { jacket(chart: C): HTMLElement; version(value: string): HTMLElement };
  links(chart: C): HTMLElement | null;
  overview: {
    chips(chart: C, limit: number, patterns: string[]): HTMLElement;
    graph(chart: C, options: { compact: boolean }): HTMLElement;
    details(chart: C): HTMLElement;
    section(
      kind: 'chart',
      title: string,
      decoration: HTMLElement,
    ): { root: HTMLElement; content: HTMLElement };
  };
  personal?: { summary(chart: C): HTMLElement; details(chart: C): HTMLElement };
  songLink?: (song: string, chart: string) => HTMLAnchorElement;
}
export interface ChartCardActions {
  expanded(): boolean;
  select(chart: string): void;
  expand(value: boolean): void;
  compare(chart: string): void;
  similar(chart: string): void;
  usage?: Pick<UsageAPI, 'emit'>;
}
/** Shared browser/song card. No global element lookup or state ownership. */
export function createChartCard<C extends ChartSummary>(
  model: { chart: C; choices: readonly C[]; key: string; domKey: string },
  presentation: ChartCardPresentation<C>,
  components: ChartCardComponents<C>,
  actions: ChartCardActions,
): HTMLElement {
  const { chart, choices, key, domKey } = model,
    { localization: i18n, overview, personal } = components;
  const displayTitle = presentation.title,
    folderValue = presentation.folder,
    genreLabel = presentation.genre,
    chartConstant = presentation.constant,
    difficultyRank = presentation.difficultyRank,
    values = presentation;
  const constantLabel = (c: C) => (chartConstant(c) == null ? '—' : chartConstant(c)!.toFixed(1));
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
    cls?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text !== undefined) i18n.text(node, text);
    if (cls) node.className = cls;
    return node;
  };
  function metrics(c: C) {
    const root = make('div', undefined, 'demand');
    for (const [group, key, label, unit] of [
      ['cadence', 'mean_onsets_s', 'Average input speed', ' /s'],
      ['cadence', 'peak_onsets_s', 'Busiest 1 s', ' inputs'],
      ['coordination', 'simultaneous_fraction', 'Simultaneous inputs', '%'],
      ['holds', 'occupancy', 'Avg active holds', ''],
      ['slides', 'occupancy', 'Avg moving slides', ''],
      ['spatial', 'single_step_buttons', 'Single-input spacing', ' buttons'],
    ] as const) {
      let value = c.demand?.[group]?.[key];
      if (value != null && unit === '%') value *= 100;
      const e = make('div', label, 'metric');
      e.append(make('strong', value == null ? 'Unknown' : value.toFixed(1) + unit));
      root.append(e);
    }
    return root;
  }
  function renderRow(c: C): HTMLElement {
    const row = make('article', undefined, 'song-row');
    row.dataset.rowKey = key;
    row.dataset.chartId = c.chart_id;
    row.dataset.level = c.level || '';
    row.dataset.constant = String(chartConstant(c) ?? '');
    row.dataset.title = c.title;
    row.dataset.difficulty = c.difficulty;
    row.dataset.genre = folderValue(c, 'genre');
    row.dataset.version = folderValue(c, 'version');
    const header = make('div', undefined, 'chart-summary');
    const summary = make('button', undefined, 'chart-row'),
      identity = make('span', undefined, 'song-identity'),
      title = make('span', i18n.verbatim(displayTitle(c)), 'song-title');
    summary.type = 'button';
    summary.dataset.chartAction = 'expand';
    const titleLine = make('span', undefined, 'song-title-line'),
      reading = presentation.romaji(c);
    titleLine.append(title);
    if (reading) {
      const roman = make('span', i18n.verbatim(reading), 'song-romaji');
      roman.lang = 'ja-Latn';
      titleLine.append(roman);
    }
    identity.append(
      titleLine,
      make(
        'span',
        i18n.parts(
          [c.artist ? i18n.verbatim(c.artist) : 'Artist not provided', i18n.verbatim(c.format)],
          ' · ',
        ),
        'muted',
      ),
    );
    summary.append(identity);
    i18n.attribute(
      summary,
      'aria-label',
      i18n.message(
        chartConstant(c) == null
          ? 'Open {0} · {1} · Chart constant unknown'
          : 'Open {0} · {1} · Chart constant {2}',
        [
          i18n.verbatim(displayTitle(c)),
          i18n.parts([i18n.verbatim(c.format), c.difficulty], ' '),
          i18n.verbatim(constantLabel(c)),
        ],
      ),
    );
    const heading = make('div', undefined, 'chart-row-heading'),
      videoLink = components.links(c);
    heading.append(
      components.artwork.jacket(c),
      summary,
      overview.chips(c, 3, presentation.patterns()),
    );
    if (videoLink) heading.append(videoLink);
    const picker = make('select', undefined, 'row-difficulty');
    picker.id = 'row-difficulty-' + domKey;
    picker.dataset.chartAction = 'difficulty';
    i18n.attribute(picker, 'aria-label', 'Difficulty for ' + displayTitle(c) + ' ' + c.format);
    for (const choice of [...choices].sort(
      (a, b) =>
        (difficultyRank(b) ?? -1) - (difficultyRank(a) ?? -1) ||
        a.chart_id.localeCompare(b.chart_id),
    ))
      picker.append(
        i18n.option(
          i18n.parts([choice.difficulty, i18n.verbatim(choice.level || '?')], ' · '),
          choice.chart_id,
        ),
      );
    picker.value = c.chart_id;
    picker.onchange = () => {
      const next = choices.find((choice) => choice.chart_id === picker.value);
      if (!next) return;
      if (actions.expanded()) actions.usage?.emit('chart_opened');
      actions.select(next.chart_id);
      const replacement = renderRow(next);
      row.replaceWith(replacement);
      replacement
        .querySelector<HTMLSelectElement>('.row-difficulty')!
        .focus({ preventScroll: true });
    };
    const level = make('span', constantLabel(c), 'chart-level chart-constant'),
      bpm = make('span', values.bpm(c) == null ? '—' : String(values.bpm(c)), 'chart-bpm'),
      speed = make(
        'span',
        values.speed(c) == null ? '—' : values.speed(c)!.toFixed(1),
        'chart-speed',
      );
    i18n.attribute(
      bpm,
      'aria-label',
      values.bpm(c) == null ? 'BPM unknown' : values.bpm(c) + ' BPM',
    );
    i18n.attribute(bpm, 'title', 'Source song BPM; individual passages may change tempo.');
    i18n.attribute(
      level,
      'aria-label',
      'Chart constant ' + (chartConstant(c) == null ? 'unknown' : constantLabel(c)),
    );
    i18n.attribute(
      level,
      'title',
      chartConstant(c) == null
        ? 'No verified source constant is available for this context.'
        : (() => {
            const source = presentation.constantSource(c);
            return source
              ? [source.provider, source.region, source.release || 'game version unspecified']
                  .filter(Boolean)
                  .join(' · ')
              : 'Neskol source constant · regional and game-version scope unspecified.';
          })(),
    );
    i18n.attribute(
      speed,
      'aria-label',
      (values.speed(c) == null ? 'Unknown' : values.speed(c)!.toFixed(1)) + ' inputs per second',
    );
    const flow = overview.graph(c, { compact: true });
    header.append(heading, picker, level, bpm, speed, flow);
    const footer = make('div', undefined, 'chart-card-footer'),
      version = folderValue(c, 'version'),
      metadata = make('div', undefined, 'chart-card-metadata');
    const versionArt = components.artwork.version(version);
    i18n.attribute(versionArt, 'title', i18n.verbatim(version));
    metadata.append(
      versionArt,
      make('span', genreLabel(folderValue(c, 'genre')), 'chart-card-genre'),
      make('span', i18n.verbatim(version), 'chart-card-version'),
    );
    const actionBar = make('div', undefined, 'chart-detail-actions'),
      compareButton = make('button', 'Compare this chart'),
      similarButton = make('button', 'Find similar');
    compareButton.type = similarButton.type = 'button';
    compareButton.dataset.chartAction = 'compare';
    similarButton.dataset.chartAction = 'similar';
    compareButton.onclick = () => {
      actions.compare(c.chart_id);
    };
    similarButton.disabled = !c.demand;
    i18n.attribute(
      similarButton,
      'title',
      c.demand ? 'Find charts with comparable measurements' : 'Similarity needs prepared analysis',
    );
    similarButton.onclick = () => {
      actions.similar(c.chart_id);
    };
    actionBar.append(compareButton, similarButton);
    footer.append(metadata, actionBar);
    header.append(footer);
    if (personal) header.append(personal.summary(c));
    header.onclick = (event) => {
      if (event.target instanceof Element && !event.target.closest('button,select,label,input,a'))
        summary.click();
    };
    const panel = make('div', undefined, 'chart-measurements');
    panel.id = 'chart-' + domKey;
    panel.hidden = !actions.expanded();
    row.classList.toggle('is-expanded', !panel.hidden);
    summary.setAttribute('aria-expanded', String(!panel.hidden));
    summary.setAttribute('aria-controls', panel.id);
    const renderDetails = () => {
      const identity = make('span', undefined, 'chart-detail-identity'),
        formatBadge = make('span', c.format, 'chart-format-badge');
      formatBadge.dataset.format = c.format;
      identity.append(
        formatBadge,
        make('span', c.difficulty, 'chart-difficulty-badge'),
        make('span', c.level || '?', 'chart-detail-level'),
      );
      const track = overview.section('chart', 'Chart details', identity);
      track.content.append(metrics(c), overview.details(c));
      panel.replaceChildren(track.root);
      if (components.songLink) track.content.append(components.songLink(c.song_id, c.chart_id));
      if (personal) panel.append(personal.details(c));
    };
    summary.onclick = () => {
      panel.hidden = !panel.hidden;
      row.classList.toggle('is-expanded', !panel.hidden);
      summary.setAttribute('aria-expanded', String(!panel.hidden));
      if (panel.hidden) actions.expand(false);
      else {
        actions.expand(true);
        renderDetails();
        actions.usage?.emit('chart_opened');
      }
    };
    if (!panel.hidden) renderDetails();
    row.append(header, panel);
    return row;
  }

  return renderRow(chart);
}
