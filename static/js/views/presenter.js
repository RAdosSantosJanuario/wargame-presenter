// Presenter console: a second window on the facilitator's screen with notes,
// next-page preview, timer, decision controls and all attribute values
// (including hidden ones). It remote-controls the audience window.
import { t, tr, getLang } from '../i18n.js';
import { h, clear, md, fmtDuration } from '../util.js';
import { icon } from '../icons.js';
import { normalizeWargame, classify, fmtValue, fmtDelta, deltaTone, norm, maxStep } from '../model.js';
import { Session } from '../engine.js';
import { renderStage, stageFit, fitText } from '../render.js';
import { brand, langSwitch } from './common.js';

export async function presenterView(root, runId) {
  document.body.classList.add('presenter-mode');
  const channel = new BroadcastChannel(`wargame-${runId}`);
  let wg = null;
  let state = null;
  let lastSeen = 0;
  const send = (cmd, arg) => channel.postMessage({ type: 'cmd', cmd, arg });

  const shell = h('div', { class: 'presenter' });
  root.append(shell);

  const waiting = (msgKey) => {
    clear(shell).append(h('div', { class: 'ps-wait' },
      brand(),
      h('div', { class: 'ps-wait-box' },
        h('span', { class: 'ps-dot pulse' }),
        h('h2', null, t(msgKey)),
        h('p', { class: 'muted' }, t('ps.waitHint')))));
  };
  waiting('ps.connecting');

  channel.onmessage = (e) => {
    const m = e.data || {};
    lastSeen = Date.now();
    if (m.type === 'init') {
      wg = normalizeWargame(m.wargame);
      state = m.state;
      render();
    } else if (m.type === 'state') {
      if (!wg) { channel.postMessage({ type: 'hello' }); return; }
      state = m.state;
      render();
    } else if (m.type === 'closed') {
      wg = null;
      waiting('ps.closed');
    }
  };
  channel.postMessage({ type: 'hello' });
  const retry = setInterval(() => { if (!wg) channel.postMessage({ type: 'hello' }); }, 1500);

  // ---------- rendering ----------
  const refs = {};
  function render() {
    const lang = getLang();
    const view = Session.view(wg, state);
    const page = view.page;
    const entry = view.entry;
    const decision = view.decision;
    const steps = page ? maxStep(page) : 0;
    const data = view.chartData();
    const next = !state.ended && page ? (view.step < steps ? page : view.nextTarget()) : null;
    const pendingDecision = view.needsDecision();

    const stageCtx = (pg, step, dec) => ({
      wg, lang: state.lang, mode: 'preview', step, data,
      pending: pg === page ? state.pending : [], decision: pg === page ? dec : null, showHidden: true,
    });

    // header
    const header = h('header', { class: 'ps-top' },
      brand(),
      h('div', { class: 'ps-title' }, h('span', { class: 'kicker' }, t('ps.console')), h('b', null, tr(wg.meta.title, lang))),
      h('span', { class: 'spacer' }),
      h('div', { class: 'ps-clocks' },
        h('div', null, h('small', null, t('ps.elapsed')), refs.elapsed = h('b', null, '00:00')),
        h('div', null, h('small', null, t('ps.time')), refs.clock = h('b', null, '--:--'))),
      h('span', { class: 'ps-conn ok', title: t('ps.connected') }, h('span', { class: 'ps-dot' }), t('ps.connected')),
      langSwitch(() => render()));

    // current + next
    const curTitle = state.ended ? t('ps.ended') : tr(page?.title, lang);
    const current = h('section', { class: 'ps-current' },
      h('div', { class: 'ps-label' },
        h('span', { class: 'kicker accent' }, t('ps.now')),
        h('b', null, curTitle),
        page ? h('span', { class: 'mini-chip' }, `${view.pageIndex(page.id) + 1} / ${view.pages.length}`) : null,
        steps ? h('span', { class: 'mini-chip' }, t('ps.step', { n: view.step, of: steps })) : null,
        page?.type === 'decision' ? h('span', { class: ['mini-chip', decision ? 'ok' : 'warn'] }, decision ? t('ps.decided') : t('ps.awaiting')) : null),
      h('div', { class: 'ps-stage' }, page ? stageFit(renderStage(page, stageCtx(page, view.step, decision))) : h('div', { class: 'ps-ended' }, icon('flag'), t('ps.ended'))));

    let nextLabel = t('ps.end');
    if (next === page && page) nextLabel = t('ps.nextStep', { n: view.step + 1 });
    else if (next) nextLabel = tr(next.title, lang);
    const nextBox = h('section', { class: 'ps-next' },
      h('div', { class: 'ps-label' },
        h('span', { class: 'kicker' }, t('ps.next')),
        h('b', null, nextLabel),
        pendingDecision ? h('span', { class: 'mini-chip warn' }, t('ps.dependsOnDecision')) : null),
      h('div', { class: 'ps-stage small' }, next ? stageFit(renderStage(next, stageCtx(next, next === page ? view.step + 1 : 0, null))) : h('div', { class: 'ps-ended' }, icon('flag'), t('ps.end'))));

    const notesText = page ? tr(page.notes, lang) : '';
    const notes = h('section', { class: 'ps-notes' },
      h('div', { class: 'ps-label' }, h('span', { class: 'kicker' }, icon('memo'), t('ed.notes'))),
      notesText ? h('div', { class: 'ps-notes-body', html: md(notesText) }) : h('p', { class: 'muted' }, t('ps.noNotes')));

    // side: navigation
    const nav = h('div', { class: 'ps-nav' },
      h('button', { class: 'ps-big', onClick: () => send('prev') }, icon('chevron-left'), t('pr.prev')),
      h('button', { class: 'ps-big primary', onClick: () => send('next') }, t('pr.next'), icon('chevron-right')));

    // timer
    const tm = state.timer;
    const timer = h('section', { class: 'ps-card ps-timer' },
      h('div', { class: 'ps-card-head' }, icon('clock'), h('span', null, t('pr.timer'))),
      refs.timer = h('div', { class: 'ps-timer-val' }, '00:00'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm primary', onClick: () => send('timer-toggle') }, icon(tm.running ? 'pause' : 'play'), tm.running ? t('ps.pause') : t('ps.start')),
        h('button', { class: 'btn sm', onClick: () => send('timer-reset') }, icon('reset'), t('ps.reset')),
        h('button', { class: 'btn sm', onClick: () => send('timer-add', 60) }, '+1m'),
        h('button', { class: 'btn sm', onClick: () => send('timer-add', -60) }, '−1m')));

    // decision controls
    let decisionCard = null;
    if (page?.type === 'decision' && page.decision) {
      const dec = page.decision;
      const chosen = new Set(decision ? decision.choiceIds : state.pending || []);
      decisionCard = h('section', { class: 'ps-card ps-decision' },
        h('div', { class: 'ps-card-head' }, icon('choices'), h('span', null, t('ed.decision')),
          h('span', { class: 'spacer' }),
          h('small', null, dec.mode === 'multiple' ? t('ed.mode.multiple') : t('ed.mode.single'))),
        h('div', { class: 'ps-choices' }, dec.choices.map((c, i) => {
          const r = decision?.results.find((x) => x.choiceId === c.id);
          return h('button', {
            class: ['ps-choice', chosen.has(c.id) && 'on', r && (r.success ? 'ok' : 'fail')],
            disabled: decision ? true : null,
            onClick: () => send('toggle', c.id),
          },
          h('span', { class: 'num' }, String(i + 1)),
          h('span', { class: 'lbl' }, `${c.icon ? `${c.icon} ` : ''}${tr(c.label, lang)}`),
          Number(c.chance ?? 100) < 100 ? h('span', { class: 'mini-chip warn' }, icon('dice'), `${c.chance}%`) : null,
          r && r.roll != null ? h('span', { class: ['mini-chip', r.success ? 'ok' : 'bad'] }, `🎲 ${r.roll}`) : null,
          c.goto ? h('span', { class: 'mini-chip', title: t('ed.goto') }, icon('branch')) : null);
        })),
        h('div', { class: 'btn-row' },
          decision
            ? h('button', { class: 'btn sm', onClick: () => send('undo') }, icon('undo'), t('dec.undo'))
            : h('button', { class: 'btn sm primary', disabled: view.canConfirm() ? null : true, onClick: () => send('confirm') }, icon('check'), t('dec.confirm'))));
    }

    // attributes (facilitator sees hidden ones too)
    const attrs = h('section', { class: 'ps-card ps-attrs' },
      h('div', { class: 'ps-card-head' }, icon('sliders'), h('span', null, t('lib.attributes'))),
      (wg.attributes || []).map((a) => {
        const v = state.attrs[a.id] ?? a.start;
        const c = classify(a, v);
        const d = v - (state.startAttrs[a.id] ?? a.start);
        return h('div', { class: ['ps-attr', a.hidden && 'is-hidden'], style: { '--c': c.color } },
          h('span', { class: 'ico' }, a.icon || ''),
          h('div', { class: 'main' },
            h('div', { class: 'top' },
              h('span', { class: 'name' }, tr(a.name, lang), a.hidden ? icon('eye-off') : null),
              h('b', null, fmtValue(a, v))),
            h('div', { class: 'bar' }, h('i', { style: { width: `${norm(a, v) * 100}%` } })),
            h('div', { class: 'bot' },
              h('span', { class: 'lvl' }, tr(c.label, lang)),
              Math.abs(d) > 1e-9 ? h('span', { class: ['delta', deltaTone(a, d)] }, `${d > 0 ? '▲' : '▼'} ${fmtDelta(a, d)}`) : null)));
      }));

    // view toggles + jump
    const jump = h('select', { class: 'ps-jump' },
      h('option', { value: '' }, t('ps.jumpTo')),
      wg.pages.map((p, i) => h('option', { value: p.id }, `${i + 1}. ${tr(p.title, lang)}${p.condition?.rules?.length ? ' ⚑' : ''}`)));
    jump.addEventListener('change', () => { if (jump.value) send('goto', jump.value); jump.value = ''; });
    const toggles = h('section', { class: 'ps-card ps-toggles' },
      h('div', { class: 'ps-card-head' }, icon('monitor'), h('span', null, t('ps.audience'))),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn sm', onClick: () => send('lang') }, icon('globe'), `${t('pr.lang')}: ${state.lang.toUpperCase()}`),
        h('button', { class: ['btn sm', state.hud && 'on'], onClick: () => send('hud') }, icon('chart'), t('pr.hud')),
        h('button', { class: ['btn sm', state.blackout && 'on danger'], onClick: () => send('blackout') }, icon('square'), t('pr.blackout')),
        h('button', { class: 'btn sm', onClick: () => send('fullscreen'), title: t('ps.fullscreenHint') }, icon('maximize'), t('pr.fullscreen'))),
      jump);

    clear(shell).append(
      header,
      h('div', { class: 'ps-body' },
        h('main', { class: 'ps-main' }, current, h('div', { class: 'ps-row' }, nextBox, notes)),
        h('aside', { class: 'ps-side' }, nav, timer, decisionCard, attrs, toggles)));
    shell.querySelectorAll('.stage').forEach((s) => fitText(s));
    tick();
  }

  function tick() {
    if (!wg || !state) return;
    const view = Session.view(wg, state);
    const rem = view.timerRemaining();
    if (refs.timer) {
      refs.timer.textContent = state.timer.duration ? fmtDuration(Math.ceil(rem)) : '—';
      refs.timer.classList.toggle('warn', rem <= 60 && rem > 0);
      refs.timer.classList.toggle('over', state.timer.duration > 0 && rem <= 0);
      refs.timer.classList.toggle('running', !!state.timer.running);
    }
    if (refs.elapsed) refs.elapsed.textContent = fmtDuration((Date.now() - new Date(state.started).getTime()) / 1000);
    if (refs.clock) refs.clock.textContent = new Date().toLocaleTimeString(getLang() === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  const ticker = setInterval(tick, 250);

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); send('next'); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); send('prev'); }
    else if (e.key === 'Enter') { e.preventDefault(); send('confirm'); }
    else if (/^[1-9]$/.test(e.key) && wg && state) {
      const page = Session.view(wg, state).page;
      const c = page?.type === 'decision' ? page.decision?.choices?.[Number(e.key) - 1] : null;
      if (c) send('toggle', c.id);
    } else if (e.key.toLowerCase() === 't') send('timer-toggle');
    else if (e.key.toLowerCase() === 'b') send('blackout');
    else if (e.key.toLowerCase() === 'l') send('lang');
    else if (e.key.toLowerCase() === 'u') send('undo');
  };
  document.addEventListener('keydown', onKey);
  document.title = `${t('ps.console')} · Wargame Presenter`;

  return {
    onLang() { if (wg && state) render(); },
    destroy() {
      clearInterval(retry);
      clearInterval(ticker);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('presenter-mode');
      channel.close();
    },
  };
}
