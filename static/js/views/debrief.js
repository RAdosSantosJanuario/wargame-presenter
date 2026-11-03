// Debrief / after-action review of a finished (or running) session.
import { t, tr, getLang } from '../i18n.js';
import { h, md, downloadJSON, fmtDate, fmtDuration, slug } from '../util.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { normalizeWargame, classify, fmtValue, fmtDelta, deltaTone, SEVERITIES, attrMap } from '../model.js';
import { chartDataFromState } from '../engine.js';
import { renderChart } from '../charts.js';
import { appHeader } from './common.js';

export async function debriefView(root, runId) {
  const run = await api.getRun(runId);
  let wg = run.wargame;
  if (!wg) wg = await api.getWargame(run.wargameId);
  wg = normalizeWargame(wg);
  const lang = getLang();
  const data = chartDataFromState(run, wg);
  const attrs = wg.attributes || [];
  const amap = attrMap(wg);
  const dur = (new Date(run.updated || Date.now()).getTime() - new Date(run.started).getTime()) / 1000;

  // severity distribution of the final state
  const counts = {};
  for (const a of attrs) {
    const c = classify(a, data.values[a.id] ?? a.start);
    counts[c.severity] = (counts[c.severity] || 0) + 1;
  }
  const order = ['critical', 'bad', 'warning', 'ok', 'good', 'info'];
  const worst = order.find((k) => counts[k]);

  const chart = (type, aspect, cls = '') => h('div', { class: ['db-chart', `chart-${type}`, cls], style: { aspectRatio: String(aspect) }, html: renderChart({ type, wg, attrs, data, lang, aspect }) });

  const header = appHeader({
    actions: [
      run.wargameId && !run.finished ? h('a', { class: 'btn', href: `#/present/${run.wargameId}?run=${run.runId}` }, icon('play'), t('run.resume')) : null,
      h('button', { class: 'btn', onClick: () => window.print() }, icon('printer'), t('run.print')),
      h('button', { class: 'btn', onClick: () => downloadJSON(`${slug(tr(wg.meta.title, 'en')) || 'wargame'}-session-${(run.started || '').slice(0, 10)}.json`, run) }, icon('download'), t('run.exportJson')),
    ],
  });

  const decisions = (run.decisions || []).map((d, i) => {
    const page = wg.pages.find((p) => p.id === d.pageId);
    const changes = attrs.map((a) => ({ a, b: d.before[a.id] ?? a.start, af: d.after[a.id] ?? a.start })).filter((x) => Math.abs(x.af - x.b) > 1e-9);
    const notChosen = (page?.decision?.choices || []).filter((c) => !d.choiceIds.includes(c.id));
    return h('article', { class: 'db-decision' },
      h('div', { class: 'db-num' }, String(i + 1).padStart(2, '0')),
      h('div', { class: 'db-dec-body' },
        h('div', { class: 'db-dec-head' },
          h('h3', null, tr(page?.title, lang) || '?'),
          h('span', { class: 'muted' }, fmtDate(d.at, lang))),
        page?.decision?.prompt ? h('div', { class: 'db-prompt', html: md(tr(page.decision.prompt, lang)) }) : null,
        d.results.map((r) => {
          const c = page?.decision?.choices?.find((x) => x.id === r.choiceId);
          const outcome = tr(r.success ? c?.outcome : c?.fail?.outcome, lang);
          return h('div', { class: ['db-choice', r.roll != null && (r.success ? 'ok' : 'fail')] },
            h('div', { class: 'db-choice-head' },
              h('b', null, `${c?.icon ? `${c.icon} ` : ''}${tr(c?.label, lang) || '?'}`),
              r.roll != null ? h('span', { class: ['roll-chip', r.success ? 'ok' : 'fail'] }, `🎲 ${r.roll} / ${r.chance} · ${r.success ? t('dec.success') : t('dec.fail')}`) : null),
            outcome ? h('div', { class: 'db-outcome', html: md(outcome) }) : null);
        }),
        changes.length ? h('div', { class: 'fx' }, changes.map(({ a, b, af }) => h('span', { class: ['fx-chip', deltaTone(a, af - b)] },
          a.icon ? h('span', { class: 'fx-ico' }, a.icon) : null,
          h('span', { class: 'fx-name' }, tr(a.name, lang)),
          h('b', null, `${fmtValue(a, b)} → ${fmtValue(a, af)}`)))) : null,
        notChosen.length ? h('div', { class: 'db-alt' }, h('span', { class: 'kicker' }, t('run.alternatives')), notChosen.map((c) => tr(c.label, lang)).join(' · ')) : null));
  });

  root.append(header, h('main', { class: 'page debrief' },
    h('section', { class: 'db-hero' },
      h('div', { class: 'kicker' }, h('span', { class: 'blink' }), t('run.kicker')),
      h('h1', null, tr(wg.meta.title, lang)),
      h('div', { class: 'db-meta' },
        meta(t('run.started'), fmtDate(run.started, lang)),
        meta(t('run.duration'), fmtDuration(dur)),
        meta(t('lib.decisions'), String((run.decisions || []).length)),
        meta(t('run.status'), run.finished ? t('run.finished') : t('run.inProgress')))),
    attrs.length ? h('section', { class: 'db-section' },
      h('h2', null, t('run.finalStatus')),
      h('div', { class: 'db-assess', style: { '--c': SEVERITIES[worst]?.color || '#888' } },
        h('div', { class: 'db-sevbar' }, order.filter((k) => counts[k]).map((k) => h('i', { style: { flex: String(counts[k]), background: SEVERITIES[k].color }, title: `${tr(SEVERITIES[k].label, lang)}: ${counts[k]}` }))),
        h('p', null, t('run.assessment', { critical: (counts.critical || 0) + (counts.bad || 0), total: attrs.length }))),
      chart('cards', Math.max(2.2, Math.min(5, attrs.length * 0.9)), 'cards')) : null,
    attrs.length ? h('section', { class: 'db-grid' },
      h('div', { class: 'db-section' }, h('h2', null, t('run.profile')), chart('radar', 1.25)),
      h('div', { class: 'db-section' }, h('h2', null, t('run.development')), chart('timeline', 1.25))) : null,
    h('section', { class: 'db-section' },
      h('h2', null, t('run.decisionLog')),
      decisions.length ? decisions : h('p', { class: 'muted' }, t('chart.noDecisions'))),
    h('p', { class: 'db-foot muted' }, `${t('run.runId')}: ${run.runId}`)));

  return { destroy() {} };
}

function meta(label, value) {
  return h('div', { class: 'db-meta-item' }, h('small', null, label), h('b', null, value));
}
