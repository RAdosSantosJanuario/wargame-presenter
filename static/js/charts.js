// Charts drawn as SVG/HTML strings (no libraries, works offline).
// SVG charts use a 1000-unit wide viewBox sized to the element's aspect ratio,
// so they scale crisply on any projector.
import { tr, t } from './i18n.js';
import { classify, levelBands, norm, goodness, fmtValue, fmtDelta, deltaTone } from './model.js';
import { escapeHtml as esc, md, h, clamp } from './util.js';

const W = 1000;
const f = (n) => Math.round(n * 10) / 10;
const truncate = (s, max) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);
const svgOpen = (H, cls) => `<svg class="chart-svg ${cls}" viewBox="0 0 ${W} ${f(H)}" preserveAspectRatio="xMidYMid meet" role="img">`;
const label = (a, lang) => `${a.icon ? `${a.icon} ` : ''}${tr(a.name, lang)}`;

export function chartAttrs(wg, el) {
  let list = wg.attributes || [];
  if (el.attrs && el.attrs.length) list = el.attrs.map((id) => list.find((a) => a.id === id)).filter(Boolean);
  if (!el.includeHidden) list = list.filter((a) => !a.hidden);
  return list;
}

// opts: { type, wg, attrs, data: {values, start, timeline, decisions, last}, lang, aspect }
export function renderChart(opts) {
  const { type, attrs, lang } = opts;
  if (!attrs.length && type !== 'log') return `<div class="chart-empty">${esc(t('chart.noAttrs', null, lang))}</div>`;
  switch (type) {
    case 'gauges': return gauges(opts);
    case 'radar': return attrs.length >= 3 ? radar(opts) : bars(opts);
    case 'timeline': return timeline(opts);
    case 'cards': return cards(opts);
    case 'deltas': return deltas(opts);
    case 'log': return log(opts);
    case 'bars':
    default: return bars(opts);
  }
}

// ---------- horizontal bars with classification bands ----------
function bars({ attrs, data, lang, aspect }) {
  const H = Math.max(160, W / Math.max(0.5, aspect));
  const n = attrs.length;
  const rowH = Math.min(H / n, 150);
  const top = (H - rowH * n) / 2;
  const labelW = 300;
  const valueW = 200;
  const x0 = labelW + 26;
  const x1 = W - valueW;
  const tw = x1 - x0;
  const fs = clamp(rowH * 0.27, 13, 34);
  let s = svgOpen(H, 'bars');
  attrs.forEach((a, i) => {
    const v = data.values[a.id] ?? a.start;
    const st = data.start?.[a.id];
    const c = classify(a, v);
    const cy = top + rowH * (i + 0.5);
    const bh = clamp(rowH * 0.42, 10, 54);
    const X = (val) => x0 + norm(a, val) * tw;
    const full = label(a, lang);
    const lfs = Math.max(fs * 0.72, Math.min(fs, labelW / (full.length * 0.52)));
    const name = truncate(full, Math.floor(labelW / (lfs * 0.5)));
    s += `<text x="${labelW}" y="${f(cy)}" class="lbl" text-anchor="end" dominant-baseline="central" font-size="${f(lfs)}">${esc(name)}</text>`;
    for (const b of levelBands(a)) {
      s += `<rect x="${f(X(b.from))}" y="${f(cy - bh / 2)}" width="${f(Math.max(0, X(b.to) - X(b.from)))}" height="${f(bh)}" fill="${b.color}" opacity="0.17"/>`;
    }
    for (const b of levelBands(a).slice(0, -1)) {
      s += `<line x1="${f(X(b.to))}" x2="${f(X(b.to))}" y1="${f(cy - bh / 2)}" y2="${f(cy + bh / 2)}" class="band-sep"/>`;
    }
    const fw = Math.max(3, X(v) - x0);
    s += `<rect class="grow-x" x="${x0}" y="${f(cy - bh * 0.3)}" width="${f(fw)}" height="${f(bh * 0.6)}" fill="${c.color}"/>`;
    s += `<rect x="${f(x0 + fw - 4)}" y="${f(cy - bh * 0.5)}" width="4" height="${f(bh)}" fill="${c.color}" class="grow-fade"/>`;
    if (st != null && Math.abs(st - v) > 1e-9) {
      s += `<path d="M${f(X(st))} ${f(cy - bh / 2 - 2)} l-${f(bh * 0.18)} -${f(bh * 0.26)} h${f(bh * 0.36)} z" class="start-mark"/>`;
    }
    s += `<text x="${x1 + 22}" y="${f(cy - fs * 0.2)}" class="val" dominant-baseline="central" font-size="${f(fs * 1.1)}" fill="${c.color}">${esc(fmtValue(a, v))}</text>`;
    s += `<text x="${x1 + 22}" y="${f(cy + fs * 0.75)}" class="sub" dominant-baseline="central" font-size="${f(fs * 0.58)}" fill="${c.color}">${esc(truncate(tr(c.label, lang).toUpperCase(), 24))}</text>`;
  });
  return `${s}</svg>`;
}

// ---------- semicircle gauges ----------
function gauges({ attrs, data, lang, aspect }) {
  const H = Math.max(160, W / Math.max(0.5, aspect));
  const n = attrs.length;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols;
    const ch = H / rows;
    const r = Math.min(cw * 0.4, ch / 1.95);
    if (!best || r > best.r + 0.5) best = { cols, rows, cw, ch, r };
  }
  const { cols, rows, cw, ch, r } = best;
  const sw = r * 0.2;
  let s = svgOpen(H, 'gauges');
  attrs.forEach((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const cx = ((cols - inRow) * cw) / 2 + cw * (col + 0.5);
    const block = r + sw / 2 + r * 0.78;
    const cy = ch * row + (ch - block) / 2 + r + sw / 2;
    const v = data.values[a.id] ?? a.start;
    const st = data.start?.[a.id];
    const c = classify(a, v);
    const P = (fr, rr = r) => { const ang = Math.PI * (1 - fr); return [cx + rr * Math.cos(ang), cy - rr * Math.sin(ang)]; };
    const arc = (f0, f1, rr = r) => {
      const [ax, ay] = P(f0, rr);
      const [bx, by] = P(f1, rr);
      return `M${f(ax)} ${f(ay)} A${f(rr)} ${f(rr)} 0 0 1 ${f(bx)} ${f(by)}`;
    };
    for (const b of levelBands(a)) {
      const f0 = norm(a, b.from);
      const f1 = norm(a, b.to);
      if (f1 - f0 > 0.001) s += `<path d="${arc(f0, f1)}" stroke="${b.color}" stroke-width="${f(sw)}" fill="none" opacity="0.22"/>`;
    }
    const fv = norm(a, v);
    if (fv > 0.002) s += `<path class="draw" pathLength="1" d="${arc(0, fv)}" stroke="${c.color}" stroke-width="${f(sw)}" fill="none"/>`;
    if (st != null && Math.abs(st - v) > 1e-9) {
      const fs0 = norm(a, st);
      const [ax, ay] = P(fs0, r - sw * 0.75);
      const [bx, by] = P(fs0, r + sw * 0.75);
      s += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}" class="start-line"/>`;
    }
    s += `<text x="${f(cx)}" y="${f(cy - r * 0.16)}" text-anchor="middle" class="val" font-size="${f(r * 0.4)}" fill="${c.color}">${esc(fmtValue(a, v))}</text>`;
    const maxChars = Math.floor((cw * 0.92) / (r * 0.2 * 0.52));
    s += `<text x="${f(cx)}" y="${f(cy + r * 0.34)}" text-anchor="middle" class="lbl" font-size="${f(r * 0.2)}">${esc(truncate(label(a, lang), maxChars))}</text>`;
    s += `<text x="${f(cx)}" y="${f(cy + r * 0.62)}" text-anchor="middle" class="sub" font-size="${f(r * 0.14)}" fill="${c.color}">${esc(truncate(tr(c.label, lang).toUpperCase(), Math.floor(maxChars * 1.3)))}</text>`;
  });
  return `${s}</svg>`;
}

// ---------- radar (normalised so that outside = better) ----------
function radar({ attrs, data, lang, aspect }) {
  const H = Math.max(240, W / Math.max(0.5, aspect));
  const n = attrs.length;
  const cx = W / 2;
  const cy = H / 2 + H * 0.01;
  const R = Math.min(W * 0.28, H * 0.33);
  const fs = clamp(R * 0.085, 12, 30);
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i, fr) => [cx + R * fr * Math.cos(ang(i)), cy + R * fr * Math.sin(ang(i))];
  const poly = (vals) => vals.map((fr, i) => pt(i, fr).map(f).join(',')).join(' ');
  let s = svgOpen(H, 'radar');
  for (const k of [0.25, 0.5, 0.75, 1]) s += `<polygon points="${poly(attrs.map(() => k))}" class="ring${k === 1 ? ' outer' : ''}"/>`;
  attrs.forEach((_, i) => { const [x, y] = pt(i, 1); s += `<line x1="${cx}" y1="${f(cy)}" x2="${f(x)}" y2="${f(y)}" class="axis"/>`; });
  if (data.start) s += `<polygon points="${poly(attrs.map((a) => Math.max(0.02, goodness(a, data.start[a.id] ?? a.start))))}" class="start-poly"/>`;
  const cur = attrs.map((a) => Math.max(0.02, goodness(a, data.values[a.id] ?? a.start)));
  s += `<polygon points="${poly(cur)}" class="cur-poly"/>`;
  attrs.forEach((a, i) => {
    const v = data.values[a.id] ?? a.start;
    const c = classify(a, v);
    const [x, y] = pt(i, cur[i]);
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(fs * 0.42)}" fill="${c.color}" class="dot"/>`;
    const [lx, ly] = pt(i, 1.13);
    const cos = Math.cos(ang(i));
    const sin = Math.sin(ang(i));
    const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
    const dy = sin < -0.5 ? -fs * 0.9 : sin > 0.5 ? fs * 0.5 : -fs * 0.2;
    s += `<text x="${f(lx)}" y="${f(ly + dy)}" text-anchor="${anchor}" class="lbl" font-size="${f(fs)}">${esc(truncate(label(a, lang), 26))}</text>`;
    s += `<text x="${f(lx)}" y="${f(ly + dy + fs * 1.15)}" text-anchor="${anchor}" class="val-sm" font-size="${f(fs * 0.85)}" fill="${c.color}">${esc(fmtValue(a, v))} · ${esc(tr(c.label, lang))}</text>`;
  });
  const ly = H - fs * 0.9;
  s += `<line x1="20" x2="60" y1="${f(ly - fs * 0.35)}" y2="${f(ly - fs * 0.35)}" class="start-poly-l"/>`;
  s += `<text x="70" y="${f(ly)}" class="legend" font-size="${f(fs * 0.75)}">${esc(t('chart.start', null, lang))}</text>`;
  s += `<rect x="${f(170 + fs)}" y="${f(ly - fs * 0.7)}" width="${f(fs * 0.7)}" height="${f(fs * 0.7)}" class="cur-poly-l"/>`;
  s += `<text x="${f(170 + fs * 2)}" y="${f(ly)}" class="legend" font-size="${f(fs * 0.75)}">${esc(t('chart.now', null, lang))}</text>`;
  s += `<text x="${W - 20}" y="${f(ly)}" text-anchor="end" class="legend" font-size="${f(fs * 0.75)}">${esc(t('chart.outerBetter', null, lang))}</text>`;
  return `${s}</svg>`;
}

// ---------- timeline as small multiples with level bands ----------
function timeline({ attrs, data, lang, aspect }) {
  const H = Math.max(200, W / Math.max(0.4, aspect));
  const n = attrs.length;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols;
    const ch = H / rows;
    const score = -Math.abs(Math.log(cw / ch / 2.1)) - (cols * rows - n) * 0.08;
    if (!best || score > best.score) best = { cols, rows, cw, ch, score };
  }
  const { cols, cw, ch } = best;
  const pts = data.timeline || [];
  const N = pts.length;
  const fs = clamp(Math.min(cw, ch * 2) * 0.055, 11, 26);
  let s = svgOpen(H, 'timeline');
  attrs.forEach((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * cw;
    const oy = row * ch;
    const pad = Math.min(cw, ch) * 0.07;
    const px0 = ox + pad + fs * 1.8;
    const px1 = ox + cw - pad;
    const py0 = oy + pad + fs * 1.6;
    const py1 = oy + ch - pad - fs * 1.3;
    const Y = (v) => py1 - norm(a, v) * (py1 - py0);
    const X = (k) => (N <= 1 ? px0 + (px1 - px0) * 0.04 : px0 + (k / (N - 1)) * (px1 - px0));
    const v = data.values[a.id] ?? a.start;
    const c = classify(a, v);
    s += `<text x="${f(ox + pad)}" y="${f(oy + pad + fs * 0.9)}" class="lbl" font-size="${f(fs)}">${esc(truncate(label(a, lang), Math.floor((cw * 0.62) / (fs * 0.5))))}</text>`;
    s += `<text x="${f(px1)}" y="${f(oy + pad + fs * 0.9)}" text-anchor="end" class="val" font-size="${f(fs * 1.05)}" fill="${c.color}">${esc(fmtValue(a, v))}</text>`;
    for (const b of levelBands(a)) {
      const yTop = Y(b.to);
      const yBot = Y(b.from);
      s += `<rect x="${f(px0)}" y="${f(yTop)}" width="${f(px1 - px0)}" height="${f(Math.max(0, yBot - yTop))}" fill="${b.color}" opacity="0.13"/>`;
    }
    s += `<rect x="${f(px0)}" y="${f(py0)}" width="${f(px1 - px0)}" height="${f(py1 - py0)}" class="plot-frame"/>`;
    s += `<text x="${f(px0 - fs * 0.4)}" y="${f(py0 + fs * 0.35)}" text-anchor="end" class="tick" font-size="${f(fs * 0.62)}">${esc(String(a.max))}</text>`;
    s += `<text x="${f(px0 - fs * 0.4)}" y="${f(py1)}" text-anchor="end" class="tick" font-size="${f(fs * 0.62)}">${esc(String(a.min))}</text>`;
    if (N > 1) {
      const d = pts.map((p, k) => `${k ? 'L' : 'M'}${f(X(k))} ${f(Y(p.values[a.id] ?? a.start))}`).join(' ');
      s += `<path d="${d}" class="line draw" pathLength="1"/>`;
    }
    pts.forEach((p, k) => {
      const pv = p.values[a.id] ?? a.start;
      const pc = classify(a, pv);
      s += `<circle cx="${f(X(k))}" cy="${f(Y(pv))}" r="${f(fs * 0.3)}" fill="${pc.color}" class="pt"/>`;
      if (N <= 14 || k % Math.ceil(N / 14) === 0) {
        s += `<text x="${f(X(k))}" y="${f(py1 + fs * 1.05)}" text-anchor="middle" class="tick" font-size="${f(fs * 0.62)}">${k === 0 ? 'S' : k}</text>`;
      }
    });
  });
  return `${s}</svg>`;
}

// ---------- stat cards ----------
function cards({ attrs, data, lang, aspect }) {
  const n = attrs.length;
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * aspect) / 1.5))));
  const rows = Math.ceil(n / cols);
  const items = attrs.map((a) => {
    const v = data.values[a.id] ?? a.start;
    const st = data.start?.[a.id] ?? a.start;
    const c = classify(a, v);
    const d = v - st;
    const tone = deltaTone(a, d);
    return `<div class="stat" style="--c:${c.color}">
      <div class="stat-head"><span class="stat-icon">${esc(a.icon || '')}</span><span class="stat-name">${esc(tr(a.name, lang))}</span></div>
      <div class="stat-val">${esc(fmtValue(a, v))}</div>
      <div class="stat-bar"><i style="width:${f(norm(a, v) * 100)}%"></i></div>
      <div class="stat-foot"><span class="lvl-chip">${esc(tr(c.label, lang))}</span>${Math.abs(d) > 1e-9 ? `<span class="delta ${tone}">${d > 0 ? '▲' : '▼'} ${esc(fmtDelta(a, d))}</span>` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="chart-cards" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${items}</div>`;
}

// ---------- changes caused by the last decision ----------
function deltas({ wg, attrs, data, lang }) {
  const last = data.last;
  if (!last) return `<div class="chart-empty">${esc(t('chart.noDecisions', null, lang))}</div>`;
  const page = (wg.pages || []).find((p) => p.id === last.pageId);
  const chosen = choiceLabels(page, last, lang);
  const rows = attrs.map((a) => {
    const b = last.before[a.id] ?? a.start;
    const af = last.after[a.id] ?? a.start;
    const d = af - b;
    const c = classify(a, af);
    const tone = deltaTone(a, d);
    return `<tr class="${Math.abs(d) > 1e-9 ? 'changed' : 'same'}">
      <td class="d-name">${esc(label(a, lang))}</td>
      <td class="d-num">${esc(fmtValue(a, b))}</td>
      <td class="d-arrow">→</td>
      <td class="d-num strong" style="color:${c.color}">${esc(fmtValue(a, af))}</td>
      <td>${Math.abs(d) > 1e-9 ? `<span class="delta ${tone}">${d > 0 ? '▲' : '▼'} ${esc(fmtDelta(a, d))}</span>` : '<span class="delta neutral">±0</span>'}</td>
      <td class="d-lvl" style="color:${c.color}">${esc(tr(c.label, lang))}</td>
    </tr>`;
  }).join('');
  return `<div class="chart-deltas">
    <div class="d-head"><span class="kicker">${esc(t('chart.lastDecision', null, lang))}</span><strong>${esc(tr(page?.title, lang))}</strong><span class="d-chosen">${esc(chosen.join(' · '))}</span></div>
    <table>${rows}</table></div>`;
}

// ---------- decision log ----------
function log({ wg, data, lang }) {
  const ds = data.decisions || [];
  if (!ds.length) return `<div class="chart-empty">${esc(t('chart.noDecisions', null, lang))}</div>`;
  const items = ds.map((d, i) => {
    const page = (wg.pages || []).find((p) => p.id === d.pageId);
    const parts = d.results.map((r) => {
      const c = page?.decision?.choices?.find((x) => x.id === r.choiceId);
      const roll = r.roll != null
        ? `<span class="roll-chip ${r.success ? 'ok' : 'fail'}">🎲 ${r.roll}/${r.chance} ${r.success ? '✓' : '✗'}</span>` : '';
      const outcome = tr(r.success ? c?.outcome : c?.fail?.outcome, lang);
      return `<div class="log-choice"><span class="log-label">${esc(c ? `${c.icon ? `${c.icon} ` : ''}${tr(c.label, lang)}` : '?')}</span>${roll}${outcome ? `<div class="log-outcome">${md(outcome)}</div>` : ''}</div>`;
    }).join('');
    return `<li><span class="log-num">${i + 1}</span><div class="log-body"><div class="log-page">${esc(tr(page?.title, lang))}</div>${parts}</div></li>`;
  }).join('');
  return `<ol class="chart-log">${items}</ol>`;
}

export function choiceLabels(page, decision, lang) {
  return (decision.results || []).map((r) => {
    const c = page?.decision?.choices?.find((x) => x.id === r.choiceId);
    return c ? tr(c.label, lang) : '?';
  });
}

// ---------- attribute bar (HUD) during the presentation ----------
export function updateHud(host, attrs, values, lang) {
  const ids = attrs.map((a) => a.id);
  for (const ch of [...host.children]) if (!ids.includes(ch.dataset.id)) ch.remove();
  attrs.forEach((a, i) => {
    let item = [...host.children].find((c) => c.dataset.id === a.id);
    if (!item) {
      item = h('div', { class: 'hud-item', dataset: { id: a.id } },
        h('span', { class: 'hud-icon' }),
        h('div', { class: 'hud-main' },
          h('div', { class: 'hud-top' }, h('span', { class: 'hud-name' }), h('span', { class: 'hud-val' })),
          h('div', { class: 'hud-bar' }, h('i')),
          h('div', { class: 'hud-lvl' })),
        h('span', { class: 'hud-delta' }));
    }
    if (host.children[i] !== item) host.insertBefore(item, host.children[i] || null);
    const v = values[a.id] ?? a.start;
    const c = classify(a, v);
    item.style.setProperty('--c', c.color);
    item.querySelector('.hud-icon').textContent = a.icon || '';
    item.querySelector('.hud-name').textContent = tr(a.name, lang);
    item.querySelector('.hud-val').textContent = fmtValue(a, v);
    item.querySelector('.hud-lvl').textContent = tr(c.label, lang);
    item.querySelector('.hud-bar i').style.width = `${f(norm(a, v) * 100)}%`;
    const old = item.dataset.v === undefined ? null : Number(item.dataset.v);
    if (old != null && Math.abs(old - v) > 1e-9) {
      const d = v - old;
      const del = item.querySelector('.hud-delta');
      del.textContent = `${d > 0 ? '▲' : '▼'} ${fmtDelta(a, d)}`;
      del.className = `hud-delta show ${deltaTone(a, d)}`;
      item.classList.remove('flash');
      void item.offsetWidth; // restart the animation
      item.classList.add('flash');
      clearTimeout(item._t);
      item._t = setTimeout(() => { del.classList.remove('show'); item.classList.remove('flash'); }, 4200);
    }
    item.dataset.v = String(v);
  });
}
