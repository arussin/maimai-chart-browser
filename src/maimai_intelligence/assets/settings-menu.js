/* Header settings work independently of catalog loading and analytics consent. */
(() => {
  'use strict';
  if (window.maimaiSettings) return;
  const toggle = document.getElementById('settings-toggle');
  const menu = document.getElementById('settings-menu');
  if (!toggle || !menu) return;
  const control = toggle.parentElement;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  function close(focus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }
  function open() {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    items()[0]?.focus();
  }
  toggle.onclick = () => menu.hidden ? open() : close(true);
  toggle.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); open();
    }
  };
  menu.onkeydown = event => {
    const entries = items(), index = entries.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    }
  };
  control.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', event => {
    if (!control.contains(event.target)) close();
  });
  control.addEventListener('focusout', () => queueMicrotask(() => {
    if (!control.contains(document.activeElement)) close();
  }));
  window.maimaiSettings = Object.freeze({close, focus: () => toggle.focus()});
})();
