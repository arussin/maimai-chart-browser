import type { Tab } from './contracts';
import type { NavigationCoordinator } from './navigation';
const names: Tab[] = ['catalog', 'patterns', 'compare', 'about'];
const labels = {
  catalog: 'charts',
  patterns: 'pattern dictionary',
  compare: 'comparison',
  about: 'about',
};
export function createTabs(
  navigation: NavigationCoordinator,
  localization: { text: (node: Node, value: string) => void },
) {
  function show(name: Tab, preservePattern = false) {
    if (!names.includes(name)) return;
    for (const id of names) {
      document.getElementById(id)!.hidden = id !== name;
      document.getElementById(id + '-tab')!.setAttribute('aria-pressed', String(id === name));
    }
    const skip = document.querySelector<HTMLAnchorElement>('.skip-link')!;
    skip.href = '#' + name;
    localization.text(skip, 'Skip to ' + labels[name]);
    navigation.tabCommitted(name, preservePattern);
  }
  for (const name of names) document.getElementById(name + '-tab')!.onclick = () => show(name);
  const requested = new URLSearchParams(location.search).get('view') as Tab;
  navigation.silent(() =>
    show(
      location.hash === '#privacy' ? 'about' : names.includes(requested) ? requested : 'catalog',
      true,
    ),
  );
  if (location.hash === '#privacy')
    (document.getElementById('privacy') as HTMLDetailsElement).open = true;
  return { show };
}
