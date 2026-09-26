import type { TextView, LocalizedText } from '../components/chart-card';
import type { AnalysisModel, AnalysisIdentity } from '../domain/analysis-model';
import type { BrowserState } from '../runtime/browser-state';
import type { UsageAPI } from '../usage';
import type { PatternDefinition } from '../domain/patterns';
export type { PatternDefinition } from '../domain/patterns';
interface PatternElements {
  'pattern-filter': HTMLDetailsElement;
  'pattern-filter-summary': HTMLElement;
  'pattern-filter-search': HTMLInputElement;
  'pattern-filter-clear': HTMLButtonElement;
  'pattern-filter-count': HTMLElement;
  'pattern-filter-empty': HTMLElement;
  'pattern-filter-options': HTMLElement;
  'version-filter': HTMLDetailsElement;
  'difficulty-filter': HTMLDetailsElement;
}
interface PatternPorts {
  root: HTMLElement;
  definitions: readonly PatternDefinition[];
  browserState: BrowserState;
  localization: Pick<TextView, 'text' | 'attribute'> & { searchTerms(value: string): string };
  usage?: Pick<UsageAPI, 'emit'>;
}
interface PatternOverview extends Pick<AnalysisModel, 'detected' | 'frequency' | 'coverage'> {
  patternIds: readonly string[];
  name(id: string): string;
}
/** Search and selection are views over supplied definitions and browser state. */
export function createPatternFilter(ports: PatternPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!;
  /* Searchable public pattern filters. Multiple selections match any selected pattern. */
  const i18n = ports.localization;

  const el = <K extends keyof PatternElements>(id: K) =>
      root.querySelector<PatternElements[K]>('#' + id)!,
    normalize = (value: unknown) =>
      String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .trim();
  function mount(overview: PatternOverview, onChange: () => void) {
    const definitions = new Map(ports.definitions.map((p) => [p.pattern_id, p]));
    const ids = [...overview.patternIds],
      selected = ports.browserState.patterns,
      rows: { id: string; input: HTMLInputElement; label: HTMLLabelElement; text: string }[] = [];
    ports.browserState.configurePatterns(ids);
    const menu = el('pattern-filter'),
      summary = el('pattern-filter-summary'),
      search = el('pattern-filter-search');
    const keepVisible = () =>
      requestAnimationFrame(() => {
        if (menu.open)
          menu
            .querySelector<HTMLElement>('.pattern-filter-panel')!
            .scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
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
    function update() {
      i18n.text(
        summary,
        selected.size === 0
          ? 'All patterns'
          : selected.size === 1
            ? overview.name([...selected][0])
            : selected.size + ' patterns selected',
      );
      el('pattern-filter-clear').disabled = !selected.size;
      const terms = normalize(search.value).split(/\s+/).filter(Boolean);
      let count = 0;
      for (const row of rows) {
        row.input.checked = selected.has(row.id);
        row.label.hidden = !terms.every((term) => row.text.includes(term));
        if (!row.label.hidden) count++;
      }
      i18n.text(
        el('pattern-filter-count'),
        ids.length
          ? count + ' of ' + ids.length + ' patterns and traits'
          : 'No pattern data in this catalog release.',
      );
      el('pattern-filter-empty').hidden = count > 0 || !ids.length;
      if (menu.open) keepVisible();
    }
    for (const [index, id] of ids.entries()) {
      const definition = definitions.get(id),
        label = make('label'),
        input = make('input'),
        text = make('span'),
        name = make('span', overview.name(id));
      input.type = 'checkbox';
      input.value = id;
      input.dataset.patternFilter = id;
      input.disabled = !overview.coverage.get(id);
      const detail = make(
        'small',
        input.disabled
          ? 'No supported chart coverage'
          : (overview.frequency.get(id) || 0) + ' charts',
      );
      detail.id = 'pattern-filter-option-help-' + index;
      detail.setAttribute('aria-hidden', 'true');
      input.setAttribute('aria-describedby', detail.id);
      text.append(name, detail);
      label.append(input, text);
      input.onchange = () => {
        ports.usage?.emit('filter_first_used', undefined, 'pattern');
        if (input.checked) selected.add(id);
        else selected.delete(id);
        update();
        onChange();
      };
      const aliases = (definition?.aliases || []).map((alias) =>
        typeof alias === 'string' ? alias : alias.text,
      );
      rows.push({
        id,
        input,
        label,
        text: normalize([overview.name(id), id, ...aliases].map(i18n.searchTerms).join(' ')),
      });
      el('pattern-filter-options').append(label);
    }
    const visibleInputs = () =>
      rows.filter((row) => !row.label.hidden && !row.input.disabled).map((row) => row.input);
    search.oninput = () => {
      if (search.value.trim()) ports.usage?.emit('search_used', undefined, 'charts');
      update();
    };
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        menu.open = false;
        summary.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const inputs = visibleInputs(),
        index = inputs.indexOf(event.target as HTMLInputElement);
      if (event.target !== search && index < 0) return;
      const next =
        event.target === search
          ? event.key === 'ArrowDown'
            ? 0
            : inputs.length - 1
          : Math.max(0, Math.min(inputs.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      if (inputs[next]) {
        event.preventDefault();
        inputs[next].focus();
      }
    });
    const otherMenus = [el('version-filter'), el('difficulty-filter')];
    menu.addEventListener('toggle', () => {
      if (menu.open) {
        for (const other of otherMenus) other.open = false;
        const rect = summary.getBoundingClientRect(),
          below = window.innerHeight - rect.bottom,
          height = menu
            .querySelector<HTMLElement>('.pattern-filter-panel')!
            .getBoundingClientRect().height;
        menu.classList.toggle('opens-up', below < height && rect.top > below);
        search.focus({ preventScroll: true });
        keepVisible();
      }
    });
    for (const other of otherMenus)
      other.addEventListener('toggle', () => {
        if (other.open) menu.open = false;
      });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
    el('pattern-filter-clear').onclick = () => {
      selected.clear();
      update();
      onChange();
      search.focus();
    };
    function set(values: readonly string[]) {
      ports.browserState.setPatterns(values);
      search.value = '';
      update();
    }
    set(new URLSearchParams(window.location.search).getAll('pattern-filter'));
    return {
      sync: update,
      ids: () => [...selected],
      set,
      clear() {
        set([]);
      },
      matches: (chart: AnalysisIdentity) =>
        !selected.size || overview.detected(chart).some((tag) => selected.has(tag.id)),
      chips: () =>
        [...selected].map((id) => {
          const button = make('button', overview.name(id) + ' ×', 'filter-chip');
          i18n.attribute(button, 'aria-label', 'Remove pattern ' + overview.name(id));
          button.onclick = () => {
            selected.delete(id);
            update();
            onChange();
            summary.focus();
          };
          return button;
        }),
    };
  }
  return Object.freeze({ mount });
}
