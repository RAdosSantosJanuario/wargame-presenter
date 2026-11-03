// Renders one page onto a 16:9 stage. Used by the editor, the presentation,
// the presenter console (previews) and thumbnails. All sizes are relative to
// the stage width (CSS container units), so it scales to any screen.
import { tr, t } from './i18n.js';
import { h, md } from './util.js';
import { icon } from './icons.js';
import { mediaUrl, attrMap, fmtDelta, deltaTone } from './model.js';
import { renderChart, chartAttrs } from './charts.js';

const CH_ICON = { email: 'mail', phone: 'phone', chat: 'chat', sms: 'sms', news: 'news', social: 'social', alert: 'alert', memo: 'memo' };
const FROM_KEY = { phone: 'inj.caller', news: 'inj.source', social: 'inj.account', alert: 'inj.system' };

/**
 * ctx = {
 *   wg, lang, mode: 'present' | 'edit' | 'thumb' | 'preview',
 *   step,                       // reveal step (Infinity = show all)
 *   data,                       // chart data {values, start, timeline, decisions, last}
 *   pending: [],                // selected choice ids (not yet confirmed)
 *   decision,                   // confirmed decision record of this page or null
 *   canConfirm, onChoice, onConfirm, onUndo,
 *   showHidden                  // show hidden attributes in effect chips
 * }
 */
export function renderStage(page, ctx) {
  const { wg, lang } = ctx;
  const theme = wg.settings?.theme === 'light' ? 'light' : 'dark';
  const stage = h('div', {
    class: ['stage', `theme-${theme}`, `mode-${ctx.mode}`],
    style: { '--accent': wg.settings?.accent || '#ffb000' },
    lang,
  });
  if (!page) return stage;
  const bg = page.background || {};
  if (bg.color) stage.style.setProperty('--stage-bg', bg.color);
  if (bg.image) {
    stage.append(
      h('div', { class: 'stage-bgimg', style: { backgroundImage: `url("${mediaUrl(wg, bg.image)}")` } }),
      h('div', { class: 'stage-bgdim', style: { opacity: String(bg.dim ?? 0.5) } }),
    );
  }
  if (page.showTitle) {
    stage.append(h('div', { class: 'stage-title' },
      page.type === 'decision' ? h('span', { class: 'stage-kicker' }, t('stage.decision', null, lang)) : null,
      h('h1', null, tr(page.title, lang))));
  }
  for (const el of page.elements || []) stage.append(renderElement(el, page, ctx));
  const banner = tr(wg.settings?.banner, lang);
  if (banner) stage.append(h('div', { class: 'stage-banner' }, h('span', null, banner)));
  updateReveal(stage, ctx.step ?? Infinity);
  return stage;
}

export function stageFit(stage) {
  return h('div', { class: 'stage-fit' }, stage);
}

// Shrink text that does not fit its box. Works with a --fit factor that the CSS
// multiplies into the font sizes, so the result scales with the stage. Call it
// after the stage is attached to the document.
const overflowing = (el) => el && el.scrollHeight > el.clientHeight + 1;
export function fitText(root) {
  if (!root || !root.isConnected) return;
  const targets = [];
  for (const el of root.querySelectorAll('.txt')) targets.push([el, () => overflowing(el)]);
  for (const el of root.querySelectorAll('.inject')) {
    const body = el.querySelector('.inj-body');
    targets.push([el, () => overflowing(body) || overflowing(el)]);
  }
  for (const grid of root.querySelectorAll('.choices-grid')) {
    targets.push([grid, () => [...grid.children].some(overflowing)]);
  }
  for (const el of root.querySelectorAll('.res-item')) targets.push([el, () => overflowing(el)]);
  for (const [el, test] of targets) {
    el.style.removeProperty('--fit');
    if (el.clientHeight < 4) continue;
    let fit = 1;
    while (test() && fit > 0.56) {
      fit = Math.round((fit - 0.05) * 100) / 100;
      el.style.setProperty('--fit', String(fit));
    }
  }
}

// animate = true only when a "next" press reveals elements (not on first render).
// The reveal animation class is removed again, so an element never stays stuck
// in its first animation frame (e.g. in a background window).
export function updateReveal(stage, step, animate = false) {
  for (const n of stage.querySelectorAll(':scope > .el')) {
    const r = Number(n.dataset.reveal) || 0;
    const wasHidden = n.classList.contains('step-hidden');
    const hidden = r > step;
    n.classList.toggle('step-hidden', hidden);
    if (animate && wasHidden && !hidden) {
      n.classList.add('step-shown');
      clearTimeout(n._revealTimer);
      n._revealTimer = setTimeout(() => n.classList.remove('step-shown'), 800);
    }
  }
}

export function renderElement(el, page, ctx) {
  const wrap = h('div', {
    class: ['el', `el-${el.kind}`],
    dataset: { id: el.id, reveal: String(Number(el.reveal) || 0) },
    style: { left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` },
  });
  try {
    const content = elementContent(el, page, ctx);
    if (content) wrap.append(...[content].flat());
  } catch (err) {
    console.error(err);
    wrap.append(h('div', { class: 'chart-empty' }, String(err.message || err)));
  }
  return wrap;
}

function elementContent(el, page, ctx) {
  switch (el.kind) {
    case 'text': return textEl(el, ctx);
    case 'image': return imageEl(el, ctx);
    case 'inject': return injectEl(el, ctx);
    case 'chart': return chartEl(el, ctx);
    case 'choices': return choicesEl(page, ctx);
    default: return null;
  }
}

function textEl(el, ctx) {
  const st = el.style || {};
  return h('div', {
    class: ['txt', `size-${st.size || 'm'}`, `align-${st.align || 'left'}`, `valign-${st.valign || 'top'}`, `font-${st.font || 'sans'}`, `box-${st.box || 'none'}`],
    style: { color: st.color || null },
  }, h('div', { class: 'txt-inner', html: md(tr(el.text, ctx.lang)) }));
}

function imageEl(el, ctx) {
  const src = mediaUrl(ctx.wg, el.src);
  const cap = tr(el.caption, ctx.lang);
  return h('figure', { class: ['img', el.frame && 'framed', `fit-${el.fit || 'contain'}`] },
    src
      ? h('div', { class: 'img-box' }, h('img', { src, alt: cap || '', draggable: 'false' }))
      : h('div', { class: 'img-empty' }, icon('image'), h('span', null, t('ed.noImage', null, ctx.lang))),
    cap ? h('figcaption', null, cap) : null);
}

function injectEl(el, ctx) {
  const L = ctx.lang;
  const ch = CH_ICON[el.channel] ? el.channel : 'email';
  const from = tr(el.from, L);
  const to = tr(el.to, L);
  const subject = tr(el.subject, L);
  const body = tr(el.body, L);
  return h('div', { class: ['inject', `ch-${ch}`, `sev-${el.severity || 'info'}`] },
    h('div', { class: 'inj-head' },
      h('span', { class: 'inj-ch' }, icon(CH_ICON[ch]), h('span', null, t(`ch.${ch}`, null, L))),
      el.severity === 'critical' ? h('span', { class: 'inj-sev' }, t('sev.critical', null, L)) : null,
      el.time ? h('span', { class: 'inj-time' }, el.time) : null),
    from || to ? h('div', { class: 'inj-meta' },
      from ? h('div', null, h('span', { class: 'k' }, t(FROM_KEY[ch] || 'inj.from', null, L)), h('span', { class: 'v' }, from)) : null,
      to ? h('div', null, h('span', { class: 'k' }, t('inj.to', null, L)), h('span', { class: 'v' }, to)) : null) : null,
    subject ? h('div', { class: 'inj-subject' }, subject) : null,
    body ? h('div', { class: 'inj-body', html: md(body) }) : null);
}

function chartEl(el, ctx) {
  const attrs = chartAttrs(ctx.wg, el);
  const aspect = (Number(el.w) * 16) / (Math.max(1, Number(el.h)) * 9);
  return h('div', {
    class: ['chart', `chart-${el.chart || 'bars'}`],
    html: renderChart({ type: el.chart || 'bars', wg: ctx.wg, attrs, data: ctx.data, lang: ctx.lang, aspect }),
  });
}

export function effectChips(effects, wg, lang, showHidden) {
  const amap = attrMap(wg);
  const items = Object.entries(effects || {})
    .filter(([id, v]) => amap[id] && Number(v) && (showHidden || !amap[id].hidden));
  if (!items.length) return null;
  return h('div', { class: 'fx' }, items.map(([id, v]) => {
    const a = amap[id];
    return h('span', { class: ['fx-chip', deltaTone(a, Number(v))] },
      a.icon ? h('span', { class: 'fx-ico' }, a.icon) : null,
      h('span', { class: 'fx-name' }, tr(a.name, lang)),
      h('b', null, fmtDelta(a, Number(v))));
  }));
}

function selectionHint(dec, lang) {
  if (dec.mode !== 'multiple') return t('dec.pickOne', null, lang);
  const min = Number(dec.min ?? 1);
  const max = Number(dec.max ?? 0);
  if (max > 0 && min === max) return t('dec.pickExactly', { n: max }, lang);
  if (max > 0 && min > 1) return t('dec.pickRange', { min, max }, lang);
  if (max > 0) return t('dec.pickUpTo', { max }, lang);
  return t('dec.pickAny', null, lang);
}

function choicesEl(page, ctx) {
  const dec = page.decision;
  const L = ctx.lang;
  if (!dec) return h('div', { class: 'chart-empty' }, t('ed.noDecision', null, L));
  const decision = ctx.decision || null;
  const decided = !!decision;
  const pending = new Set(ctx.pending || []);
  const chosen = new Set(decision ? decision.choiceIds : []);
  const n = dec.choices.length || 1;
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
  const interactive = typeof ctx.onChoice === 'function' && !decided;

  const grid = h('div', { class: 'choices-grid', style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } });
  dec.choices.forEach((c, i) => {
    const isSel = decided ? chosen.has(c.id) : pending.has(c.id);
    const result = decided ? decision.results.find((r) => r.choiceId === c.id) : null;
    const chance = Number(c.chance ?? 100);
    const showFx = dec.showEffects === 'always' && !decided;
    const desc = tr(c.description, L);
    grid.append(h(interactive ? 'button' : 'div', {
      type: interactive ? 'button' : null,
      class: ['choice', isSel && 'selected', decided && !isSel && 'dimmed', result && (result.success ? 'success' : 'failed')],
      dataset: { id: c.id },
      style: { animationDelay: `${i * 70}ms` },
      onClick: interactive ? () => ctx.onChoice(c.id) : null,
    },
    h('span', { class: 'choice-key' }, String(i + 1)),
    h('span', { class: 'choice-check' }, icon('check')),
    h('span', { class: 'choice-title' },
      c.icon ? h('span', { class: 'choice-icon' }, c.icon) : null,
      h('span', { class: 'choice-label' }, tr(c.label, L))),
    desc ? h('span', { class: 'choice-desc' }, desc) : null,
    chance < 100 ? h('span', { class: 'choice-chance' }, icon('dice'), `${t('dec.chance', null, L)} ${chance}%`) : null,
    showFx ? effectChips(c.effects, ctx.wg, L, ctx.showHidden) : null));
  });

  let result = null;
  if (decided) {
    result = h('div', { class: 'choices-result' }, decision.results.map((r) => {
      const c = dec.choices.find((x) => x.id === r.choiceId);
      if (!c) return null;
      const outcome = tr(r.success ? c.outcome : c.fail?.outcome, L);
      return h('div', { class: ['res-item', r.roll != null && (r.success ? 'ok' : 'fail')] },
        h('div', { class: 'res-title' }, c.icon ? h('span', null, c.icon) : null, h('span', null, tr(c.label, L))),
        r.roll != null ? h('div', { class: 'res-roll', dataset: { roll: String(r.roll), chance: String(r.chance) } },
          icon('dice'),
          h('span', { class: 'roll-num' }, String(r.roll)),
          h('span', { class: 'roll-of' }, `/ ${r.chance}`),
          h('span', { class: 'roll-verdict' }, r.success ? t('dec.success', null, L) : t('dec.fail', null, L))) : null,
        h('div', { class: 'res-reveal' },
          outcome ? h('div', { class: 'res-outcome', html: md(outcome) }) : null,
          dec.showEffects !== 'never' ? effectChips(r.effects, ctx.wg, L, ctx.showHidden) : null));
    }));
  }

  let actions = null;
  if (ctx.mode === 'present') {
    actions = h('div', { class: 'choices-actions' },
      decided
        ? [h('span', { class: 'decided-badge' }, icon('check'), t('dec.recorded', null, L)),
          h('button', { type: 'button', class: 'mini-btn', onClick: ctx.onUndo }, icon('undo'), t('dec.undo', null, L))]
        : h('button', { type: 'button', class: 'confirm-btn', disabled: ctx.canConfirm ? null : true, onClick: ctx.onConfirm }, icon('check'), t('dec.confirm', null, L)));
  }

  return h('div', { class: ['choices', decided && 'decided', `n-${n}`] },
    h('div', { class: 'choices-head' },
      h('div', { class: 'choices-prompt', html: md(tr(dec.prompt, L)) }),
      h('div', { class: 'choices-hint' }, icon(dec.mode === 'multiple' ? 'choices' : 'target'), selectionHint(dec, L))),
    grid,
    result,
    actions);
}
