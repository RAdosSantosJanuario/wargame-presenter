// Small DOM + helper toolkit (no dependencies).
import { icon } from './icons.js';

export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null || sv === '') continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function debounce(fn, ms = 300) {
  let timer = null;
  const d = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  d.flush = (...args) => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
  d.pending = () => timer !== null;
  return d;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Markdown-lite: **bold**, *italic*, `code`, ==mark==, # / ## headings, - bullets, 1. numbered.
export function md(src) {
  const lines = escapeHtml(src || '').split(/\r?\n/);
  let html = '';
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { html += `<p>${para.join('<br>')}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara(); flushList();
      const lvl = m[1].length;
      html += `<h${lvl + 1} class="md-h${lvl}">${inline(m[2])}</h${lvl + 1}>`;
      continue;
    }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    flushList();
    para.push(inline(line));
  }
  flushPara();
  flushList();
  return html;
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

// ---------- toasts ----------
export function toast(msg, type = 'info', ms = 2600) {
  let host = document.querySelector('.toasts');
  if (!host) host = document.body.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }));
  const el = h('div', { class: ['toast', type] }, msg);
  host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, className = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = overlay.querySelector('.modal-foot .btn.primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    };
    const foot = actions.length
      ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
        class: ['btn', a.primary && 'primary', a.danger && 'danger', a.ghost && 'ghost'],
        onClick: async () => {
          const r = a.onClick ? await a.onClick() : undefined;
          if (r !== false) close(r === undefined ? a.value : r);
        },
      }, a.label)))
      : null;
    const overlay = h('div', {
      class: 'modal-overlay',
      onPointerdown: (e) => { if (e.target === overlay) close(null); },
    }, h('div', { class: ['modal', wide && 'wide', className], role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' },
        h('h3', null, title),
        h('button', { class: 'icon-btn', title: 'Close', onClick: () => close(null) }, icon('x'))),
      h('div', { class: 'modal-body' }, typeof body === 'function' ? body(close) : body),
      foot));
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    setTimeout(() => overlay.querySelector('.modal-body input, .modal-body textarea, .modal-body select, .modal-foot .btn.primary')?.focus(), 40);
  });
}

export function confirmDialog(title, message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return modal({
    title,
    body: h('p', { class: 'modal-text' }, message),
    actions: [
      { label: cancelLabel, ghost: true, value: false },
      { label: okLabel, primary: !danger, danger, value: true },
    ],
  }).then((v) => v === true);
}

export function isModalOpen() {
  return !!document.querySelector('.modal-overlay');
}

// ---------- files ----------
export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataURL') r.readAsDataURL(file);
    else r.readAsText(file, 'utf-8');
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function fmtDate(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function storageGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
