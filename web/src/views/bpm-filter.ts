import type { TextView } from '../components/chart-card';
import type { BpmFilterValue, BpmOperator } from '../domain/bpm-filter';
import {
  bpmSymbols,
  formatBpmInput,
  isBpmOperator,
  matchesBpm,
  parseBpmInput,
} from '../domain/bpm-filter';

interface BpmFilterPorts {
  root: HTMLElement;
  localization: Pick<TextView, 'text' | 'attribute'>;
  state: BpmFilterValue;
  onChange(): void;
  onUse(): void;
}

/** One compact catalog filter; the authoritative value lives in BrowserState. */
export function createBpmFilter(ports: BpmFilterPorts) {
  const document = ports.root.ownerDocument,
    i18n = ports.localization,
    state = ports.state;
  const container = document.createElement('div'),
    label = document.createElement('span'),
    controls = document.createElement('div'),
    operator = document.createElement('select'),
    input = document.createElement('input'),
    error = document.createElement('p');
  container.id = 'bpm-filter-field';
  container.className = 'bpm-filter-field';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-labelledby', 'bpm-filter-label');
  label.id = 'bpm-filter-label';
  i18n.text(label, 'BPM');
  controls.className = 'bpm-filter-controls';
  operator.id = 'filter-bpm-operator';
  i18n.attribute(operator, 'aria-label', 'BPM comparison');
  const operators: [BpmOperator, string][] = [
    ['lte', 'BPM less than or equal to'],
    ['eq', 'BPM equal to'],
    ['gte', 'BPM greater than or equal to'],
  ];
  for (const [value, description] of operators) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = bpmSymbols[value];
    i18n.attribute(option, 'aria-label', description);
    i18n.attribute(option, 'title', description);
    operator.append(option);
  }
  input.id = 'filter-bpm-value';
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-describedby', 'bpm-filter-error');
  i18n.attribute(input, 'aria-label', 'BPM value');
  i18n.attribute(input, 'placeholder', 'Any BPM');
  error.id = 'bpm-filter-error';
  error.setAttribute('role', 'status');
  controls.append(operator, input);
  container.append(label, controls, error);
  ports.root.querySelector('#bpm-filter-field')?.remove();
  ports.root.querySelector('.filter-secondary-row')!.append(container);

  function sync() {
    operator.value = state.operator;
    input.value = formatBpmInput(state.value);
    input.removeAttribute('aria-invalid');
    i18n.text(error, '');
  }

  function clear() {
    state.operator = 'eq';
    state.value = null;
    sync();
  }

  function commit() {
    const value = parseBpmInput(input.value);
    if (value === undefined || !isBpmOperator(operator.value)) {
      input.setAttribute('aria-invalid', 'true');
      i18n.text(error, 'Enter a positive BPM, or leave blank for any BPM.');
      // Keep the last valid filter, including its operator, while a draft is invalid.
      operator.value = state.operator;
      return;
    }
    const changed = state.value !== value || state.operator !== operator.value;
    const affectsResults = changed && (state.value !== null || value !== null);
    state.operator = operator.value;
    state.value = value;
    sync();
    // Enter followed by blur must not render twice and discard the clicked target.
    if (affectsResults) {
      if (value !== null) ports.onUse();
      ports.onChange();
    }
  }

  input.onblur = commit;
  input.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      sync();
    }
  };
  operator.onchange = commit;
  sync();

  return {
    sync,
    clear,
    activeCount: () => Number(state.value !== null),
    matches: (bpm: unknown) => matchesBpm(bpm, state),
    chips() {
      if (state.value === null) return [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-chip';
      i18n.text(button, {
        message: 'BPM {0} {1} ×',
        values: [{ literal: bpmSymbols[state.operator] }, state.value],
      });
      i18n.attribute(button, 'aria-label', 'Remove BPM filter');
      // Do not let blur replace this chip between pointerdown and click.
      button.onpointerdown = (event) => {
        if (event.button === 0) event.preventDefault();
      };
      button.onclick = () => {
        clear();
        ports.onChange();
        input.focus();
      };
      return [button];
    },
  };
}
