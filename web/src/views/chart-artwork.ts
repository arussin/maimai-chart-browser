import type { TextView } from '../components/chart-card';
import { createArtworkModel, type ArtworkChart } from '../domain/artwork';
export interface ArtworkPorts {
  localization: Pick<TextView, 'text' | 'attribute' | 'locale'>;
  publicData: { catalog: readonly ArtworkChart[]; artwork?: unknown };
  title(chart: ArtworkChart): string;
  asset(path: string): string;
}
/** Display-only artwork from a verified catalog; image failure never changes identity. */
export function createChartArtwork(ports: ArtworkPorts) {
  /* Display-only artwork from the verified public catalog, with same-site images only. */
  const i18n = ports.localization,
    model = createArtworkModel(ports.publicData);
  function image(path: string | null | undefined, className: string, label: string) {
    const box = document.createElement('span');
    box.className = className + ' artwork-missing';
    i18n.attribute(box, 'title', label + ' unavailable');
    box.setAttribute('role', 'img');
    i18n.attribute(box, 'aria-label', label + ' unavailable');
    if (className === 'song-jacket') i18n.text(box, '♪');
    if (!model.accepted(path)) return box;
    const img = document.createElement('img');
    i18n.attribute(img, 'alt', '');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      box.classList.remove('artwork-missing');
      i18n.attribute(box, 'title', label);
      i18n.attribute(box, 'aria-label', label);
    };
    img.onerror = () => {
      img.remove();
      box.classList.add('artwork-missing');
      i18n.attribute(box, 'title', label + ' unavailable');
      i18n.attribute(box, 'aria-label', label + ' unavailable');
      if (className === 'song-jacket') i18n.text(box, '♪');
    };
    box.replaceChildren(img);
    img.src = ports.asset(path);
    return box;
  }
  function jacket(chart: ArtworkChart) {
    return image(model.jacket(chart), 'song-jacket', 'Jacket for ' + ports.title(chart));
  }
  function version(name: string) {
    const box = image(model.version(name), 'version-logo', name + ' logo');
    box.setAttribute('aria-hidden', 'true');
    box.removeAttribute('role');
    box.removeAttribute('aria-label');
    return box;
  }
  return Object.freeze({ jacket, version });
}
