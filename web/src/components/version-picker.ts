import type { TextView } from './chart-card';
import type { VersionChoice } from '../domain/score-export';

/** Logo presentation follows the existing badge picker; identity stays in the select. */
export function createVersionPicker(ports: {
  document: Document;
  localization: TextView;
  choices: readonly VersionChoice[];
  selected: string | null;
  logo(name: string): HTMLElement | undefined;
}) {
  const { document, localization: i18n } = ports,
    root = document.createElement('div'),
    caption = document.createElement('span'),
    select = document.createElement('select'),
    button = document.createElement('button'),
    menu = document.createElement('div'),
    controller = new AbortController();
  root.className = 'player-version-picker';
  caption.id = 'player-export-version-label';
  i18n.text(caption, 'Record version');
  select.id = 'player-export-version';
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.append(i18n.option('Choose the version of your record', ''));
  const label = (choice: VersionChoice) =>
    choice.logoVersion === null
      ? i18n.message('Imported version: {0}', [i18n.verbatim(choice.label)])
      : i18n.verbatim(choice.label);
  for (const choice of ports.choices) select.append(i18n.option(label(choice), choice.id));
  select.value = ports.selected || '';
  button.id = select.id + '-button';
  button.className = 'player-version-button';
  button.type = 'button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-labelledby', caption.id + ' ' + select.id + '-value');
  menu.id = select.id + '-choices';
  menu.className = 'player-version-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', caption.id);
  button.setAttribute('aria-controls', menu.id);
  function content(choice?: VersionChoice) {
    const node = document.createElement('span'),
      text = document.createElement('span');
    node.className = 'player-version-value';
    if (choice?.logoVersion) {
      const logo = ports.logo(choice.logoVersion);
      if (logo) {
        logo.setAttribute('aria-hidden', 'true');
        node.append(logo);
      }
    }
    i18n.text(text, choice ? label(choice) : 'Choose the version of your record');
    node.append(text);
    return node;
  }
  const choices = ports.choices.map((choice) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'player-version-option';
    option.tabIndex = -1;
    option.dataset.value = choice.id;
    option.setAttribute('role', 'option');
    option.append(content(choice));
    option.onclick = () => {
      select.value = choice.id;
      select.dispatchEvent(new Event('change'));
      close(true);
    };
    menu.append(option);
    return option;
  });
  function render() {
    const current = content(ports.choices.find((choice) => choice.id === select.value));
    current.id = select.id + '-value';
    button.replaceChildren(current);
    choices.forEach((option) =>
      option.setAttribute('aria-selected', String(option.dataset.value === select.value)),
    );
  }
  function close(focus = false) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  }
  function focusChoice(index: number) {
    const option = choices[index];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }
  function open(index = choices.findIndex((option) => option.dataset.value === select.value)) {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    focusChoice(Math.max(0, index));
  }
  button.onclick = () => (menu.hidden ? open() : close(true));
  button.onkeydown = (event) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : undefined);
    }
  };
  let search = '',
    searchTime = 0;
  menu.onkeydown = (event) => {
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      focusChoice(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? choices.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
      );
    } else if (event.key === 'Tab') {
      // Restore the trigger before native tab navigation leaves the closed list.
      close(true);
    } else if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now(),
        key = event.key.toLocaleLowerCase();
      search = now - searchTime < 700 ? search + key : key;
      searchTime = now;
      const query = [...search].every((character) => character === key) ? key : search;
      for (let offset = 1; offset <= choices.length; offset++) {
        const next = (index + offset) % choices.length,
          name = ports.choices[next].label.toLocaleLowerCase();
        if (name.startsWith(query) || name.replace(/^maimai(?:\s+dx)?\s+/, '').startsWith(query)) {
          focusChoice(next);
          break;
        }
      }
    }
  };
  const outside = (event: Event) => {
    if (!root.contains(event.target as Node | null)) close();
  };
  document.addEventListener('pointerdown', outside, { signal: controller.signal });
  document.addEventListener('focusin', outside, { signal: controller.signal });
  select.addEventListener('change', render, { signal: controller.signal });
  render();
  root.append(caption, select, button, menu);
  return { root, select, button, destroy: () => controller.abort() };
}
