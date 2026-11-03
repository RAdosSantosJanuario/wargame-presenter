import { getLang, setLang, t } from '../i18n.js';
import { h } from '../util.js';

export function brand() {
  return h('a', { class: 'brand', href: '#/', title: t('nav.library') },
    h('span', { class: 'brand-mark', html: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 29 9v14l-13 7L3 23V9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 9v14M9 13l7 4 7-4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="17" r="2.2" fill="currentColor"/></svg>' }),
    h('span', { class: 'brand-text' }, h('b', null, 'WARGAME'), h('span', null, 'PRESENTER')));
}

export function langSwitch(onChange) {
  const cur = getLang();
  return h('div', { class: 'seg lang-switch', role: 'group', 'aria-label': t('nav.language') },
    ['en', 'de'].map((l) => h('button', {
      type: 'button',
      class: l === cur ? 'on' : '',
      onClick: () => { if (l !== getLang()) { setLang(l); onChange?.(l); } },
    }, l.toUpperCase())));
}

export function appHeader({ middle = null, actions = [] } = {}) {
  return h('header', { class: 'topbar' },
    brand(),
    h('div', { class: 'topbar-mid' }, middle),
    h('div', { class: 'topbar-actions' }, actions, langSwitch()));
}

export function errorPage(root, message) {
  root.append(h('div', { class: 'page error-page' },
    h('div', { class: 'error-box' },
      h('div', { class: 'kicker' }, t('err.title')),
      h('p', null, message),
      h('a', { class: 'btn primary', href: '#/' }, t('nav.backToLibrary')))));
}
