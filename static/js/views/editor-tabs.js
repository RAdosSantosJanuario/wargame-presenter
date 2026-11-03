// Editor tabs: attributes (with classification levels), settings, consistency check,
// and the template library dialogs.
import { t, tr } from '../i18n.js';
import { h, clear, toast, modal, confirmDialog, clone, round, escapeHtml as esc } from '../util.js';
import { icon } from '../icons.js';
import {
  SEVERITIES, SEVERITY_KEYS, newAttribute, newChoice, levelBands, norm, translationStats, checkWargame,
  L, fmtValue, fmtDelta, deltaTone,
} from '../model.js';
import { ATTRIBUTE_TEMPLATES, CHOICE_TEMPLATES, CHOICE_CATEGORIES } from '../templates.js';
import { renderStage, stageFit, fitText } from '../render.js';
import { biField, field, row, section, textInput, numInput, selectInput, checkbox, segmented, colorInput } from './fields.js';

// ======================================================================
// Attributes
// ======================================================================
export function attributesTab(host, ctx) {
  const { wg, ed } = ctx;
  const wrap = h('div', { class: 'ed-wide' });
  host.append(wrap);

  const render = () => {
    clear(wrap);
    wrap.append(h('div', { class: 'wide-head' },
      h('div', null,
        h('div', { class: 'kicker' }, t('ed.tab.attributes')),
        h('h2', null, t('attr.title')),
        h('p', { class: 'muted' }, t('attr.lead'))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => attributeLibraryDialog(ctx, render) }, icon('book'), t('ed.fromLibrary')),
        h('button', {
          class: 'btn primary',
          onClick: () => {
            const a = newAttribute({ id: uniqueId(wg, 'attribute') });
            wg.attributes.push(a);
            ed.focusAttr = a.id;
            ctx.changed();
            render();
          },
        }, icon('plus'), t('attr.add')))));
    if (!wg.attributes.length) wrap.append(h('div', { class: 'empty-box' }, icon('sliders'), h('p', null, t('attr.empty'))));
    wg.attributes.forEach((a, i) => wrap.append(attrCard(a, i)));
    if (ed.focusAttr) {
      const target = wrap.querySelector(`[data-attr="${CSS.escape(ed.focusAttr)}"]`);
      ed.focusAttr = null;
      if (target) setTimeout(() => { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.classList.add('pulse'); }, 50);
    }
  };

  function attrCard(a, i) {
    const nameEl = h('span', null, tr(a.name) || a.id);
    const preview = h('div', { class: 'lvl-preview' });
    const drawPreview = () => { preview.innerHTML = levelPreviewSvg(a); };
    const levelsWrap = h('div', { class: 'lvl-table' });
    const upd = () => { drawPreview(); ctx.changed(); };

    const renderLevels = () => {
      clear(levelsWrap);
      levelsWrap.append(h('div', { class: 'lvl-row lvl-headrow' },
        h('span', null, t('attr.range')), h('span', null, t('attr.upTo')), h('span', null, t('attr.severity')),
        h('span', null, t('attr.labelEn')), h('span', null, t('attr.labelDe')), h('span')));
      let from = Number(a.min);
      a.levels.forEach((lv, li) => {
        lv.label = lv.label || L();
        const sevSel = selectInput(SEVERITY_KEYS.map((k) => [k, tr(SEVERITIES[k].label)]), lv.severity || 'info', (v) => {
          const oldDefault = tr(SEVERITIES[lv.severity]?.label, 'en') === lv.label.en && tr(SEVERITIES[lv.severity]?.label, 'de') === lv.label.de;
          lv.severity = v;
          if (oldDefault || (!lv.label.en && !lv.label.de)) lv.label = clone(SEVERITIES[v].label);
          renderLevels();
          upd();
        }, { cls: 'sev-select' });
        sevSel.style.setProperty('--c', SEVERITIES[lv.severity]?.color || '#888');
        const labelIn = (lang) => {
          const inp = textInput(lv.label[lang] || '', (v) => { lv.label[lang] = v; upd(); inp.classList.toggle('missing', !v.trim() && !!(lv.label[lang === 'en' ? 'de' : 'en'] || '').trim()); });
          inp.classList.toggle('missing', !(lv.label[lang] || '').trim() && !!(lv.label[lang === 'en' ? 'de' : 'en'] || '').trim());
          return inp;
        };
        const rangeText = `${fmtValue({ ...a, unit: '' }, from)} – `;
        from = Number(lv.upTo);
        levelsWrap.append(h('div', { class: 'lvl-row' },
          h('span', { class: 'lvl-from' }, h('i', { class: 'sw', style: { background: SEVERITIES[lv.severity]?.color } }), rangeText),
          numInput(lv.upTo, (v) => { lv.upTo = v; upd(); }, { step: 'any' }),
          sevSel,
          labelIn('en'),
          labelIn('de'),
          h('button', { type: 'button', class: 'icon-btn danger', title: t('ed.delete'), onClick: () => { a.levels.splice(li, 1); renderLevels(); upd(); } }, icon('x'))));
      });
    };

    const autoLevels = (n) => {
      const min = Number(a.min);
      const max = Number(a.max);
      const presets = {
        3: ['critical', 'warning', 'good'],
        4: ['critical', 'bad', 'warning', 'good'],
        5: ['critical', 'bad', 'warning', 'ok', 'good'],
      };
      let sev = presets[n];
      if (a.better === 'lower') sev = [...sev].reverse();
      if (a.better === 'neutral') sev = sev.map(() => 'info');
      a.levels = sev.map((s, k) => ({ upTo: round(min + ((max - min) * (k + 1)) / n, 1), severity: s, label: clone(SEVERITIES[s].label) }));
      renderLevels();
      upd();
    };

    const idInput = textInput(a.id, () => {}, { cls: 'mono' });
    idInput.addEventListener('change', () => {
      const v = idInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      if (!v || (v !== a.id && wg.attributes.some((x) => x.id === v))) {
        toast(t('attr.idTaken'), 'error');
        idInput.value = a.id;
        return;
      }
      if (v !== a.id) {
        ctx.renameAttr(a.id, v);
        a.id = v;
        idInput.value = v;
        card.dataset.attr = v;
        ctx.changed();
      }
    });

    const card = h('section', { class: ['attr-card', a.hidden && 'is-hidden'], dataset: { attr: a.id } },
      h('div', { class: 'attr-head' },
        h('span', { class: 'attr-icon' }, (() => {
          const inp = textInput(a.icon || '', (v) => { a.icon = v.trim(); ctx.changed(); }, { cls: 'icon-in big', placeholder: '📊' });
          inp.maxLength = 8;
          return inp;
        })()),
        h('h3', null, nameEl),
        a.hidden ? h('span', { class: 'mini-chip' }, icon('eye-off'), t('attr.hiddenShort')) : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon-btn', title: t('ed.moveUp'), onClick: () => { if (i > 0) { wg.attributes.splice(i - 1, 0, wg.attributes.splice(i, 1)[0]); ctx.changed(); render(); } } }, icon('arrow-up')),
        h('button', { type: 'button', class: 'icon-btn', title: t('ed.moveDown'), onClick: () => { if (i < wg.attributes.length - 1) { wg.attributes.splice(i + 1, 0, wg.attributes.splice(i, 1)[0]); ctx.changed(); render(); } } }, icon('arrow-down')),
        h('button', {
          type: 'button', class: 'icon-btn danger', title: t('ed.delete'),
          onClick: async () => {
            const ok = await confirmDialog(t('attr.deleteTitle'), t('attr.deleteText', { name: tr(a.name) || a.id }), { okLabel: t('ed.delete'), cancelLabel: t('btn.cancel'), danger: true });
            if (!ok) return;
            ctx.removeAttr(a.id);
            wg.attributes.splice(wg.attributes.indexOf(a), 1);
            ctx.changed();
            render();
          },
        }, icon('trash'))),
      h('div', { class: 'attr-grid' },
        h('div', { class: 'attr-col' },
          biField(a, 'name', { label: t('attr.name'), onChange: () => { nameEl.textContent = tr(a.name) || a.id; ctx.changed(); } }),
          biField(a, 'description', { label: t('attr.description'), multiline: true, rows: 2, onChange: () => ctx.changed() })),
        h('div', { class: 'attr-col' },
          row(
            field(t('attr.id'), idInput),
            field(t('attr.unit'), textInput(a.unit || '', (v) => { a.unit = v; upd(); }, { placeholder: '%, k€, h' }))),
          row(
            field(t('attr.min'), numInput(a.min, (v) => { a.min = v; upd(); })),
            field(t('attr.max'), numInput(a.max, (v) => { a.max = v; upd(); })),
            field(t('attr.start'), numInput(a.start, (v) => { a.start = v; upd(); }))),
          field(t('attr.better'), segmented([
            ['higher', t('attr.better.higher')], ['lower', t('attr.better.lower')], ['neutral', t('attr.better.neutral')],
          ], a.better || 'higher', (v) => { a.better = v; upd(); })),
          checkbox(t('attr.hidden'), a.hidden, (v) => { a.hidden = v; card.classList.toggle('is-hidden', v); ctx.changed(); }, { hint: t('attr.hiddenHint') }))),
      h('div', { class: 'lvl-block' },
        h('div', { class: 'sub-head' },
          icon('flag'), h('span', null, t('attr.levels')),
          h('span', { class: 'hint inline' }, t('attr.levelsHint')),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn sm', onClick: () => { const last = a.levels[a.levels.length - 1]; a.levels.push({ upTo: Number(a.max), severity: 'good', label: clone(SEVERITIES.good.label) }); if (last && Number(last.upTo) >= Number(a.max)) last.upTo = round((Number(a.min) + Number(a.max)) / 2, 1); a.levels.sort((x, y) => x.upTo - y.upTo); renderLevels(); upd(); } }, icon('plus'), t('attr.addLevel')),
          h('button', { type: 'button', class: 'btn sm', onClick: () => autoLevels(3) }, '3'),
          h('button', { type: 'button', class: 'btn sm', onClick: () => autoLevels(4) }, '4'),
          h('button', { type: 'button', class: 'btn sm', onClick: () => autoLevels(5) }, '5'),
          h('button', { type: 'button', class: 'btn sm ghost', title: t('attr.sortLevels'), onClick: () => { a.levels.sort((x, y) => Number(x.upTo) - Number(y.upTo)); renderLevels(); upd(); } }, icon('list'))),
        preview,
        levelsWrap));
    drawPreview();
    renderLevels();
    return card;
  }

  render();
}

function uniqueId(wg, base) {
  let id = base;
  let n = 2;
  while (wg.attributes.some((a) => a.id === id)) id = `${base}-${n++}`;
  return id;
}

export function levelPreviewSvg(a) {
  const W = 1000;
  const H = 74;
  const min = Number(a.min);
  const max = Number(a.max);
  const X = (v) => 10 + norm(a, v) * (W - 20);
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="lvl-svg">`;
  for (const b of levelBands(a)) {
    const x0 = X(b.from);
    const x1 = X(b.to);
    s += `<rect x="${x0}" y="14" width="${Math.max(0, x1 - x0)}" height="30" fill="${b.color}" opacity="0.85"/>`;
    const lbl = tr(b.label) || '';
    if (x1 - x0 > 50) s += `<text x="${(x0 + x1) / 2}" y="34" text-anchor="middle" class="lvl-txt">${esc(lbl.length > (x1 - x0) / 9 ? `${lbl.slice(0, Math.max(1, Math.floor((x1 - x0) / 9) - 1))}…` : lbl)}</text>`;
  }
  const sx = X(Number(a.start));
  s += `<path d="M${sx} 12 l-7 -10 h14 z" class="lvl-start"/><line x1="${sx}" x2="${sx}" y1="12" y2="46" class="lvl-start-line"/>`;
  s += `<text x="10" y="66" class="lvl-tick">${esc(String(min))}</text><text x="${W - 10}" y="66" text-anchor="end" class="lvl-tick">${esc(String(max))}${esc(a.unit ? ` ${a.unit}` : '')}</text>`;
  s += `<text x="${sx}" y="66" text-anchor="middle" class="lvl-tick strong">${esc(t('attr.start'))} ${esc(String(a.start))}</text>`;
  return `${s}</svg>`;
}

// ======================================================================
// Settings
// ======================================================================
export function settingsTab(host, ctx) {
  const { wg } = ctx;
  const s = wg.settings;
  const previewHost = h('div', { class: 'settings-preview' });
  const drawPreview = () => {
    const first = wg.pages[0];
    const stage = renderStage(first, { wg, lang: s.language || 'de', mode: 'preview', step: Infinity, data: ctx.previewData(first?.id) });
    clear(previewHost).append(stageFit(stage));
    requestAnimationFrame(() => fitText(stage));
  };
  const upd = () => { ctx.changed(); drawPreview(); };
  const bannerPresets = [
    [L('EXERCISE · EXERCISE · EXERCISE', 'ÜBUNG · ÜBUNG · ÜBUNG'), 'EXERCISE / ÜBUNG'],
    [L('TLP:CLEAR', 'TLP:CLEAR'), 'TLP:CLEAR'],
    [L('TLP:AMBER · EXERCISE', 'TLP:AMBER · ÜBUNG'), 'TLP:AMBER'],
    [L('', ''), t('ed.none')],
  ];
  let bannerField;
  const renderBannerField = () => biField(s, 'banner', { label: t('set.banner'), onChange: upd, hint: t('set.bannerHint') });
  const bannerHost = h('div', null, bannerField = renderBannerField());
  host.append(h('div', { class: 'ed-wide settings' },
    h('div', { class: 'wide-head' },
      h('div', null, h('div', { class: 'kicker' }, t('ed.tab.settings')), h('h2', null, t('set.title')), h('p', { class: 'muted' }, t('set.lead')))),
    h('div', { class: 'settings-grid' },
      h('div', { class: 'settings-col' },
        section(t('set.meta'), [
          biField(wg.meta, 'title', { label: t('ed.title'), onChange: () => ctx.changed({ title: true }) }),
          biField(wg.meta, 'subtitle', { label: t('set.subtitle'), onChange: () => ctx.changed() }),
          biField(wg.meta, 'description', { label: t('set.description'), multiline: true, rows: 3, onChange: () => ctx.changed() }),
          field(t('set.author'), textInput(wg.meta.author || '', (v) => { wg.meta.author = v; ctx.changed(); })),
        ], { icon: icon('file') })),
      h('div', { class: 'settings-col' },
        section(t('set.presentation'), [
          field(t('set.theme'), segmented([['dark', t('set.theme.dark')], ['light', t('set.theme.light')]], s.theme || 'dark', (v) => { s.theme = v; upd(); })),
          field(t('set.accent'), colorInput(s.accent, (v) => { s.accent = v || '#ffb000'; upd(); }, { allowEmpty: false, presets: ['#ffb000', '#ff5d3a', '#3fd0c9', '#4f8df5', '#2fb47c', '#d94f8a'] })),
          field(t('set.language'), segmented([['de', 'Deutsch'], ['en', 'English']], s.language || 'de', (v) => { s.language = v; upd(); }), t('set.languageHint')),
          checkbox(t('set.hud'), s.hud !== false, (v) => { s.hud = v; ctx.changed(); }, { hint: t('set.hudHint') }),
          h('div', { class: 'field' },
            h('label', { class: 'field-label' }, t('set.bannerPresets')),
            h('div', { class: 'btn-row wrap' }, bannerPresets.map(([val, label]) => h('button', {
              type: 'button', class: 'btn sm',
              onClick: () => { s.banner = clone(val); const nf = renderBannerField(); bannerField.replaceWith(nf); bannerField = nf; upd(); },
            }, label)))),
          bannerHost,
        ], { icon: icon('monitor') }),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('set.preview')), previewHost)))));
  drawPreview();
}

// ======================================================================
// Check
// ======================================================================
export function checkTab(host, ctx) {
  const { wg } = ctx;
  const issues = checkWargame(wg);
  const stats = translationStats(wg);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const bar = (lang, v) => h('div', { class: 'tr-bar' },
    h('span', { class: 'tr-lang' }, lang.toUpperCase()),
    h('div', { class: 'tr-track' }, h('i', { style: { width: pct(v) } })),
    h('b', null, pct(v)));
  const groups = [['error', 'alert-circle'], ['warn', 'alert'], ['info', 'info']];
  const fieldName = (k) => t(`fld.${k}`);
  host.append(h('div', { class: 'ed-wide check-tab' },
    h('div', { class: 'wide-head' },
      h('div', null, h('div', { class: 'kicker' }, t('ed.tab.check')), h('h2', null, t('chk.title')), h('p', { class: 'muted' }, t('chk.lead')))),
    h('div', { class: 'check-grid' },
      h('section', { class: 'check-card' },
        h('h3', null, icon('globe'), t('chk.translations')),
        bar('en', stats.en),
        bar('de', stats.de),
        h('p', { class: 'muted' }, stats.complete ? t('chk.trComplete') : t('chk.trIncomplete', { n: stats.total }))),
      h('section', { class: 'check-card' },
        h('h3', null, icon('layers'), t('chk.summary')),
        h('div', { class: 'sum-grid' },
          sum(wg.pages.length, t('lib.pages')),
          sum(wg.pages.filter((p) => p.type === 'decision').length, t('lib.decisions')),
          sum(wg.pages.reduce((n, p) => n + (p.decision?.choices?.length || 0) * (p.type === 'decision' ? 1 : 0), 0), t('ed.choices')),
          sum(wg.attributes.length, t('lib.attributes')),
          sum(wg.pages.filter((p) => p.condition?.rules?.length).length, t('chk.conditional')),
          sum(wg.pages.reduce((n, p) => n + (p.type === 'decision' ? (p.decision?.choices || []).filter((c) => Number(c.chance ?? 100) < 100).length : 0), 0), t('chk.rolls'))))),
    issues.length
      ? groups.map(([lvl, ic]) => {
        const list = issues.filter((i) => i.level === lvl);
        if (!list.length) return null;
        return h('section', { class: ['issue-group', lvl] },
          h('h3', null, icon(ic), t(`chk.level.${lvl}`), h('span', { class: 'count' }, String(list.length))),
          h('ul', null, list.map((i) => h('li', null,
            h('span', null, t(i.key, { ...i.vars, field: i.vars.field ? fieldName(i.vars.field) : '' })),
            i.target?.tab ? h('button', { class: 'btn sm ghost', onClick: () => ctx.goTo(i.target) }, t('chk.go'), icon('chevron-right')) : null))));
      })
      : h('div', { class: 'empty-box ok' }, icon('check'), h('p', null, t('chk.allGood')))));
}

function sum(n, label) {
  return h('div', { class: 'sum' }, h('b', null, String(n)), h('span', null, label));
}

// ======================================================================
// Template libraries
// ======================================================================
function templateChips(effects, wg) {
  const items = Object.entries(effects || {}).filter(([, v]) => Number(v));
  return h('div', { class: 'fx' }, items.map(([id, v]) => {
    const a = wg.attributes.find((x) => x.id === id) || ATTRIBUTE_TEMPLATES.find((x) => x.id === id) || { id, name: L(id, id), better: 'higher' };
    const missing = !wg.attributes.some((x) => x.id === id);
    return h('span', { class: ['fx-chip', deltaTone(a, Number(v)), missing && 'missing'], title: missing ? t('lib.attrMissing') : '' },
      a.icon ? h('span', { class: 'fx-ico' }, a.icon) : null,
      h('span', { class: 'fx-name' }, tr(a.name)),
      h('b', null, fmtDelta(a, Number(v))));
  }));
}

export async function choiceLibraryDialog(ctx, page, done) {
  const { wg } = ctx;
  const picked = new Set();
  let addMissing = true;
  let filter = 'all';
  const listEl = h('div', { class: 'tpl-choices' });
  const countEl = h('span', { class: 'count' }, '0');
  const render = () => {
    clear(listEl);
    CHOICE_TEMPLATES.forEach((c, idx) => {
      if (filter !== 'all' && c.category !== filter) return;
      const input = h('input', { type: 'checkbox' });
      input.checked = picked.has(idx);
      input.addEventListener('change', () => { if (input.checked) picked.add(idx); else picked.delete(idx); countEl.textContent = String(picked.size); item.classList.toggle('on', input.checked); });
      const item = h('label', { class: ['tpl-choice', picked.has(idx) && 'on'] }, input,
        h('span', { class: 'tpl-icon' }, c.icon || '•'),
        h('div', { class: 'tpl-main' },
          h('div', { class: 'tpl-title' }, h('b', null, tr(c.label)),
            h('span', { class: 'mini-chip' }, tr(CHOICE_CATEGORIES[c.category]) || c.category),
            Number(c.chance ?? 100) < 100 ? h('span', { class: 'mini-chip warn' }, icon('dice'), `${c.chance}%`) : null),
          h('small', null, tr(c.description)),
          templateChips(c.effects, wg)));
      listEl.append(item);
    });
  };
  const cats = [['all', t('lib.allCategories')], ...Object.entries(CHOICE_CATEGORIES).map(([k, v]) => [k, tr(v)])];
  const filterEl = h('div', { class: 'chip-pick' });
  const renderFilter = () => {
    clear(filterEl).append(...cats.map(([k, label]) => h('button', { type: 'button', class: filter === k ? 'on' : '', onClick: () => { filter = k; renderFilter(); render(); } }, label)));
  };
  renderFilter();
  render();
  const res = await modal({
    title: t('ed.choiceLibrary'),
    wide: true,
    className: 'tpl-modal',
    body: h('div', { class: 'tpl-body' },
      h('p', { class: 'muted' }, t('lib.choiceLibLead')),
      filterEl,
      listEl,
      checkbox(t('lib.addMissingAttrs'), addMissing, (v) => { addMissing = v; })),
    actions: [
      { label: t('btn.cancel'), ghost: true, value: null },
      { label: h('span', null, t('ed.insertSelected'), ' (', countEl, ')'), primary: true, value: 'ok' },
    ],
  });
  if (res !== 'ok' || !picked.size) return;
  const existing = new Set(wg.attributes.map((a) => a.id));
  let skipped = 0;
  let added = 0;
  const take = (src) => {
    const out = {};
    for (const [id, v] of Object.entries(src || {})) {
      if (!existing.has(id)) {
        const tpl = ATTRIBUTE_TEMPLATES.find((a) => a.id === id);
        if (addMissing && tpl) { wg.attributes.push(newAttribute(tpl)); existing.add(id); added++; } else { skipped++; continue; }
      }
      out[id] = v;
    }
    return out;
  };
  for (const idx of [...picked].sort((x, y) => x - y)) {
    const tpl = CHOICE_TEMPLATES[idx];
    page.decision.choices.push(newChoice({
      icon: tpl.icon || '',
      label: clone(tpl.label),
      description: clone(tpl.description || L()),
      outcome: clone(tpl.outcome || L()),
      chance: tpl.chance ?? 100,
      effects: take(tpl.effects),
      fail: { effects: take(tpl.fail?.effects), outcome: clone(tpl.fail?.outcome || L()), goto: '' },
      goto: '',
    }));
  }
  toast(t('lib.inserted', { n: picked.size }) + (added ? ` ${t('lib.attrsAdded', { n: added })}` : '') + (skipped ? ` ${t('lib.fxSkipped', { n: skipped })}` : ''), 'ok', 4000);
  done();
}

export async function attributeLibraryDialog(ctx, done) {
  const { wg } = ctx;
  const picked = new Set();
  const list = h('div', { class: 'tpl-attr-list' }, ATTRIBUTE_TEMPLATES.map((a) => {
    const exists = wg.attributes.some((x) => x.id === a.id);
    const input = h('input', { type: 'checkbox', disabled: exists ? true : null });
    input.addEventListener('change', () => (input.checked ? picked.add(a.id) : picked.delete(a.id)));
    return h('label', { class: ['tpl-attr', exists && 'exists'] }, input,
      h('span', { class: 'tpl-icon' }, a.icon || ''),
      h('span', null,
        h('b', null, tr(a.name), exists ? h('em', null, ` · ${t('lib.alreadyAdded')}`) : null),
        h('small', null, `${tr(a.description)} · ${a.min}–${a.max}${a.unit ? ` ${a.unit}` : ''} · ${t(`attr.better.${a.better}`)}`)));
  }));
  const res = await modal({
    title: t('lib.attrLibrary'),
    wide: true,
    body: h('div', null, h('p', { class: 'muted' }, t('lib.attrLibLead')), list),
    actions: [
      { label: t('btn.cancel'), ghost: true, value: null },
      { label: t('ed.insertSelected'), primary: true, value: 'ok' },
    ],
  });
  if (res !== 'ok' || !picked.size) return;
  for (const a of ATTRIBUTE_TEMPLATES) if (picked.has(a.id)) wg.attributes.push(newAttribute(a));
  ctx.changed();
  toast(t('lib.attrsAdded', { n: picked.size }), 'ok');
  done();
}
