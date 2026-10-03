import type { TextView, LocalizedText } from '../components/chart-card';
import type { CatalogChart, PublicCatalog } from '../runtime/catalog';
import type { BrowserState } from '../runtime/browser-state';
import type { HistoryPort } from '../runtime/history';
import type { AnalysisModel } from '../domain/analysis-model';
import type * as Matching from '../domain/challenge-matching';
import type * as CatalogQuery from '../catalog-query';
import type { createChartOverview } from './chart-overview';
import type { createChartArtwork } from './chart-artwork';
import type { createChartLinks } from './chart-links';
import type { createRegistryBrowser } from './registry-browser';
import type { createSongSearch } from './song-search';
import type { UsageAPI } from '../usage';
type Side = 'left' | 'right';
type PatternComparison = ReturnType<AnalysisModel['compare']>;
interface Picker {
  input: HTMLInputElement;
  results: HTMLElement;
  status: HTMLElement;
  selection: HTMLElement;
  close(): void;
}
interface ComparisonElements {
  'comparison-pickers': HTMLElement;
  'direct-comparison': HTMLElement;
  'similar-results': HTMLElement;
  'similar-priority': HTMLSelectElement;
  'find-similar': HTMLButtonElement;
  'comparison-status': HTMLElement;
  'similar-use-filters': HTMLInputElement;
  'comparison-clear': HTMLButtonElement;
}
interface ComparisonPorts {
  root: HTMLElement;
  localization: TextView & { searchTerms(value: string): string };
  browserState: BrowserState;
  catalogQuery: Pick<typeof CatalogQuery, 'titleLabel'>;
  matching: typeof Matching;
  artwork: Pick<ReturnType<typeof createChartArtwork>, 'jacket'>;
  chartLinks: Pick<ReturnType<typeof createChartLinks>, 'group'>;
  overview: ReturnType<typeof createChartOverview>;
  personal?: { summary(chart: CatalogChart): HTMLElement };
  registry: Pick<ReturnType<typeof createRegistryBrowser>, 'resolve'>;
  songSearch: ReturnType<typeof createSongSearch>;
  historyPort: Pick<HistoryPort, 'onTraversal' | 'replaceState'>;
  usage?: Pick<UsageAPI, 'emit'>;
}
/** Shared comparison controls; model state and repositories belong to the application. */
export function createChartComparison(ports: ComparisonPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!,
    location = window.location,
    history = window.history,
    i18n = ports.localization;
  const groups: Record<string, string> = {
    cadence: 'Input speed',
    rhythm: 'Rhythm',
    coordination: 'Simultaneous inputs',
    holds: 'Holds',
    slides: 'Slides',
    spatial: 'Layout',
  };
  const measurements = [
    ['cadence', 'mean_onsets_s', 'Average inputs / s', ''],
    ['cadence', 'peak_onsets_s', 'Busiest second', ''],
    ['cadence', 'p90_onsets_s', '90th-percentile inputs / s', ''],
    ['rhythm', 'gap_beats', 'Average gap between inputs', ' beats'],
    ['rhythm', 'gap_variation', 'Variation in input spacing', ''],
    ['coordination', 'simultaneous_fraction', 'Inputs played together', '%'],
    ['coordination', 'maximum_group', 'Largest simultaneous group', ''],
    ['holds', 'occupancy', 'Average active holds', ''],
    ['slides', 'occupancy', 'Average moving slides', ''],
    ['slides', 'wait_occupancy', 'Average waiting slides', ''],
    ['spatial', 'single_step_buttons', 'Average spacing between single inputs', ' buttons'],
    ['spatial', 'simultaneous_span_buttons', 'Simultaneous-input span', ' buttons'],
    ['spatial', 'touch_fraction', 'Touch inputs', '%'],
  ];
  function mount({ data, eligibleIds }: { data: PublicCatalog; eligibleIds(): Iterable<string> }) {
    const overview = ports.overview;
    const el = <K extends keyof ComparisonElements>(id: K) =>
        root.querySelector<ComparisonElements[K]>('#' + id)!,
      make = <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        text?: LocalizedText,
        cls?: string,
      ) => {
        const node = document.createElement(tag);
        if (text !== undefined) i18n.text(node, text);
        if (cls) node.className = cls;
        return node;
      };
    const byId = new Map(data.catalog.map((c) => [c.chart_id, c])),
      state = ports.browserState.comparison,
      pickers = {} as Record<Side, Picker>;
    const name = (c: CatalogChart) =>
      ports.catalogQuery?.titleLabel(c, i18n.locale) || c.title.trim() || '〈Blank title〉';
    const chartType = (c: CatalogChart) => i18n.parts([i18n.verbatim(c.format), c.difficulty], ' ');
    const label = (c: CatalogChart) =>
      i18n.parts(
        [i18n.verbatim(name(c)), chartType(c), i18n.verbatim('Lv. ' + (c.level || '?'))],
        ' · ',
      );
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
      difficultyOrder = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
    const bpm = (c: CatalogChart) => data.navigation?.charts?.[c.chart_id]?.bpm ?? null,
      bpmText = (c: CatalogChart) => (bpm(c) == null ? 'BPM unknown' : bpm(c) + ' BPM');
    let index: ReturnType<typeof Matching.createIndex<CatalogChart>> | null = null;
    let matches: Matching.SimilarResult<PatternComparison>[] | null = null;
    const getIndex = () => index || (index = ports.matching.createIndex(data.catalog));
    function identity(c: CatalogChart) {
      const box = make('div', undefined, 'chosen-chart');
      box.append(
        ports.artwork.jacket(c),
        make('strong', i18n.verbatim(name(c))),
        make(
          'p',
          i18n.parts([chartType(c), i18n.verbatim('Lv. ' + (c.level || '?')), bpmText(c)], ' · '),
          'muted',
        ),
        make('p', i18n.verbatim(c.artist), 'muted'),
        overview.chips(c),
        overview.graph(c, { compact: true }),
      );
      const videoLink = ports.chartLinks.group(c);
      if (videoLink) box.append(videoLink);
      if (ports.personal) box.append(ports.personal.summary(c));
      return box;
    }
    function writeLink() {
      const url = new URL(location.href);
      for (const side of ['left', 'right'] as const) {
        if (state[side]) url.searchParams.set(side, state[side]);
        else url.searchParams.delete(side);
      }
      ports.historyPort.replaceState(history.state, '', url);
    }
    function choose(side: Side, id: string, write = true) {
      id = ports.registry.resolve(data, id);
      if (!byId.has(id)) return;
      if (side === 'left' && state.left !== id) {
        matches = null;
        state.similar = false;
      }
      const deliberate =
        write &&
        !!(side === 'right' ? state.left : state.right) &&
        (side === 'right' ? state.left : state.right) !== id;
      if (deliberate) ports.usage?.emit('compare_requested');
      ports.browserState.chooseComparison(side, id);
      const picker = pickers[side];
      picker.input.value = name(byId.get(id)!);
      picker.close();
      picker.selection.replaceChildren(identity(byId.get(id)!));
      render();
      if (deliberate) ports.usage?.emit('compare_loaded');
      if (write) writeLink();
    }
    for (const [side, title] of [
      ['left', 'First chart'],
      ['right', 'Second chart'],
    ] as const) {
      const container = make('div', undefined, 'chart-picker'),
        labelNode = make('label', title),
        input = make('input'),
        selection = make('div'),
        results = make('div', undefined, 'chart-choices'),
        more = make('button', 'Show more matches', 'chart-choices-more'),
        status = make('p', '', 'muted');
      input.type = 'search';
      input.id = 'compare-' + side + '-search';
      i18n.attribute(input, 'placeholder', 'Song, romaji title or artist…');
      input.autocomplete = 'off';
      results.id = 'compare-' + side + '-choices';
      results.hidden = true;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', results.id);
      labelNode.append(input);
      results.setAttribute('role', 'listbox');
      i18n.attribute(results, 'aria-label', title + ' search results');
      more.type = 'button';
      more.hidden = true;
      more.setAttribute('aria-controls', results.id);
      status.id = 'compare-' + side + '-search-status';
      status.setAttribute('role', 'status');
      input.setAttribute('aria-describedby', status.id);
      container.append(labelNode, results, more, status, selection);
      el('comparison-pickers').append(container);
      let found: CatalogChart[] = [];
      let shown = 0,
        active = -1;
      const hint =
        'Search all ' +
        data.catalog.length.toLocaleString() +
        ' charts by song, artist or difficulty.';
      function close() {
        results.hidden = true;
        more.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
        i18n.text(status, state[side] ? '' : hint);
      }
      function activate(position: number) {
        active = position;
        [...results.children].forEach((option, index) =>
          option.setAttribute('aria-selected', String(index === active)),
        );
        const option = results.children[active];
        if (option) {
          input.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
      }
      function appendMatches() {
        const end = Math.min(shown + 20, found.length);
        for (let index = shown; index < end; index++) {
          const chart = found[index],
            option = make('div', label(chart), 'chart-choice');
          option.id = results.id + '-' + index;
          option.dataset.choice = chart.chart_id;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', 'false');
          option.setAttribute('aria-posinset', String(index + 1));
          option.setAttribute('aria-setsize', String(found.length));
          option.onmousedown = (event) => event.preventDefault();
          option.onclick = () => {
            choose(side, chart.chart_id);
            input.focus();
          };
          results.append(option);
        }
        shown = end;
        more.hidden = shown >= found.length;
        i18n.text(
          status,
          found.length
            ? shown < found.length
              ? 'Showing ' +
                shown +
                ' of ' +
                found.length.toLocaleString() +
                ' matching charts. Keep typing or show more.'
              : found.length.toLocaleString() + ' matching charts.'
            : 'No matching charts. Try another song, artist or difficulty.',
        );
      }
      pickers[side] = { input, results, status, selection, close };
      close();
      function search() {
        results.replaceChildren();
        found = [];
        shown = 0;
        active = -1;
        input.removeAttribute('aria-activedescendant');
        if (!input.value.trim()) {
          close();
          return;
        }
        const matchesSearch = ports.songSearch.query(input.value),
          query = input.value.normalize('NFKC').toLowerCase().trim();
        const rank = (c: CatalogChart) => {
          const title = name(c).normalize('NFKC').toLowerCase();
          return title === query ? 0 : title.startsWith(query) ? 1 : 2;
        };
        found = data.catalog.filter((c) =>
          matchesSearch(c, [c.format, i18n.searchTerms(c.difficulty), c.level ?? '']),
        );
        found.sort(
          (a, b) =>
            rank(a) - rank(b) ||
            collator.compare(name(a), name(b)) ||
            collator.compare(a.format, b.format) ||
            difficultyOrder.indexOf(a.difficulty) - difficultyOrder.indexOf(b.difficulty) ||
            a.chart_id.localeCompare(b.chart_id),
        );
        results.hidden = !found.length;
        input.setAttribute('aria-expanded', String(!!found.length));
        appendMatches();
      }
      const changed = (composing: boolean) => {
        if (composing) return;
        ports.usage?.emit('search_used', undefined, 'compare');
        if (side === 'left') {
          matches = null;
          state.similar = false;
        }
        ports.browserState.chooseComparison(side, null);
        selection.replaceChildren();
        render();
        writeLink();
        search();
      };
      input.oninput = (event) => changed((event as InputEvent).isComposing);
      input.addEventListener('compositionend', () => changed(false));
      input.onfocus = () => {
        if (!state[side] && results.hidden) search();
      };
      input.onkeydown = (event) => {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (results.hidden) search();
          if (!found.length) return;
          const next =
            active < 0
              ? event.key === 'ArrowDown'
                ? 0
                : shown - 1
              : Math.max(
                  0,
                  Math.min(found.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)),
                );
          if (next >= shown) appendMatches();
          activate(next);
          event.preventDefault();
        } else if (event.key === 'Enter' && !results.hidden && active >= 0) {
          choose(side, found[active].chart_id);
          event.preventDefault();
        } else if (event.key === 'Escape') {
          close();
          event.preventDefault();
        }
      };
      // Keep input focus through a click without suppressing Safari's touch-generated click.
      more.onmousedown = (event) => event.preventDefault();
      more.onclick = () => {
        const next = shown;
        appendMatches();
        input.focus();
        activate(next);
      };
      container.addEventListener('focusout', (event) => {
        if (!container.contains(event.relatedTarget as Node | null)) close();
      });
      document.addEventListener('pointerdown', (event) => {
        if (!container.contains(event.target as Node | null)) close();
      });
    }
    function renderPair() {
      const root = el('direct-comparison');
      root.replaceChildren();
      if (!state.left || !state.right || state.left === state.right) return;
      const left = byId.get(state.left)!,
        right = byId.get(state.right)!,
        result = left.demand && right.demand ? getIndex().compare(state.left, state.right) : null,
        heading = make('h2', 'Chart measurements');
      root.append(overview.pair(left, right), heading);
      if (result) {
        const summary = make('div', undefined, 'comparison-summary');
        for (const [title, value, kind] of [
          [
            'Closest in',
            i18n.parts(
              result.closest_groups.map((g) => groups[g].toLowerCase()),
              ' and ',
            ),
            'closest',
          ],
          ['Furthest in', groups[result.largest_difference].toLowerCase(), 'furthest'],
        ]) {
          const item = make('p', undefined, 'comparison-' + kind);
          item.append(make('strong', title), make('span', value));
          summary.append(item);
        }
        root.append(summary);
      } else
        root.append(
          make(
            'p',
            'There is not enough shared measurement coverage for a similarity summary.',
            'muted',
          ),
        );
      const table = make('table', undefined, 'metric-comparison'),
        head = make('thead'),
        tr = make('tr');
      for (const text of ['Measurement', label(left), label(right)]) {
        const th = make('th', text);
        th.scope = 'col';
        tr.append(th);
      }
      head.append(tr);
      table.append(head);
      const body = make('tbody');
      let lastGroup = '';
      const tempoRow = make('tr'),
        tempoLabel = make('th', 'Source song BPM');
      tempoLabel.scope = 'row';
      tempoRow.append(tempoLabel);
      for (const chart of [left, right])
        tempoRow.append(make('td', bpm(chart) == null ? 'Unknown' : String(bpm(chart))));
      body.append(tempoRow);
      for (const [group, key, title, unit] of measurements) {
        if (lastGroup !== group) {
          const row = make('tr', undefined, 'metric-group'),
            cell = make('th', groups[group]);
          cell.colSpan = 3;
          cell.scope = 'rowgroup';
          row.append(cell);
          body.append(row);
          lastGroup = group;
        }
        const row = make('tr'),
          titleCell = make('th', title);
        titleCell.scope = 'row';
        row.append(titleCell);
        for (const chart of [left, right]) {
          let value = chart.demand?.[group]?.[key];
          if (unit === '%' && value != null) value *= 100;
          const text =
            value == null
              ? 'Unknown'
              : (Number.isInteger(value) ? String(value) : value.toFixed(2)) + unit;
          row.append(make('td', text));
        }
        body.append(row);
      }
      table.append(body);
      root.append(table);
    }
    function renderMatches() {
      const root = el('similar-results');
      root.replaceChildren();
      if (matches === null) return;
      root.append(
        make(
          'h2',
          el('similar-priority').value === 'patterns'
            ? 'Similar patterns & demands'
            : 'Similar chart demands',
        ),
        make(
          'p',
          matches.length +
            ' matches · one chart per song family · select a match to compare both charts.',
          'muted',
        ),
      );
      if (!matches.length)
        root.append(
          make(
            'p',
            'No other song families match the selected filters with enough measurement coverage. Try widening the chart filters.',
            'empty-state',
          ),
        );
      for (const match of matches) {
        const c = byId.get(match.chart_id)!,
          card = make('article', undefined, 'similar-chart');
        card.append(identity(c));
        card.append(
          make(
            'p',
            i18n.message('Similar {0}', [
              i18n.parts(
                match.closest_groups.map((g) => groups[g].toLowerCase()),
                ' and ',
              ),
            ]),
            'muted',
          ),
        );
        if (match.patterns) {
          const shared = match.patterns.shared;
          card.append(
            make(
              'p',
              shared.length
                ? i18n.message('Shared: {0}', [i18n.parts(shared.map(overview.name), ' · ')])
                : 'No shared detections in supported coverage',
              'match-patterns',
            ),
          );
          if (match.patternDistance == null)
            card.append(
              make('p', 'Pattern coverage insufficient; ranked by measurements', 'muted'),
            );
        }
        const button = make('button', state.right === c.chart_id ? 'Comparing' : 'Compare');
        i18n.attribute(button, 'aria-label', i18n.message('Compare with {0}', [label(c)]));
        button.dataset.compareChart = c.chart_id;
        button.onclick = () => {
          choose('right', c.chart_id);
          el('direct-comparison').scrollIntoView({ block: 'start', behavior: 'instant' });
          el('direct-comparison').tabIndex = -1;
          el('direct-comparison').focus({ preventScroll: true });
        };
        card.append(button);
        root.append(card);
      }
    }
    function render() {
      for (const side of ['left', 'right'] as const)
        if (state[side]) pickers[side].selection.replaceChildren(identity(byId.get(state[side]!)!));
      el('find-similar').disabled = !state.left || !byId.get(state.left)?.demand;
      i18n.text(
        el('comparison-status'),
        state.left && state.right
          ? state.left === state.right
            ? 'Both selections are the same chart. Choose another chart to compare.'
            : i18n.message('Comparing {0} with {1}', [
                label(byId.get(state.left)!),
                label(byId.get(state.right)!),
              ])
          : state.left
            ? 'Choose a second chart or find similar chart demands.'
            : 'Choose a first chart to begin.',
      );
      renderPair();
      renderMatches();
    }
    function find(scroll = true) {
      if (!state.left || !byId.get(state.left)?.demand) return;
      state.similar = true;
      matches = getIndex().similar(state.left, {
        limit: 8,
        eligibleIds: state.useFilters ? eligibleIds() : null,
        patternCompare: state.priority === 'patterns' ? overview.compare : null,
      });
      render();
      if (scroll) el('similar-results').scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    el('similar-priority').onchange = () => {
      state.priority = el('similar-priority').value === 'patterns' ? 'patterns' : 'measurements';
      if (matches !== null) {
        ports.usage?.emit('similar_requested');
        find();
      }
    };
    el('find-similar').onclick = () => {
      ports.usage?.emit('similar_requested');
      const u = new URL(location.href);
      u.searchParams.set('similar', '1');
      ports.historyPort.replaceState(history.state, '', u);
      find();
    };
    el('similar-use-filters').onchange = () => {
      state.useFilters = el('similar-use-filters').checked;
      if (matches !== null) {
        ports.usage?.emit('similar_requested');
        find();
      }
    };
    el('comparison-clear').onclick = () => {
      ports.browserState.chooseComparison('left', null);
      ports.browserState.chooseComparison('right', null);
      matches = null;
      state.similar = false;
      for (const picker of Object.values(pickers)) {
        picker.input.value = '';
        picker.selection.replaceChildren();
        picker.close();
      }
      render();
      writeLink();
      pickers.left.input.focus();
    };
    function restore() {
      const params = new URLSearchParams(location.search);
      let missing = false;
      matches = null;
      state.similar = false;
      for (const side of ['left', 'right'] as const) {
        const id = ports.registry.resolve(data, params.get(side) ?? '');
        ports.browserState.chooseComparison(side, null);
        pickers[side].input.value = '';
        pickers[side].selection.replaceChildren();
        pickers[side].close();
        if (id) {
          if (byId.has(id)) choose(side, id, false);
          else missing = true;
        }
      }
      render();
      if (params.get('similar') === '1' && state.left) find();
      if (missing)
        i18n.text(
          el('comparison-status'),
          'A linked chart is not available in this catalog version. Choose a chart below.',
        );
    }
    ports.historyPort.onTraversal(restore);
    restore();
    return {
      render,
      sync() {
        matches = null;
        el('similar-priority').value = state.priority;
        el('similar-use-filters').checked = state.useFilters;
        for (const side of ['left', 'right'] as const) {
          const chart = byId.get(state[side] ?? '');
          pickers[side].input.value = chart ? name(chart) : '';
          pickers[side].selection.replaceChildren(...(chart ? [identity(chart)] : []));
          pickers[side].close();
        }
        if (state.similar) find(false);
        else render();
      },
      first: () => state.left,
      useAsFirst: (id: string, findNow = false) => {
        ports.browserState.chooseComparison('right', null);
        pickers.right.input.value = '';
        pickers.right.selection.replaceChildren();
        pickers.right.close();
        choose('left', id);
        if (findNow) {
          ports.usage?.emit('similar_requested');
          const u = new URL(location.href);
          u.searchParams.set('similar', '1');
          ports.historyPort.replaceState(history.state, '', u);
          find();
        }
      },
      useAsSecond: (id: string) => choose('right', id),
    };
  }
  return Object.freeze({ mount });
}
