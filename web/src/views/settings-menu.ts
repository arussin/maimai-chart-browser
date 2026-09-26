import type { TextView, LocalizedText } from '../components/chart-card';
import type { UsageAPI } from '../usage';
import type { DETAILS } from '../usage-contract';
export interface SettingsLocalization extends Pick<TextView, 'text' | 'attribute'> {
  readonly locale?: string;
  translate(value: string): string;
}
export interface SettingsMenu {
  close(focus?: boolean): void;
  focus(): void;
}
export interface SettingsPorts {
  root: HTMLElement;
  localization?: SettingsLocalization;
  usage?: Pick<UsageAPI, 'emit'>;
}
type ShareService = (typeof DETAILS.share_destination_clicked)[number];
/** Settings and sharing receive their shell root; they do not depend on catalog readiness. */
export function createSettingsMenu(ports: SettingsPorts): SettingsMenu | undefined {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!,
    navigator = window.navigator;
  const find = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id);
  let settings: SettingsMenu | undefined;
  /* Header settings work independently of catalog loading and analytics consent. */
  (() => {
    'use strict';

    const foundToggle = find<HTMLButtonElement>('settings-toggle');
    const foundMenu = find('settings-menu');
    if (!foundToggle || !foundMenu) return;
    const toggle = foundToggle,
      menu = foundMenu,
      control = toggle.parentElement!;
    const items = () =>
      [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((item) => !item.hidden);
    function close(focus = false) {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focus) toggle.focus();
    }
    function open(last = false, focus = true) {
      if (menu.hidden) ports.usage?.emit('settings_opened');
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      fitMenu();
      const entries = items();
      if (focus) entries[last ? entries.length - 1 : 0]?.focus();
      else toggle.focus({ preventScroll: true });
    }
    function fitMenu() {
      if (!menu.hidden)
        menu.style.maxHeight =
          Math.max(0, window.innerHeight - menu.getBoundingClientRect().top - 12) + 'px';
    }
    window.addEventListener('resize', fitMenu);
    find('report-issue')?.addEventListener('click', () => ports.usage?.emit('report_issue_opened'));
    toggle.onclick = (event) => (menu.hidden ? open(false, event.detail === 0) : close(true));
    toggle.onkeydown = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open(event.key === 'ArrowUp');
      }
    };
    menu.addEventListener('click', (event) => {
      if (event.target instanceof window.Element && event.target.closest('a[role="menuitem"]'))
        setTimeout(() => close(true), 0);
    });
    menu.onkeydown = (event) => {
      const entries = items(),
        index = entries.findIndex((item) => item === document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
        entries[next]?.focus();
      }
    };
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        close(true);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!control.contains(event.target as Node | null)) close();
    });
    control.addEventListener('focusout', (event) => {
      // Some browsers blur the current item before focusing a clicked link.
      // A null destination must not hide that link between pointerdown and click.
      if (event.relatedTarget && !control.contains(event.relatedTarget as Node)) close();
    });
    settings = Object.freeze({ close, focus: () => toggle.focus() });
  })();

  /* Share the site, never the current route, search, import token, or player data.
   * AddToAny is an outbound destination only: no third-party script runs here. */
  (() => {
    'use strict';
    const foundTrigger = find<HTMLButtonElement>('site-share');
    if (!foundTrigger || find('site-share-dialog')) return;
    const trigger = foundTrigger;
    const siteURL = 'https://maimai.party/';
    const siteTitle = 'maimai.party';
    const i18n: SettingsLocalization = ports.localization || {
      text: (node, value) => {
        node.textContent = String(value);
      },
      attribute: (node, name, value) => node.setAttribute(name, String(value)),
      translate: (value) => value,
    };
    function make<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      text?: LocalizedText,
      className?: string,
    ): HTMLElementTagNameMap[K] {
      const node = document.createElement(tag);
      if (text !== undefined) i18n.text(node, text);
      if (className) node.className = className;
      return node;
    }
    function icon(path: string, filled = false) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const shape = document.createElementNS(svg.namespaceURI, 'path');
      shape.setAttribute('d', path);
      shape.setAttribute('fill', filled ? 'currentColor' : 'none');
      if (!filled) {
        shape.setAttribute('stroke', 'currentColor');
        shape.setAttribute('stroke-width', '1.8');
        shape.setAttribute('stroke-linecap', 'round');
        shape.setAttribute('stroke-linejoin', 'round');
      }
      svg.append(shape);
      return svg;
    }
    const dialog = make('dialog', undefined, 'site-share-dialog');
    dialog.id = 'site-share-dialog';
    dialog.setAttribute('aria-labelledby', 'site-share-title');
    dialog.setAttribute('aria-describedby', 'site-share-description');
    const header = make('header');
    const title = make('h2', 'Share this site');
    title.id = 'site-share-title';
    const close = make('button', undefined, 'site-share-close');
    close.type = 'button';
    i18n.attribute(close, 'aria-label', 'Close');
    close.append(icon(`M6 6l12 12M6 18 18 6`));
    close.id = 'site-share-close';
    close.onclick = () => dialog.close();
    header.append(title, close);
    const description = make(
      'p',
      'Share the public homepage. Your player data and current search are not included.',
    );
    description.id = 'site-share-description';
    const services = make('div', undefined, 'site-share-services');
    const linkRow = make('div', undefined, 'site-share-link-row');
    const link = make('input');
    link.type = 'url';
    link.value = siteURL;
    link.readOnly = true;
    link.id = 'site-share-url';
    i18n.attribute(link, 'aria-label', 'Website link');
    link.onclick = () => link.select();
    const copy = make('button');
    copy.type = 'button';
    copy.id = 'site-share-copy';
    copy.append(icon(`M9 9h11v11H9zM15 9V4H4v11h5`), make('span', 'Copy link'));
    linkRow.append(link, copy);
    const status = make('p', '', 'site-share-status');
    status.id = 'site-share-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    const actions = make('div', undefined, 'site-share-actions');
    const native = make('button');
    native.type = 'button';
    native.id = 'site-share-native';
    native.append(
      icon(`M12 15V3m-4 4 4-4 4 4M7 11H4v10h16V11h-3`),
      make('span', 'Share with device…'),
    );
    const more = make('a');
    more.id = 'site-share-more';
    more.append(icon(`M5 12h.01M12 12h.01M19 12h.01`), make('span', 'More…'));
    actions.append(native, more);
    const note = make(
      'p',
      'Social services open in a new tab. More options are provided by AddToAny.',
      'site-share-note',
    );
    dialog.append(header, services, linkRow, status, actions, description, note);
    root.append(dialog);
    let pending = false;
    const names: Partial<Record<ShareService, string>> = {
      line: 'LINE',
      x: 'X',
      hatena: 'Hatena',
      kakao: 'KakaoTalk',
      naver: 'Naver',
      wechat: 'WeChat',
      sina_weibo: 'Weibo',
      qzone: 'Qzone',
      facebook: 'Facebook',
      whatsapp: 'WhatsApp',
      facebook_messenger: 'Messenger',
      reddit: 'Reddit',
    };
    // Simple Icons 16.32.0 (CC0); pinned provenance: share-icons-source.json.
    const serviceIcons: Partial<Record<ShareService, string>> = {
      facebook: `M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z`,
      whatsapp: `M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z`,
      reddit: `M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z`,
      x: `M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z`,
      facebook_messenger: `M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13`,
      line: `M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314`,
      hatena: `M20.47 0C22.42 0 24 1.58 24 3.53v16.94c0 1.95-1.58 3.53-3.53 3.53H3.53C1.58 24 0 22.42 0 20.47V3.53C0 1.58 1.58 0 3.53 0h16.94zm-3.705 14.47c-.78 0-1.41.63-1.41 1.41s.63 1.414 1.41 1.414 1.41-.645 1.41-1.425-.63-1.41-1.41-1.41zM8.61 17.247c1.2 0 2.056-.042 2.58-.12.526-.084.976-.222 1.32-.412.45-.232.78-.564 1.02-.99s.36-.915.36-1.48c0-.78-.21-1.403-.63-1.87-.42-.48-.99-.734-1.74-.794.66-.18 1.156-.45 1.456-.81.315-.344.465-.824.465-1.424 0-.48-.103-.885-.3-1.26-.21-.36-.493-.645-.883-.87-.345-.195-.735-.315-1.215-.405-.464-.074-1.29-.12-2.474-.12H5.654v10.486H8.61zm.736-4.185c.705 0 1.185.088 1.44.262.27.18.39.495.39.93 0 .405-.135.69-.42.855-.27.18-.765.254-1.44.254H8.31v-2.297h1.05zm8.656.706v-7.06h-2.46v7.06H18zM8.925 9.08c.71 0 1.185.08 1.432.24.245.16.367.435.367.83 0 .38-.13.646-.39.804-.265.154-.747.232-1.452.232h-.57V9.08h.615z`,
      kakao: `M22.125 0H1.875C.8394 0 0 .8394 0 1.875v20.25C0 23.1606.8394 24 1.875 24h20.25C23.1606 24 24 23.1606 24 22.125V1.875C24 .8394 23.1606 0 22.125 0zM12 18.75c-.591 0-1.1697-.0413-1.7317-.1209-.5626.3965-3.813 2.6797-4.1198 2.7225 0 0-.1258.0489-.2328-.0141s-.0876-.2282-.0876-.2282c.0322-.2198.8426-3.0183.992-3.5333-2.7452-1.36-4.5701-3.7686-4.5701-6.5135C2.25 6.8168 6.6152 3.375 12 3.375s9.75 3.4418 9.75 7.6875c0 4.2457-4.3652 7.6875-9.75 7.6875zM8.0496 9.8672h-.8777v3.3417c0 .2963-.2523.5372-.5625.5372s-.5625-.2409-.5625-.5372V9.8672h-.8777c-.3044 0-.552-.2471-.552-.5508s.2477-.5508.552-.5508h2.8804c.3044 0 .552.2471.552.5508s-.2477.5508-.552.5508zm10.9879 2.9566a.558.558 0 0 1 .108.4167.5588.5588 0 0 1-.2183.371.5572.5572 0 0 1-.3383.1135.558.558 0 0 1-.4493-.2236l-1.3192-1.7479-.1952.1952v1.2273a.5635.5635 0 0 1-.5627.5628.563.563 0 0 1-.5625-.5625V9.3281c0-.3102.2523-.5625.5625-.5625s.5625.2523.5625.5625v1.209l1.5694-1.5694c.0807-.0807.1916-.1252.312-.1252.1404 0 .2814.0606.3871.1661.0985.0984.1573.2251.1654.3566.0082.1327-.036.2542-.1241.3425l-1.2818 1.2817 1.3845 1.8344zm-8.3502-3.5023c-.095-.2699-.3829-.5475-.7503-.5557-.3663.0083-.6542.2858-.749.5551l-1.3455 3.5415c-.1708.5305-.0217.7272.1333.7988a.8568.8568 0 0 0 .3576.0776c.2346 0 .4139-.0952.4678-.2481l.2787-.7297 1.7152.0001.2785.7292c.0541.1532.2335.2484.4681.2484a.8601.8601 0 0 0 .3576-.0775c.1551-.0713.3041-.2681.1329-.7999l-1.3449-3.5398zm-1.3116 2.4433l.5618-1.5961.5618 1.5961H9.3757zm5.9056 1.3836c0 .2843-.2418.5156-.5391.5156h-1.8047c-.2973 0-.5391-.2314-.5391-.5156V9.3281c0-.3102.2576-.5625.5742-.5625s.5742.2523.5742.5625v3.3047h1.1953c.2974 0 .5392.2314.5392.5156z`,
      naver: `M16.273 12.845 7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845Z`,
      wechat: `M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z`,
      sina_weibo: `M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM9.05 17.219c-.384.616-1.208.884-1.829.602-.612-.279-.793-.991-.406-1.593.379-.595 1.176-.861 1.793-.601.622.263.82.972.442 1.592zm1.27-1.627c-.141.237-.449.353-.689.253-.236-.09-.313-.361-.177-.586.138-.227.436-.346.672-.24.239.09.315.36.18.601l.014-.028zm.176-2.719c-1.893-.493-4.033.45-4.857 2.118-.836 1.704-.026 3.591 1.886 4.21 1.983.64 4.318-.341 5.132-2.179.8-1.793-.201-3.642-2.161-4.149zm7.563-1.224c-.346-.105-.57-.18-.405-.615.375-.977.42-1.804 0-2.404-.781-1.112-2.915-1.053-5.364-.03 0 0-.766.331-.571-.271.376-1.217.315-2.224-.27-2.809-1.338-1.337-4.869.045-7.888 3.08C1.309 10.87 0 13.273 0 15.348c0 3.981 5.099 6.395 10.086 6.395 6.536 0 10.888-3.801 10.888-6.82 0-1.822-1.547-2.854-2.915-3.284v.01zm1.908-5.092c-.766-.856-1.908-1.187-2.96-.962-.436.09-.706.511-.616.932.09.42.511.691.932.602.511-.105 1.067.044 1.442.465.376.421.466.977.316 1.473-.136.406.089.856.51.992.405.119.857-.105.992-.512.33-1.021.12-2.178-.646-3.035l.03.045zm2.418-2.195c-1.576-1.757-3.905-2.419-6.054-1.968-.496.104-.812.587-.706 1.081.104.496.586.813 1.082.707 1.532-.331 3.185.15 4.296 1.383 1.112 1.246 1.429 2.943.947 4.416-.165.48.106 1.007.586 1.157.479.165.991-.104 1.157-.586.675-2.088.241-4.478-1.338-6.235l.03.045z`,
      qzone: `M23.9868 9.2012c-.032-.099-.127-.223-.334-.258-.207-.036-7.352-1.4063-7.352-1.4063s-.105-.022-.198-.07c-.092-.047-.127-.167-.127-.167S12.4472.954 12.3491.7679c-.099-.187-.245-.238-.349-.238-.104 0-.251.051-.349.238C11.5531.954 8.0245 7.3 8.0245 7.3s-.035.12-.128.167c-.092.047-.197.07-.197.07S.5546 8.9071.3466 8.9421c-.208.036-.302.16-.333.258a.477.477 0 00.125.4491L5.5013 15.14s.072.08.119.172c.016.104.005.21.005.21s-1.1891 7.243-1.2201 7.451c-.031.208.075.369.159.4301.083.062.233.106.421.013.189-.093 6.813-3.2614 6.813-3.2614s.098-.044.201-.061c.103-.017.201.061.201.061s6.624 3.1684 6.813 3.2614c.188.094.338.049.421-.013a.463.463 0 00.159-.43c-.021-.14-.93-5.6778-.93-5.6778.876-.5401 1.4251-1.0392 1.8492-1.7473-2.5944.9692-6.0069 1.7173-9.4163 1.8663-.9152.041-2.4104.097-3.4735-.015-.6781-.071-1.1702-.144-1.2432-.438-.053-.2151.054-.4601.5451-.8312a2640.8625 2640.8625 0 012.8614-2.1553c1.2852-.9681 3.5595-2.4703 3.5595-2.7314 0-.285-2.1443-.781-4.0376-.781-1.9452 0-2.2753.132-2.8114.168-.488.034-.769.005-.804-.138-.06-.2481.183-.3891.588-.5682.7091-.314 1.8603-.594 1.9843-.626.194-.052 3.0824-.8051 5.6188-.5351 1.3181.14 3.2444.668 3.2444 1.2762 0 .342-1.7212 1.4942-3.2254 2.5973-1.1492.8431-2.2173 1.5612-2.2173 1.6883 0 .342 3.5334 1.2411 6.6899 1.01l.003-.022c.048-.092.119-.172.119-.172l5.3627-5.4907a.477.477 0 00.127-.449z`,
    };
    const suggestions: Record<string, ShareService[]> = {
      ja: ['line', 'x', 'hatena'],
      ko: ['kakao', 'naver'],
      zh: ['wechat', 'sina_weibo', 'qzone'],
      en: ['facebook', 'whatsapp', 'reddit', 'x', 'facebook_messenger'],
    };
    function locale() {
      // Explicit site-language choice takes precedence; browser locale is only a fallback.
      const language = i18n.locale || (navigator.languages || [navigator.language])[0] || 'en';
      const base = language.toLowerCase().split('-')[0];
      return Object.hasOwn(suggestions, base) ? base : 'en';
    }
    function destination(service: ShareService) {
      const naver = service === 'naver';
      const url = new URL(
        naver
          ? 'https://share.naver.com/web/shareView'
          : service === 'more'
            ? 'https://www.addtoany.com/share'
            : 'https://www.addtoany.com/add_to/' + service,
      );
      url.searchParams.set(naver ? 'url' : 'linkurl', siteURL);
      url.searchParams.set(naver ? 'title' : 'linkname', siteTitle);
      return url.href;
    }
    function external(anchor: HTMLAnchorElement, service: ShareService) {
      anchor.href = destination(service);
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.referrerPolicy = 'no-referrer';
      anchor.dataset.shareService = service;
      anchor.onclick = () => ports.usage?.emit('share_destination_clicked', undefined, service);
    }
    external(more, 'more');
    function render() {
      services.replaceChildren();
      for (const service of suggestions[locale()]) {
        const anchor = make('a', undefined, 'site-share-service');
        const mark = make('span', undefined, 'site-share-app-icon');
        mark.append(icon(serviceIcons[service]!, true));
        anchor.append(mark, make('span', names[service], 'site-share-app-label'));
        external(anchor, service);
        services.append(anchor);
      }
      native.hidden = typeof navigator.share !== 'function';
    }
    function fallback() {
      render();
      i18n.text(status, '');
      if (!dialog.open) dialog.showModal();
      copy.focus();
    }
    function data() {
      return {
        url: siteURL,
        title: siteTitle,
        text: i18n.translate('Explore maimai charts, patterns, and personal progress.'),
      };
    }
    async function shareNative() {
      if (pending) return;
      const payload = data();
      try {
        if (
          typeof navigator.share !== 'function' ||
          (typeof navigator.canShare === 'function' && !navigator.canShare(payload))
        ) {
          fallback();
          return;
        }
        pending = true;
        trigger.disabled = true;
        native.disabled = true;
        // Invoke synchronously in the click handler, before any await or lazy loading.
        await navigator.share(payload);
        ports.usage?.emit('share_native_result', undefined, 'resolved');
        if (dialog.open) dialog.close();
        else settings?.focus();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          ports.usage?.emit('share_native_result', undefined, 'cancelled');
          // Cancellation is not an error: do not open another picker or claim success.
          if (!dialog.open) settings?.focus();
        } else {
          ports.usage?.emit('share_native_result', undefined, 'failed');
          fallback();
        }
      } finally {
        pending = false;
        trigger.disabled = false;
        native.disabled = false;
      }
    }
    function mobileDevice() {
      return (
        (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
          ?.mobile === true ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
    }
    trigger.onclick = () => {
      if (pending) return;
      ports.usage?.emit('share_opened');
      settings?.close();
      if (mobileDevice() && typeof navigator.share === 'function') void shareNative();
      else fallback();
    };
    native.onclick = () => {
      void shareNative();
    };
    copy.onclick = async () => {
      copy.disabled = true;
      try {
        if (typeof navigator.clipboard?.writeText !== 'function')
          throw new Error('clipboard-unavailable');
        await navigator.clipboard.writeText(siteURL);
        ports.usage?.emit('share_copied');
        if (dialog.open) i18n.text(status, 'Link copied');
      } catch {
        if (dialog.open) {
          link.focus();
          link.select();
          i18n.text(status, 'Copy the selected link using your device’s copy command.');
        }
      } finally {
        copy.disabled = false;
      }
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button,a[href],input')].filter(
        (node) =>
          !node.hidden && !('disabled' in node && node.disabled) && node.getClientRects().length,
      );
      if (!controls.length) return;
      // Include service links even in browsers that skip links in the default Tab order.
      const index = controls.findIndex((item) => item === document.activeElement);
      const next =
        index < 0
          ? event.shiftKey
            ? controls.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next].focus();
    });
    dialog.addEventListener('close', () => settings?.focus());
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
    window.addEventListener('maimai-language-change', () => {
      if (dialog.open) render();
    });
  })();

  return settings;
}
