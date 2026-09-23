import type { TextView } from '../components/chart-card';
import type { BrowserState } from '../runtime/browser-state';
import type { UsageAPI } from '../usage';
interface FilterChart {
  difficulty: string;
  level?: string;
}
interface FilterElements {
  'filter-min': HTMLInputElement;
  'filter-max': HTMLInputElement;
  'level-min-slider': HTMLInputElement;
  'level-max-slider': HTMLInputElement;
  'difficulty-filter': HTMLDetailsElement;
  'difficulty-summary': HTMLElement;
  'difficulty-clear': HTMLButtonElement;
  'difficulty-options': HTMLElement;
  'version-filter': HTMLDetailsElement;
  'level-error': HTMLElement;
  'level-range': HTMLElement;
  'level-clear': HTMLButtonElement;
}
interface FilterPorts {
  root: HTMLElement;
  localization: Pick<TextView, 'text' | 'attribute'>;
  browserState: BrowserState;
  playerContext?: { key(value: string): string };
  usage?: Pick<UsageAPI, 'emit'>;
}
/** Catalog and personal disclosures render shared browser state. */
export function createChartFilters(ports: FilterPorts) {
  const root = ports.root,
    document = root.ownerDocument;
  /* Multiple difficulties and an inclusive level interval, shared with comparison filtering. */
  const i18n = ports.localization;

  // Shared disclosure behavior for catalog and personal filters.
  const disclosureViews = new Map<string, (persist?: boolean) => void>();
  function filterDisclosure(
    root: HTMLElement,
    toggle: HTMLButtonElement,
    body: HTMLElement,
    key: string,
  ) {
    key = ports.playerContext?.key(key) || key;
    const hint = document.createElement('small');
    hint.className = 'filter-disclosure-hint';
    hint.setAttribute('aria-hidden', 'true');
    toggle.insertBefore(hint, toggle.lastElementChild);
    const disclosure = ports.browserState.disclosure(toggle.id);
    try {
      disclosure.expanded = (localStorage.getItem(key) ?? sessionStorage.getItem(key)) === '0';
    } catch {}
    function update(persist = false) {
      if (persist)
        try {
          localStorage.setItem(key, disclosure.expanded ? '0' : '1');
        } catch {}
      toggle.setAttribute('aria-expanded', String(disclosure.expanded));
      root.classList.toggle('is-collapsed', !disclosure.expanded);
      body.inert = !disclosure.expanded;
      i18n.text(hint, disclosure.expanded ? 'Collapse' : 'Expand');
      i18n.attribute(
        toggle,
        'title',
        disclosure.expanded ? 'Click to collapse' : 'Click to expand',
      );
      i18n.attribute(root, 'title', disclosure.expanded ? '' : 'Click to expand');
    }
    toggle.onclick = () => {
      disclosure.expanded = !disclosure.expanded;
      update(true);
      if (disclosure.expanded)
        ports.usage?.emit(
          'filters_opened',
          undefined,
          key.includes('personal') || key.includes('player') ? 'personal' : 'catalog',
        );
    };
    disclosureViews.set(toggle.id, update);
    update();
  }
  filterDisclosure.sync = () => {
    for (const update of disclosureViews.values()) update(true);
  };
  const el = <K extends keyof FilterElements>(id: K) =>
    root.querySelector<FilterElements[K]>('#' + id)!;
  const number = (value: unknown) => {
    const text = String(value ?? '')
      .normalize('NFKC')
      .trim();
    if (!/^\d+(?:\+|\.5|\.0)?$/.test(text)) return null;
    return parseFloat(text) + (text.endsWith('+') ? 0.5 : 0);
  };
  function mount(charts: readonly FilterChart[], onChange: () => void) {
    const order = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
    const selected = ports.browserState.difficulties,
      difficulties = [...new Set(charts.map((c) => c.difficulty))].sort(
        (a, b) => order.indexOf(a.toUpperCase()) - order.indexOf(b.toUpperCase()),
      );
    const levels = [...new Set(charts.map((c) => number(c.level)).filter((n) => n != null))].sort(
      (a, b) => a - b,
    );
    const label = (n: number) => (Number.isInteger(n) ? String(n) : Math.floor(n) + '+');
    ports.browserState.configureLevels(difficulties, levels);
    const range = ports.browserState.level;
    let drag: number | null = null;
    const fields = [el('filter-min'), el('filter-max')],
      sliders = [el('level-min-slider'), el('level-max-slider')];
    const menu = el('difficulty-filter'),
      summary = el('difficulty-summary');
    function updateDifficulties() {
      i18n.text(
        summary,
        selected.size === 0
          ? 'All difficulties'
          : selected.size === 1
            ? [...selected][0]
            : selected.size + ' difficulties selected',
      );
      for (const checkbox of el('difficulty-options').querySelectorAll('input'))
        checkbox.checked = selected.has(checkbox.value);
    }
    for (const difficulty of difficulties) {
      const row = document.createElement('label'),
        input = document.createElement('input'),
        text = document.createElement('span');
      row.dataset.difficulty = difficulty;
      input.type = 'checkbox';
      input.value = difficulty;
      i18n.text(text, difficulty);
      input.onchange = () => {
        if (input.checked) selected.add(difficulty);
        else selected.delete(difficulty);
        updateDifficulties();
        ports.usage?.emit('filter_first_used', undefined, 'difficulty');
        onChange();
      };
      row.append(input, text);
      el('difficulty-options').append(row);
    }
    el('difficulty-clear').onclick = () => {
      selected.clear();
      updateDifficulties();
      onChange();
    };
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menu.open = false;
        summary.focus();
        event.stopPropagation();
      }
    });
    menu.addEventListener('toggle', () => {
      if (menu.open) el('version-filter').open = false;
    });
    el('version-filter').addEventListener('toggle', () => {
      if (el('version-filter').open) menu.open = false;
    });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
    function sync() {
      i18n.text(el('level-error'), '');
      fields.forEach((field, i) => {
        field.value = levels.length ? label(levels[i ? range.high : range.low]) : '';
        field.removeAttribute('aria-invalid');
      });
      sliders.forEach((slider, i) => {
        slider.value = String(i ? range.high : range.low);
        i18n.attribute(
          slider,
          'aria-valuetext',
          levels.length
            ? 'Level ' + label(levels[i ? range.high : range.low])
            : 'No levels available',
        );
      });
      sliders[0].setAttribute('aria-valuemax', String(range.high));
      sliders[1].setAttribute('aria-valuemin', String(range.low));
      const scale = Math.max(1, levels.length - 1);
      el('level-range').style.setProperty('--level-low', (range.low / scale) * 100 + '%');
      el('level-range').style.setProperty('--level-high', (range.high / scale) * 100 + '%');
      el('level-clear').disabled =
        !levels.length || (range.low === 0 && range.high === levels.length - 1);
    }
    function clearLevels() {
      range.low = 0;
      range.high = Math.max(0, levels.length - 1);
      sync();
    }
    function setSlider(side: number, index: number) {
      index = Math.max(0, Math.min(levels.length - 1, index));
      if (side === 0) range.low = Math.min(index, range.high);
      else range.high = Math.max(index, range.low);
      sync();
      ports.usage?.emit('filter_first_used', undefined, 'level');
      onChange();
    }
    function commit(side: number) {
      const text = fields[side].value.trim(),
        value = number(text),
        index =
          text === ''
            ? side
              ? levels.length - 1
              : 0
            : value === null
              ? -1
              : levels.indexOf(value);
      if (index < 0) {
        fields[side].setAttribute('aria-invalid', 'true');
        i18n.text(
          el('level-error'),
          'Enter an available level from ' +
            label(levels[0]) +
            ' to ' +
            label(levels.at(-1)!) +
            '. Use + for a plus level.',
        );
        return;
      }
      // Enter followed by blur must not render a second time and discard the
      // button receiving the click that moved focus out of the text field.
      if (index === (side ? range.high : range.low)) {
        sync();
        return;
      }
      if (side === 0) {
        range.low = index;
        if (range.low > range.high) range.high = range.low;
      } else {
        range.high = index;
        if (range.high < range.low) range.low = range.high;
      }
      sync();
      ports.usage?.emit('filter_first_used', undefined, 'level');
      onChange();
    }
    fields.forEach((field, i) => {
      field.disabled = !levels.length;
      field.onblur = () => commit(i);
      field.onkeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(i);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          sync();
        }
      };
    });
    sliders.forEach((slider, i) => {
      slider.min = '0';
      slider.max = String(Math.max(0, levels.length - 1));
      slider.step = '1';
      slider.disabled = levels.length < 2;
      slider.oninput = () => setSlider(i, Number(slider.value));
    });
    // Track taps choose the nearer handle. Equal handles can be separated to either
    // side by tapping the track; both native handles also remain in the tab order.
    const track = el('level-range');
    function trackIndex(event: PointerEvent) {
      const box = track.getBoundingClientRect();
      return Math.round(
        Math.max(0, Math.min(1, (event.clientX - box.left - 12) / (box.width - 24))) *
          (levels.length - 1),
      );
    }
    track.onpointerdown = (event) => {
      if (
        (event.target as Element | null)?.tagName === 'INPUT' ||
        levels.length < 2 ||
        event.button !== 0
      )
        return;
      const index = trackIndex(event),
        side =
          Math.abs(index - range.low) < Math.abs(index - range.high)
            ? 0
            : Math.abs(index - range.low) > Math.abs(index - range.high)
              ? 1
              : index <= range.low
                ? 0
                : 1;
      drag = side;
      track.setPointerCapture(event.pointerId);
      sliders[side].focus();
      setSlider(side, index);
      event.preventDefault();
    };
    track.onpointermove = (event) => {
      if (drag != null) setSlider(drag, trackIndex(event));
    };
    track.onpointerup = track.onpointercancel = () => {
      drag = null;
    };
    el('level-clear').onclick = () => {
      clearLevels();
      onChange();
      fields[0].focus();
    };
    updateDifficulties();
    sync();
    return {
      snapshot: () => ports.browserState.filterSnapshot(),
      restore(value: unknown) {
        ports.browserState.restoreFilters(value);
        updateDifficulties();
        sync();
      },
      sync() {
        updateDifficulties();
        sync();
      },
      matches(chart: FilterChart) {
        if (selected.size && !selected.has(chart.difficulty)) return false;
        if ((range.low === 0 && range.high === levels.length - 1) || !levels.length) return true;
        const value = number(chart.level);
        return value != null && value >= levels[range.low] && value <= levels[range.high];
      },
      clear() {
        selected.clear();
        updateDifficulties();
        clearLevels();
      },
      activeCount() {
        return (
          Number(selected.size > 0) + Number(range.low > 0) + Number(range.high < levels.length - 1)
        );
      },
      chips() {
        const result: HTMLButtonElement[] = [];
        function chip(text: string, aria: string, remove: () => void) {
          const button = document.createElement('button');
          button.className = 'filter-chip';
          i18n.text(button, text + ' ×');
          i18n.attribute(button, 'aria-label', aria);
          button.onclick = remove;
          result.push(button);
        }
        for (const difficulty of selected)
          chip(difficulty, 'Remove difficulty ' + difficulty, () => {
            selected.delete(difficulty);
            updateDifficulties();
            onChange();
            summary.focus();
          });
        if (range.low > 0)
          chip('From level ' + label(levels[range.low]), 'Remove minimum level filter', () => {
            range.low = 0;
            sync();
            onChange();
            fields[0].focus();
          });
        if (range.high < levels.length - 1)
          chip('To level ' + label(levels[range.high]), 'Remove maximum level filter', () => {
            range.high = levels.length - 1;
            sync();
            onChange();
            fields[1].focus();
          });
        return result;
      },
    };
  }
  const catalogFilters = Object.freeze({ mount, levelNumber: number });

  return { filterDisclosure, catalogFilters };
}
