import type { LocalizedText } from '../components/chart-card';
import type { Locale } from '../runtime/contracts';
export interface TranslationRow extends Partial<Record<Locale, string>> {
  $translate?: number[];
}
export interface LocalizationConfiguration {
  messages: Record<string, TranslationRow>;
  flags: Record<string, string>;
}
interface Binding {
  node: WeakRef<Node>;
  source: LocalizedText;
  apply(node: Node, value: string): void;
}
/** Site-owned copy and explicit literal content, scoped to the supplied shell root. */
export function createLocalization(ports: {
  root: HTMLElement;
  configuration: LocalizationConfiguration;
}) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!,
    navigator = window.navigator,
    location = window.location;
  /* Site-owned copy only. No DOM observer, network translation, or catalog mutation. */

  const catalogs = ports.configuration.messages;
  const languages: readonly Locale[] = ['en', 'zh-Hans', 'ko', 'ja'];
  const isLocale = (value: unknown): value is Locale =>
    typeof value === 'string' && languages.includes(value as Locale);
  const names = { en: 'English', 'zh-Hans': '简体中文', ko: '한국어', ja: '日本語' };
  const key = 'maimai-language-v1';
  const readmeLinks = new Map<HTMLAnchorElement, string>();
  const verbatim = (value: unknown) => ({ literal: String(value ?? '') });
  const parts = (values: LocalizedText[], separator: string) => ({ parts: values, separator });
  const message = (source: string, values: LocalizedText[]) => ({ message: source, values });
  const sourceText = (value: LocalizedText | null | undefined): string =>
    value && typeof value === 'object'
      ? 'literal' in value
        ? value.literal
        : 'message' in value
          ? value.message.replace(/\{(\d+)\}/g, (_, n: string) =>
              sourceText(value.values[Number(n)]),
            )
          : value.parts.map(sourceText).join(value.separator)
      : String(value ?? '');
  const negotiate = (values: readonly unknown[]): Locale => {
    for (const value of values) {
      const language = String(value).toLowerCase();
      if (/^zh(?:-|$)/.test(language)) return 'zh-Hans';
      if (/^ko(?:-|$)/.test(language)) return 'ko';
      if (/^ja(?:-|$)/.test(language)) return 'ja';
      if (/^en(?:-|$)/.test(language)) return 'en';
    }
    return 'en';
  };
  let locale = negotiate(navigator.languages || [navigator.language]);
  try {
    const saved = localStorage.getItem(key);
    if (isLocale(saved)) locale = saved;
  } catch {}
  // Explicit public route language wins without overwriting the user's saved preference.
  const routeLocale = (
    { en: 'en', ja: 'ja', ko: 'ko', 'zh-hans': 'zh-Hans' } as Record<string, Locale>
  )[location.pathname.split('/')[1]];
  const linkedLocale = new URLSearchParams(location.search).get('lang');
  if (routeLocale) locale = routeLocale;
  else if (isLocale(linkedLocale)) locale = linkedLocale;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.keys(catalogs)
    .filter((source) => /\{\d+\}/.test(source))
    .map((source) => {
      const parts = source.split(/(\{\d+\})/);
      return {
        source,
        indices: parts.filter((p) => /^\{\d+\}$/.test(p)).map((p) => Number(p.slice(1, -1))),
        expression: new RegExp(
          '^' + parts.map((p) => (/^\{\d+\}$/.test(p) ? '(.*?)' : escape(p))).join('') + '$',
          's',
        ),
        specificity: source.replace(/\{\d+\}/g, '').length,
      };
    })
    .sort((a, b) => b.specificity - a.specificity);
  function translate(value: LocalizedText | null | undefined): string {
    if (value && typeof value === 'object' && 'literal' in value) return value.literal;
    if (value && typeof value === 'object' && 'parts' in value)
      return value.parts.map(translate).join(translate(value.separator));
    if (value && typeof value === 'object' && 'message' in value)
      return (
        locale === 'en' ? value.message : catalogs[value.message]?.[locale] || value.message
      ).replace(/\{(\d+)\}/g, (_, n: string) => translate(value.values[Number(n)]));
    const source = String(value ?? '');
    if (locale === 'en' || !source.trim()) return source;
    const leading = source.match(/^\s*/)![0],
      trailing = source.match(/\s*$/)![0],
      trimmed = source.trim();
    const exact = catalogs[trimmed];
    if (exact) return leading + (exact[locale] ?? trimmed) + trailing;
    for (const pattern of patterns) {
      const match = pattern.expression.exec(trimmed);
      if (match) {
        const values: Record<number, string> = {};
        pattern.indices.forEach((index, i) => {
          values[index] = match[i + 1];
        });
        return (
          leading +
          (catalogs[pattern.source][locale] ?? pattern.source).replace(
            /\{(\d+)\}/g,
            (_, n: string) =>
              catalogs[pattern.source].$translate?.includes(Number(n))
                ? translate(values[Number(n)])
                : values[Number(n)],
          ) +
          trailing
        );
      }
    }
    return source;
  }
  // Weak references let discarded catalog rows and closed lessons be collected.
  const bindings = new Set<Binding>(),
    registered = new WeakMap<Node, Map<string, Binding>>();
  function bind(node: Node, slot: string, source: LocalizedText, apply: Binding['apply']) {
    let slots = registered.get(node);
    if (!slots) {
      slots = new Map();
      registered.set(node, slots);
    }
    let entry = slots.get(slot);
    if (!entry) {
      entry = { node: new WeakRef(node), source, apply };
      slots.set(slot, entry);
      bindings.add(entry);
    }
    entry.source = source;
    apply(node, translate(source));
  }
  function text(node: Node, source: LocalizedText) {
    const value = sourceText(source);
    if (node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE)
      node.firstChild!.nodeValue = value;
    else node.textContent = value;
    // Bind the text node rather than its parent; labels may later receive an input.
    if (node.firstChild)
      bind(node.firstChild, 'text', source, (target, value) => {
        target.nodeValue = value;
      });
    return source;
  }
  const attributes = new Set(['title', 'aria-label', 'aria-valuetext', 'placeholder', 'alt']);
  function attribute(node: Element, name: string, source: LocalizedText) {
    if (attributes.has(name))
      bind(node, name, source, (target, value) => (target as Element).setAttribute(name, value));
    else node.setAttribute(name, sourceText(source));
    return source;
  }
  function option(label: LocalizedText, value: string, defaultSelected = false, selected = false) {
    const node = new Option('', value, defaultSelected, selected);
    text(node, label);
    return node;
  }
  // Explicit escape hatch for official names and user data, including words that
  // happen to equal a UI message (a song or player could be named "Close").
  function literal(node: Node, source: unknown) {
    text(node, verbatim(source));
    return source;
  }
  function original(node: Node, attributeName?: string) {
    const target = attributeName ? node : node.nodeType === Node.TEXT_NODE ? node : node.firstChild;
    const source = target && registered.get(target)?.get(attributeName || 'text')?.source;
    return (
      source ?? (attributeName ? (node as Element).getAttribute(attributeName) : node.textContent)
    );
  }
  function staticText(root: HTMLElement) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode())
      if (!walk.currentNode.parentElement?.closest('script,style,noscript,[data-i18n-literal]'))
        nodes.push(walk.currentNode);
    for (const node of nodes)
      if (!registered.has(node) && catalogs[(node.nodeValue ?? '').trim()])
        bind(node, 'text', node.nodeValue ?? '', (target, value) => {
          target.nodeValue = value;
        });
    for (const node of root.querySelectorAll(
      '[title],[aria-label],[aria-valuetext],[placeholder],[alt]',
    )) {
      if (node.closest('[data-i18n-literal]')) continue;
      for (const name of attributes)
        if (
          !registered.get(node)?.has(name) &&
          node.hasAttribute(name) &&
          catalogs[(node.getAttribute(name) ?? '').trim()]
        )
          attribute(node, name, node.getAttribute(name) ?? '');
    }
  }
  function setLocale(next: string, { persist = true } = {}) {
    if (!isLocale(next)) return false;
    locale = next;
    if (persist)
      try {
        localStorage.setItem(key, next);
      } catch {}
    document.documentElement.lang = locale;
    document.documentElement.style.setProperty(
      '--label-constant',
      JSON.stringify(translate('Constant')),
    );
    document.documentElement.style.setProperty(
      '--label-speed',
      JSON.stringify(translate('Inputs / s')),
    );
    for (const entry of bindings) {
      const node = entry.node.deref();
      if (!node) bindings.delete(entry);
      else entry.apply(node, translate(entry.source));
    }
    for (const button of root.querySelectorAll<HTMLElement>('[data-language]'))
      button.setAttribute('aria-pressed', String(button.dataset.language === locale));
    for (const [link, english] of readmeLinks)
      link.setAttribute(
        'href',
        locale === 'en' ? english : english + '/blob/main/README.' + locale + '.md',
      );
    window.dispatchEvent(new CustomEvent('maimai-language-change', { detail: locale }));
    return true;
  }
  // Unmodified Famfamfam PNGs by Mark James, bundled at build time.
  const flags = ports.configuration.flags;
  function controls(host: Element) {
    const controls = document.createElement('div');
    controls.className = 'language-controls';
    controls.setAttribute('role', 'group');
    attribute(controls, 'aria-label', 'Language');
    for (const language of languages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.language = language;
      button.title = names[language];
      button.setAttribute('aria-label', names[language]);
      const icon = document.createElement('img');
      icon.src = flags[language];
      icon.alt = '';
      icon.width = 16;
      icon.height = 11;
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      button.onclick = () => setLocale(language);
      controls.append(button);
    }
    host.append(controls);
    for (const button of controls.querySelectorAll<HTMLElement>('[data-language]'))
      button.setAttribute('aria-pressed', String(button.dataset.language === locale));
    return controls;
  }
  function mount() {
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-localized-readme]'))
      readmeLinks.set(link, link.getAttribute('href') ?? '');
    staticText(root);
    const title = document.querySelector('head title');
    if (title && catalogs[title.textContent ?? '']) text(title, title.textContent ?? '');
    const header =
      root.querySelector('[data-version-browser] .site-header') ||
      root.querySelector('.site-header');
    controls(header || root.querySelector('main') || root);
    setLocale(locale, { persist: false });
  }
  const searchTerms = (value: string) =>
    [value, ...languages.filter((l) => l !== 'en').map((l) => catalogs[value]?.[l] || '')].join(
      ' ',
    );
  const localization = Object.freeze({
    text,
    literal,
    verbatim,
    parts,
    message,
    original,
    attribute,
    option,
    translate,
    searchTerms,
    staticText,
    controls,
    setLocale,
    negotiate,
    get locale() {
      return locale;
    },
  });
  document.documentElement.lang = locale;
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  window.addEventListener('storage', (event) => {
    if (event.key === key && isLocale(event.newValue))
      setLocale(event.newValue, { persist: false });
  });
  return localization;
}
