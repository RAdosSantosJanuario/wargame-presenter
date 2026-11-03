// Data model: factories, classification, effects, conditions and validation.
import { tr } from './i18n.js';
import { uid, clone, round } from './util.js';

export const L = (en = '', de = '') => ({ en, de });

export const SEVERITIES = {
  critical: { color: '#e5484d', label: L('Critical', 'Kritisch') },
  bad: { color: '#f0702b', label: L('Bad', 'Schlecht') },
  warning: { color: '#f2b53c', label: L('Warning', 'Warnung') },
  ok: { color: '#a3c94a', label: L('Acceptable', 'Akzeptabel') },
  good: { color: '#2fb47c', label: L('Good', 'Gut') },
  info: { color: '#4f8df5', label: L('Neutral', 'Neutral') },
};
export const SEVERITY_KEYS = Object.keys(SEVERITIES);
export const CHANNELS = ['email', 'phone', 'chat', 'sms', 'news', 'social', 'alert', 'memo'];
export const CHART_TYPES = ['bars', 'gauges', 'radar', 'timeline', 'cards', 'deltas', 'log'];
export const TEXT_SIZES = ['s', 'm', 'l', 'xl', 'xxl'];
export const BOXES = ['none', 'card', 'accent', 'warning', 'critical'];
export const FONTS = ['sans', 'display', 'mono'];
export const OPS = ['<', '<=', '>', '>=', '==', '!='];

// ---------- factories ----------
export function defaultLevels(attr) {
  const min = Number(attr.min ?? 0);
  const max = Number(attr.max ?? 100);
  const span = max - min;
  const cuts = [0.25, 0.5, 0.75, 1].map((f) => round(min + span * f, 1));
  let sev = ['critical', 'bad', 'warning', 'good'];
  if (attr.better === 'lower') sev = ['good', 'warning', 'bad', 'critical'];
  if (attr.better === 'neutral') sev = ['info', 'info', 'info', 'info'];
  return cuts.map((upTo, i) => ({ upTo, severity: sev[i], label: clone(SEVERITIES[sev[i]].label) }));
}

export function newAttribute(partial = {}) {
  const a = {
    id: uid('a-'),
    icon: '📊',
    name: L('New attribute', 'Neues Attribut'),
    description: L(),
    unit: '',
    min: 0,
    max: 100,
    start: 50,
    better: 'higher',
    hidden: false,
    levels: [],
    ...clone(partial),
  };
  if (!a.levels || !a.levels.length) a.levels = defaultLevels(a);
  return a;
}

export function newChoice(partial = {}) {
  return {
    id: uid('c-'),
    icon: '',
    label: L('New option', 'Neue Option'),
    description: L(),
    effects: {},
    outcome: L(),
    chance: 100,
    goto: '',
    fail: { effects: {}, outcome: L(), goto: '' },
    ...clone(partial),
  };
}

export function newElement(kind, partial = {}) {
  const base = { id: uid('e-'), kind, x: 6, y: 18, w: 50, h: 30, reveal: 0 };
  const byKind = {
    text: {
      text: L('Text', 'Text'),
      style: { size: 'm', align: 'left', valign: 'top', font: 'sans', box: 'none', color: '' },
    },
    image: { x: 52, y: 18, w: 42, h: 60, src: '', fit: 'contain', caption: L(), frame: true },
    inject: {
      x: 6, y: 17, w: 54, h: 64,
      channel: 'email',
      severity: 'warning',
      time: '08:15',
      from: L('SOC <soc@example.com>', 'SOC <soc@example.com>'),
      to: L('IT crisis team', 'IT-Krisenstab'),
      subject: L('Suspicious activity detected', 'Verdächtige Aktivität erkannt'),
      body: L('Describe the inject here.', 'Beschreiben Sie hier den Inject.'),
    },
    chart: { x: 6, y: 17, w: 88, h: 76, chart: 'bars', attrs: [], includeHidden: false },
    choices: { x: 4, y: 16, w: 92, h: 79 },
  };
  return { ...base, ...clone(byKind[kind] || {}), ...clone(partial) };
}

export const PAGE_TEMPLATES = ['title', 'text', 'inject', 'image', 'decision', 'results', 'debrief', 'blank'];

export function newPage(template = 'text') {
  const page = {
    id: uid('p-'),
    type: 'content',
    title: L('New page', 'Neue Seite'),
    showTitle: true,
    notes: L(),
    background: { color: '', image: '', dim: 0.5 },
    timer: 0,
    condition: null,
    elements: [],
  };
  const T = (text, style, pos) => newElement('text', { text, style: { size: 'm', align: 'left', valign: 'top', font: 'sans', box: 'none', color: '', ...style }, ...pos });
  switch (template) {
    case 'title':
      page.showTitle = false;
      page.title = L('Title', 'Titel');
      page.elements = [
        T(L('SCENARIO BRIEFING', 'SZENARIO-BRIEFING'), { size: 's', align: 'center', font: 'mono', color: 'var(--accent)' }, { x: 10, y: 26, w: 80, h: 6 }),
        T(L('# Operation Title', '# Operationstitel'), { size: 'xxl', align: 'center', valign: 'middle', font: 'display' }, { x: 6, y: 33, w: 88, h: 22 }),
        T(L('A cyber crisis exercise', 'Eine Cyber-Krisenübung'), { size: 'l', align: 'center' }, { x: 10, y: 57, w: 80, h: 10 }),
      ];
      break;
    case 'text':
      page.title = L('Briefing', 'Briefing');
      page.elements = [T(L('- First point\n- Second point\n- Third point', '- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt'), { size: 'l' }, { x: 6, y: 18, w: 88, h: 74 })];
      break;
    case 'inject':
      page.title = L('Inject', 'Inject');
      page.elements = [
        newElement('inject'),
        T(L('## Questions for the room\n- What do we know?\n- What do we not know?\n- Who needs to be informed?', '## Fragen an den Raum\n- Was wissen wir?\n- Was wissen wir nicht?\n- Wer muss informiert werden?'), { box: 'card' }, { x: 63, y: 17, w: 31, h: 48, reveal: 1 }),
      ];
      page.elements[1].reveal = 1;
      break;
    case 'image':
      page.title = L('Image', 'Bild');
      page.elements = [
        newElement('image', { x: 6, y: 17, w: 58, h: 76 }),
        T(L('Describe what the room is seeing.', 'Beschreiben Sie, was der Raum sieht.'), { size: 'm', box: 'card' }, { x: 67, y: 17, w: 27, h: 40 }),
      ];
      break;
    case 'decision':
      page.type = 'decision';
      page.title = L('Decision', 'Entscheidung');
      page.timer = 300;
      page.elements = [newElement('choices')];
      page.decision = newDecision();
      break;
    case 'results':
      page.title = L('Situation report', 'Lagebild');
      page.elements = [newElement('chart', { chart: 'gauges' })];
      break;
    case 'debrief':
      page.title = L('Debrief', 'Nachbesprechung');
      page.elements = [
        newElement('chart', { chart: 'timeline', x: 4, y: 17, w: 57, h: 77, includeHidden: true }),
        newElement('chart', { chart: 'log', x: 63, y: 17, w: 33, h: 77, includeHidden: true }),
      ];
      break;
    case 'blank':
    default:
      page.showTitle = false;
      page.title = L('Blank page', 'Leere Seite');
  }
  return page;
}

export function newDecision() {
  return {
    prompt: L('How does the crisis team respond?', 'Wie reagiert der Krisenstab?'),
    mode: 'single',
    min: 1,
    max: 1,
    showEffects: 'after',
    choices: [
      newChoice({ label: L('Option A', 'Option A') }),
      newChoice({ label: L('Option B', 'Option B') }),
      newChoice({ label: L('Option C', 'Option C') }),
    ],
  };
}

export function newWargame(title = L('New wargame', 'Neues Planspiel'), attributes = []) {
  const titlePage = newPage('title');
  titlePage.elements[1].text = L(`# ${title.en || title.de}`, `# ${title.de || title.en}`);
  return {
    schema: 1,
    meta: { title, subtitle: L(), description: L(), author: '' },
    settings: {
      theme: 'dark',
      accent: '#ffb000',
      language: 'de',
      hud: true,
      banner: L('EXERCISE · EXERCISE · EXERCISE', 'ÜBUNG · ÜBUNG · ÜBUNG'),
    },
    attributes,
    pages: [titlePage],
  };
}

// Make sure older / hand-written files have every field the app expects.
export function normalizeWargame(wg) {
  wg.meta = { title: L(), subtitle: L(), description: L(), author: '', ...(wg.meta || {}) };
  wg.settings = { theme: 'dark', accent: '#ffb000', language: 'de', hud: true, banner: L(), ...(wg.settings || {}) };
  wg.attributes = (wg.attributes || []).map((a) => ({ ...newAttribute({ levels: a.levels || [] }), ...a }));
  wg.pages = (wg.pages || []).map((p) => {
    const page = { ...newPage('blank'), showTitle: true, ...p };
    page.elements = (page.elements || []).map((e) => ({ ...newElement(e.kind), ...e }));
    if (page.type === 'decision') {
      page.decision = { ...newDecision(), choices: [], ...(page.decision || {}) };
      page.decision.choices = page.decision.choices.map((c) => ({ ...newChoice(), ...c, fail: { effects: {}, outcome: L(), goto: '', ...(c.fail || {}) } }));
    }
    page.background = { color: '', image: '', dim: 0.5, ...(page.background || {}) };
    return page;
  });
  return wg;
}

// ---------- attributes ----------
export function attrMap(wg) {
  return Object.fromEntries((wg.attributes || []).map((a) => [a.id, a]));
}

export function startValues(wg) {
  return Object.fromEntries((wg.attributes || []).map((a) => [a.id, clampAttr(a, Number(a.start ?? a.min ?? 0))]));
}

export function clampAttr(attr, v) {
  const min = Number(attr.min ?? 0);
  const max = Number(attr.max ?? 100);
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
}

export function norm(attr, v) {
  const min = Number(attr.min ?? 0);
  const max = Number(attr.max ?? 100);
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

// 0..1 where 1 is the "best" end of the scale
export function goodness(attr, v) {
  return attr.better === 'lower' ? 1 - norm(attr, v) : norm(attr, v);
}

export function sortedLevels(attr) {
  return [...(attr.levels || [])].sort((a, b) => Number(a.upTo) - Number(b.upTo));
}

export function classify(attr, v) {
  const levels = sortedLevels(attr);
  if (!levels.length) return { index: -1, severity: 'info', color: SEVERITIES.info.color, label: L() };
  let index = levels.findIndex((l) => v <= Number(l.upTo));
  if (index < 0) index = levels.length - 1;
  const lv = levels[index];
  const sev = SEVERITIES[lv.severity] || SEVERITIES.info;
  const hasLabel = lv.label && (lv.label.en || lv.label.de);
  return { index, level: lv, severity: lv.severity, color: lv.color || sev.color, label: hasLabel ? lv.label : sev.label };
}

// bands for drawing: [{from, to, color, label, severity}]
export function levelBands(attr) {
  const min = Number(attr.min ?? 0);
  const max = Number(attr.max ?? 100);
  const levels = sortedLevels(attr);
  if (!levels.length) return [{ from: min, to: max, color: SEVERITIES.info.color, severity: 'info', label: L() }];
  let from = min;
  return levels.map((lv, i) => {
    const to = i === levels.length - 1 ? max : Math.min(max, Number(lv.upTo));
    const band = { from, to, color: lv.color || (SEVERITIES[lv.severity] || SEVERITIES.info).color, severity: lv.severity, label: lv.label };
    from = to;
    return band;
  }).filter((b) => b.to >= b.from);
}

export function deltaTone(attr, d) {
  if (!d || attr.better === 'neutral') return 'neutral';
  const up = d > 0;
  return (attr.better === 'lower' ? !up : up) ? 'good' : 'bad';
}

export function fmtNumber(v) {
  if (!Number.isFinite(v)) return '–';
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
}

export function fmtValue(attr, v) {
  const unit = attr.unit || '';
  const n = fmtNumber(v);
  if (!unit) return n;
  return unit === '%' ? `${n}%` : `${n} ${unit}`;
}

export function fmtDelta(attr, d) {
  const n = fmtNumber(Math.abs(d));
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const unit = attr.unit && attr.unit !== '%' ? ` ${attr.unit}` : attr.unit === '%' ? '' : '';
  return `${sign}${n}${unit}`;
}

export function applyEffects(wg, values, effects) {
  const out = { ...values };
  const map = attrMap(wg);
  for (const [id, delta] of Object.entries(effects || {})) {
    const a = map[id];
    const d = Number(delta);
    if (!a || !Number.isFinite(d) || d === 0) continue;
    out[id] = clampAttr(a, (out[id] ?? Number(a.start ?? 0)) + d);
  }
  return out;
}

export function evalCondition(cond, values, chosen) {
  if (!cond || !Array.isArray(cond.rules) || !cond.rules.length) return true;
  const results = cond.rules.map((r) => {
    if (r.type === 'choice') {
      const c = chosen.has(r.choice);
      return r.op === 'notChosen' ? !c : c;
    }
    const v = values[r.attr];
    if (v == null) return false;
    const x = Number(r.value);
    switch (r.op) {
      case '<': return v < x;
      case '<=': return v <= x;
      case '>': return v > x;
      case '>=': return v >= x;
      case '==': return v === x;
      case '!=': return v !== x;
      default: return true;
    }
  });
  return cond.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function mediaUrl(wg, src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  return `/media/${encodeURIComponent(wg.id)}/${encodeURIComponent(src)}`;
}

export function allChoices(wg) {
  const out = [];
  for (const p of wg.pages || []) {
    if (p.type !== 'decision' || !p.decision) continue;
    for (const c of p.decision.choices || []) out.push({ page: p, choice: c });
  }
  return out;
}

export function maxStep(page) {
  return Math.max(0, ...(page?.elements || []).map((e) => Number(e.reveal) || 0));
}

// ---------- validation ----------
// Every bilingual field with where it lives. required = must have text.
export function bilingualFields(wg) {
  const out = [];
  const add = (obj, key, target, label, required = false) => out.push({ obj, key, target, label, required });
  const m = wg.meta || {};
  add(m, 'title', { tab: 'settings' }, 'title', true);
  add(m, 'subtitle', { tab: 'settings' }, 'subtitle');
  add(m, 'description', { tab: 'settings' }, 'description');
  add(wg.settings || {}, 'banner', { tab: 'settings' }, 'banner');
  for (const a of wg.attributes || []) {
    const target = { tab: 'attributes', attr: a.id };
    add(a, 'name', target, 'name', true);
    add(a, 'description', target, 'description');
    for (const lv of a.levels || []) add(lv, 'label', target, 'level');
  }
  for (const p of wg.pages || []) {
    const target = { tab: 'pages', page: p.id };
    add(p, 'title', target, 'pageTitle', true);
    add(p, 'notes', target, 'notes');
    for (const e of p.elements || []) {
      const et = { ...target, element: e.id };
      if (e.kind === 'text') add(e, 'text', et, 'text');
      if (e.kind === 'image') add(e, 'caption', et, 'caption');
      if (e.kind === 'inject') for (const k of ['from', 'to', 'subject', 'body']) add(e, k, et, k);
    }
    if (p.type === 'decision' && p.decision) {
      add(p.decision, 'prompt', target, 'prompt');
      for (const c of p.decision.choices || []) {
        add(c, 'label', target, 'choiceLabel', true);
        add(c, 'description', target, 'choiceDescription');
        add(c, 'outcome', target, 'outcome');
        if (Number(c.chance ?? 100) < 100 && c.fail) add(c.fail, 'outcome', target, 'failOutcome');
      }
    }
  }
  return out;
}

export function translationStats(wg) {
  const fields = bilingualFields(wg).filter((f) => {
    const v = f.obj[f.key];
    return v && (String(v.en || '').trim() || String(v.de || '').trim());
  });
  const filled = { en: 0, de: 0 };
  for (const f of fields) {
    const v = f.obj[f.key];
    if (String(v.en || '').trim()) filled.en++;
    if (String(v.de || '').trim()) filled.de++;
  }
  const total = fields.length || 1;
  return { total: fields.length, en: filled.en / total, de: filled.de / total, complete: filled.en === fields.length && filled.de === fields.length };
}

export function checkWargame(wg) {
  const issues = [];
  const add = (level, key, vars, target) => issues.push({ level, key, vars: vars || {}, target: target || {} });
  const attrs = attrMap(wg);
  const pageIds = new Set((wg.pages || []).map((p) => p.id));
  const choiceIds = new Set();
  const seen = new Set();

  if (!(wg.pages || []).length) add('error', 'chk.noPages');
  if (!(wg.attributes || []).length) add('warn', 'chk.noAttrs', {}, { tab: 'attributes' });

  for (const f of bilingualFields(wg)) {
    const v = f.obj[f.key] || {};
    const en = String(v.en || '').trim();
    const de = String(v.de || '').trim();
    if (!en && !de) {
      if (f.required) add('warn', 'chk.empty', { field: f.label }, f.target);
    } else if (!en || !de) {
      add('warn', 'chk.missingTr', { field: f.label, lang: !en ? 'EN' : 'DE', text: (en || de).slice(0, 40) }, f.target);
    }
  }

  for (const a of wg.attributes || []) {
    const target = { tab: 'attributes', attr: a.id };
    const name = tr(a.name) || a.id;
    if (seen.has(a.id)) add('error', 'chk.dupId', { id: a.id }, target);
    seen.add(a.id);
    if (Number(a.min) >= Number(a.max)) add('error', 'chk.minMax', { name }, target);
    if (Number(a.start) < Number(a.min) || Number(a.start) > Number(a.max)) add('warn', 'chk.startRange', { name }, target);
    const lv = a.levels || [];
    if (!lv.length) add('warn', 'chk.noLevels', { name }, target);
    for (let i = 1; i < lv.length; i++) {
      if (Number(lv[i].upTo) <= Number(lv[i - 1].upTo)) { add('warn', 'chk.levelsUnsorted', { name }, target); break; }
    }
    if (lv.length && Number(lv[lv.length - 1].upTo) < Number(a.max)) add('warn', 'chk.levelsMax', { name }, target);
  }

  for (const [pi, p] of (wg.pages || []).entries()) {
    const target = { tab: 'pages', page: p.id };
    const page = `${pi + 1}. ${tr(p.title) || ''}`.trim();
    if (seen.has(p.id)) add('error', 'chk.dupId', { id: p.id }, target);
    seen.add(p.id);
    for (const e of p.elements || []) {
      if (e.kind === 'image' && !e.src) add('warn', 'chk.imgNoSrc', { page }, { ...target, element: e.id });
      if (e.kind === 'chart') for (const id of e.attrs || []) if (!attrs[id]) add('warn', 'chk.unknownAttr', { page, id }, { ...target, element: e.id });
    }
    if (p.type === 'decision') {
      const d = p.decision || {};
      const choices = d.choices || [];
      if (choices.length < 2) add('warn', 'chk.fewChoices', { page }, target);
      if (!(p.elements || []).some((e) => e.kind === 'choices')) add('warn', 'chk.noChoicesEl', { page }, target);
      for (const c of choices) {
        if (choiceIds.has(c.id)) add('error', 'chk.dupId', { id: c.id }, target);
        choiceIds.add(c.id);
        const label = tr(c.label) || c.id;
        const effects = { ...(c.effects || {}), ...((c.fail && c.fail.effects) || {}) };
        for (const id of Object.keys(effects)) if (!attrs[id]) add('warn', 'chk.unknownAttr', { page, id }, target);
        if (c.goto && !pageIds.has(c.goto)) add('error', 'chk.badGoto', { page, choice: label }, target);
        if (c.fail && c.fail.goto && !pageIds.has(c.fail.goto)) add('error', 'chk.badGoto', { page, choice: label }, target);
        if (!Object.values(c.effects || {}).some((v) => Number(v))) add('info', 'chk.noEffects', { page, choice: label }, target);
      }
      if (d.mode === 'multiple' && Number(d.max) > 0 && Number(d.min) > Number(d.max)) add('error', 'chk.minGtMax', { page }, target);
    }
  }
  // conditions need all choice ids first
  for (const [pi, p] of (wg.pages || []).entries()) {
    const target = { tab: 'pages', page: p.id };
    const page = `${pi + 1}. ${tr(p.title) || ''}`.trim();
    for (const r of p.condition?.rules || []) {
      if (r.type === 'choice' && !choiceIds.has(r.choice)) add('error', 'chk.condChoice', { page }, target);
      if (r.type !== 'choice' && !attrs[r.attr]) add('error', 'chk.condAttr', { page }, target);
    }
  }
  return issues;
}
