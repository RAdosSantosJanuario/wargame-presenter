// Network map element: systems (nodes), connections (links) and zones, drawn as
// SVG. Node status and link style can change during the exercise through
// conditions (same rules as conditional pages), so the map reacts to decisions.
import { tr, t } from './i18n.js';
import { escapeHtml as esc } from './util.js';
import { ICONS } from './icons.js';
import { evalCondition } from './model.js';

export const NET_STATUSES = ['normal', 'clean', 'unknown', 'suspicious', 'compromised', 'encrypted', 'isolated', 'offline'];
export const NET_LINK_STYLES = ['normal', 'attack', 'suspicious', 'blocked'];
// node icon id -> icon in icons.js
export const NET_ICONS = {
  server: 'server', database: 'database', firewall: 'firewall', cloud: 'cloud', internet: 'globe',
  client: 'laptop', workstation: 'monitor', user: 'user', vpn: 'key', site: 'building', backup: 'archive',
  router: 'router', app: 'app', mail: 'mail', phone: 'phone', mobile: 'sms', security: 'shield',
};

const W = 1000;
let seq = 0;
const f = (n) => Math.round(n * 10) / 10;
const cut = (s, max) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

export function chosenFromData(data) {
  const set = new Set();
  for (const d of data?.decisions || []) for (const r of d.results || []) set.add(r.choiceId);
  return set;
}

// Current status of every node / style of every link. base = ignore the rules.
export function resolveNetwork(el, data, base = false) {
  const values = data?.values || {};
  const chosen = chosenFromData(data);
  const pick = (states) => {
    if (base) return null;
    for (const s of states || []) {
      if (s.condition?.rules?.length && evalCondition(s.condition, values, chosen)) return s.value;
    }
    return null;
  };
  return {
    nodes: (el.nodes || []).map((n) => ({ ...n, eff: pick(n.states) || n.status || 'normal' })),
    links: (el.links || []).map((l) => ({ ...l, eff: pick(l.states) || l.style || 'normal' })),
  };
}

export function netHeight(aspect) {
  return Math.max(200, W / Math.max(0.4, aspect || 16 / 9));
}

export function nodeBox(n, H) {
  const hasSub = !!(n.sub && (String(n.sub.en || '').trim() || String(n.sub.de || '').trim()));
  const w = ((Number(n.w) || 17) / 100) * W;
  const h = hasSub ? 62 : 46;
  const cx = ((Number(n.x) || 0) / 100) * W;
  const cy = ((Number(n.y) || 0) / 100) * H;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, cx, cy, w, h };
}

// Smooth connector between two boxes: horizontal when they sit side by side,
// vertical when they are stacked.
function linkGeom(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  let s; let e; let c1; let c2;
  // systems in different columns connect side to side, stacked ones top to bottom
  if (gapX > 12 || (gapX >= gapY && gapY <= 12)) {
    const sg = Math.sign(dx) || 1;
    s = [sg > 0 ? a.x1 : a.x0, a.cy];
    e = [sg > 0 ? b.x0 : b.x1, b.cy];
    const k = Math.max(18, Math.abs(e[0] - s[0]) * 0.5);
    c1 = [s[0] + sg * k, s[1]];
    c2 = [e[0] - sg * k, e[1]];
  } else {
    const sg = Math.sign(dy) || 1;
    s = [a.cx, sg > 0 ? a.y1 : a.y0];
    e = [b.cx, sg > 0 ? b.y0 : b.y1];
    const k = Math.max(14, Math.abs(e[1] - s[1]) * 0.5);
    c1 = [s[0], s[1] + sg * k];
    c2 = [e[0], e[1] - sg * k];
  }
  const d = `M${f(s[0])} ${f(s[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`;
  const mid = [(s[0] + 3 * c1[0] + 3 * c2[0] + e[0]) / 8, (s[1] + 3 * c1[1] + 3 * c2[1] + e[1]) / 8];
  return { d, mid };
}

/**
 * opts: { lang, aspect, data, base, editing, sel: {type, id}, connectFrom }
 */
export function renderNetwork(el, opts = {}) {
  const { lang, aspect = 16 / 9, data = null, base = false, editing = false, sel = null, connectFrom = null } = opts;
  const H = netHeight(aspect);
  const id = `net${++seq}`;
  const { nodes, links } = resolveNetwork(el, data, base);
  const boxes = new Map(nodes.map((n) => [n.id, nodeBox(n, H)]));
  const isSel = (type, oid) => sel && sel.type === type && sel.id === oid;

  let s = `<svg class="net-svg${editing ? ' editing' : ''}" viewBox="0 0 ${W} ${f(H)}" preserveAspectRatio="xMidYMid meet" role="img">`;
  s += `<defs><pattern id="${id}-g" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" class="net-grid"/></pattern>`;
  for (const st of ['attack', 'suspicious']) {
    s += `<marker id="${id}-${st}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0 0L10 5L0 10z" class="net-mk-${st}"/></marker>`;
  }
  s += '</defs>';
  if (el.frame !== false) {
    s += `<rect class="net-bg" x="1.5" y="1.5" width="${W - 3}" height="${f(H - 3)}" rx="12"/>`;
    s += `<rect x="1.5" y="1.5" width="${W - 3}" height="${f(H - 3)}" rx="12" fill="url(#${id}-g)" class="net-bg-grid"/>`;
  }
  const title = tr(el.title, lang);
  const subtitle = tr(el.subtitle, lang);
  if (title) s += `<text x="26" y="40" class="net-title">${esc(cut(title.toUpperCase(), 60))}</text>`;
  if (subtitle) s += `<text x="26" y="${title ? 63 : 40}" class="net-subtitle">${esc(cut(subtitle, 90))}</text>`;

  // zones
  for (const z of el.zones || []) {
    const x = (Number(z.x) / 100) * W;
    const y = (Number(z.y) / 100) * H;
    const w = (Number(z.w) / 100) * W;
    const h = (Number(z.h) / 100) * H;
    s += `<g class="net-zone${isSel('zone', z.id) ? ' sel' : ''}" data-zone="${esc(z.id)}">`;
    s += `<rect class="nz-box" x="${f(x)}" y="${f(y)}" width="${f(Math.max(10, w))}" height="${f(Math.max(10, h))}" rx="14"/>`;
    const zl = tr(z.label, lang);
    if (zl) s += `<text x="${f(x + 4)}" y="${f(y - 9)}" class="net-zone-label">${esc(cut(zl.toUpperCase(), Math.max(4, Math.floor(w / 8))))}</text>`;
    if (editing) s += `<rect class="net-handle" data-zone-resize="${esc(z.id)}" x="${f(x + w - 8)}" y="${f(y + h - 8)}" width="16" height="16" rx="2"/>`;
    s += '</g>';
  }

  // links (normal ones first so attack paths are drawn on top)
  const order = { normal: 0, blocked: 1, suspicious: 2, attack: 3 };
  for (const l of [...links].sort((a, b) => (order[a.eff] ?? 0) - (order[b.eff] ?? 0))) {
    const a = boxes.get(l.from);
    const b = boxes.get(l.to);
    if (!a || !b) continue;
    const g = linkGeom(a, b);
    const marker = l.eff === 'attack' || l.eff === 'suspicious' ? ` marker-end="url(#${id}-${l.eff})"` : '';
    s += `<g class="net-link ln-${l.eff}${isSel('link', l.id) ? ' sel' : ''}" data-link="${esc(l.id)}">`;
    if (editing) s += `<path d="${g.d}" class="net-hit"/>`;
    s += `<path d="${g.d}" class="net-line"${marker}/>`;
    const [mx, my] = g.mid;
    if (l.eff === 'blocked') s += `<path d="M${f(mx - 8)} ${f(my - 8)}l16 16M${f(mx + 8)} ${f(my - 8)}l-16 16" class="net-x"/>`;
    const ll = tr(l.label, lang);
    if (ll) s += `<text x="${f(mx)}" y="${f(my - (l.eff === 'blocked' ? 14 : 8))}" class="net-link-label" text-anchor="middle">${esc(cut(ll, 24))}</text>`;
    s += '</g>';
  }

  // nodes
  for (const n of nodes) {
    const b = boxes.get(n.id);
    const label = tr(n.label, lang) || '—';
    const sub = tr(n.sub, lang);
    const avail = b.w - 46 - (n.eff === 'normal' ? 12 : 30);
    const lfs = Math.max(12, Math.min(17, avail / (label.length * 0.52 || 1)));
    const cls = ['net-node', `st-${n.eff}`, isSel('node', n.id) && 'sel', connectFrom === n.id && 'src'].filter(Boolean).join(' ');
    s += `<g class="${cls}" data-node="${esc(n.id)}" transform="translate(${f(b.x0)} ${f(b.y0)})">`;
    if (editing && (isSel('node', n.id) || connectFrom === n.id)) s += `<rect class="nn-sel" x="-6" y="-6" width="${f(b.w + 12)}" height="${b.h + 12}" rx="12"/>`;
    s += `<rect class="nn-box" width="${f(b.w)}" height="${b.h}" rx="9"/>`;
    s += `<g class="nn-ico" transform="translate(13 ${f(b.h / 2 - 11)}) scale(0.92)">${ICONS[NET_ICONS[n.icon] || n.icon] || ICONS.server}</g>`;
    if (sub) {
      s += `<text x="46" y="${f(b.h / 2 - 4)}" class="nn-label" style="font-size:${f(lfs)}px">${esc(cut(label, Math.floor(avail / (lfs * 0.5))))}</text>`;
      s += `<text x="46" y="${f(b.h / 2 + 15)}" class="nn-sub">${esc(cut(sub, Math.floor(avail / 6.3)))}</text>`;
    } else {
      s += `<text x="46" y="${f(b.h / 2 + 6)}" class="nn-label" style="font-size:${f(lfs)}px">${esc(cut(label, Math.floor(avail / (lfs * 0.5))))}</text>`;
    }
    if (n.eff === 'encrypted') s += `<g class="nn-lock" transform="translate(${f(b.w - 27)} ${f(b.h / 2 - 9)}) scale(0.75)">${ICONS.lock}</g>`;
    else if (n.eff !== 'normal') s += `<circle class="nn-dot" cx="${f(b.w - 16)}" cy="${f(b.h / 2)}" r="5.5"/>`;
    s += '</g>';
  }

  if (el.legend !== false) s += legend(nodes, links, H, lang);
  return `${s}</svg>`;
}

function legend(nodes, links, H, lang) {
  const items = [];
  const usedStatus = new Set(nodes.map((n) => n.eff));
  for (const st of NET_STATUSES) if (usedStatus.has(st)) items.push({ type: 'node', st, label: t(`net.st.${st}`, null, lang) });
  const usedLinks = new Set(links.map((l) => l.eff));
  for (const st of ['attack', 'suspicious', 'blocked']) if (usedLinks.has(st)) items.push({ type: 'link', st, label: t(`net.ln.${st}`, null, lang) });
  if (!items.length) return '';
  const fs = 12.5;
  const widths = items.map((it) => (it.type === 'link' ? 44 : 22) + it.label.length * fs * 0.56 + 26);
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = Math.min(1, (W - 52) / total);
  let x = 26;
  const y = H - 20;
  let s = `<g class="net-legend" transform="translate(0 0)">`;
  items.forEach((it, i) => {
    const sx = (v) => f(v);
    if (it.type === 'node') {
      s += `<g class="net-node st-${it.st}"><rect class="nn-box" x="${sx(x)}" y="${f(y - 11)}" width="${f(14 * scale + 2)}" height="${f(14 * scale + 2)}" rx="3"/></g>`;
      x += 22 * scale;
    } else {
      s += `<g class="net-link ln-${it.st}"><path class="net-line" d="M${sx(x)} ${f(y - 4)}h${f(34 * scale)}"/></g>`;
      x += 44 * scale;
    }
    s += `<text x="${sx(x)}" y="${f(y)}" style="font-size:${f(fs * Math.max(0.8, scale))}px">${esc(it.label)}</text>`;
    x += (widths[i] - (it.type === 'link' ? 44 : 22)) * scale;
  });
  return `${s}</g>`;
}
