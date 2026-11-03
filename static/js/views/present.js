// Audience presentation (projector). Owns the session and broadcasts its state to
// the presenter console window via BroadcastChannel (same browser, same machine).
import { t, tr, getLang } from '../i18n.js';
import { h, clear, toast, modal, debounce, isModalOpen, fmtDuration, fmtDate, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { normalizeWargame } from '../model.js';
import { Session } from '../engine.js';
import { renderStage, stageFit, updateReveal, renderElement, fitText } from '../render.js';
import { updateHud, renderChart } from '../charts.js';

export async function presentView(root, id, query) {
  const wg = normalizeWargame(await api.getWargame(id));
  const test = query.test === '1';
  let saved = null;
  if (query.run) {
    try { saved = await api.getRun(query.run); } catch { toast(t('pr.runMissing'), 'warn'); }
  } else if (!test) {
    const open = (await api.listRuns(id)).filter((r) => !r.finished);
    if (open.length) {
      const r = open[0];
      const choice = await modal({
        title: t('pr.resumeTitle'),
        body: h('p', { class: 'modal-text' }, t('pr.resumeText', { date: fmtDate(r.updated, getLang()), n: r.decisionCount })),
        actions: [
          { label: t('pr.newSession'), ghost: true, value: 'new' },
          { label: t('pr.resume'), primary: true, value: 'resume' },
        ],
      });
      if (choice === 'resume') saved = await api.getRun(r.runId);
    }
  }

  const session = new Session(wg, saved);
  const st = () => session.state;
  if (test) {
    session.state.runId = `test-${session.state.runId}`;
    const p = query.page && session.pageById(query.page);
    if (p) { session.state.history = []; session._enter(p, false); }
  } else {
    history.replaceState(null, '', `#/present/${encodeURIComponent(id)}?run=${session.state.runId}${query.from ? `&from=${query.from}` : ''}`);
  }

  const persist = debounce(() => {
    if (test) return;
    api.saveRun(session.state.runId, session.state).catch((err) => console.warn('save failed', err));
  }, 400);

  // ---------- DOM ----------
  document.body.classList.add('presenting');
  const stageHost = h('div', { class: 'pr-stage-slot' });
  const hud = h('div', { class: 'pr-hud' });
  const timerEl = h('div', { class: 'pr-timer' }, icon('clock'), h('span', { class: 'pr-timer-val' }, '00:00'));
  const counter = h('span', { class: 'pr-counter' });
  const clock = h('span', { class: 'pr-clock' });
  const blackout = h('div', { class: 'pr-blackout' });
  const endHost = h('div', { class: 'pr-end-host' });
  const helpEl = h('div', { class: 'pr-help hidden' });
  const ctrlBtn = (ic, title, onClick, cls = '') => h('button', { type: 'button', class: ['pr-btn', cls], title, onClick: (e) => { e.stopPropagation(); onClick(); } }, icon(ic));
  const langBtn = h('button', { type: 'button', class: 'pr-btn lang', title: `${t('pr.lang')} (L)`, onClick: () => session.toggleLang() });
  const controls = h('div', { class: 'pr-controls' },
    ctrlBtn('chevron-left', `${t('pr.prev')} (←)`, () => prev()),
    counter,
    ctrlBtn('chevron-right', `${t('pr.next')} (→)`, () => next(), 'primary'),
    h('span', { class: 'pr-sep' }),
    langBtn,
    ctrlBtn('chart', `${t('pr.hud')} (H)`, () => session.toggleHud()),
    ctrlBtn('clock', `${t('pr.timer')} (T)`, () => session.timerToggle()),
    ctrlBtn('square', `${t('pr.blackout')} (B)`, () => session.toggleBlackout()),
    ctrlBtn('monitor', `${t('pr.presenter')} (P)`, () => openPresenter()),
    ctrlBtn('maximize', `${t('pr.fullscreen')} (F)`, () => toggleFullscreen()),
    ctrlBtn('info', `${t('pr.help')} (?)`, () => helpEl.classList.toggle('hidden')),
    h('span', { class: 'pr-sep' }),
    clock,
    test ? h('span', { class: 'pr-test' }, t('pr.testMode')) : null,
    ctrlBtn('exit', `${t('pr.exit')} (Esc)`, () => exit(true)));
  const shell = h('div', { class: 'present' },
    h('div', { class: 'pr-stage-area' }, stageHost, endHost, timerEl, controls),
    hud, blackout, helpEl);
  root.append(shell);

  helpEl.append(h('div', { class: 'pr-help-box' },
    h('h3', null, t('pr.help')),
    h('dl', null, [
      ['→ / Space / PgDn', t('pr.k.next')], ['← / PgUp', t('pr.k.prev')], ['1 – 9', t('pr.k.choice')],
      ['Enter', t('pr.k.confirm')], ['U', t('pr.k.undo')], ['L', t('pr.k.lang')], ['H', t('pr.k.hud')],
      ['T', t('pr.k.timer')], ['B / .', t('pr.k.blackout')], ['F', t('pr.k.fullscreen')], ['P', t('pr.k.presenter')], ['Esc', t('pr.k.exit')],
    ].map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    h('button', { class: 'btn', onClick: () => helpEl.classList.add('hidden') }, t('btn.close'))));

  // ---------- rendering ----------
  let stage = null;
  let rendered = { key: null };
  let hudDelay = null;

  const ctx = () => ({
    wg,
    lang: st().lang,
    mode: 'present',
    step: session.step,
    data: session.chartData(),
    pending: st().pending,
    decision: session.decision,
    canConfirm: session.canConfirm(),
    onChoice: (cid) => session.toggle(cid),
    onConfirm: () => confirm(),
    onUndo: () => session.undoDecision(),
    showHidden: false,
  });

  function refreshDynamic() {
    if (!stage) return;
    const page = session.page;
    const c = ctx();
    for (const el of page.elements) {
      if (el.kind !== 'choices' && el.kind !== 'chart') continue;
      const old = stage.querySelector(`:scope > .el[data-id="${CSS.escape(el.id)}"]`);
      if (!old) continue;
      const fresh = renderElement(el, page, c);
      fresh.className = old.className;
      old.replaceWith(fresh);
    }
    fitText(stage);
  }

  function render(reason = 'page', info = {}) {
    const s = st();
    shell.classList.toggle('theme-light', wg.settings?.theme === 'light');
    shell.classList.toggle('hud-off', !s.hud);
    shell.classList.toggle('is-blackout', !!s.blackout);
    langBtn.textContent = s.lang.toUpperCase();
    document.documentElement.lang = s.lang;

    if (s.ended) {
      stage = null;
      rendered.key = null;
      clear(stageHost);
      renderEnd();
    } else {
      clear(endHost);
      const page = session.page;
      const key = `${s.history.length}|${page.id}|${s.lang}`;
      if (key !== rendered.key || reason === 'page') {
        stage = renderStage(page, ctx());
        stage.classList.add('enter');
        stageHost.replaceChildren(stageFit(stage));
        fitText(stage);
        rendered.key = key;
        const entered = stage;
        setTimeout(() => entered.classList.remove('enter'), 1100);
      } else if (reason === 'step') {
        updateReveal(stage, session.step, true);
      } else if (reason === 'select') {
        const sel = new Set(s.pending || []);
        stage.querySelectorAll('.choice[data-id]').forEach((c) => c.classList.toggle('selected', sel.has(c.dataset.id)));
        const btn = stage.querySelector('.confirm-btn');
        if (btn) { btn.disabled = !session.canConfirm(); btn.classList.remove('nudge'); }
      } else if (['decided', 'undo'].includes(reason)) {
        refreshDynamic();
      }
      const idx = session.pageIndex(page.id);
      counter.textContent = `${idx + 1} / ${session.pages.length}`;
    }

    // attribute bar (wait for dice animations before revealing changes)
    let delay = 0;
    if (reason === 'decided' && info.rolled && stage) delay = animateRolls(stage);
    clearTimeout(hudDelay);
    const visible = (wg.attributes || []).filter((a) => !a.hidden);
    const values = { ...s.attrs };
    if (delay) hudDelay = setTimeout(() => updateHud(hud, visible, values, s.lang), delay);
    else updateHud(hud, visible, values, s.lang);
    tickTimer();
    broadcast();
    persist();
  }

  function renderEnd() {
    const s = st();
    const started = new Date(s.started).getTime();
    const dur = (Date.now() - started) / 1000;
    const attrs = wg.attributes || [];
    clear(endHost).append(h('div', { class: 'pr-end' },
      h('div', { class: 'pr-end-inner' },
        h('div', { class: 'kicker' }, t('pr.endKicker', null, s.lang)),
        h('h1', null, tr(wg.meta.title, s.lang)),
        h('p', { class: 'pr-end-sub' }, t('pr.endSummary', { n: s.decisions.length, time: fmtDuration(dur) }, s.lang)),
        attrs.length ? h('div', { class: 'pr-end-chart', html: renderChart({ type: 'cards', wg, attrs, data: session.chartData(), lang: s.lang, aspect: 2.6 }) }) : null,
        h('div', { class: 'btn-row center' },
          h('button', { class: 'btn lg', onClick: () => prev() }, icon('chevron-left'), t('pr.back', null, s.lang)),
          !test ? h('a', { class: 'btn lg primary', href: `#/run/${s.runId}` }, icon('chart'), t('run.debrief', null, s.lang)) : null,
          h('button', { class: 'btn lg', onClick: () => exit(false) }, icon('exit'), t('pr.exit', null, s.lang))))));
  }

  function animateRolls(stageEl) {
    const res = stageEl.querySelector('.choices-result');
    const rolls = res ? [...res.querySelectorAll('.res-roll')] : [];
    if (!rolls.length) return 0;
    res.classList.add('rolling');
    const base = 1300;
    const total = base + (rolls.length - 1) * 450;
    rolls.forEach((r, i) => {
      const num = r.querySelector('.roll-num');
      const final = r.dataset.roll;
      const end = performance.now() + base + i * 450;
      r.classList.add('spinning');
      const spin = () => {
        if (performance.now() < end) {
          num.textContent = String(1 + Math.floor(Math.random() * 100));
          setTimeout(spin, 55);
        } else {
          num.textContent = final;
          r.classList.remove('spinning');
          r.classList.add('landed');
        }
      };
      spin();
    });
    setTimeout(() => res.classList.remove('rolling'), total + 50);
    return total + 50;
  }

  // ---------- actions ----------
  let blockedEntry = null;
  function next() {
    if (!helpEl.classList.contains('hidden')) { helpEl.classList.add('hidden'); return; }
    if (st().blackout) { session.toggleBlackout(); return; }
    const r = session.next();
    if (r.blocked) {
      if (blockedEntry === session.entry) {
        blockedEntry = null;
        session.next({ force: true });
      } else {
        blockedEntry = session.entry;
        toast(t('pr.decideFirst', null, st().lang), 'warn', 3000);
        stage?.querySelector('.confirm-btn')?.classList.add('nudge');
      }
    } else blockedEntry = null;
  }
  function prev() { blockedEntry = null; session.prev(); }
  function confirm() {
    const r = session.confirm();
    if (r.error === 'selection') {
      toast(t('pr.selectMore', { min: Math.max(1, r.min) }, st().lang), 'warn');
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  let presenterWin = null;
  function openPresenter() {
    presenterWin = window.open(`#/presenter/${encodeURIComponent(st().runId)}`, `wargame-presenter-${st().runId}`, 'popup,width=1320,height=820');
    if (!presenterWin) toast(t('pr.popupBlocked'), 'warn', 4000);
  }

  async function exit(ask) {
    if (ask && !st().ended) {
      const ok = await confirmDialog(t('pr.exitTitle'), test ? t('pr.exitTextTest') : t('pr.exitText'), { okLabel: t('pr.exit'), cancelLabel: t('btn.cancel') });
      if (!ok) return;
    }
    persist.flush();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    location.hash = query.from === 'edit' ? `#/edit/${encodeURIComponent(id)}` : '#/';
  }

  // ---------- presenter console link ----------
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`wargame-${session.state.runId}`) : null;
  const slim = () => { const { wargame, ...rest } = session.state; return rest; };
  function broadcast() { channel?.postMessage({ type: 'state', state: slim(), now: Date.now() }); }
  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'hello') channel.postMessage({ type: 'init', wargame: wg, state: slim(), test, now: Date.now() });
      else if (m.type === 'cmd') {
        if (m.cmd === 'next') next();
        else if (m.cmd === 'prev') prev();
        else if (m.cmd === 'confirm') confirm();
        else if (m.cmd === 'fullscreen') toggleFullscreen();
        else session.command(m.cmd, m.arg);
      }
    };
  }

  // ---------- timer + clock ----------
  function tickTimer() {
    const tm = st().timer;
    const rem = session.timerRemaining();
    timerEl.classList.toggle('show', !!tm.duration && !st().ended);
    timerEl.classList.toggle('running', !!tm.running);
    timerEl.classList.toggle('warn', rem <= 60 && rem > 0);
    timerEl.classList.toggle('over', tm.duration > 0 && rem <= 0);
    timerEl.querySelector('.pr-timer-val').textContent = fmtDuration(Math.ceil(rem));
    if (tm.running && rem <= 0) { session.timerPause(); }
    clock.textContent = fmtDuration((Date.now() - new Date(st().started).getTime()) / 1000);
  }
  const ticker = setInterval(tickTimer, 250);

  // ---------- input ----------
  const onKey = (e) => {
    if (isModalOpen()) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const page = session.page;
    const onDecision = page && page.type === 'decision' && !session.decision;
    if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(k)) { e.preventDefault(); next(); return; }
    if (['ArrowLeft', 'PageUp', 'Backspace', 'ArrowUp'].includes(k)) { e.preventDefault(); prev(); return; }
    if (k === 'Enter') { e.preventDefault(); if (onDecision && session.canConfirm()) confirm(); else next(); return; }
    if (/^[1-9]$/.test(k) && onDecision) {
      const c = page.decision.choices[Number(k) - 1];
      if (c) session.toggle(c.id);
      return;
    }
    switch (k.toLowerCase()) {
      case 'l': session.toggleLang(); break;
      case 'h': session.toggleHud(); break;
      case 'b': case '.': session.toggleBlackout(); break;
      case 'f': toggleFullscreen(); break;
      case 't': session.timerToggle(); break;
      case 'r': session.timerReset(); break;
      case 'u': session.undoDecision(); break;
      case 'p': openPresenter(); break;
      case '?': helpEl.classList.toggle('hidden'); break;
      case 'escape':
        if (!helpEl.classList.contains('hidden')) helpEl.classList.add('hidden');
        else if (!document.fullscreenElement) exit(true);
        break;
      default: break;
    }
  };
  let idleTimer = null;
  const onMove = () => {
    shell.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shell.classList.add('idle'), 2600);
  };
  document.addEventListener('keydown', onKey);
  shell.addEventListener('pointermove', onMove);
  onMove();

  const unsub = session.on((reason, info) => render(reason, info));
  render('page');

  return {
    onLang() { /* the presentation keeps its own language (L key) */ },
    destroy() {
      unsub();
      persist.flush();
      clearInterval(ticker);
      clearTimeout(idleTimer);
      clearTimeout(hudDelay);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('presenting');
      channel?.postMessage({ type: 'closed' });
      channel?.close();
    },
  };
}
