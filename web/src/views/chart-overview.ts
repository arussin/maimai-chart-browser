import type { TextView, LocalizedText } from '../components/chart-card';
import type { createChartSections } from '../components/chart-sections';
import type { AnalysisModel, Span } from '../domain/analysis-model';
import type { PatternDefinition } from '../domain/patterns';
import type { CatalogChart, CatalogDetails, PublicCatalog } from '../runtime/catalog';
import type * as CatalogQuery from '../catalog-query';
export interface OverviewPorts {
  root: HTMLElement;
  localization: TextView;
  publicData: Pick<PublicCatalog, 'analysis'>;
  definitions: readonly PatternDefinition[];
  sections: Pick<ReturnType<typeof createChartSections>, 'section'>;
  analysis: AnalysisModel;
  catalogDetails?: CatalogDetails;
  catalogQuery: Pick<typeof CatalogQuery, 'titleLabel'>;
  patternLibrary: { show(id: string, button: HTMLElement): boolean };
}
/** Views consume the prepared analysis model; loading remains in the detail repository. */
export function createChartOverview(ports: OverviewPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!,
    i18n = ports.localization;
  const data = ports.publicData,
    pack = data.analysis;
  const definitions = new Map(ports.definitions.map((p) => [p.pattern_id, p]));
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
    cls?: string,
  ) => {
    const n = document.createElement(tag);
    if (text !== undefined) i18n.text(n, text);
    if (cls) n.className = cls;
    return n;
  };
  const section = ports.sections.section;
  const svg = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, LocalizedText>,
    text?: LocalizedText,
  ) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) i18n.attribute(n, k, v);
    if (text !== undefined) i18n.text(n, text);
    return n;
  };
  const name = (id: string) => definitions.get(id)?.display_name || id;
  const clock = (us: number) => {
    const s = us / 1e6;
    return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
  };
  const { get, tags, detected, rate, compare, frequency, coverage } = ports.analysis;
  const delivery = ports.catalogDetails,
    pendingGraphs = new Map<Element, () => void>();
  let graphFrame = 0;
  const observer: IntersectionObserver | null =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                const run = pendingGraphs.get(entry.target);
                pendingGraphs.delete(entry.target);
                observer!.unobserve(entry.target);
                run?.();
              }
          },
          { rootMargin: '160px' },
        );
  function onVisible(box: HTMLElement, run: () => void) {
    pendingGraphs.set(box, run);
    if (!graphFrame)
      graphFrame = requestAnimationFrame(() => {
        graphFrame = 0;
        for (const [node, start] of pendingGraphs) {
          if (!node.isConnected) {
            pendingGraphs.delete(node);
            observer?.unobserve(node);
          } else if (observer) observer.observe(node);
          else {
            pendingGraphs.delete(node);
            start();
          }
        }
      });
  }
  function loadInto(
    box: HTMLElement,
    c: CatalogChart,
    render: () => HTMLElement,
    priority = false,
  ) {
    const compact = box.classList.contains('compact');
    const run = () => {
      box.replaceChildren(
        make('p', compact ? 'Loading activity…' : 'Loading chart evidence…', 'muted'),
      );
      delivery!
        .ensure(c, priority)
        .then(() => {
          if (box.isConnected) box.replaceWith(render());
        })
        .catch(() => {
          const retry = make('button', 'Retry loading chart');
          retry.type = 'button';
          retry.onclick = run;
          box.replaceChildren(
            make(
              'p',
              compact
                ? 'Activity could not load.'
                : 'Chart evidence could not be loaded. Search and filters are still available.',
              'muted',
            ),
            retry,
          );
        });
    };
    return run;
  }
  function patternButton(id: string, text = name(id)) {
    const b = make('button', text, 'pattern-chip');
    b.type = 'button';
    b.dataset.pattern = id;
    b.onclick = () => ports.patternLibrary.show(id, b);
    return b;
  }
  function chips(c: CatalogChart, limit = 3, focus: string | string[] | null = null) {
    const box = make('div', undefined, 'chart-patterns'),
      found = detected(c);
    const priorities = new Set(Array.isArray(focus) ? focus : focus ? [focus] : []);
    if (priorities.size)
      found.sort((a, b) => Number(priorities.has(b.id)) - Number(priorities.has(a.id)));
    for (const t of found.slice(0, limit)) {
      const b = patternButton(t.id);
      i18n.attribute(b, 'title', t.count + ' observed occurrences · experimental detection');
      box.append(b);
    }
    if (found.length > limit) box.append(make('span', '+' + (found.length - limit), 'muted'));
    if (!found.length)
      box.append(
        make(
          'span',
          get(c)
            ? 'No patterns detected in supported coverage'
            : 'Patterns not prepared for this chart',
          'muted',
        ),
      );
    return box;
  }
  function graph(
    c: CatalogChart,
    {
      compact = false,
      maximum = null,
      span = null,
    }: { compact?: boolean; maximum?: number | null; span?: Span | null } = {},
  ): HTMLElement {
    const record = get(c),
      box = make('figure', undefined, 'chart-flow' + (compact ? ' compact' : ''));
    if (record && delivery && !delivery.ready(c)) {
      box.append(make('span', 'Loading activity…', 'muted'));
      onVisible(
        box,
        loadInto(box, c, () => graph(c, { compact, maximum, span })),
      );
      return box;
    }
    if (!record?.segments?.length || !record.span) {
      box.append(make('span', 'Flow unavailable', 'muted'));
      return box;
    }
    const segments = record.segments;
    if (!segments.some((s) => s[2] != null && s[3] != null && s[4] > 0)) {
      box.append(make('span', 'Flow unavailable', 'muted'));
      return box;
    }
    const peak = Math.max(0, ...segments.map((s) => s[3] || 0)),
      max = maximum ?? Math.max(1, peak),
      height = compact ? 42 : 110,
      left = compact ? 0 : 30,
      right = 240,
      bottom = compact ? 40 : 88,
      top = 4,
      width = (right - left) / segments.length;
    const chartName = i18n.parts(
        [
          i18n.verbatim(
            ports.catalogQuery?.titleLabel(c, ports.localization?.locale) ||
              c.title.trim() ||
              'untitled chart',
          ),
          c.difficulty,
        ],
        ' ',
      ),
      title = i18n.message('Input activity through {0}', [chartName]);
    const art = svg('svg', {
      viewBox: '0 0 244 ' + height,
      role: 'img',
      preserveAspectRatio: compact ? 'none' : 'xMidYMid meet',
      'aria-label': i18n.message(
        'Input activity through {0}. {1} to {2}. Peak {3} inputs per second.',
        [
          chartName,
          i18n.verbatim(clock(record.span[0])),
          i18n.verbatim(clock(record.span[1])),
          i18n.verbatim(peak.toFixed(1)),
        ],
      ),
    });
    art.append(svg('title', {}, title));
    if (!compact)
      for (const y of [0, max / 2, max])
        art.append(
          svg(
            'text',
            {
              x: 26,
              y: bottom - (y / max) * (bottom - top) + 3,
              'text-anchor': 'end',
              class: 'flow-axis',
            },
            Number(y.toFixed(1)),
          ),
        );
    segments.forEach((s, i) => {
      const x = left + i * width + 1,
        valid = s[2] != null && s[4] > 0,
        y = (v: number | null) => bottom - ((v ?? 0) / max) * (bottom - top),
        highlight = span && s[0] < span[1] && s[1] > span[0];
      const bar = svg('rect', {
        x,
        y: valid ? y(s[2]) : top,
        width: Math.max(1, width - 2),
        height: valid ? Math.max(0.7, bottom - y(s[2])) : bottom - top,
        class: !valid ? 'flow-unknown' : highlight ? 'flow-highlight' : 'flow-bar',
        opacity: s[4] < 1 ? 0.45 : 1,
      });
      bar.append(
        svg(
          'title',
          {},
          clock(s[0]) +
            '–' +
            clock(s[1]) +
            ': ' +
            (valid
              ? s[2]!.toFixed(1) +
                ' mean, ' +
                s[3]!.toFixed(1) +
                ' peak inputs/s · ' +
                Math.round(s[4] * 100) +
                '% coverage'
              : 'Unknown'),
        ),
      );
      art.append(bar);
      if (valid)
        art.append(
          svg('line', { x1: x, x2: x + width - 2, y1: y(s[3]), y2: y(s[3]), class: 'flow-peak' }),
        );
    });
    if (!compact) {
      art.append(
        svg('text', { x: left, y: 105, class: 'flow-axis' }, clock(record.span[0])),
        svg(
          'text',
          { x: right, y: 105, 'text-anchor': 'end', class: 'flow-axis' },
          clock(record.span[1]),
        ),
      );
    }
    box.append(art);
    box.append(
      make(
        'figcaption',
        compact
          ? 'Peak ' + peak.toFixed(1) + ' /s · own scale'
          : 'Inputs / s · mean bars, 250 ms peak marks · chart time',
        'muted',
      ),
    );
    return box;
  }
  function details(c: CatalogChart): HTMLElement {
    const box = make('section', undefined, 'chart-pattern-detail');
    box.append(make('h4', 'Patterns & activity'));
    if (get(c) && delivery && !delivery.ready(c)) {
      loadInto(box, c, () => details(c), true)();
      return box;
    }
    const found = detected(c),
      layout = make('div', undefined, 'chart-pattern-content'),
      activity = make('div', undefined, 'chart-activity'),
      evidenceList = make('div', undefined, 'chart-evidence-list'),
      flow = make('div'),
      reading = make('p', '', 'flow-reading');
    flow.append(graph(c));
    reading.setAttribute('role', 'status');
    activity.append(flow, reading);
    layout.append(activity, evidenceList);
    box.append(layout);
    if (!get(c)) {
      box.append(make('p', 'This chart has no prepared pattern analysis.'));
      return box;
    }
    if (!found.length)
      evidenceList.append(make('p', 'No patterns detected in supported coverage.', 'muted'));
    for (const tag of found) {
      const row = make('div', undefined, 'pattern-evidence');
      row.append(
        patternButton(tag.id),
        make(
          'span',
          tag.count +
            ' observed' +
            (tag.coverage === 'partial' || tag.truncated ? ' · partial coverage' : ''),
          'muted',
        ),
      );
      const seen = new Set();
      tag.spans.forEach((span, i) => {
        const evidence = tag.evidence[i] || {},
          target =
            typeof evidence === 'object' &&
            'target_pattern_id' in evidence &&
            typeof evidence.target_pattern_id === 'string'
              ? evidence.target_pattern_id
              : undefined,
          key = span.join(':') + ':' + (target || '');
        if (seen.has(key)) return;
        seen.add(key);
        const label = (target ? name(target) + ' · ' : '') + clock(span[0]) + '–' + clock(span[1]),
          button = make('button', label, 'span-button');
        button.type = 'button';
        i18n.attribute(button, 'aria-label', 'Highlight ' + name(tag.id) + ' · ' + label);
        button.onclick = () => {
          flow.replaceChildren(graph(c, { span }));
          i18n.text(reading, name(tag.id) + ' · ' + label + ' · highlighted in activity chart');
        };
        row.append(button);
      });
      if (tag.id === 'pattern.umiyuri')
        row.append(
          make('span', 'Recurring-pair form · other variants may not be detected', 'muted'),
        );
      evidenceList.append(row);
    }
    return box;
  }
  function pair(left: CatalogChart, right: CatalogChart) {
    const box = make('section', undefined, 'pattern-comparison'),
      result = compare(left, right);
    box.append(make('h2', 'Patterns in common'));
    if (!get(left) || !get(right))
      box.append(
        make(
          'p',
          'Pattern mappings are unavailable for one or both charts in this release.',
          'muted',
        ),
      );
    for (const [title, ids] of [
      ['Shared patterns', result.shared],
      ['Detected only in first', result.first],
      ['Detected only in second', result.second],
      ['Other chart coverage unknown', result.unknown],
    ] as [string, string[]][]) {
      if (!ids.length && title === 'Other chart coverage unknown') continue;
      const group = make('div', undefined, 'pattern-comparison-group');
      group.append(make('h3', title));
      for (const id of ids) group.append(patternButton(id));
      if (!ids.length) group.append(make('span', 'None detected', 'muted'));
      box.append(group);
    }
    const ids = [
      ...new Set([...result.shared, ...result.first, ...result.second, ...result.unknown]),
    ].filter((id) => id.startsWith('pattern.'));
    if (ids.length) {
      const table = make('table', undefined, 'pattern-metrics'),
        head = make('thead'),
        labels = make('tr');
      for (const text of [
        'Pattern frequency',
        ...[left, right].map((c) => i18n.parts([i18n.verbatim(c.title), c.difficulty], ' · ')),
      ]) {
        const th = make('th', text);
        th.scope = 'col';
        labels.append(th);
      }
      head.append(labels);
      table.append(head);
      const body = make('tbody');
      for (const id of ids) {
        const row = make('tr'),
          label = make('th');
        label.scope = 'row';
        label.append(patternButton(id));
        row.append(label);
        for (const c of [left, right]) {
          const t = tags(c).find((t) => t.id === id),
            cell = make('td');
          if (!t || t.status === 'unknown') i18n.text(cell, 'Unknown');
          else {
            cell.append(
              make('strong', String(t.count)),
              make(
                'span',
                (rate(c, t) ?? 0).toFixed(1) +
                  ' / min' +
                  (t.coverage === 'partial' || t.truncated ? ' · lower bound' : ''),
                'muted',
              ),
            );
          }
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      box.append(table);
    }
    box.append(make('h2', 'Activity through each chart'));
    const graphs = make('div', undefined, 'flow-comparison');
    const max = Math.max(
      1,
      ...[left, right].map(
        (c) => get(c)?.flow_peak ?? Math.max(0, ...(get(c)?.segments || []).map((s) => s[3] || 0)),
      ),
    );
    for (const c of [left, right]) {
      const figure = make('div');
      figure.append(
        make(
          'h3',
          i18n.parts(
            [
              i18n.verbatim(
                ports.catalogQuery?.titleLabel(c, ports.localization?.locale) ||
                  c.title.trim() ||
                  'Untitled',
              ),
              c.difficulty,
            ],
            ' · ',
          ),
        ),
        graph(c, { maximum: max }),
      );
      graphs.append(figure);
    }
    box.append(graphs);
    return box;
  }
  return Object.freeze({
    get,
    tags,
    detected,
    name,
    chips,
    graph,
    details,
    section,
    compare,
    pair,
    frequency,
    coverage,
    patternIds: pack?.patterns || [],
    definition: (id: string) => pack?.definitions?.[id] || null,
  });
}
