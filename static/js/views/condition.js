// Editor for a condition {mode: 'all'|'any', rules: [...]}, stored at holder[key].
// Used for conditional pages and for status changes on the network map.
import { t, tr } from '../i18n.js';
import { h, clear } from '../util.js';
import { icon } from '../icons.js';
import { allChoices, OPS } from '../model.js';
import { numInput, selectInput, segmented } from './fields.js';

export function conditionEditor(wg, holder, key, onChange, opts = {}) {
  const {
    heading = t('ed.condition'),
    emptyHint = t('ed.condNone'),
    introHint = t('ed.condShowIf'),
    addLabel = t('ed.addCondition'),
    keepEmpty = false, // keep {rules: []} instead of removing the condition
  } = opts;
  const wrap = h('div', { class: 'cond' });
  const choiceOptions = () => allChoices(wg).map(({ page: pg, choice }) => [choice.id, `${wg.pages.indexOf(pg) + 1}. ${tr(choice.label) || choice.id}`]);
  const newRule = () => (wg.attributes[0]
    ? { type: 'attr', attr: wg.attributes[0].id, op: '<', value: 50 }
    : { type: 'choice', choice: choiceOptions()[0]?.[0] || '', op: 'chosen' });
  const btn = (name, title, onClick) => h('button', { type: 'button', class: 'icon-btn', title, onClick }, icon(name));

  const render = () => {
    clear(wrap);
    const cond = holder[key];
    if (heading) wrap.append(h('div', { class: 'sub-head' }, icon('filter'), h('span', null, heading)));
    if (!cond || !cond.rules?.length) {
      if (emptyHint) wrap.append(h('p', { class: 'hint' }, emptyHint));
      wrap.append(h('button', {
        type: 'button',
        class: 'btn sm',
        onClick: () => {
          holder[key] = { mode: cond?.mode || 'all', rules: [newRule()] };
          render();
          onChange();
        },
      }, icon('plus'), addLabel));
      return;
    }
    if (introHint) wrap.append(h('p', { class: 'hint' }, introHint));
    wrap.append(segmented([['all', t('ed.cond.all')], ['any', t('ed.cond.any')]], cond.mode || 'all', (v) => { cond.mode = v; onChange(); }));
    cond.rules.forEach((r, i) => {
      const typeSel = selectInput([['attr', t('ed.rule.attr')], ['choice', t('ed.rule.choice')]], r.type === 'choice' ? 'choice' : 'attr', (v) => {
        cond.rules[i] = v === 'choice'
          ? { type: 'choice', choice: choiceOptions()[0]?.[0] || '', op: 'chosen' }
          : { type: 'attr', attr: wg.attributes[0]?.id || '', op: '<', value: 50 };
        render();
        onChange();
      });
      const parts = r.type === 'choice'
        ? [selectInput(choiceOptions(), r.choice, (v) => { r.choice = v; onChange(); }, { cls: 'grow' }),
          selectInput([['chosen', t('ed.rule.chosen')], ['notChosen', t('ed.rule.notChosen')]], r.op || 'chosen', (v) => { r.op = v; onChange(); })]
        : [selectInput(wg.attributes.map((a) => [a.id, `${a.icon || ''} ${tr(a.name)}`.trim()]), r.attr, (v) => { r.attr = v; onChange(); }, { cls: 'grow' }),
          selectInput(OPS.map((o) => [o, o]), r.op || '<', (v) => { r.op = v; onChange(); }, { cls: 'op' }),
          numInput(r.value ?? 0, (v) => { r.value = v; onChange(); }, { cls: 'val' })];
      wrap.append(h('div', { class: 'rule' }, typeSel, parts,
        btn('x', t('ed.delete'), () => {
          cond.rules.splice(i, 1);
          if (!cond.rules.length && !keepEmpty) holder[key] = null;
          render();
          onChange();
        })));
    });
    wrap.append(h('button', { type: 'button', class: 'btn sm', onClick: () => { cond.rules.push(newRule()); render(); onChange(); } }, icon('plus'), t('ed.addRule')));
  };
  render();
  return wrap;
}
