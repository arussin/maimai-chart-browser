import type { TextView, LocalizedText } from '../components/chart-card';
import type { BrowserState } from '../runtime/browser-state';
import type { PublicCatalog, CatalogChart } from '../runtime/catalog';
import type { UsageAPI } from '../usage';
import type { regionalValues } from '../catalog-query';
import { normalizeGenres } from '../domain/catalog-genres';
interface RegistryPorts {
  root: HTMLElement;
  localization: Pick<TextView, 'text'>;
  browserState: BrowserState;
  catalogQuery: { regionalValues: typeof regionalValues };
  usage?: Pick<UsageAPI, 'emit'>;
}
/** Regional controls project catalog display fields without changing identity or membership. */
export function createRegistryBrowser(ports: RegistryPorts) {
  const root = ports.root,
    document = root.ownerDocument;
  /* Regional data preference never restricts catalog membership. */
  const i18n = ports.localization;

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
  ): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (text !== undefined) i18n.text(n, text);
    return n;
  };
  function matchesRegion(chart: CatalogChart, region: string | undefined) {
    return !region || chart.regional?.[region]?.listing === 'listed';
  }
  function resolve(data: { legacy_ids?: Record<string, string> }, id: string) {
    return data.legacy_ids?.[id] || id;
  }
  function mount(data: PublicCatalog, changed: () => void) {
    if (data.schema_version !== 'maimai-browser-catalog-2') return;
    if (!data.navigation) throw new Error('Catalog navigation is unavailable');
    const modelNavigation = data.navigation;
    const label = make('label'),
      checkbox = make('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'use-international-data';
    checkbox.checked = false;
    label.className = 'check international-data-option';
    label.append(checkbox, make('span', 'Use maimai international data'));
    const controls = root.querySelector<HTMLElement>('#regional-controls')!;
    controls.append(label);
    controls.hidden = false;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('#filter-region>button')];
    const regionLabels = { '': 'All regions', JP: 'JP', INTL: 'International' };
    const region = ports.browserState.region;
    function selectRegion(value: string | undefined) {
      ports.browserState.setRegion(value ?? '');
      checkbox.checked = region.international;
      for (const button of buttons) {
        const selected = button.dataset.region === value;
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
    }
    const navigation = new Map(
      Object.entries(modelNavigation.charts).map(([id, row]) => [id, { ...row }]),
    );
    const originals = new Map(data.catalog.map((c) => [c.chart_id, { ...c }]));
    function apply(notify = true) {
      for (const chart of data.catalog) {
        const projected = ports.catalogQuery.regionalValues(
          originals.get(chart.chart_id)!,
          navigation.get(chart.chart_id)!,
          region.international,
        );
        Object.assign(chart, projected.fields);
        Object.assign(modelNavigation.charts[chart.chart_id], projected.navigation);
      }
      if (notify) changed();
    }
    checkbox.onchange = () => {
      region.international = checkbox.checked;
      apply();
      ports.usage?.emit('filter_first_used', undefined, 'international');
    };
    buttons.forEach((button, index) => {
      button.onclick = () => {
        selectRegion(button.dataset.region);
        apply();
        ports.usage?.emit('filter_first_used', undefined, 'region');
      };
      button.onkeydown = (event) => {
        const offsets: Record<string, number> = {
          ArrowRight: 1,
          ArrowDown: 1,
          ArrowLeft: -1,
          ArrowUp: -1,
        };
        const offset = offsets[event.key];
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : offset
                ? (index + offset + buttons.length) % buttons.length
                : null;
        if (next === null) return;
        event.preventDefault();
        buttons[next].focus();
        buttons[next].click();
      };
    });
    return {
      value: () => region.availability,
      label: () => regionLabels[region.availability],
      clear: (notify = true) => {
        selectRegion('');
        apply(notify);
      },
      snapshot: () => ({ ...region }),
      sync: () => {
        const saved = { ...region };
        selectRegion(saved.availability);
        region.international = saved.international;
        checkbox.checked = region.international;
        apply(false);
      },
      restore: (saved: unknown) => {
        ports.browserState.restoreRegion(saved);
        checkbox.checked = region.international;
        apply(false);
      },
    };
  }
  return Object.freeze({ resolve, mount, normalize: normalizeGenres, matchesRegion });
}
