/* Adapted from arussin/maimai-session-report's support.js (MIT, Copyright 2026 arussin).
 * The checkout stays in a separate origin and starts only after an explicit click. */
(() => {
  'use strict';
  const opener = document.getElementById('support-open');
  if (!opener || opener.dataset.checkoutReady || typeof HTMLDialogElement === 'undefined' ||
      typeof HTMLDialogElement.prototype.showModal !== 'function') return;
  opener.dataset.checkoutReady = 'true';
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.setAttribute('aria-controls', 'support-checkout-dialog');

  const origin = 'https://buymeacoffee.com';
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const dialog = element('dialog', 'support-dialog');
  dialog.id = 'support-checkout-dialog';
  dialog.setAttribute('aria-labelledby', 'support-dialog-title');
  const header = element('header', 'support-dialog-header');
  const heading = element('div', 'support-dialog-heading');
  const title = element('h2', 'support-dialog-title', 'Buy the creator a maimai credit');
  title.id = 'support-dialog-title';
  heading.append(title);
  const close = element('button', 'support-dialog-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close support checkout');
  header.append(heading, close);

  const wrap = element('div', 'support-frame-wrap');
  const loading = element('div', 'support-loading');
  loading.setAttribute('role', 'status');
  const ring = element('span', 'support-loading-ring');
  ring.setAttribute('aria-hidden', 'true');
  const status = element('span', 'support-loading-copy', 'Opening secure checkout…');
  loading.append(ring, status);
  wrap.append(loading);
  const frame = element('iframe', 'support-frame');
  frame.title = 'Buy Me a Coffee support checkout';
  frame.allow = `payment ${origin}`;
  frame.referrerPolicy = 'no-referrer';
  wrap.append(frame);

  const footer = element('footer', 'support-dialog-footer');
  footer.hidden = true;
  const fallback = element('a', 'support-fallback', 'Open on Buy Me a Coffee ↗');
  fallback.href = `${origin}/russin`;
  fallback.target = '_blank';
  fallback.rel = 'noopener noreferrer';
  fallback.referrerPolicy = 'no-referrer';
  footer.append(fallback);
  dialog.append(header, wrap, footer);
  document.body.append(dialog);

  let started = false;
  function startCheckout() {
    if (started) return;
    started = true;
    const slow = setTimeout(() => {
      ring.hidden = true;
      status.textContent = 'Checkout hasn’t loaded yet.';
      footer.hidden = false;
    }, 12000);
    frame.addEventListener('load', () => {
      // Ignore the empty frame's initial load, including a cancelled navigation.
      try { if (frame.contentWindow.location.href === 'about:blank') return; } catch { /* Separate provider origin. */ }
      clearTimeout(slow);
      loading.hidden = true;
      footer.hidden = true;
    });
    const url = new URL(`${origin}/widget/page/russin`);
    url.searchParams.set('description', 'Support maimai.party');
    url.searchParams.set('color', '#5F7FFF');
    frame.src = url.toString();
  }
  opener.addEventListener('click', event => {
    // Preserve the ordinary link for new-tab gestures and browsers without dialogs.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    dialog.showModal();
    document.body.classList.add('support-dialog-open');
    close.focus();
    startCheckout();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('support-dialog-open');
    opener.focus({preventScroll: true});
  });
})();
