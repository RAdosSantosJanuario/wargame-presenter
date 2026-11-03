import { t, tr, getLang } from '../i18n.js';
import { h, clear, toast, modal, confirmDialog, downloadJSON, readFile, pickFile, slug, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { newWargame, newAttribute, L } from '../model.js';
import { ATTRIBUTE_TEMPLATES } from '../templates.js';
import { appHeader } from './common.js';
import { biField, field } from './fields.js';

export async function libraryView(root) {
  let list = await api.listWargames();
  const body = h('main', { class: 'page library' });
  root.append(appHeader(), body);

  const refresh = async () => { list = await api.listWargames(); render(); };

  function render() {
    clear(body);
    body.append(
      h('section', { class: 'lib-hero' },
        h('div', { class: 'lib-hero-text' },
          h('div', { class: 'kicker' }, h('span', { class: 'blink' }), t('lib.kicker')),
          h('h1', null, t('lib.title')),
          h('p', null, t('lib.lead'))),
        h('div', { class: 'lib-hero-actions' },
          h('button', { class: 'btn primary lg', onClick: createDialog }, icon('plus'), t('lib.new')),
          h('button', { class: 'btn lg', onClick: importFile }, icon('upload'), t('lib.import')))),
      list.length
        ? h('section', { class: 'lib-grid' }, list.map(card))
        : h('section', { class: 'lib-empty' }, icon('shield'), h('p', null, t('lib.empty'))),
      h('p', { class: 'lib-drop-hint' }, icon('upload'), t('lib.dropHint')));
  }

  function card(w, i) {
    const title = tr(w.meta?.title) || t('lib.untitled');
    const sub = tr(w.meta?.subtitle) || tr(w.meta?.description);
    const stat = (n, label) => h('div', { class: 'stat-mini' }, h('b', null, String(n)), h('span', null, label));
    return h('article', { class: 'wg-card', style: { '--accent': w.settings?.accent || '#ffb000', animationDelay: `${i * 60}ms` } },
      h('div', { class: 'wg-card-top' },
        h('span', { class: 'wg-tag' }, (w.settings?.theme === 'light' ? '◐ ' : '◑ ') + (w.settings?.language || 'de').toUpperCase()),
        h('span', { class: 'wg-updated' }, fmtDate(w.meta?.updated, getLang())),
        h('div', { class: 'wg-tools' },
          h('button', { class: 'icon-btn', title: t('lib.sessions'), onClick: () => sessionsDialog(w) }, icon('history')),
          h('button', { class: 'icon-btn', title: t('lib.export'), onClick: () => exportWargame(w) }, icon('download')),
          h('button', { class: 'icon-btn', title: t('lib.duplicate'), onClick: () => duplicate(w) }, icon('copy')),
          h('button', { class: 'icon-btn danger', title: t('lib.delete'), onClick: () => remove(w) }, icon('trash')))),
      h('h2', null, title),
      sub ? h('p', { class: 'wg-sub' }, sub) : null,
      h('div', { class: 'wg-stats' },
        stat(w.pageCount, t('lib.pages')),
        stat(w.decisionCount, t('lib.decisions')),
        stat(w.attributeCount, t('lib.attributes')),
        stat(w.runCount, t('lib.sessions'))),
      h('div', { class: 'wg-actions' },
        h('a', { class: 'btn primary', href: `#/present/${w.id}` }, icon('play'), t('lib.present')),
        h('a', { class: 'btn', href: `#/edit/${w.id}` }, icon('edit'), t('lib.edit'))));
  }

  async function createDialog() {
    const draft = { title: L('', '') };
    const picked = new Set(['containment', 'operations', 'reputation', 'resources', 'effort']);
    const list = h('div', { class: 'tpl-attr-list' }, ATTRIBUTE_TEMPLATES.map((a) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = picked.has(a.id);
      input.addEventListener('change', () => (input.checked ? picked.add(a.id) : picked.delete(a.id)));
      return h('label', { class: 'tpl-attr' }, input,
        h('span', { class: 'tpl-icon' }, a.icon || ''),
        h('span', null, h('b', null, tr(a.name)), h('small', null, tr(a.description))));
    }));
    const result = await modal({
      title: t('lib.new'),
      wide: true,
      body: h('div', { class: 'form' },
        biField(draft, 'title', { label: t('ed.title'), placeholder: t('lib.titlePlaceholder') }),
        field(t('lib.startAttrs'), list, t('lib.startAttrsHint'))),
      actions: [
        { label: t('btn.cancel'), ghost: true, value: null },
        { label: t('lib.create'), primary: true, value: 'ok' },
      ],
    });
    if (result !== 'ok') return;
    const title = { en: draft.title.en || draft.title.de || t('lib.untitled', null, 'en'), de: draft.title.de || draft.title.en || t('lib.untitled', null, 'de') };
    const attrs = ATTRIBUTE_TEMPLATES.filter((a) => picked.has(a.id)).map((a) => newAttribute(a));
    const created = await api.createWargame(newWargame(title, attrs));
    location.hash = `#/edit/${created.id}`;
  }

  async function importFile() {
    const file = await pickFile('.json,application/json');
    if (file) await importFromFile(file);
  }

  async function importFromFile(file) {
    try {
      const data = JSON.parse(await readFile(file));
      const created = await api.importWargame(data);
      toast(t('lib.imported', { title: tr(created.meta?.title) || file.name }), 'ok');
      await refresh();
    } catch (err) {
      toast(`${t('lib.importFailed')}: ${err.message}`, 'error', 5000);
    }
  }

  async function exportWargame(w) {
    try {
      const data = await api.exportWargame(w.id);
      downloadJSON(`${slug(tr(w.meta?.title, 'en') || tr(w.meta?.title)) || 'wargame'}.wargame.json`, data);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function duplicate(w) {
    await api.duplicateWargame(w.id);
    toast(t('lib.duplicated'), 'ok');
    await refresh();
  }

  async function remove(w) {
    const ok = await confirmDialog(t('lib.deleteTitle'), t('lib.deleteText', { title: tr(w.meta?.title) }), { okLabel: t('lib.delete'), cancelLabel: t('btn.cancel'), danger: true });
    if (!ok) return;
    await api.deleteWargame(w.id);
    toast(t('lib.deleted'), 'ok');
    await refresh();
  }

  async function sessionsDialog(w) {
    const runs = await api.listRuns(w.id);
    const listEl = h('div', { class: 'run-list' });
    const renderRuns = () => {
      clear(listEl);
      if (!runs.length) { listEl.append(h('p', { class: 'muted' }, t('lib.noSessions'))); return; }
      for (const r of runs) {
        listEl.append(h('div', { class: 'run-row' },
          h('span', { class: ['run-state', r.finished ? 'done' : 'open'] }, r.finished ? t('run.finished') : t('run.inProgress')),
          h('div', { class: 'run-info' },
            h('b', null, fmtDate(r.started, getLang())),
            h('small', null, `${r.decisionCount} ${t('lib.decisions')} · ${t('run.updated')} ${fmtDate(r.updated, getLang())}`)),
          h('a', { class: 'btn sm', href: `#/run/${r.runId}` }, icon('chart'), t('run.debrief')),
          !r.finished ? h('a', { class: 'btn sm', href: `#/present/${w.id}?run=${r.runId}` }, icon('play'), t('run.resume')) : null,
          h('button', {
            class: 'icon-btn danger', title: t('lib.delete'),
            onClick: async () => {
              if (!(await confirmDialog(t('run.deleteTitle'), t('run.deleteText'), { okLabel: t('lib.delete'), cancelLabel: t('btn.cancel'), danger: true }))) return;
              await api.deleteRun(r.runId);
              runs.splice(runs.indexOf(r), 1);
              renderRuns();
              refresh();
            },
          }, icon('trash'))));
      }
    };
    renderRuns();
    await modal({ title: `${t('lib.sessions')} · ${tr(w.meta?.title)}`, wide: true, body: listEl });
  }

  // drag & drop import
  const onDragOver = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); body.classList.add('dropping'); } };
  const onDragLeave = (e) => { if (e.target === body || !body.contains(e.relatedTarget)) body.classList.remove('dropping'); };
  const onDrop = async (e) => {
    e.preventDefault();
    body.classList.remove('dropping');
    for (const file of e.dataTransfer.files) if (/\.json$/i.test(file.name)) await importFromFile(file);
  };
  body.addEventListener('dragover', onDragOver);
  body.addEventListener('dragleave', onDragLeave);
  body.addEventListener('drop', onDrop);

  render();
  return { destroy() {} };
}
