/* Header settings work independently of catalog loading and analytics consent. */
(() => {
  'use strict';
  if (window.maimaiSettings) return;
  const toggle = document.getElementById('settings-toggle');
  const menu = document.getElementById('settings-menu');
  if (!toggle || !menu) return;
  const control = toggle.parentElement;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.hidden);
  function close(focus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }
  function open(last = false, focus = true) {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    fitMenu();
    const entries = items();
    if (focus) entries[last ? entries.length - 1 : 0]?.focus();
  }
  function fitMenu() {
    if (!menu.hidden) menu.style.maxHeight = Math.max(0, window.innerHeight - menu.getBoundingClientRect().top - 12) + 'px';
  }
  window.addEventListener('resize', fitMenu);
  toggle.onclick = event => menu.hidden ? open(false, event.detail === 0) : close(true);
  toggle.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); open(event.key === 'ArrowUp');
    }
  };
  menu.addEventListener('click', event => {
    if (event.target.closest('a[role="menuitem"]')) setTimeout(() => close(true), 0);
  });
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
  control.addEventListener('focusout', event => {
    // Some browsers blur the current item before focusing a clicked link.
    // A null destination must not hide that link between pointerdown and click.
    if (event.relatedTarget && !control.contains(event.relatedTarget)) close();
  });
  window.maimaiSettings = Object.freeze({close, focus: () => toggle.focus()});
})();
