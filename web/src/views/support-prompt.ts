import type { TextView } from '../components/chart-card';

export function supportHeart(document: Document): SVGSVGElement {
  const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  heart.setAttribute('viewBox', '0 0 24 24');
  heart.setAttribute('width', '16');
  heart.setAttribute('height', '16');
  heart.setAttribute('fill', 'none');
  heart.setAttribute('stroke', 'currentColor');
  heart.setAttribute('stroke-width', '1.7');
  heart.setAttribute('stroke-linecap', 'round');
  heart.setAttribute('stroke-linejoin', 'round');
  heart.setAttribute('aria-hidden', 'true');
  heart.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8Z',
  );
  heart.append(path);
  return heart;
}

/** An optional entry to the existing checkout; no payment or player state lives here. */
export function createSupportPrompt(
  document: Document,
  localization: Pick<TextView, 'text'>,
  context: 'import' | 'export',
): HTMLDivElement | null {
  if (!document.querySelector('#support-open[data-checkout-ready="stripe"]')) return null;
  const note = document.createElement('div');
  note.className = 'player-support-prompt';
  note.dataset.supportContext = context;
  const text = document.createElement('p'),
    intro = document.createElement('span'),
    link = document.createElement('button');
  localization.text(intro, 'maimai.party is free to use, but costs quite a bit to maintain.');
  link.type = 'button';
  link.className = 'player-support-link';
  link.dataset.supportOpen = '';
  link.setAttribute('aria-haspopup', 'dialog');
  link.setAttribute('aria-controls', 'support-checkout-dialog');
  localization.text(link, 'Please consider supporting its development and hosting.');
  text.append(intro, document.createElement('br'), link);
  note.append(supportHeart(document), text);
  return note;
}
