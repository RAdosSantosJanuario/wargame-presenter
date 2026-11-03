// Presentation engine: navigation, reveal steps, decisions, dice rolls, timer, undo.
// The whole session state is one plain JSON object (saved to data/runs and
// broadcast to the presenter console).
import { startValues, applyEffects, evalCondition, maxStep } from './model.js';
import { uid, clone } from './util.js';

export class Session {
  constructor(wg, saved = null) {
    this.wg = wg;
    this.listeners = new Set();
    if (saved && saved.history && saved.history.length) {
      this.state = saved;
      this.state.wargame = clone(wg);
    } else {
      const start = startValues(wg);
      this.state = {
        runId: uid('r'),
        wargameId: wg.id,
        wargame: clone(wg),
        started: new Date().toISOString(),
        updated: null,
        finished: false,
        ended: false,
        lang: wg.settings?.language || 'de',
        hud: wg.settings?.hud !== false,
        blackout: false,
        startAttrs: start,
        attrs: clone(start),
        history: [],
        decisions: [],
        pending: [],
        timer: { duration: 0, remaining: 0, running: false, endsAt: 0 },
      };
      const first = this.pages.find((p) => this.canEnter(p)) || this.pages[0];
      if (first) this._enter(first, false);
    }
  }

  // Read-only view on a state object (used by the presenter console).
  static view(wg, state) {
    const s = Object.create(Session.prototype);
    s.wg = wg;
    s.listeners = new Set();
    s.state = state;
    return s;
  }

  // ---------- events ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason = 'change', info = {}) {
    this.state.updated = new Date().toISOString();
    for (const fn of this.listeners) fn(reason, info);
  }

  // ---------- lookups ----------
  get pages() { return this.wg.pages || []; }
  get entry() { return this.state.history[this.state.history.length - 1]; }
  get page() { return this.state.ended ? null : this.pageById(this.entry?.pageId); }
  get step() { return this.entry?.step || 0; }
  get decision() {
    const e = this.entry;
    return e && e.decision != null ? this.state.decisions[e.decision] : null;
  }
  pageById(id) { return this.pages.find((p) => p.id === id) || null; }
  pageIndex(id) { return this.pages.findIndex((p) => p.id === id); }
  chosenIds() {
    const set = new Set();
    for (const d of this.state.decisions) for (const r of d.results) set.add(r.choiceId);
    return set;
  }
  canEnter(page) { return evalCondition(page.condition, this.state.attrs, this.chosenIds()); }

  // Page that "next" would go to (null = end of scenario)
  nextTarget() {
    const page = this.page;
    if (!page) return null;
    const d = this.decision;
    if (d) {
      const jump = d.results.map((r) => r.goto).find(Boolean);
      const target = jump && this.pageById(jump);
      if (target) return target;
    }
    const idx = this.pageIndex(page.id);
    return this.pages.slice(idx + 1).find((p) => this.canEnter(p)) || null;
  }

  needsDecision() {
    const page = this.page;
    return !!(page && page.type === 'decision' && page.decision?.choices?.length && !this.decision);
  }

  // ---------- navigation ----------
  _enter(page, emit = true) {
    this.state.history.push({
      pageId: page.id,
      step: 0,
      snap: { attrs: clone(this.state.attrs), dlen: this.state.decisions.length },
      decision: null,
    });
    this.state.pending = [];
    this._resetTimer(page);
    if (emit) this.emit('page');
  }

  next({ force = false } = {}) {
    if (this.state.ended) return { ended: true };
    const page = this.page;
    const e = this.entry;
    if (!page || !e) return { ended: true };
    if (e.step < maxStep(page)) {
      e.step++;
      this.emit('step');
      return { step: e.step };
    }
    if (this.needsDecision() && !force) return { blocked: true };
    const target = this.nextTarget();
    if (!target) {
      this.state.ended = true;
      this.state.finished = true;
      this._pauseTimer();
      this.emit('end');
      return { ended: true };
    }
    this._enter(target);
    return { moved: true };
  }

  prev() {
    if (this.state.ended) {
      this.state.ended = false;
      this.emit('page');
      return { moved: true };
    }
    const e = this.entry;
    if (!e) return {};
    if (e.step > 0) {
      e.step--;
      this.emit('step');
      return { step: e.step };
    }
    if (this.state.history.length <= 1) return { atStart: true };
    const popped = this.state.history.pop();
    // restore the state from the moment we left the previous page
    this.state.attrs = clone(popped.snap.attrs);
    this.state.decisions.length = popped.snap.dlen;
    const cur = this.entry;
    const d = cur.decision != null ? this.state.decisions[cur.decision] : null;
    this.state.pending = d ? [...d.choiceIds] : [];
    this._resetTimer(this.page);
    this.emit('page');
    return { moved: true };
  }

  goTo(pageId) {
    const page = this.pageById(pageId);
    if (!page) return;
    if (this.state.ended) this.state.ended = false;
    this._enter(page);
  }

  // ---------- decisions ----------
  toggle(choiceId) {
    const page = this.page;
    if (!page || page.type !== 'decision' || this.decision) return false;
    const dec = page.decision;
    if (!dec.choices.some((c) => c.id === choiceId)) return false;
    let sel = [...(this.state.pending || [])];
    if (dec.mode !== 'multiple') {
      sel = sel[0] === choiceId ? [] : [choiceId];
    } else if (sel.includes(choiceId)) {
      sel = sel.filter((id) => id !== choiceId);
    } else {
      const max = Number(dec.max) || 0;
      if (max > 0 && sel.length >= max) {
        if (max === 1) sel = [choiceId];
        else return false;
      } else sel.push(choiceId);
    }
    this.state.pending = sel;
    this.emit('select');
    return true;
  }

  selectionLimits() {
    const dec = this.page?.decision;
    if (!dec) return { min: 0, max: 0 };
    if (dec.mode !== 'multiple') return { min: 1, max: 1 };
    return { min: Math.max(0, Number(dec.min ?? 1)), max: Math.max(0, Number(dec.max ?? 0)) };
  }

  canConfirm() {
    if (!this.page || this.page.type !== 'decision' || this.decision) return false;
    const { min, max } = this.selectionLimits();
    const n = (this.state.pending || []).length;
    return n >= Math.max(1, min) && (!max || n <= max);
  }

  confirm() {
    const page = this.page;
    const e = this.entry;
    if (!page || page.type !== 'decision' || this.decision) return { error: 'state' };
    if (!this.canConfirm()) return { error: 'selection', ...this.selectionLimits() };
    const dec = page.decision;
    const sel = this.state.pending.filter((id) => dec.choices.some((c) => c.id === id));
    const before = clone(this.state.attrs);
    const results = [];
    for (const choice of dec.choices) {
      if (!sel.includes(choice.id)) continue;
      const chance = Math.max(0, Math.min(100, Number(choice.chance ?? 100)));
      let roll = null;
      let success = true;
      if (chance < 100) {
        roll = 1 + Math.floor(Math.random() * 100);
        success = roll <= chance;
      }
      const branch = success ? choice : (choice.fail || {});
      const effects = clone(branch.effects || {});
      this.state.attrs = applyEffects(this.wg, this.state.attrs, effects);
      results.push({ choiceId: choice.id, chance, roll, success, effects, goto: branch.goto || '' });
    }
    const decision = {
      pageId: page.id,
      choiceIds: sel,
      results,
      before,
      after: clone(this.state.attrs),
      at: new Date().toISOString(),
    };
    this.state.decisions.push(decision);
    e.decision = this.state.decisions.length - 1;
    this._pauseTimer();
    this.emit('decided', { rolled: results.some((r) => r.roll != null) });
    return { ok: true, decision };
  }

  undoDecision() {
    const e = this.entry;
    if (!e || e.decision == null) return false;
    this.state.attrs = clone(e.snap.attrs);
    this.state.decisions.length = e.snap.dlen;
    e.decision = null;
    this.emit('undo');
    return true;
  }

  // ---------- view toggles ----------
  setLang(lang) { this.state.lang = lang; this.emit('lang'); }
  toggleLang() { this.setLang(this.state.lang === 'de' ? 'en' : 'de'); }
  toggleHud() { this.state.hud = !this.state.hud; this.emit('hud'); }
  toggleBlackout() { this.state.blackout = !this.state.blackout; this.emit('blackout'); }

  // ---------- timer ----------
  _resetTimer(page) {
    const sec = Number(page?.timer) || 0;
    this.state.timer = { duration: sec, remaining: sec, running: false, endsAt: 0 };
  }
  _pauseTimer() {
    const t = this.state.timer;
    if (t.running) {
      t.remaining = Math.max(0, (t.endsAt - Date.now()) / 1000);
      t.running = false;
    }
  }
  timerRemaining() {
    const t = this.state.timer;
    return t.running ? Math.max(0, (t.endsAt - Date.now()) / 1000) : t.remaining;
  }
  timerStart() {
    const t = this.state.timer;
    if (!t.duration) { t.duration = 300; t.remaining = 300; }
    if (t.remaining <= 0) t.remaining = t.duration;
    t.running = true;
    t.endsAt = Date.now() + t.remaining * 1000;
    this.emit('timer');
  }
  timerPause() { this._pauseTimer(); this.emit('timer'); }
  timerToggle() { if (this.state.timer.running) this.timerPause(); else this.timerStart(); }
  timerReset() { this._resetTimer(this.page); if (!this.state.timer.duration) this.state.timer = { duration: 300, remaining: 300, running: false, endsAt: 0 }; this.emit('timer'); }
  timerAdd(sec) {
    const t = this.state.timer;
    t.duration = Math.max(0, t.duration + sec);
    if (t.running) t.endsAt += sec * 1000;
    else t.remaining = Math.max(0, t.remaining + sec);
    this.emit('timer');
  }

  // ---------- data for charts ----------
  chartData() {
    return chartDataFromState(this.state, this.wg);
  }

  // dispatch a command (used by the presenter console)
  command(cmd, arg) {
    switch (cmd) {
      case 'next': return this.next(arg || {});
      case 'prev': return this.prev();
      case 'goto': return this.goTo(arg);
      case 'toggle': return this.toggle(arg);
      case 'confirm': return this.confirm();
      case 'undo': return this.undoDecision();
      case 'lang': return arg ? this.setLang(arg) : this.toggleLang();
      case 'hud': return this.toggleHud();
      case 'blackout': return this.toggleBlackout();
      case 'timer-toggle': return this.timerToggle();
      case 'timer-reset': return this.timerReset();
      case 'timer-add': return this.timerAdd(Number(arg) || 60);
      default: return null;
    }
  }
}

// Shared by presentation, presenter console, editor preview and debrief.
export function chartDataFromState(state, wg) {
  const timeline = [{ label: { en: 'Start', de: 'Start' }, values: state.startAttrs }];
  for (const d of state.decisions || []) {
    const page = (wg.pages || []).find((p) => p.id === d.pageId);
    timeline.push({ label: page ? page.title : { en: '?', de: '?' }, values: d.after, decision: d });
  }
  return {
    values: state.attrs,
    start: state.startAttrs,
    timeline,
    decisions: state.decisions || [],
    last: (state.decisions || [])[state.decisions.length - 1] || null,
  };
}
