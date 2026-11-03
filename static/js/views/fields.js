// Form building blocks for the editor. Inputs write straight into the model
// object and call onChange, so the inspector never has to re-render while typing.
import { t } from '../i18n.js';
import { h } from '../util.js';

export function field(label, control, hint) {
  return h('div', { class: 'field' },
    label ? h('label', { class: 'field-label' }, label) : null,
    control,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

export function row(...children) {
  return h('div', { class: 'field-row' }, children);
}

export function section(title, children, { open = true, icon: ico = null, extra = null } = {}) {
  const det = h('details', { class: 'section', open: open ? true : null },
    h('summary', null, ico, h('span', null, title), extra),
    h('div', { class: 'section-body' }, children));
  return det;
}

export function biField(obj, key, { label, multiline = false, rows = 3, onChange, placeholder = '', hint = null } = {}) {
  if (!obj[key] || typeof obj[key] !== 'object') {
    obj[key] = { en: typeof obj[key] === 'string' ? obj[key] : '', de: '' };
  }
  const value = obj[key];
  const rowsEls = {};
  const update = () => {
    const en = String(value.en || '').trim();
    const de = String(value.de || '').trim();
    rowsEls.en.classList.toggle('missing', !en && !!de);
    rowsEls.de.classList.toggle('missing', !de && !!en);
  };
  const wrap = h('div', { class: 'field bi' }, label ? h('label', { class: 'field-label' }, label) : null);
  for (const lang of ['en', 'de']) {
    const input = multiline
      ? h('textarea', { rows: String(rows), placeholder, spellcheck: 'true', lang })
      : h('input', { type: 'text', placeholder, spellcheck: 'true', lang });
    input.value = value[lang] || '';
    input.addEventListener('input', () => {
      value[lang] = input.value;
      update();
      onChange?.();
    });
    rowsEls[lang] = h('div', { class: 'bi-row' }, h('span', { class: 'bi-tag', title: t(`lang.${lang}`) }, lang.toUpperCase()), input);
    wrap.append(rowsEls[lang]);
  }
  if (hint) wrap.append(h('div', { class: 'hint' }, hint));
  update();
  return wrap;
}

export function textInput(value, onInput, { placeholder = '', type = 'text', cls = '' } = {}) {
  const input = h('input', { type, placeholder, class: cls });
  input.value = value ?? '';
  input.addEventListener('input', () => onInput(input.value, input));
  return input;
}

export function numInput(value, onInput, { min = null, max = null, step = 'any', placeholder = '', cls = '', allowEmpty = false } = {}) {
  const input = h('input', { type: 'number', step: String(step), placeholder, class: ['num', cls] });
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  input.value = value == null || value === '' ? '' : String(value);
  input.addEventListener('input', () => {
    if (input.value === '') { if (allowEmpty) onInput(null, input); return; }
    const v = Number(input.value);
    if (Number.isFinite(v)) onInput(v, input);
  });
  return input;
}

export function selectInput(options, value, onChange, { cls = '' } = {}) {
  const sel = h('select', { class: cls }, options.map(([v, label]) => h('option', { value: v }, label)));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onChange(sel.value, sel));
  return sel;
}

export function checkbox(label, checked, onChange, { hint = null } = {}) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return h('label', { class: 'check' }, input, h('span', null, label), hint ? h('small', null, hint) : null);
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const render = (cur) => {
    wrap.replaceChildren(...options.map(([v, label, title]) => h('button', {
      type: 'button',
      class: v === cur ? 'on' : '',
      title: title || null,
      onClick: () => { render(v); onChange(v); },
    }, label)));
  };
  render(value);
  return wrap;
}

export function colorInput(value, onChange, { allowEmpty = true, presets = [] } = {}) {
  const input = h('input', { type: 'color' });
  input.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffb000';
  const wrap = h('div', { class: ['color-input', !value && 'empty'] }, input);
  input.addEventListener('input', () => { wrap.classList.remove('empty'); onChange(input.value); });
  for (const p of presets) {
    wrap.append(h('button', {
      type: 'button', class: 'swatch', title: p, style: { background: p },
      onClick: () => { input.value = p; wrap.classList.remove('empty'); onChange(p); },
    }));
  }
  if (allowEmpty) {
    wrap.append(h('button', {
      type: 'button', class: 'swatch none', title: t('ed.none'),
      onClick: () => { wrap.classList.add('empty'); onChange(''); },
    }, '×'));
  }
  return wrap;
}
