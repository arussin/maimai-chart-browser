import type { TextView } from './chart-card';
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
/** Static peer headings: old disclosure preferences cannot hide chart or player context. */
export function createChartSections(
  _root: HTMLElement,
  _state: SectionState,
  i18n: Pick<TextView, 'text'>,
  _preferences: SectionPreferences,
  _usage?: Pick<UsageAPI, 'emit'>,
) {
  function section(kind: keyof SectionState, title: string, decoration?: HTMLElement) {
    const node = document.createElement('section'),
      heading = document.createElement('h3'),
      name = document.createElement('span'),
      body = document.createElement('div'),
      content = document.createElement('div');
    node.className = 'chart-section';
    node.dataset.chartSection = kind;
    heading.className = 'chart-section-heading';
    name.className = 'chart-section-name';
    i18n.text(name, title);
    heading.append(name);
    if (decoration) heading.append(decoration);
    body.className = 'chart-section-body';
    content.className = 'chart-section-content';
    body.append(content);
    node.append(heading, body);
    return { root: node, content };
  }
  return Object.freeze({ section, dispose() {} });
}
