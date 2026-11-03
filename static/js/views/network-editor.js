// Visual editor for a network map element: drag nodes and zones, connect nodes,
// and define how nodes/connections change during the exercise.
import { t, tr } from '../i18n.js';
import { h, clear, modal, uid, clone, clamp, round, debounce } from '../util.js';
import { icon } from '../icons.js';
import { L } from '../model.js';
import { renderNetwork, NET_STATUSES, NET_LINK_STYLES, NET_ICONS } from '../network.js';
import { biField, field, row, numInput, selectInput, checkbox, segmented } from './fields.js';
import { conditionEditor } from './condition.js';

export async function openNetworkEditor({ wg, el, lang, previewData, onChange }) {
  el.nodes = el.nodes || [];
  el.links = el.links || [];
  el.zones = el.zones || [];
  const aspect = (Number(el.w) * 16) / (Math.max(1, Number(el.h)) * 9);
  const st = { sel: null, connect: false, connectFrom: null, base: true, lang: lang || 'en' };
  const theme = wg.settings?.theme === 'light' ? 'light' : 'dark';

  const canvas = h('div', { class: `net-canvas theme-${theme}`, style: { '--ar': String(aspect), '--accent': wg.settings?.accent || '#ffb000' } });
  const side = h('div', { class: 'net-ed-side' });
  const connectBtn = h('button', { type: 'button', class: 'btn sm', title: t('net.connectHint'), onClick: () => toggleConnect() }, icon('link'), t('net.connect'));
  const hint = h('div', { class: 'net-ed-hint' });

  const node = (id) => el.nodes.find((n) => n.id === id);
  // local undo history for this dialog (Ctrl+Z / Ctrl+Y)
  const FIELDS = ['title', 'subtitle', 'frame', 'legend', 'nodes', 'links', 'zones'];
  const snap = () => JSON.stringify(FIELDS.map((k) => el[k]));
  const hist = { stack: [snap()], index: 0 };
  const record = debounce(() => {
    const cur = snap();
    if (cur === hist.stack[hist.index]) return;
    hist.stack = hist.stack.slice(0, hist.index + 1);
    hist.stack.push(cur);
    if (hist.stack.length > 200) hist.stack.shift();
    hist.index = hist.stack.length - 1;
  }, 400);
  const commit = () => { onChange(); record(); };
  const changed = () => { draw(); commit(); };
  function restore(index) {
    hist.index = index;
    JSON.parse(hist.stack[index]).forEach((v, i) => { el[FIELDS[i]] = v; });
    const s = st.sel;
    if (s && !(s.type === 'node' ? el.nodes : s.type === 'link' ? el.links : el.zones).some((x) => x.id === s.id)) st.sel = null;
    if (st.connectFrom && !el.nodes.some((n) => n.id === st.connectFrom)) st.connectFrom = null;
    draw();
    renderSide();
    onChange();
  }
  const undo = () => { record.flush(); if (hist.index > 0) restore(hist.index - 1); };
  const redo = () => { record.flush(); if (hist.index < hist.stack.length - 1) restore(hist.index + 1); };

  function draw() {
    canvas.innerHTML = renderNetwork(el, {
      lang: st.lang, aspect, data: st.base ? null : previewData, base: st.base, editing: true, sel: st.sel, connectFrom: st.connectFrom,
    });
    connectBtn.classList.toggle('on', st.connect);
    hint.textContent = st.connect
      ? (st.connectFrom ? t('net.connectNext') : t('net.connectFirst'))
      : t('net.canvasHint');
  }

  function select(sel) {
    st.sel = sel;
    draw();
    renderSide();
  }

  function toggleConnect(on = !st.connect) {
    st.connect = on;
    st.connectFrom = on && st.sel?.type === 'node' ? st.sel.id : null;
    draw();
  }

  // ---------- add / remove ----------
  function addNode() {
    const n = { id: uid('n-'), label: L(t('net.newNode', null, 'en'), t('net.newNode', null, 'de')), sub: L(), icon: 'server', x: 50, y: 50, w: 17, status: 'normal', states: [] };
    while (el.nodes.some((o) => Math.abs(o.x - n.x) < 2 && Math.abs(o.y - n.y) < 2)) { n.x += 4; n.y += 6; }
    el.nodes.push(n);
    select({ type: 'node', id: n.id });
    commit();
  }
  function addZone() {
    const z = { id: uid('z-'), label: L(t('net.newZone', null, 'en'), t('net.newZone', null, 'de')), x: 30, y: 25, w: 40, h: 50 };
    el.zones.push(z);
    select({ type: 'zone', id: z.id });
    commit();
  }
  function addLink(from, to) {
    const existing = el.links.find((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from));
    if (!existing) el.links.push({ id: uid('l-'), from, to, style: 'normal', label: L(), states: [] });
    commit();
  }
  function removeSelected() {
    const s = st.sel;
    if (!s) return;
    if (s.type === 'node') {
      el.nodes = el.nodes.filter((n) => n.id !== s.id);
      el.links = el.links.filter((l) => l.from !== s.id && l.to !== s.id);
    } else if (s.type === 'link') el.links = el.links.filter((l) => l.id !== s.id);
    else if (s.type === 'zone') el.zones = el.zones.filter((z) => z.id !== s.id);
    if (st.connectFrom === s.id) st.connectFrom = null;
    select(null);
    commit();
  }

  // ---------- pointer interaction ----------
  const toPct = (e) => {
    const svg = canvas.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const vb = svg.viewBox.baseVal;
    return { x: (p.x / vb.width) * 100, y: (p.y / vb.height) * 100 };
  };
  function drag(e, apply) {
    e.preventDefault();
    const p0 = toPct(e);
    let moved = false;
    const onMove = (ev) => {
      const p = toPct(ev);
      const dx = p.x - p0.x;
      const dy = p.y - p0.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
      moved = true;
      const sn = ev.altKey ? 0.1 : 0.5;
      apply(dx, dy, (v) => Math.round(v / sn) * sn);
      draw();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) { commit(); renderSide(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !canvas.querySelector('svg')) return;
    const nodeEl = e.target.closest('[data-node]');
    const resizeEl = e.target.closest('[data-zone-resize]');
    const linkEl = e.target.closest('[data-link]');
    const zoneEl = e.target.closest('[data-zone]');
    if (nodeEl) {
      const id = nodeEl.dataset.node;
      const from = st.connect ? st.connectFrom : (e.shiftKey && st.sel?.type === 'node' ? st.sel.id : null);
      if (from && from !== id) {
        addLink(from, id);
        if (st.connect) st.connectFrom = id;
        select({ type: 'node', id });
        return;
      }
      if (st.connect) { st.connectFrom = id; select({ type: 'node', id }); return; }
      if (st.sel?.type !== 'node' || st.sel.id !== id) select({ type: 'node', id });
      const n = node(id);
      const o = { x: n.x, y: n.y };
      drag(e, (dx, dy, S) => { n.x = clamp(S(o.x + dx), 0, 100); n.y = clamp(S(o.y + dy), 0, 100); });
      return;
    }
    if (resizeEl) {
      const z = el.zones.find((x) => x.id === resizeEl.dataset.zoneResize);
      const o = { w: z.w, h: z.h };
      drag(e, (dx, dy, S) => { z.w = clamp(S(o.w + dx), 4, 100 - z.x); z.h = clamp(S(o.h + dy), 4, 100 - z.y); });
      return;
    }
    if (linkEl) { select({ type: 'link', id: linkEl.dataset.link }); return; }
    if (zoneEl) {
      const z = el.zones.find((x) => x.id === zoneEl.dataset.zone);
      if (st.sel?.type !== 'zone' || st.sel.id !== z.id) select({ type: 'zone', id: z.id });
      const o = { x: z.x, y: z.y };
      drag(e, (dx, dy, S) => { z.x = clamp(S(o.x + dx), 0, 100 - z.w); z.y = clamp(S(o.y + dy), 0, 100 - z.h); });
      return;
    }
    st.connectFrom = null;
    select(null);
  });

  // ---------- side panel ----------
  function statePicker(options, value, onPick, prefix) {
    const wrap = h('div', { class: 'chip-pick st-pick' });
    const render = (cur) => {
      clear(wrap).append(...options.map((o) => h('button', {
        type: 'button',
        class: cur === o ? 'on' : '',
        onClick: () => { render(o); onPick(o); },
      }, prefix === 'st'
        ? h('span', { class: `net-node st-${o} st-chip` })
        : h('span', { class: `ln-chip ln-${o}` }),
      t(`net.${prefix}.${o}`, null, st.lang))));
    };
    render(value);
    return wrap;
  }

  function statesEditor(item, kind) {
    item.states = item.states || [];
    const list = h('div', { class: 'net-states' });
    const options = kind === 'node' ? NET_STATUSES : NET_LINK_STYLES;
    const prefix = kind === 'node' ? 'st' : 'ln';
    const render = () => {
      clear(list);
      item.states.forEach((s, i) => {
        list.append(h('div', { class: 'net-state' },
          h('div', { class: 'net-state-head' },
            h('span', { class: 'kicker' }, `${i + 1}`),
            h('span', null, t('net.becomes')),
            selectInput(options.map((o) => [o, t(`net.${prefix}.${o}`, null, st.lang)]), s.value, (v) => { s.value = v; changed(); }),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'icon-btn danger', title: t('ed.delete'), onClick: () => { item.states.splice(i, 1); render(); changed(); } }, icon('trash'))),
          conditionEditor(wg, s, 'condition', changed, { heading: null, emptyHint: t('net.stateNoRule'), introHint: t('net.when'), addLabel: t('ed.addRule'), keepEmpty: true })));
      });
      list.append(h('button', {
        type: 'button',
        class: 'btn sm',
        onClick: () => {
          const choice = wg.pages.flatMap((p) => (p.type === 'decision' ? p.decision?.choices || [] : []))[0];
          const rule = choice ? { type: 'choice', choice: choice.id, op: 'chosen' } : { type: 'attr', attr: wg.attributes[0]?.id || '', op: '<', value: 50 };
          item.states.push({ value: kind === 'node' ? 'compromised' : 'blocked', condition: { mode: 'all', rules: [rule] } });
          render();
          changed();
        },
      }, icon('plus'), t('net.addState')));
    };
    render();
    return h('div', { class: 'field' },
      h('label', { class: 'field-label' }, t('net.states')),
      h('div', { class: 'hint' }, t(kind === 'node' ? 'net.statesHint' : 'net.linkStatesHint')),
      list);
  }

  function renderSide() {
    const scroll = side.scrollTop;
    clear(side);
    const s = st.sel;
    const head = (ic, title, ...actions) => h('div', { class: 'net-side-head' }, icon(ic), h('b', null, title), h('span', { class: 'spacer' }), actions);
    if (s?.type === 'node' && node(s.id)) {
      const n = node(s.id);
      side.append(
        head('server', t('net.node'),
          h('button', { type: 'button', class: 'icon-btn', title: t('ed.duplicate'), onClick: () => { const c = clone(n); c.id = uid('n-'); c.x = clamp(n.x + 3, 0, 100); c.y = clamp(n.y + 5, 0, 100); el.nodes.push(c); select({ type: 'node', id: c.id }); commit(); } }, icon('copy')),
          h('button', { type: 'button', class: 'icon-btn danger', title: t('ed.delete'), onClick: removeSelected }, icon('trash'))),
        biField(n, 'label', { label: t('net.label'), onChange: changed }),
        biField(n, 'sub', { label: t('net.sub'), onChange: changed }),
        field(t('net.icon'), h('div', { class: 'chip-pick icon-pick' }, Object.keys(NET_ICONS).map((k) => h('button', {
          type: 'button',
          class: n.icon === k ? 'on' : '',
          title: t(`net.ic.${k}`),
          onClick: (e) => { n.icon = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); changed(); },
        }, icon(NET_ICONS[k]))))),
        field(t('net.width'), row(numInput(n.w ?? 17, (v) => { n.w = clamp(round(v, 1), 6, 60); changed(); }, { min: 6, max: 60, step: 0.5 }), h('span', { class: 'unit' }, '%'))),
        field(t('net.status'), statePicker(NET_STATUSES, n.status || 'normal', (v) => { n.status = v; changed(); }, 'st')),
        statesEditor(n, 'node'));
    } else if (s?.type === 'link' && el.links.find((l) => l.id === s.id)) {
      const l = el.links.find((x) => x.id === s.id);
      const fromN = node(l.from);
      const toN = node(l.to);
      side.append(
        head('link', t('net.link'),
          h('button', { type: 'button', class: 'icon-btn', title: t('net.swap'), onClick: () => { [l.from, l.to] = [l.to, l.from]; renderSide(); changed(); } }, icon('swap')),
          h('button', { type: 'button', class: 'icon-btn danger', title: t('ed.delete'), onClick: removeSelected }, icon('trash'))),
        h('p', { class: 'net-link-ends' }, h('b', null, tr(fromN?.label, st.lang) || '?'), ' → ', h('b', null, tr(toN?.label, st.lang) || '?')),
        field(t('net.style'), statePicker(NET_LINK_STYLES, l.style || 'normal', (v) => { l.style = v; changed(); }, 'ln')),
        biField(l, 'label', { label: t('net.linkLabel'), onChange: changed }),
        statesEditor(l, 'link'));
    } else if (s?.type === 'zone' && el.zones.find((z) => z.id === s.id)) {
      const z = el.zones.find((x) => x.id === s.id);
      side.append(
        head('blank', t('net.zone'), h('button', { type: 'button', class: 'icon-btn danger', title: t('ed.delete'), onClick: removeSelected }, icon('trash'))),
        biField(z, 'label', { label: t('net.zoneLabel'), onChange: changed }),
        h('p', { class: 'hint' }, t('net.zoneHint')));
    } else {
      side.append(
        head('network', t('net.general')),
        biField(el, 'title', { label: t('ed.title'), onChange: changed }),
        biField(el, 'subtitle', { label: t('net.subtitle'), onChange: changed }),
        checkbox(t('net.frame'), el.frame !== false, (v) => { el.frame = v; changed(); }),
        checkbox(t('net.legend'), el.legend !== false, (v) => { el.legend = v; changed(); }),
        h('p', { class: 'hint' }, t('net.stats', { nodes: el.nodes.length, links: el.links.length, zones: el.zones.length })),
        h('div', { class: 'net-help' },
          h('p', null, t('net.help1')),
          h('p', null, t('net.help2')),
          h('p', null, t('net.help3'))));
    }
    side.scrollTop = scroll;
  }

  // ---------- keyboard ----------
  const onKey = (e) => {
    const a = document.activeElement;
    const typing = a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable);
    if (e.key === 'Escape' && (st.connect || st.connectFrom)) {
      e.stopPropagation();
      e.preventDefault();
      st.connectFrom = null;
      toggleConnect(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase()) && !typing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); e.stopPropagation(); removeSelected(); return; }
    if (e.key.startsWith('Arrow') && st.sel?.type === 'node') {
      e.preventDefault();
      const n = node(st.sel.id);
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowLeft') n.x = clamp(round(n.x - step, 2), 0, 100);
      if (e.key === 'ArrowRight') n.x = clamp(round(n.x + step, 2), 0, 100);
      if (e.key === 'ArrowUp') n.y = clamp(round(n.y - step, 2), 0, 100);
      if (e.key === 'ArrowDown') n.y = clamp(round(n.y + step, 2), 0, 100);
      changed();
    }
    if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleConnect();
  };
  window.addEventListener('keydown', onKey, true);

  const toolbar = h('div', { class: 'net-ed-tools' },
    h('button', { type: 'button', class: 'btn sm primary', onClick: addNode }, icon('plus'), t('net.addNode')),
    h('button', { type: 'button', class: 'btn sm', onClick: addZone }, icon('blank'), t('net.addZone')),
    connectBtn,
    h('span', { class: 'spacer' }),
    h('span', { class: 'kicker' }, t('net.show')),
    segmented([['base', t('net.base')], ['sim', t('net.simulated')]], 'base', (v) => { st.base = v === 'base'; draw(); }),
    segmented([['en', 'EN'], ['de', 'DE']], st.lang, (v) => { st.lang = v; draw(); renderSide(); }));

  draw();
  renderSide();
  await modal({
    title: t('net.editor'),
    wide: true,
    className: 'net-modal',
    body: h('div', { class: 'net-ed' },
      h('div', { class: 'net-ed-main' }, toolbar, h('div', { class: 'net-canvas-wrap' }, canvas), hint),
      side),
    actions: [{ label: t('ed.done'), primary: true, value: 'done' }],
  });
  window.removeEventListener('keydown', onKey, true);
  record.flush();
  onChange();
}
