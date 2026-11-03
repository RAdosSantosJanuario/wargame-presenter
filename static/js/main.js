// Hash router: #/  #/edit/<id>  #/present/<id>  #/presenter/<runId>  #/run/<runId>
import { t, onLangChange, getLang } from './i18n.js';
import { clear, toast } from './util.js';
import { libraryView } from './views/library.js';
import { editorView } from './views/editor.js';
import { presentView } from './views/present.js';
import { presenterView } from './views/presenter.js';
import { debriefView } from './views/debrief.js';
import { appHeader, errorPage } from './views/common.js';

const app = document.getElementById('app');
let current = null;
let routing = 0;

function parse() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts, query };
}

async function route() {
  const my = ++routing;
  try { current?.destroy?.(); } catch (err) { console.error(err); }
  current = null;
  clear(app);
  document.documentElement.lang = getLang();
  document.title = 'Wargame Presenter';
  const { parts, query } = parse();
  const [view, id] = parts;
  try {
    let v;
    switch (view) {
      case 'edit': v = await editorView(app, id, query); break;
      case 'present': v = await presentView(app, id, query); break;
      case 'presenter': v = await presenterView(app, id, query); break;
      case 'run': v = await debriefView(app, id, query); break;
      default: v = await libraryView(app, query);
    }
    if (my !== routing) { v?.destroy?.(); return; }
    current = v;
  } catch (err) {
    console.error(err);
    if (my !== routing) return;
    clear(app);
    app.append(appHeader());
    errorPage(app, err.message || String(err));
  }
}

window.addEventListener('hashchange', route);
onLangChange(() => {
  document.documentElement.lang = getLang();
  if (current?.onLang) current.onLang();
  else route();
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`${t('err.title')}: ${e.reason?.message || e.reason}`, 'error', 5000);
});
route();
