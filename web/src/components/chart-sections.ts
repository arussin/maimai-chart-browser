import type { TextView, LocalizedText } from './chart-card';
import type { UsageAPI } from '../usage';
export interface SectionState {
  chart: boolean;
  player: boolean;
}
export interface SectionPreferences {
  read(): Partial<SectionState>;
  write(state: SectionState): void;
  subscribe(listener: () => void): () => void;
}
/** One shared disclosure renderer; persistence and the owning state are supplied. */
export function createChartSections(
  root: HTMLElement,
  state: SectionState,
  i18n: Pick<TextView, 'text'>,
  preferences: SectionPreferences,
  usage?: Pick<UsageAPI, 'emit'>,
) {
  let serial = 0;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
    cls?: string,
  ) => {
    const node = document.createElement(tag);
    if (text !== undefined) i18n.text(node, text);
    if (cls) node.className = cls;
    return node;
  };
  function read() {
    Object.assign(state, preferences.read());
  }
  function sync() {
    for (const node of root.querySelectorAll<HTMLElement>('[data-chart-section]')) {
      const kind = node.dataset.chartSection;
      if (kind !== 'chart' && kind !== 'player') continue;
      const button = node.querySelector<HTMLButtonElement>('.chart-section-toggle'),
        body = node.querySelector<HTMLElement>('.chart-section-body');
      if (!button || !body) continue;
      const expanded = state[kind];
      if (!expanded && body.contains(root.ownerDocument.activeElement)) button.focus();
      button.setAttribute('aria-expanded', String(expanded));
      node.classList.toggle('is-section-collapsed', !expanded);
      body.inert = !expanded;
    }
  }
  read();
  const dispose = preferences.subscribe(() => {
    read();
    sync();
  });
  function section(kind: keyof SectionState, title: string, decoration?: HTMLElement) {
    const node = make('section', undefined, 'chart-section'),
      heading = make('h3'),
      button = make('button', undefined, 'chart-section-toggle'),
      name = make('span', title, 'chart-section-name'),
      chevron = make('span', '⌄', 'chart-section-chevron');
    node.dataset.chartSection = kind;
    button.type = 'button';
    button.append(name);
    if (decoration) button.append(decoration);
    chevron.setAttribute('aria-hidden', 'true');
    button.append(chevron);
    heading.append(button);
    const reveal = make('div', undefined, 'chart-section-reveal'),
      body = make('div', undefined, 'chart-section-body'),
      content = make('div', undefined, 'chart-section-content');
    reveal.id = 'chart-section-' + ++serial;
    button.setAttribute('aria-controls', reveal.id);
    body.append(content);
    reveal.append(body);
    node.append(heading, reveal);
    button.setAttribute('aria-expanded', String(state[kind]));
    node.classList.toggle('is-section-collapsed', !state[kind]);
    body.inert = !state[kind];
    button.onclick = () => {
      state[kind] = !state[kind];
      if (state[kind]) usage?.emit('chart_section_opened', undefined, kind);
      preferences.write(state);
      sync();
    };
    return { root: node, content };
  }
  return Object.freeze({ section, dispose });
}
