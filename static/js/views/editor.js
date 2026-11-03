// Wargame editor: pages (free-form stage), attributes, settings, checks.
import { t, tr, getLang } from '../i18n.js';
import { h, clear, debounce, toast, modal, confirmDialog, downloadJSON, readFile, pickFile, slug, clone, uid, clamp, round, isModalOpen } from '../util.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import {
  normalizeWargame, newPage, newElement, newChoice, newDecision, PAGE_TEMPLATES, CHANNELS, CHART_TYPES,
  TEXT_SIZES, BOXES, FONTS, OPS, startValues, applyEffects, allChoices, maxStep, mediaUrl, checkWargame, L, deltaTone,
} from '../model.js';
import { renderStage, stageFit, fitText } from '../render.js';
import { brand, langSwitch } from './common.js';
import { biField, field, row, section, textInput, numInput, selectInput, checkbox, segmented, colorInput } from './fields.js';
import { attributesTab, settingsTab, checkTab, choiceLibraryDialog } from './editor-tabs.js';

const TPL_ICON = { title: 'title', text: 'type', inject: 'mail', image: 'image', decision: 'choices', results: 'gauge', debrief: 'timeline', blank: 'blank' };
const KIND_ICON = { text: 'type', image: 'image', inject: 'mail', chart: 'chart', choices: 'choices' };
const CHART_ICON = { bars: 'chart', gauges: 'gauge', radar: 'radar', timeline: 'timeline', cards: 'grid', deltas: 'table', log: 'list' };
const TABS = [['pages', 'layers'], ['attributes', 'sliders'], ['settings', 'monitor'], ['check', 'check']];

export async function editorView(root, id, query) {
  const wg = normalizeWargame(await api.getWargame(id));
  const ed = {
    tab: TABS.some(([k]) => k === query.tab) ? query.tab : 'pages',
    pageId: query.page && wg.pages.some((p) => p.id === query.page) ? query.page : wg.pages[0]?.id || null,
    elId: null,
    previewLang: getLang(),
    status: 'saved',
    openChoices: new Set(),
    focusAttr: null,
  };
  const els = {};

  // ---------- saving ----------
  let saveSeq = 0;
  let lastSave = Promise.resolve();
  async function doSave() {
    const seq = ++saveSeq;
    setStatus('saving');
    try {
      await api.saveWargame(wg.id, wg);
      if (seq === saveSeq) setStatus('saved');
    } catch (err) {
      setStatus('error');
      toast(`${t('ed.saveFailed')}: ${err.message}`, 'error', 5000);
    }
  }
  const save = debounce(() => { lastSave = doSave(); }, 600);
  async function saveNow() { save.flush(); await lastSave; }

  function setStatus(s) {
    ed.status = s;
    if (els.status) {
      els.status.className = `save-status ${s}`;
      els.status.textContent = t(`ed.status.${s}`);
      els.status.title = t(`ed.status.${s}`);
    }
  }

  const thumbLater = debounce((pid) => updateThumb(pid), 350);
  function changed({ stage = true, thumb = true, list = false } = {}) {
    setStatus('dirty');
    save();
    if (ed.tab !== 'pages') return;
    if (stage) renderStageArea();
    if (list) renderPageList();
    else if (thumb) thumbLater(ed.pageId);
  }

  const page = () => wg.pages.find((p) => p.id === ed.pageId) || null;
  const element = () => page()?.elements.find((e) => e.id === ed.elId) || null;

  // Preview data: assume the first option was taken on every decision before this page.
  function previewData(pageId = ed.pageId) {
    const start = startValues(wg);
    let values = { ...start };
    const decisions = [];
    for (const pg of wg.pages) {
      if (pg.id === pageId) break;
      if (pg.type !== 'decision' || !pg.decision?.choices?.length) continue;
      const c = pg.decision.choices[0];
      const before = { ...values };
      values = applyEffects(wg, values, c.effects);
      decisions.push({ pageId: pg.id, choiceIds: [c.id], results: [{ choiceId: c.id, chance: 100, roll: null, success: true, effects: c.effects, goto: '' }], before, after: { ...values } });
    }
    const timeline = [{ label: L('Start', 'Start'), values: start }, ...decisions.map((d) => ({ label: wg.pages.find((p) => p.id === d.pageId)?.title, values: d.after }))];
    return { values, start, timeline, decisions, last: decisions[decisions.length - 1] || null };
  }

  // ---------- frame ----------
  function renderAll() {
    clear(root);
    els.status = h('span', { class: 'save-status' });
    els.tabs = h('nav', { class: 'tabs' });
    const top = h('header', { class: 'topbar ed-top' },
      brand(),
      h('div', { class: 'ed-title' },
        h('span', { class: 'kicker' }, t('ed.editing')),
        els.title = h('b', null, tr(wg.meta.title) || t('lib.untitled'))),
      els.tabs,
      h('div', { class: 'topbar-actions' },
        els.status,
        h('button', { class: 'btn', onClick: exportWargame, title: t('lib.export') }, icon('download'), h('span', { class: 'hide-sm' }, t('lib.export'))),
        h('button', { class: 'btn primary', onClick: present }, icon('play'), t('lib.present')),
        langSwitch()));
    els.body = h('div', { class: 'ed-body' });
    root.append(h('div', { class: 'editor' }, top, els.body));
    setStatus(ed.status);
    renderBody();
  }

  function renderTabs() {
    const issues = checkWargame(wg).filter((i) => i.level !== 'info').length;
    clear(els.tabs).append(...TABS.map(([k, ic]) => h('button', {
      class: ed.tab === k ? 'on' : '',
      title: t(`ed.tab.${k}`),
      onClick: () => { if (ed.tab !== k) { ed.tab = k; renderBody(); } },
    }, icon(ic), h('span', null, t(`ed.tab.${k}`)), k === 'check' && issues ? h('span', { class: 'badge' }, String(issues)) : null)));
  }

  function renderBody() {
    renderTabs();
    clear(els.body);
    els.stage = null;
    els.stageHost = null;
    const ctx = tabCtx();
    if (ed.tab === 'attributes') attributesTab(els.body, ctx);
    else if (ed.tab === 'settings') settingsTab(els.body, ctx);
    else if (ed.tab === 'check') checkTab(els.body, ctx);
    else renderPagesTab();
  }

  function tabCtx() {
    return {
      wg,
      ed,
      changed: (o = {}) => { changed({ stage: false, thumb: false, ...o }); if (o.title) els.title.textContent = tr(wg.meta.title) || t('lib.untitled'); },
      rerender: renderBody,
      goTo: gotoTarget,
      imagePicker,
      renameAttr,
      removeAttr,
      previewData,
    };
  }

  function gotoTarget(target = {}) {
    ed.tab = target.tab || 'pages';
    if (target.page) { ed.pageId = target.page; ed.elId = target.element || null; }
    if (target.attr) ed.focusAttr = target.attr;
    renderBody();
  }

  // ---------- pages tab ----------
  function renderPagesTab() {
    els.list = h('div', { class: 'pl-list' });
    els.canvas = h('section', { class: 'ed-canvas' });
    els.inspector = h('aside', { class: 'ed-inspector' });
    els.body.append(h('div', { class: 'ed-pages' },
      h('aside', { class: 'ed-pagelist' },
        h('div', { class: 'pl-head' },
          h('span', { class: 'kicker' }, t('ed.pages')),
          els.pageCount = h('span', { class: 'pl-count' }, String(wg.pages.length)),
          h('span', { class: 'spacer' }),
          addPageButton()),
        els.list),
      els.canvas,
      els.inspector));
    renderPageList();
    renderCanvas();
    renderInspector();
  }

  function addPageButton() {
    return h('button', {
      class: 'btn sm primary',
      onClick: (e) => popMenu(e.currentTarget, PAGE_TEMPLATES.map((tpl) => ({
        icon: TPL_ICON[tpl], label: t(`tpl.${tpl}`), hint: t(`tpl.${tpl}.hint`), onClick: () => addPage(tpl),
      }))),
    }, icon('plus'), t('ed.addPage'));
  }

  function renderPageList() {
    if (!els.list) return;
    clear(els.list);
    els.pageCount.textContent = String(wg.pages.length);
    wg.pages.forEach((p, i) => els.list.append(pageItem(p, i)));
  }

  function pageBadges(p) {
    const hasGoto = p.type === 'decision' && (p.decision?.choices || []).some((c) => c.goto || c.fail?.goto);
    const steps = maxStep(p);
    return [
      p.type === 'decision' ? h('span', { class: 'pb decision', title: t('ed.type.decision') }, icon('choices')) : null,
      p.condition?.rules?.length ? h('span', { class: 'pb', title: t('ed.condition') }, icon('filter')) : null,
      hasGoto ? h('span', { class: 'pb', title: t('ed.goto') }, icon('branch')) : null,
      p.timer ? h('span', { class: 'pb', title: t('ed.timer') }, icon('clock')) : null,
      steps ? h('span', { class: 'pb steps', title: t('ed.reveal') }, `+${steps}`) : null,
    ];
  }

  function pageItem(p, i) {
    const thumb = h('div', { class: 'pl-thumb' });
    fillThumb(thumb, p);
    const item = h('div', {
      class: ['pl-item', p.id === ed.pageId && 'on', p.type === 'decision' && 'is-decision'],
      draggable: 'true',
      dataset: { id: p.id },
      onClick: () => selectPage(p.id),
    },
    h('span', { class: 'pl-num' }, String(i + 1).padStart(2, '0')),
    thumb,
    h('div', { class: 'pl-meta' },
      h('span', { class: 'pl-title' }, tr(p.title, ed.previewLang) || '—'),
      h('span', { class: 'pl-badges' }, pageBadges(p))),
    h('div', { class: 'pl-tools' },
      iconBtn('copy', t('ed.duplicate'), (e) => { e.stopPropagation(); duplicatePage(p); }),
      iconBtn('trash', t('ed.delete'), (e) => { e.stopPropagation(); deletePage(p); }, 'danger')));
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-page', p.id);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('text/x-page')) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      item.classList.toggle('drop-after', after);
      item.classList.toggle('drop-before', !after);
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-after', 'drop-before'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = item.classList.contains('drop-after');
      item.classList.remove('drop-after', 'drop-before');
      const srcId = e.dataTransfer.getData('text/x-page');
      if (!srcId || srcId === p.id) return;
      const from = wg.pages.findIndex((x) => x.id === srcId);
      const [moved] = wg.pages.splice(from, 1);
      let to = wg.pages.findIndex((x) => x.id === p.id);
      if (after) to++;
      wg.pages.splice(to, 0, moved);
      changed({ stage: false, list: true });
    });
    return item;
  }

  function fillThumb(thumb, p) {
    clear(thumb).append(stageFit(renderStage(p, { wg, lang: ed.previewLang, mode: 'thumb', step: Infinity, data: previewData(p.id) })));
  }

  function updateThumb(pid) {
    if (!els.list) return;
    const item = els.list.querySelector(`.pl-item[data-id="${CSS.escape(pid || '')}"]`);
    const p = wg.pages.find((x) => x.id === pid);
    if (!item || !p) return;
    fillThumb(item.querySelector('.pl-thumb'), p);
    item.querySelector('.pl-title').textContent = tr(p.title, ed.previewLang) || '—';
    clear(item.querySelector('.pl-badges')).append(...pageBadges(p).filter(Boolean));
  }

  function selectPage(pid) {
    if (ed.pageId === pid) return;
    ed.pageId = pid;
    ed.elId = null;
    for (const n of els.list.querySelectorAll('.pl-item')) n.classList.toggle('on', n.dataset.id === pid);
    renderCanvas();
    renderInspector();
  }

  function addPage(tpl) {
    const p = newPage(tpl);
    const idx = wg.pages.findIndex((x) => x.id === ed.pageId);
    wg.pages.splice(idx < 0 ? wg.pages.length : idx + 1, 0, p);
    ed.pageId = p.id;
    ed.elId = null;
    changed({ stage: false, list: true });
    renderCanvas();
    renderInspector();
    els.list.querySelector('.pl-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  function duplicatePage(p) {
    const copy = clone(p);
    copy.id = uid('p-');
    for (const e of copy.elements) e.id = uid('e-');
    for (const c of copy.decision?.choices || []) c.id = uid('c-');
    copy.title = { en: `${p.title.en || ''} (copy)`.trim(), de: `${p.title.de || ''} (Kopie)`.trim() };
    wg.pages.splice(wg.pages.indexOf(p) + 1, 0, copy);
    ed.pageId = copy.id;
    ed.elId = null;
    changed({ stage: false, list: true });
    renderCanvas();
    renderInspector();
  }

  async function deletePage(p) {
    const ok = await confirmDialog(t('ed.deletePageTitle'), t('ed.deletePageText', { title: tr(p.title) || '—' }), { okLabel: t('ed.delete'), cancelLabel: t('btn.cancel'), danger: true });
    if (!ok) return;
    const idx = wg.pages.indexOf(p);
    wg.pages.splice(idx, 1);
    for (const pg of wg.pages) {
      for (const c of pg.decision?.choices || []) {
        if (c.goto === p.id) c.goto = '';
        if (c.fail?.goto === p.id) c.fail.goto = '';
      }
    }
    if (ed.pageId === p.id) {
      ed.pageId = wg.pages[Math.min(idx, wg.pages.length - 1)]?.id || null;
      ed.elId = null;
    }
    changed({ stage: false, list: true });
    renderCanvas();
    renderInspector();
  }

  // ---------- canvas ----------
  function renderCanvas() {
    clear(els.canvas);
    els.stage = null;
    const p = page();
    if (!p) {
      els.canvas.append(h('div', { class: 'ed-empty' }, icon('layers'), h('p', null, t('ed.noPages')), addPageButton()));
      return;
    }
    const addEl = (kind) => h('button', { class: 'tool', onClick: () => addElement(kind), title: t(`kind.${kind}.hint`) },
      icon(KIND_ICON[kind]), h('span', null, t(`kind.${kind}`)));
    els.canvas.append(
      h('div', { class: 'ed-tools' },
        h('div', { class: 'tool-group' },
          h('span', { class: 'kicker' }, t('ed.add')),
          addEl('text'), addEl('image'), addEl('inject'), addEl('chart'),
          p.type === 'decision' && !p.elements.some((e) => e.kind === 'choices') ? addEl('choices') : null),
        h('div', { class: 'tool-group' },
          h('span', { class: 'kicker' }, t('ed.preview')),
          segmented([['en', 'EN'], ['de', 'DE']], ed.previewLang, (l) => { ed.previewLang = l; renderStageArea(); renderPageList(); }),
          h('button', { class: 'btn sm', onClick: () => presentFrom(p.id), title: t('ed.testHint') }, icon('play'), t('ed.test')))),
      els.stageHost = h('div', { class: 'ed-stage-host' }),
      h('div', { class: 'ed-canvas-foot' }, icon('info'), h('span', null, t('ed.canvasHint'))));
    renderStageArea();
    // drop image files onto the stage
    els.stageHost.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); els.stageHost.classList.add('drop'); } });
    els.stageHost.addEventListener('dragleave', () => els.stageHost.classList.remove('drop'));
    els.stageHost.addEventListener('drop', async (e) => {
      e.preventDefault();
      els.stageHost.classList.remove('drop');
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (!file || !els.stage) return;
      const r = els.stage.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 100 - 15, 0, 70);
      const y = clamp(((e.clientY - r.top) / r.height) * 100 - 15, 0, 70);
      await addImageFromFile(file, { x: round(x, 1), y: round(y, 1), w: 30, h: 30 });
    });
  }

  function renderStageArea() {
    if (!els.stageHost) return;
    const p = page();
    if (!p) return;
    const stage = renderStage(p, { wg, lang: ed.previewLang, mode: 'edit', step: Infinity, data: previewData(), showHidden: true });
    els.stage = stage;
    stage.addEventListener('pointerdown', (e) => { if (!e.target.closest('.el')) selectElement(null); });
    for (const node of stage.querySelectorAll(':scope > .el')) {
      const el = p.elements.find((x) => x.id === node.dataset.id);
      if (!el) continue;
      node.addEventListener('pointerdown', (e) => startDrag(e, el, node, 'move'));
      node.addEventListener('dblclick', () => els.inspector.querySelector('textarea, input[type=text]')?.focus());
      if (Number(el.reveal) > 0) node.append(h('span', { class: 'reveal-badge', title: t('ed.reveal') }, `+${el.reveal}`));
      if (el.id === ed.elId) decorateSelected(node, el);
    }
    clear(els.stageHost).append(stageFit(stage));
    fitText(stage);
  }

  function decorateSelected(node, el) {
    node.classList.add('selected');
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const hd = h('span', { class: `handle h-${d}` });
      hd.addEventListener('pointerdown', (e) => startDrag(e, el, node, d));
      node.append(hd);
    }
  }

  function selectElement(elId) {
    if (ed.elId === elId) return;
    ed.elId = elId;
    if (els.stage) {
      for (const node of els.stage.querySelectorAll(':scope > .el')) {
        node.classList.remove('selected');
        node.querySelectorAll('.handle').forEach((n) => n.remove());
      }
      const el = element();
      const node = elId && els.stage.querySelector(`:scope > .el[data-id="${CSS.escape(elId)}"]`);
      if (node && el) decorateSelected(node, el);
    }
    renderInspector();
  }

  function startDrag(e, el, node, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (ed.elId !== el.id) selectElement(el.id);
    const rect = els.stage.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { x: Number(el.x), y: Number(el.y), w: Number(el.w), h: Number(el.h) };
    let moved = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      moved = true;
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      const sn = ev.altKey ? 0.1 : 0.5;
      const S = (v) => Math.round(v / sn) * sn;
      let { x, y, w, h: hh } = o;
      if (mode === 'move') {
        x = clamp(S(o.x + dx), 0, Math.max(0, 100 - o.w));
        y = clamp(S(o.y + dy), 0, Math.max(0, 100 - o.h));
      } else {
        if (mode.includes('e')) w = clamp(S(o.w + dx), 2, 100 - o.x);
        if (mode.includes('s')) hh = clamp(S(o.h + dy), 2, 100 - o.y);
        if (mode.includes('w')) { const nx = clamp(S(o.x + dx), 0, o.x + o.w - 2); w = o.w + (o.x - nx); x = nx; }
        if (mode.includes('n')) { const ny = clamp(S(o.y + dy), 0, o.y + o.h - 2); hh = o.h + (o.y - ny); y = ny; }
      }
      Object.assign(el, { x: round(x, 2), y: round(y, 2), w: round(w, 2), h: round(hh, 2) });
      Object.assign(node.style, { left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` });
      syncPosInputs(el);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) changed({ stage: mode !== 'move' && ['chart', 'choices'].includes(el.kind) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function syncPosInputs(el) {
    if (!els.pos) return;
    for (const k of ['x', 'y', 'w', 'h']) if (els.pos[k] && document.activeElement !== els.pos[k]) els.pos[k].value = String(el[k]);
  }

  // ---------- element operations ----------
  function addElement(kind, partial = {}) {
    const p = page();
    if (!p) return null;
    if (kind === 'choices' && p.type !== 'decision') setPageType(p, 'decision', false);
    const el = newElement(kind, partial);
    // cascade so new elements don't land exactly on top of each other
    while (p.elements.some((x) => Math.abs(x.x - el.x) < 0.5 && Math.abs(x.y - el.y) < 0.5) && el.x < 70 && el.y < 70) { el.x += 2; el.y += 2; }
    el.w = Math.min(el.w, 100 - el.x);
    el.h = Math.min(el.h, 100 - el.y);
    p.elements.push(el);
    ed.elId = el.id;
    changed({ stage: true, thumb: true });
    renderCanvas();
    renderInspector();
    return el;
  }

  async function addImageFromFile(file, pos = {}) {
    try {
      const src = await uploadImage(file);
      if (src) addElement('image', { src, ...pos });
    } catch (err) { toast(err.message, 'error'); }
  }

  function duplicateElement(p, el) {
    const copy = clone(el);
    copy.id = uid('e-');
    copy.x = clamp(el.x + 2, 0, 100 - el.w);
    copy.y = clamp(el.y + 2, 0, 100 - el.h);
    p.elements.splice(p.elements.indexOf(el) + 1, 0, copy);
    ed.elId = copy.id;
    changed();
    renderInspector();
  }

  function deleteElement(p, el) {
    p.elements.splice(p.elements.indexOf(el), 1);
    ed.elId = null;
    changed();
    if (el.kind === 'choices') renderCanvas();
    renderInspector();
  }

  function moveLayer(p, el, dir) {
    const i = p.elements.indexOf(el);
    const j = clamp(i + dir, 0, p.elements.length - 1);
    if (i === j) return;
    p.elements.splice(i, 1);
    p.elements.splice(j, 0, el);
    changed();
  }

  function setPageType(p, type, rerender = true) {
    p.type = type;
    if (type === 'decision') {
      if (!p.decision) p.decision = newDecision();
      if (!p.elements.some((e) => e.kind === 'choices')) {
        p.elements.push(newElement('choices'));
      }
      if (!p.timer) p.timer = 300;
    } else {
      p.elements = p.elements.filter((e) => e.kind !== 'choices');
    }
    if (rerender) {
      changed({ list: true });
      renderCanvas();
      renderInspector();
    }
  }

  // ---------- inspector ----------
  function renderInspector() {
    if (!els.inspector) return;
    const scroll = els.inspector.scrollTop;
    clear(els.inspector);
    els.pos = null;
    const p = page();
    if (!p) return;
    const el = element();
    els.inspector.append(
      h('div', { class: 'insp-tabs' },
        h('button', { class: !el ? 'on' : '', onClick: () => selectElement(null) }, icon('file'), t('ed.page')),
        h('button', { class: el ? 'on' : '', disabled: el ? null : true }, icon(el ? KIND_ICON[el.kind] : 'square'), el ? t(`kind.${el.kind}`) : t('ed.element'))),
      el ? elementPanel(p, el) : pagePanel(p));
    els.inspector.scrollTop = scroll;
  }

  function refreshListTitle(p) {
    const item = els.list?.querySelector(`.pl-item[data-id="${CSS.escape(p.id)}"] .pl-title`);
    if (item) item.textContent = tr(p.title, ed.previewLang) || '—';
  }

  function pagePanel(p) {
    return h('div', { class: 'insp-body' },
      section(t('ed.page'), [
        biField(p, 'title', { label: t('ed.pageTitle'), onChange: () => { changed(); refreshListTitle(p); } }),
        checkbox(t('ed.showTitle'), p.showTitle, (v) => { p.showTitle = v; changed(); }),
        field(t('ed.pageType'), segmented([['content', t('ed.type.content')], ['decision', t('ed.type.decision')]], p.type, (v) => setPageType(p, v))),
      ], { icon: icon('file') }),
      p.type === 'decision' ? decisionSection(p) : null,
      section(t('ed.notes'), [
        biField(p, 'notes', { multiline: true, rows: 4, onChange: () => changed({ stage: false, thumb: false }), hint: t('ed.notesHint') }),
      ], { icon: icon('memo') }),
      section(t('ed.flow'), [
        field(t('ed.timer'), row(
          numInput(p.timer ? round(p.timer / 60, 2) : '', (v) => { p.timer = Math.max(0, Math.round((v || 0) * 60)); changed({ stage: false }); }, { min: 0, step: 0.5, placeholder: '0', allowEmpty: true }),
          h('span', { class: 'unit' }, t('ed.minutes'))), t('ed.timerHint')),
        conditionEditor(p),
      ], { icon: icon('branch'), open: !!(p.condition?.rules?.length || p.timer) }),
      section(t('ed.background'), backgroundEditor(p), { icon: icon('image'), open: !!(p.background?.color || p.background?.image) }));
  }

  function decisionSection(p) {
    const d = p.decision;
    const choicesWrap = h('div', { class: 'choice-list' });
    const renderChoices = () => {
      clear(choicesWrap);
      d.choices.forEach((c, i) => choicesWrap.append(choiceEditor(p, c, i, renderChoices)));
      countEl.textContent = String(d.choices.length);
    };
    const countEl = h('span', { class: 'count' });
    const limits = h('div', { class: 'field-row' });
    const renderLimits = () => {
      clear(limits);
      if (d.mode === 'multiple') {
        limits.append(
          field(t('ed.minChoices'), numInput(d.min ?? 1, (v) => { d.min = Math.max(0, Math.round(v)); changed(); }, { min: 0, step: 1 })),
          field(t('ed.maxChoices'), numInput(d.max ?? 0, (v) => { d.max = Math.max(0, Math.round(v)); changed(); }, { min: 0, step: 1 }), t('ed.maxHint')));
      }
    };
    renderLimits();
    const sec = section(t('ed.decision'), [
      biField(d, 'prompt', { label: t('ed.prompt'), multiline: true, rows: 2, onChange: () => changed() }),
      field(t('ed.mode'), segmented([['single', t('ed.mode.single')], ['multiple', t('ed.mode.multiple')]], d.mode, (v) => {
        d.mode = v;
        if (v === 'multiple' && !(Number(d.max) > 1)) { d.min = 1; d.max = 2; }
        renderLimits();
        changed();
      })),
      limits,
      field(t('ed.showEffects'), selectInput([['never', t('ed.fx.never')], ['after', t('ed.fx.after')], ['always', t('ed.fx.always')]], d.showEffects || 'after', (v) => { d.showEffects = v; changed(); })),
      h('div', { class: 'sub-head' },
        h('span', null, t('ed.choices'), ' ', countEl),
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn sm',
          onClick: () => {
            const c = newChoice({ label: L(`Option ${d.choices.length + 1}`, `Option ${d.choices.length + 1}`) });
            d.choices.push(c);
            ed.openChoices.add(c.id);
            renderChoices();
            changed();
          },
        }, icon('plus'), t('ed.addChoice')),
        h('button', { class: 'btn sm', onClick: () => choiceLibraryDialog(tabCtx(), p, () => { renderChoices(); changed({ list: true }); }) }, icon('book'), t('ed.fromLibrary'))),
      choicesWrap,
    ], { icon: icon('choices') });
    renderChoices();
    return sec;
  }

  function gotoSelect(value, onChange) {
    return selectInput([['', t('ed.gotoNext')], ...wg.pages.map((pg, i) => [pg.id, `${i + 1}. ${tr(pg.title) || '—'}`])], value || '', onChange);
  }

  function effectsGrid(effects, onAny) {
    if (!wg.attributes.length) return h('div', { class: 'hint' }, t('ed.noAttrsYet'));
    return h('div', { class: 'fx-grid' }, wg.attributes.map((a) => {
      const tone = (inp, v) => {
        const tn = v ? deltaTone(a, v) : 'neutral';
        inp.classList.toggle('good', tn === 'good');
        inp.classList.toggle('bad', tn === 'bad');
      };
      const input = numInput(effects[a.id] ?? '', (v, inp) => {
        if (!v) delete effects[a.id];
        else effects[a.id] = v;
        tone(inp, v);
        onAny?.();
      }, { step: 1, placeholder: '0', allowEmpty: true });
      tone(input, effects[a.id]);
      return h('label', { class: ['fx-row', a.hidden && 'is-hidden'], title: tr(a.description) },
        h('span', { class: 'fx-ico' }, a.icon || ''),
        h('span', { class: 'fx-name' }, tr(a.name), a.hidden ? h('small', null, ` (${t('attr.hiddenShort')})`) : null),
        input,
        h('span', { class: 'fx-unit' }, a.unit || ''));
    }));
  }

  function choiceEditor(p, c, i, rerender) {
    const d = p.decision;
    const open = ed.openChoices.has(c.id);
    const toggle = () => { if (open) ed.openChoices.delete(c.id); else ed.openChoices.add(c.id); rerender(); };
    const labelPreview = h('span', { class: 'ce-label' }, tr(c.label, ed.previewLang) || '—');
    const iconIn = textInput(c.icon || '', (v) => { c.icon = v.trim(); changed(); }, { placeholder: '🙂', cls: 'icon-in' });
    iconIn.maxLength = 8;
    const chance = Number(c.chance ?? 100);
    const fxCount = Object.values(c.effects || {}).filter((v) => Number(v)).length;
    const head = h('div', { class: 'ce-head', onClick: (e) => { if (!e.target.closest('button, input')) toggle(); } },
      h('span', { class: 'ce-num' }, String(i + 1)),
      iconIn,
      labelPreview,
      h('span', { class: 'ce-badges' },
        fxCount ? h('span', { class: 'mini-chip' }, `${fxCount} fx`) : null,
        chance < 100 ? h('span', { class: 'mini-chip warn' }, icon('dice'), `${chance}%`) : null,
        c.goto ? h('span', { class: 'mini-chip' }, icon('branch')) : null),
      h('span', { class: 'ce-tools' },
        iconBtn('arrow-up', t('ed.moveUp'), () => { if (i > 0) { d.choices.splice(i - 1, 0, d.choices.splice(i, 1)[0]); rerender(); changed(); } }),
        iconBtn('arrow-down', t('ed.moveDown'), () => { if (i < d.choices.length - 1) { d.choices.splice(i + 1, 0, d.choices.splice(i, 1)[0]); rerender(); changed(); } }),
        iconBtn('copy', t('ed.duplicate'), () => { const cp = clone(c); cp.id = uid('c-'); d.choices.splice(i + 1, 0, cp); rerender(); changed(); }),
        iconBtn('trash', t('ed.delete'), () => { d.choices.splice(i, 1); rerender(); changed({ list: true }); }, 'danger'),
        iconBtn(open ? 'chevron-up' : 'chevron-down', t('ed.expand'), toggle)));
    const card = h('div', { class: ['choice-ed', open && 'open'] }, head);
    if (!open) return card;

    const failWrap = h('div');
    const renderFail = () => {
      clear(failWrap);
      if (Number(c.chance ?? 100) >= 100) return;
      c.fail = c.fail || { effects: {}, outcome: L(), goto: '' };
      failWrap.append(h('div', { class: 'fail-box' },
        h('div', { class: 'sub-head' }, icon('dice'), h('span', null, t('ed.onFail', { p: 100 - Number(c.chance) }))),
        field(t('ed.effects'), effectsGrid(c.fail.effects, () => changed({ stage: false }))),
        biField(c.fail, 'outcome', { label: t('ed.outcome'), multiline: true, rows: 2, onChange: () => changed({ stage: false, thumb: false }) }),
        field(t('ed.goto'), gotoSelect(c.fail.goto, (v) => { c.fail.goto = v; changed({ list: true, stage: false }); }))));
    };
    renderFail();
    card.append(h('div', { class: 'ce-body' },
      biField(c, 'label', { label: t('ed.choiceLabel'), onChange: () => { labelPreview.textContent = tr(c.label, ed.previewLang) || '—'; changed(); } }),
      biField(c, 'description', { label: t('ed.choiceDesc'), multiline: true, rows: 2, onChange: () => changed() }),
      field(t('ed.effects'), effectsGrid(c.effects, () => changed({ stage: d.showEffects === 'always' })), t('ed.effectsHint')),
      biField(c, 'outcome', { label: t('ed.outcome'), multiline: true, rows: 2, onChange: () => changed({ stage: false, thumb: false }) }),
      row(
        field(t('ed.chance'), row(numInput(c.chance ?? 100, (v) => { c.chance = clamp(Math.round(v), 0, 100); renderFail(); changed(); }, { min: 0, max: 100, step: 5 }), h('span', { class: 'unit' }, '%')), t('ed.chanceHint')),
        field(t('ed.goto'), gotoSelect(c.goto, (v) => { c.goto = v; changed({ list: true, stage: false }); }))),
      failWrap));
    return card;
  }

  function conditionEditor(p) {
    const wrap = h('div', { class: 'cond' });
    const choiceOptions = () => allChoices(wg).map(({ page: pg, choice }) => [choice.id, `${wg.pages.indexOf(pg) + 1}. ${tr(choice.label) || choice.id}`]);
    const newRule = () => (wg.attributes[0]
      ? { type: 'attr', attr: wg.attributes[0].id, op: '<', value: 50 }
      : { type: 'choice', choice: allChoices(wg)[0]?.choice.id || '', op: 'chosen' });
    const upd = () => changed({ stage: false, list: true });
    const render = () => {
      clear(wrap);
      const cond = p.condition;
      wrap.append(h('div', { class: 'sub-head' }, icon('filter'), h('span', null, t('ed.condition'))));
      if (!cond || !cond.rules?.length) {
        wrap.append(h('p', { class: 'hint' }, t('ed.condNone')),
          h('button', { class: 'btn sm', onClick: () => { p.condition = { mode: 'all', rules: [newRule()] }; render(); upd(); } }, icon('plus'), t('ed.addCondition')));
        return;
      }
      wrap.append(h('p', { class: 'hint' }, t('ed.condShowIf')),
        segmented([['all', t('ed.cond.all')], ['any', t('ed.cond.any')]], cond.mode || 'all', (v) => { cond.mode = v; upd(); }));
      cond.rules.forEach((r, i) => {
        const typeSel = selectInput([['attr', t('ed.rule.attr')], ['choice', t('ed.rule.choice')]], r.type === 'choice' ? 'choice' : 'attr', (v) => {
          cond.rules[i] = v === 'choice' ? { type: 'choice', choice: choiceOptions()[0]?.[0] || '', op: 'chosen' } : { type: 'attr', attr: wg.attributes[0]?.id || '', op: '<', value: 50 };
          render(); upd();
        });
        const parts = r.type === 'choice'
          ? [selectInput(choiceOptions(), r.choice, (v) => { r.choice = v; upd(); }, { cls: 'grow' }),
            selectInput([['chosen', t('ed.rule.chosen')], ['notChosen', t('ed.rule.notChosen')]], r.op || 'chosen', (v) => { r.op = v; upd(); })]
          : [selectInput(wg.attributes.map((a) => [a.id, `${a.icon || ''} ${tr(a.name)}`.trim()]), r.attr, (v) => { r.attr = v; upd(); }, { cls: 'grow' }),
            selectInput(OPS.map((o) => [o, o]), r.op || '<', (v) => { r.op = v; upd(); }, { cls: 'op' }),
            numInput(r.value ?? 0, (v) => { r.value = v; upd(); }, { cls: 'val' })];
        wrap.append(h('div', { class: 'rule' }, typeSel, parts,
          iconBtn('x', t('ed.delete'), () => { cond.rules.splice(i, 1); if (!cond.rules.length) p.condition = null; render(); upd(); })));
      });
      wrap.append(h('button', { class: 'btn sm', onClick: () => { cond.rules.push(newRule()); render(); upd(); } }, icon('plus'), t('ed.addRule')));
    };
    render();
    return wrap;
  }

  function backgroundEditor(p) {
    const bg = p.background;
    const dim = h('input', { type: 'range', min: '0', max: '0.95', step: '0.05' });
    dim.value = String(bg.dim ?? 0.5);
    dim.addEventListener('input', () => { bg.dim = Number(dim.value); changed(); });
    return [
      field(t('ed.bgColor'), colorInput(bg.color, (v) => { bg.color = v; changed(); }, { presets: ['#0b1016', '#141a22', '#2a0f12', '#0f2a1d', '#f3f1ea'] })),
      field(t('ed.bgImage'), imagePicker(bg.image, (src) => { bg.image = src; changed(); })),
      field(t('ed.bgDim'), dim),
    ];
  }

  function elementPanel(p, el) {
    els.pos = {};
    const pos = ['x', 'y', 'w', 'h'].map((k) => {
      const inp = numInput(el[k], (v) => {
        el[k] = round(clamp(v, k === 'w' || k === 'h' ? 1 : 0, 100), 2);
        changed();
      }, { step: 0.5 });
      els.pos[k] = inp;
      return h('label', { class: 'pos-field' }, h('span', null, k.toUpperCase()), inp);
    });
    const kindPanel = {
      text: textPanel, image: imagePanel, inject: injectPanel, chart: chartPanel, choices: choicesPanel,
    }[el.kind];
    return h('div', { class: 'insp-body' },
      h('div', { class: 'insp-actions' },
        h('button', { class: 'btn sm', onClick: () => duplicateElement(p, el) }, icon('copy'), t('ed.duplicate')),
        iconBtn('arrow-up', t('ed.bringForward'), () => moveLayer(p, el, 1)),
        iconBtn('arrow-down', t('ed.sendBackward'), () => moveLayer(p, el, -1)),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm danger', onClick: () => deleteElement(p, el) }, icon('trash'), t('ed.delete'))),
      kindPanel ? kindPanel(el, p) : null,
      section(t('ed.layout'), [
        h('div', { class: 'pos-grid' }, pos),
        field(t('ed.reveal'), numInput(el.reveal || 0, (v) => { el.reveal = Math.max(0, Math.round(v)); changed({ list: true }); }, { min: 0, step: 1 }), t('ed.revealHint')),
      ], { icon: icon('grid') }));
  }

  function textPanel(el) {
    const st = el.style || (el.style = {});
    return section(t('kind.text'), [
      biField(el, 'text', { multiline: true, rows: 6, onChange: () => changed(), hint: t('ed.mdHint') }),
      row(
        field(t('ed.size'), selectInput(TEXT_SIZES.map((s) => [s, s.toUpperCase()]), st.size || 'm', (v) => { st.size = v; changed(); })),
        field(t('ed.font'), selectInput(FONTS.map((f) => [f, t(`font.${f}`)]), st.font || 'sans', (v) => { st.font = v; changed(); }))),
      field(t('ed.align'), segmented([['left', t('align.left')], ['center', t('align.center')], ['right', t('align.right')]], st.align || 'left', (v) => { st.align = v; changed(); })),
      field(t('ed.valign'), segmented([['top', t('valign.top')], ['middle', t('valign.middle')], ['bottom', t('valign.bottom')]], st.valign || 'top', (v) => { st.valign = v; changed(); })),
      field(t('ed.box'), selectInput(BOXES.map((b) => [b, t(`box.${b}`)]), st.box || 'none', (v) => { st.box = v; changed(); })),
      field(t('ed.color'), colorInput(st.color, (v) => { st.color = v; changed(); }, { presets: ['#ffffff', '#ffb000', '#e5484d', '#2fb47c', '#4f8df5', '#1c1f24'] })),
    ], { icon: icon('type') });
  }

  function imagePanel(el) {
    return section(t('kind.image'), [
      field(t('ed.image'), imagePicker(el.src, (src) => { el.src = src; changed(); })),
      field(t('ed.fit'), segmented([['contain', t('fit.contain')], ['cover', t('fit.cover')]], el.fit || 'contain', (v) => { el.fit = v; changed(); })),
      checkbox(t('ed.frame'), el.frame, (v) => { el.frame = v; changed(); }),
      biField(el, 'caption', { label: t('ed.caption'), onChange: () => changed() }),
    ], { icon: icon('image') });
  }

  function injectPanel(el) {
    return section(t('kind.inject'), [
      field(t('ed.channel'), h('div', { class: 'chip-pick' }, CHANNELS.map((ch) => h('button', {
        type: 'button',
        class: el.channel === ch ? 'on' : '',
        onClick: (e) => { el.channel = ch; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); changed(); },
      }, icon({ email: 'mail', phone: 'phone', chat: 'chat', sms: 'sms', news: 'news', social: 'social', alert: 'alert', memo: 'memo' }[ch]), t(`ch.${ch}`))))),
      row(
        field(t('ed.severity'), selectInput([['info', t('sev.info')], ['warning', t('sev.warning')], ['critical', t('sev.critical')]], el.severity || 'info', (v) => { el.severity = v; changed(); })),
        field(t('ed.time'), textInput(el.time || '', (v) => { el.time = v; changed(); }, { placeholder: 'Mon 08:15' }))),
      biField(el, 'from', { label: t('ed.from'), onChange: () => changed() }),
      biField(el, 'to', { label: t('inj.to'), onChange: () => changed() }),
      biField(el, 'subject', { label: t('ed.subject'), onChange: () => changed() }),
      biField(el, 'body', { label: t('ed.body'), multiline: true, rows: 6, onChange: () => changed(), hint: t('ed.mdHint') }),
    ], { icon: icon('mail') });
  }

  function chartPanel(el) {
    el.attrs = el.attrs || [];
    const attrList = h('div', { class: 'attr-pick' }, wg.attributes.map((a) => checkbox(`${a.icon || ''} ${tr(a.name)}${a.hidden ? ` (${t('attr.hiddenShort')})` : ''}`, el.attrs.includes(a.id), (v) => {
      el.attrs = v ? [...new Set([...el.attrs, a.id])] : el.attrs.filter((x) => x !== a.id);
      el.attrs = wg.attributes.map((x) => x.id).filter((x) => el.attrs.includes(x));
      changed();
    })));
    return section(t('kind.chart'), [
      field(t('ed.chartType'), h('div', { class: 'chart-pick' }, CHART_TYPES.map((ct) => h('button', {
        type: 'button',
        class: (el.chart || 'bars') === ct ? 'on' : '',
        onClick: (e) => { el.chart = ct; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); changed(); },
      }, icon(CHART_ICON[ct]), h('b', null, t(`chart.${ct}`)), h('small', null, t(`chart.${ct}.hint`)))))),
      field(t('ed.chartAttrs'), attrList, t('ed.chartAttrsHint')),
      checkbox(t('ed.includeHidden'), el.includeHidden, (v) => { el.includeHidden = v; changed(); }, { hint: t('ed.includeHiddenHint') }),
    ], { icon: icon('chart') });
  }

  function choicesPanel(el, p) {
    return section(t('kind.choices'), [
      h('p', { class: 'hint' }, t('ed.choicesElHint')),
      h('button', { class: 'btn sm', onClick: () => selectElement(null) }, icon('choices'), t('ed.editDecision')),
    ], { icon: icon('choices') });
  }

  // ---------- images ----------
  async function uploadImage(file) {
    file = file || await pickFile('image/*');
    if (!file) return null;
    if (file.size > 25 * 1024 * 1024) { toast(t('ed.tooLarge'), 'error'); return null; }
    const dataUrl = await readFile(file, 'dataURL');
    const res = await api.uploadMedia(wg.id, file.name || 'image.png', dataUrl);
    return res.file;
  }

  async function mediaGallery() {
    const files = (await api.listMedia(wg.id)).filter((f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f));
    return modal({
      title: t('ed.gallery'),
      wide: true,
      body: (close) => (files.length
        ? h('div', { class: 'gallery' }, files.map((f) => h('button', { class: 'gal-item', type: 'button', onClick: () => close(f), title: f },
          h('img', { src: mediaUrl(wg, f), alt: f, loading: 'lazy' }), h('span', null, f))))
        : h('p', { class: 'muted' }, t('ed.galleryEmpty'))),
    });
  }

  function imagePicker(value, onChange) {
    const wrap = h('div', { class: 'img-picker' });
    const render = (v) => {
      clear(wrap).append(
        h('div', { class: 'img-prev' }, v ? h('img', { src: mediaUrl(wg, v), alt: '' }) : icon('image')),
        h('div', { class: 'img-btns' },
          h('button', { type: 'button', class: 'btn sm', onClick: async () => { try { const src = await uploadImage(); if (src) { render(src); onChange(src); } } catch (err) { toast(err.message, 'error'); } } }, icon('upload'), t('ed.upload')),
          h('button', { type: 'button', class: 'btn sm', onClick: async () => { const src = await mediaGallery(); if (src) { render(src); onChange(src); } } }, icon('grid'), t('ed.gallery')),
          v ? h('button', { type: 'button', class: 'btn sm ghost', title: t('ed.remove'), onClick: () => { render(''); onChange(''); } }, icon('x')) : null));
    };
    render(value);
    return wrap;
  }

  // ---------- attributes (used by the attributes tab) ----------
  function eachReference(fn) {
    for (const p of wg.pages) {
      for (const c of p.decision?.choices || []) { fn({ effects: c.effects }); if (c.fail) fn({ effects: c.fail.effects }); }
      for (const r of p.condition?.rules || []) fn({ rule: r });
      for (const e of p.elements) if (e.kind === 'chart') fn({ chart: e });
    }
  }

  function renameAttr(oldId, newId) {
    eachReference(({ effects, rule, chart }) => {
      if (effects && oldId in effects) { effects[newId] = effects[oldId]; delete effects[oldId]; }
      if (rule && rule.type !== 'choice' && rule.attr === oldId) rule.attr = newId;
      if (chart && chart.attrs) chart.attrs = chart.attrs.map((x) => (x === oldId ? newId : x));
    });
  }

  function removeAttr(attrId) {
    let used = 0;
    eachReference(({ effects, rule, chart }) => {
      if (effects && attrId in effects) { delete effects[attrId]; used++; }
      if (chart && chart.attrs?.includes(attrId)) { chart.attrs = chart.attrs.filter((x) => x !== attrId); used++; }
      if (rule && rule.type !== 'choice' && rule.attr === attrId) used++;
    });
    for (const p of wg.pages) {
      if (p.condition?.rules) {
        p.condition.rules = p.condition.rules.filter((r) => r.type === 'choice' || r.attr !== attrId);
        if (!p.condition.rules.length) p.condition = null;
      }
    }
    return used;
  }

  // ---------- actions ----------
  async function exportWargame() {
    await saveNow();
    try {
      const data = await api.exportWargame(wg.id);
      downloadJSON(`${slug(tr(wg.meta.title, 'en') || tr(wg.meta.title)) || 'wargame'}.wargame.json`, data);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function present() {
    await saveNow();
    location.hash = `#/present/${wg.id}?from=edit`;
  }

  async function presentFrom(pageId) {
    await saveNow();
    location.hash = `#/present/${wg.id}?from=edit&test=1&page=${encodeURIComponent(pageId)}`;
  }

  function iconBtn(name, title, onClick, cls = '') {
    return h('button', { type: 'button', class: ['icon-btn', cls], title, onClick }, icon(name));
  }

  // ---------- keyboard / paste ----------
  const onKey = (e) => {
    if (isModalOpen()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow().then(() => toast(t('ed.status.saved'), 'ok', 1200));
      return;
    }
    if (ed.tab !== 'pages') return;
    const a = document.activeElement;
    if (a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable)) return;
    const p = page();
    const el = element();
    if (el) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteElement(p, el); return; }
      if (e.key === 'Escape') { selectElement(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(p, el); return; }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = e.shiftKey ? 5 : 0.5;
        if (e.key === 'ArrowLeft') el.x = clamp(round(el.x - s, 2), 0, 100 - el.w);
        if (e.key === 'ArrowRight') el.x = clamp(round(el.x + s, 2), 0, 100 - el.w);
        if (e.key === 'ArrowUp') el.y = clamp(round(el.y - s, 2), 0, 100 - el.h);
        if (e.key === 'ArrowDown') el.y = clamp(round(el.y + s, 2), 0, 100 - el.h);
        syncPosInputs(el);
        changed();
      }
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const i = wg.pages.findIndex((x) => x.id === ed.pageId);
      const n = wg.pages[clamp(i + (e.key === 'PageDown' ? 1 : -1), 0, wg.pages.length - 1)];
      if (n) selectPage(n.id);
    }
  };
  const onPaste = (e) => {
    if (ed.tab !== 'pages' || isModalOpen()) return;
    const a = document.activeElement;
    if (a && ['INPUT', 'TEXTAREA'].includes(a.tagName)) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); addImageFromFile(file); }
  };
  const onBeforeUnload = (e) => {
    if (save.pending() || ed.status === 'saving') { save.flush(); e.preventDefault(); e.returnValue = ''; }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', onBeforeUnload);

  renderAll();

  return {
    onLang() { ed.previewLang = getLang(); renderAll(); },
    destroy() {
      save.flush();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('beforeunload', onBeforeUnload);
      closeMenus();
    },
  };
}

// ---------- tiny popup menu ----------
function closeMenus() { document.querySelectorAll('.pop-menu').forEach((m) => m.remove()); }

function popMenu(anchor, items) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'pop-menu', style: { left: `${Math.round(r.left)}px`, top: `${Math.round(r.bottom + 6)}px` } },
    items.map((it) => h('button', { type: 'button', onClick: () => { closeMenus(); it.onClick(); } },
      icon(it.icon),
      h('span', null, h('b', null, it.label), it.hint ? h('small', null, it.hint) : null))));
  document.body.append(menu);
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - mr.width - 8)}px`;
  if (mr.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, r.top - mr.height - 6)}px`;
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { closeMenus(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  });
}
