import model from '../../../src/maimai_intelligence/assets/public-routes.json' with { type: 'json' };
const encodeIdentity = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
  );
/** Public chart fragments carry a selection, never a second canonical song URL. */
export const chartFragment = (chartID: string): string => '#chart-' + encodeIdentity(chartID);
export function chartFromFragment(fragment: string): string | undefined {
  if (!fragment.startsWith('#chart-')) return undefined;
  try {
    return decodeURIComponent(fragment.slice(7)) || undefined;
  } catch {
    return undefined;
  }
}
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const routePattern = new RegExp(
  '^/(' +
    Object.keys(model.locales).map(escaped).join('|') +
    ')/(' +
    model.kinds.map(escaped).join('|') +
    ')/[^/]+/$',
);
export function publicPath(locale: string, kind: 'songs' | 'versions', slug: string): string {
  if (
    !Object.hasOwn(model.locales, locale) ||
    !model.kinds.includes(kind) ||
    !slug ||
    /[/?#\\]/.test(slug)
  )
    throw Error('Invalid canonical public route');
  return '/' + locale + '/' + kind + '/' + encodeIdentity(slug) + '/';
}
