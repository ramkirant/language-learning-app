// Admin -> Deck: add / edit / delete items, rename categories, quick-add, CSV import / export.
import * as store from '../storage.js';
import * as sync from '../sync.js';
import { parseCsv, toCsv } from '../csv.js';
import { STARTER_FRENCH } from '../starter.js';
import { esc } from '../util.js';
import { toast, download, readFile } from '../ui.js';

// Read the four item fields from a form (form.elements avoids clashes with built-ins like form.target).
const fields = (f) => ({
  category: f.elements.category.value, target: f.elements.target.value,
  native: f.elements.native.value, pron: f.elements.pron.value,
});

export function mount(root) {
  const lang = store.activeLanguage();
  let query = '';
  let editId = null;
  let renaming = null;
  let lastCategory = '';
  const changed = () => { sync.requestSync('edit'); refresh(); };

  function summary(res) {
    return `Added ${res.added}, updated ${res.updated}, unchanged ${res.skipped}` + (res.removed ? `, removed ${res.removed}` : '');
  }

  function draw() {
    root.innerHTML = `
      <section class="tile"><h2>Add to ${esc(lang.flag)} ${esc(lang.name)}</h2>
        <form id="addForm" autocomplete="off">
          <label>Category<input type="text" name="category" list="cats" required placeholder="e.g. General Salutations" value="${esc(lastCategory)}"></label>
          <datalist id="cats"></datalist>
          <label>${esc(lang.name)}<input type="text" name="target" required></label>
          <label>${esc(lang.nativeName)}<input type="text" name="native" required></label>
          <label>Pronunciation (optional)<input type="text" name="pron"></label>
          <div class="btns"><button class="btn primary" type="submit">Save &amp; add another</button></div>
        </form></section>
      <section class="tile">
        <details><summary>Quick add (paste several lines)</summary>
          <p class="muted small">One per line: <code>category ~|~ ${esc(lang.name)} ~|~ ${esc(lang.nativeName)} ~|~ pronunciation</code></p>
          <textarea id="bulk" rows="5" placeholder="General Salutations~|~Bonjour~|~Hello~|~bon-ZHOOR"></textarea>
          <div class="btns"><button class="btn" id="bulkPreview" type="button">Preview</button>
            <button class="btn primary" id="bulkAdd" type="button">Add lines</button></div>
          <div id="bulkInfo" class="small"></div></details>
        <details><summary>Import / export CSV</summary>
          <label>CSV file (separator ~|~)<input type="file" id="csvFile" accept=".csv,.txt,text/plain,text/csv"></label>
          <label><select id="csvMode"><option value="merge">Merge: add new, update matching</option>
            <option value="replace">Replace: make the deck match the file</option></select></label>
          <div class="btns"><button class="btn" id="csvImport" type="button">Import</button>
            <button class="btn" id="csvExport" type="button">Export CSV</button></div></details>
        ${lang.speechCode.startsWith('fr') ? '<div class="btns"><button class="btn" id="starter" type="button">Load starter French phrases</button></div>' : ''}
      </section>
      <section class="tile"><h2 id="count"></h2>
        <input type="search" id="q" placeholder="Search..." value="${esc(query)}"><div id="list"></div></section>`;
    wire();
    refresh();
  }

  function refresh() {
    const items = store.itemsOf(lang.id);
    root.querySelector('#cats').innerHTML = store.categories(lang.id).map((c) => `<option value="${esc(c)}">`).join('');
    root.querySelector('#count').textContent = `Items (${items.length})`;
    const q = query.trim().toLowerCase();
    const shown = q ? items.filter((i) => `${i.category} ${i.target} ${i.native}`.toLowerCase().includes(q)) : items;
    const groups = new Map();
    for (const it of shown) groups.set(it.category, [...(groups.get(it.category) ?? []), it]);
    root.querySelector('#list').innerHTML = shown.length ? [...groups].map(([cat, list]) => `
      ${cat === renaming ? `<form class="cat-head" data-rename-form="${esc(cat)}">
        <input type="text" name="name" value="${esc(cat)}" required style="margin-right:.4rem">
        <button class="btn small primary" type="submit">Save</button>
        <button class="btn small" type="button" data-cancel-rename="1" style="margin-left:.3rem">Cancel</button></form>` :
      `<div class="cat-head"><span>${esc(cat)} (${list.length})</span>
        <button class="btn small" data-rename="${esc(cat)}">Rename</button></div>`}
      ${list.map(rowHtml).join('')}`).join('') : '<p class="empty">Nothing here yet.</p>';
  }

  function rowHtml(it) {
    if (it.id !== editId) {
      return `<div class="list-item"><div class="main"><b>${esc(it.target)}</b><span>${esc(it.native)}</span>
        <span class="muted small">${esc(it.pron)}</span></div>
        <button class="btn small" data-edit="${it.id}">Edit</button>
        <button class="btn small danger" data-del="${it.id}">Delete</button></div>`;
    }
    return `<form class="list-item" data-save="${it.id}" style="display:block">
      <label>Category<input type="text" name="category" value="${esc(it.category)}" required></label>
      <label>${esc(lang.name)}<input type="text" name="target" value="${esc(it.target)}" required></label>
      <label>${esc(lang.nativeName)}<input type="text" name="native" value="${esc(it.native)}" required></label>
      <label>Pronunciation<input type="text" name="pron" value="${esc(it.pron)}"></label>
      <div class="btns"><button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" data-cancel="1">Cancel</button></div></form>`;
  }

  function wire() {
    const $ = (id) => root.querySelector(`#${id}`);

    $('addForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      store.addItem(lang.id, fields(f));
      lastCategory = f.elements.category.value;
      for (const n of ['target', 'native', 'pron']) f.elements[n].value = '';
      f.elements.target.focus();
      toast('Saved', 'success');
      changed();
    });

    $('q').addEventListener('input', (e) => { query = e.target.value; refresh(); });

    const parseBulk = () => parseCsv($('bulk').value);
    $('bulkPreview').addEventListener('click', () => {
      const { rows, errors } = parseBulk();
      $('bulkInfo').innerHTML = `<p>${rows.length} valid line(s).</p>` + errors.map((er) =>
        `<p class="err-text">Line ${er.line}: ${esc(er.reason)}</p>`).join('');
    });
    $('bulkAdd').addEventListener('click', () => {
      const { rows, errors } = parseBulk();
      if (!rows.length) { toast('Nothing valid to add', 'error'); return; }
      const res = store.importRows(lang.id, rows, 'merge');
      $('bulk').value = '';
      $('bulkInfo').innerHTML = errors.map((er) => `<p class="err-text">Line ${er.line} skipped: ${esc(er.reason)}</p>`).join('');
      toast(summary(res), 'success');
      changed();
    });

    $('csvExport').addEventListener('click', () => {
      const items = store.itemsOf(lang.id);
      if (!items.length) { toast('The deck is empty', 'error'); return; }
      download(`${lang.name.toLowerCase().replace(/\W+/g, '-')}.csv`, toCsv(items), 'text/csv');
    });
    $('csvImport').addEventListener('click', async () => {
      const file = $('csvFile').files[0];
      if (!file) { toast('Choose a CSV file first', 'error'); return; }
      const mode = $('csvMode').value;
      const { rows, errors } = parseCsv(await readFile(file));
      if (!rows.length) { toast('No valid rows found in that file', 'error'); return; }
      if (mode === 'replace' && !confirm(`Replace the ${lang.name} deck with ${rows.length} rows from the file? Items not in the file will be removed.`)) return;
      const res = store.importRows(lang.id, rows, mode);
      toast(`${summary(res)}${errors.length ? `; ${errors.length} bad line(s) skipped` : ''}`, 'success');
      $('csvFile').value = '';
      changed();
    });
    $('starter')?.addEventListener('click', () => {
      toast(summary(store.importRows(lang.id, STARTER_FRENCH, 'merge')), 'success');
      changed();
    });

    root.querySelector('#list').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.edit) { editId = b.dataset.edit; refresh(); }
      else if (b.dataset.cancel) { editId = null; refresh(); }
      else if (b.dataset.del) {
        const it = store.getItem(b.dataset.del);
        if (confirm(`Delete "${it.target}"? Your progress on it will no longer count.`)) { store.deleteItem(it.id); changed(); }
      } else if (b.dataset.rename) { renaming = b.dataset.rename; refresh(); }
      else if (b.dataset.cancelRename) { renaming = null; refresh(); }
    });
    root.querySelector('#list').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.dataset.renameForm) {
        store.renameCategory(lang.id, f.dataset.renameForm, f.elements.name.value);
        renaming = null;
        toast('Category renamed', 'success');
        changed();
        return;
      }
      store.updateItem(f.dataset.save, fields(f));
      editId = null;
      toast('Updated', 'success');
      changed();
    });
  }

  draw();
  return null;
}
