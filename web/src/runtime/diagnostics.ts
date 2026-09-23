/** Bounded, in-memory operational codes. Never connected to the usage collector. */
export type BrowserDiagnostic = 'catalog_unavailable' | 'route_unavailable' | 'detail_unavailable';
const codes: BrowserDiagnostic[] = [];
export function diagnose(code: BrowserDiagnostic): void {
  codes.push(code);
  if (codes.length > 20) codes.shift();
}
export function diagnostics(): readonly BrowserDiagnostic[] {
  return Object.freeze([...codes]);
}
export function catalogFailure(root: HTMLElement, locale: string): void {
  diagnose('catalog_unavailable');
  const messages: Record<string, readonly [string, string]> = {
    en: [
      'The catalog could not be loaded. Public song information remains available.',
      'Retry loading',
    ],
    ja: ['カタログを読み込めませんでした。公開楽曲情報は引き続き表示できます。', '再読み込み'],
    ko: ['카탈로그를 불러오지 못했습니다. 공개 곡 정보는 계속 볼 수 있습니다.', '다시 불러오기'],
    'zh-Hans': ['无法加载曲目库。仍可查看公开歌曲信息。', '重新加载'],
  };
  const document = root.ownerDocument;
  const status =
    root.querySelector<HTMLElement>('#lab-status,[data-diagnostic="catalog_unavailable"]') ??
    document.createElement('p');
  // A validated catalog rejection already owns its localized explanation.
  if (status.dataset.catalogError) return;
  const retry = document.createElement('button');
  status.setAttribute('role', 'status');
  status.dataset.diagnostic = 'catalog_unavailable';
  retry.type = 'button';
  retry.onclick = () => document.defaultView?.location.reload();
  const update = (language: string) => {
    const [message, label] = messages[language] ?? messages.en;
    status.replaceChildren(document.createTextNode(message + ' '), retry);
    retry.textContent = label;
  };
  update(locale);
  if (!status.isConnected) root.prepend(status);
  document.defaultView?.addEventListener('maimai-language-change', () =>
    update(document.documentElement.lang),
  );
}

/** Transient local status; neither a page activation nor a usage event. */
export function catalogPending(root: HTMLElement, locale: string): HTMLElement {
  const status = root.ownerDocument.createElement('p');
  status.dataset.catalogProgress = '';
  status.setAttribute('role', 'status');
  status.textContent =
    (
      {
        en: 'Loading catalog…',
        ja: 'カタログを読み込み中…',
        ko: '카탈로그를 불러오는 중…',
        'zh-Hans': '正在加载曲目库…',
      } as Record<string, string>
    )[locale] || 'Loading catalog…';
  root.prepend(status);
  return status;
}
