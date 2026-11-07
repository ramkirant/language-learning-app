// Admin -> Languages: add / rename / delete languages (French is created automatically).
import * as store from '../storage.js';
import * as sync from '../sync.js';
import { esc } from '../util.js';
import { toast } from '../ui.js';

const PRESETS = [
  ['Spanish', 'es-ES', '🇪🇸'], ['German', 'de-DE', '🇩🇪'], ['Italian', 'it-IT', '🇮🇹'],
  ['Portuguese', 'pt-PT', '🇵🇹'], ['Dutch', 'nl-NL', '🇳🇱'], ['Hindi', 'hi-IN', '🇮🇳'],
  ['Tamil', 'ta-IN', '🇮🇳'], ['Japanese', 'ja-JP', '🇯🇵'], ['Korean', 'ko-KR', '🇰🇷'],
  ['Chinese (Mandarin)', 'zh-CN', '🇨🇳'], ['Arabic', 'ar-SA', '🇸🇦'], ['Russian', 'ru-RU', '🇷🇺'],
  ['French', 'fr-FR', '🇫🇷'],
];

const fieldsOf = (f) => ({
  name: f.elements.name.value.trim(), speechCode: f.elements.speechCode.value.trim(),
  flag: f.elements.flag.value.trim(), nativeName: f.elements.nativeName.value.trim() || 'English',
});

const form = (l = {}) => `
  <label>Language name<input type="text" name="name" required value="${esc(l.name ?? '')}" placeholder="e.g. Spanish"></label>
  <label>Speech code (for read-aloud)<input type="text" name="speechCode" value="${esc(l.speechCode ?? '')}" placeholder="es-ES"></label>
  <label>Flag / emoji (optional)<input type="text" name="flag" value="${esc(l.flag ?? '')}"></label>
  <label>Your native language<input type="text" name="nativeName" value="${esc(l.nativeName ?? 'English')}"></label>`;

export function mount(root) {
  let editId = null;

  function draw() {
    const langs = store.languages();
    root.innerHTML = `
      <section class="tile"><h2>Languages</h2>
        ${langs.map((l) => editId === l.id ? `
          <form class="list-item" style="display:block" data-save="${esc(l.id)}">${form(l)}
            <div class="btns"><button class="btn primary" type="submit">Save</button>
              <button class="btn" type="button" data-cancel="1">Cancel</button></div></form>` : `
          <div class="list-item"><div class="main"><b>${esc(l.flag)} ${esc(l.name)}</b>
            <span class="muted small">${store.itemsOf(l.id).length} items \u00B7 speech ${esc(l.speechCode || 'none')} \u00B7 native ${esc(l.nativeName)}</span></div>
            <button class="btn small" data-edit="${esc(l.id)}">Edit</button>
            <button class="btn small danger" data-del="${esc(l.id)}">Delete</button></div>`).join('')}
      </section>
      <section class="tile"><h2>Add a language</h2>
        <form id="addForm" autocomplete="off">
          <label>Start from a preset<select id="preset"><option value="">Custom...</option>${PRESETS.map((p, i) =>
            `<option value="${i}">${p[2]} ${p[0]}</option>`).join('')}</select></label>
          ${form()}
          <div class="btns"><button class="btn primary" type="submit">Add language</button></div>
        </form></section>`;
    wire();
  }

  function wire() {
    const add = root.querySelector('#addForm');
    root.querySelector('#preset').addEventListener('change', (e) => {
      const p = PRESETS[e.target.value];
      if (!p) return;
      add.elements.name.value = p[0]; add.elements.speechCode.value = p[1]; add.elements.flag.value = p[2];
    });
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = fieldsOf(add);
      if (store.languages().some((l) => l.name.toLowerCase() === f.name.toLowerCase())) { toast('That language already exists', 'error'); return; }
      const lang = store.saveLanguage(f);
      store.setActiveLanguage(lang.id);
      sync.requestSync('edit');
      toast(`${lang.name} added - switch to it from the header`, 'success');
      draw();
    });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) { editId = b.dataset.edit; draw(); }
    else if (b.dataset.cancel) { editId = null; draw(); }
    else if (b.dataset.del) {
      const l = store.getLanguage(b.dataset.del);
      if (!confirm(`Delete ${l.name}? This removes its ${store.itemsOf(l.id).length} items and your progress on them.`)) return;
      try { store.deleteLanguage(l.id); sync.requestSync('edit'); draw(); } catch (err) { toast(err.message, 'error'); }
    }
  });
  root.addEventListener('submit', (e) => {
    if (!e.target.dataset.save) return;
    e.preventDefault();
    store.saveLanguage({ id: e.target.dataset.save, ...fieldsOf(e.target) });
    editId = null;
    sync.requestSync('edit');
    toast('Saved', 'success');
    draw();
  });

  draw();
  return null;
}
