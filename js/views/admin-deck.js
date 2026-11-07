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
  let catFilter = 'all';
  let editId = null;
  let renaming = null;
  let lastCategory = '';
  const changed = () => { sync.requestSync('edit'); refresh(); };

  function summary(res) {
    return `Added ${res.added}, updated ${res.updated}, unchanged ${res.skipped}` + (res.removed ? `, removed ${res.removed}` : '');
  }

  function draw() {
    root.innerHTML = `
      <section class="tile"><details id="addBox"><summary>Add to ${esc(lang.flag)} ${esc(lang.name)}</summary>
        <form id="addForm" autocomplete="off" style="margin-top:.6rem">
          <label>Category<select name="category" required></select></label>
          <p id="noCats" class="muted small" hidden>No categories yet - open <b>Add category</b> below and create one first.</p>
          <label>${esc(lang.name)}<input type="text" name="target" required></label>
          <label>${esc(lang.nativeName)}<input type="text" name="native" required></label>
          <label>Pronunciation (optional)<input type="text" name="pron"></label>
          <div class="btns"><button class="btn primary" type="submit">Save &amp; add another</button></div>
        </form></details></section>
      <section class="tile">
        <details id="catBox"><summary>Add category</summary>
          <form id="catForm" class="row" autocomplete="off" style="margin-top:.5rem">
            <input type="text" name="name" required placeholder="e.g. Food &amp; Drink" aria-label="New category name">
            <button class="btn primary" type="submit" style="flex:0 0 auto">Add</button>
          </form>
          <div id="catList" class="small" style="margin-top:.6rem"></div></details></section>
      <section class="tile"><details id="toolsBox"><summary>Quick add, import &amp; export</summary>
        <div style="margin-top:.6rem">
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
        </div></details></section>
      <section class="tile"><h2 id="count"></h2>
        <div class="row"><input type="search" id="q" placeholder="Search..." value="${esc(query)}">
          <select id="catFilter" aria-label="Filter by category"></select></div><div id="list"></div></section>`;
    wire();
    refresh();
  }

  // Keeps the item form's dropdown and the category list in step with the deck.
  function renderCategoryUi() {
    const names = store.categoryNames(lang.id);
    const sel = root.querySelector('#addForm').elements.category;
    const want = lastCategory;
    sel.innerHTML = '<option value="" disabled>Select a category</option>' +
      names.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = names.includes(want) ? want : '';
    root.querySelector('#noCats').hidden = names.length > 0;
    const counts = new Map(store.itemsOf(lang.id).map((i) => [i.category, 0]));
    for (const i of store.itemsOf(lang.id)) counts.set(i.category, counts.get(i.category) + 1);
    root.querySelector('#catList').innerHTML = names.length ? names.map((c) => {
      const n = counts.get(c) ?? 0;
      return `<div class="list-item"><div class="main"><b>${esc(c)}</b><span class="muted small">${n} item${n === 1 ? '' : 's'}</span></div>
        ${n === 0 ? `<button class="btn small danger" data-rm-cat="${esc(c)}">Remove</button>` : ''}</div>`;
    }).join('') : '<span class="muted">No categories yet.</span>';
  }

  function refresh() {
    const items = store.itemsOf(lang.id);
    renderCategoryUi();
    const cats = store.categories(lang.id);
    if (catFilter !== 'all' && !cats.includes(catFilter)) catFilter = 'all'; // category was renamed or emptied
    const optionsHtml = ['<option value="all">All categories</option>',
      ...cats.map((c) => `<option value="${esc(c)}" ${c === catFilter ? 'selected' : ''}>${esc(c)}</option>`)].join('');
    const sel = root.querySelector('#catFilter');
    if (sel.dataset.html !== optionsHtml) { sel.innerHTML = optionsHtml; sel.dataset.html = optionsHtml; }
    sel.value = catFilter;
    const q = query.trim().toLowerCase();
    const shown = items.filter((i) => (catFilter === 'all' || i.category === catFilter)
      && (!q || `${i.category} ${i.target} ${i.native}`.toLowerCase().includes(q)));
    root.querySelector('#count').textContent = shown.length === items.length
      ? `Items (${items.length})` : `Items (${shown.length} of ${items.length})`;
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

    $('addForm').elements.category.addEventListener('change', (e) => { lastCategory = e.target.value; });
    $('catForm').addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        lastCategory = store.addCategory(lang.id, e.target.elements.name.value);
      } catch (err) { toast(err.message, 'error'); return; }
      e.target.reset();
      toast(`Category "${lastCategory}" added`, 'success');
      changed();
    });
    $('catList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-rm-cat]');
      if (!b) return;
      try { store.removeEmptyCategory(lang.id, b.dataset.rmCat); } catch (err) { toast(err.message, 'error'); return; }
      changed();
    });

    $('q').addEventListener('input', (e) => { query = e.target.value; refresh(); });
    $('catFilter').addEventListener('change', (e) => { catFilter = e.target.value; refresh(); });

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
        if (catFilter === f.dataset.renameForm) catFilter = f.elements.name.value.trim(); // keep following the renamed category
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
