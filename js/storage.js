// Local-first data store (localStorage). Everything the app shows comes from here; sync.js
// copies changes to/from Firestore in the background. Records carry `updatedAt` for merging.
import { uid, slugify } from './util.js';
import { mergeMaps } from './merge.js';

const KEY = 'lla:v1';
const DEFAULT_LANGUAGE = {
  id: 'fr', name: 'French', speechCode: 'fr-FR', flag: '\u{1F1EB}\u{1F1F7}', nativeName: 'English',
  updatedAt: 0, deleted: false,
};

let state = null;
const subs = new Set();
export let persistFailed = false;

const fresh = () => ({
  version: 1,
  meta: { deviceId: uid(), session: null, sync: {}, lastBackupAt: 0, answered: 0 },
  languages: { fr: { ...DEFAULT_LANGUAGE } },
  items: {},
  progress: {},   // { [owner]: { [langId]: { [itemId_dir]: record } } }
  settings: {},   // { [owner]: { activeLanguageId, muted, perLanguage, updatedAt } }
  dirty: { languages: {}, items: {}, progress: {}, settings: {} },
});

export function init() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : fresh();
  } catch {
    state = fresh();
  }
  const base = fresh();
  state.meta = { ...base.meta, ...state.meta };
  state.dirty = { ...base.dirty, ...state.dirty };
  for (const k of ['languages', 'items', 'progress', 'settings']) state[k] ??= {};
  if (!Object.values(state.languages).some((l) => !l.deleted)) {
    state.languages.fr = { ...DEFAULT_LANGUAGE, updatedAt: state.languages.fr?.updatedAt ?? 0 };
  }
  return state;
}

export const getState = () => state;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (evt) => subs.forEach((f) => f(evt));

export function save(evt = 'change') {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    persistFailed = false;
  } catch {
    persistFailed = true;
  }
  emit(evt);
}

const stamp = (rec) => { rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1); return rec; };

// ---- session / owner ------------------------------------------------------------------
export const getSession = () => state.meta.session;
export const owner = () => state.meta.session?.uid ?? 'local';
export const isSignedIn = () => !!state.meta.session;
// Without an account the app is a private local copy, so admin tools are available.
export const isAdmin = () => !state.meta.session || state.meta.session.role === 'admin';

export function setSession(session) {
  state.meta.session = session;
  if (session) adoptLocalData(session.uid);
  save();
}

// Progress made before signing in is merged into the account (newer wins) and queued for upload.
function adoptLocalData(uidKey) {
  const local = state.progress.local;
  if (local) {
    state.progress[uidKey] ??= {};
    for (const [langId, map] of Object.entries(local)) {
      const target = (state.progress[uidKey][langId] ??= {});
      const { merged, pulled } = mergeMaps(target, map);
      for (const key of Object.keys(map)) {
        if (pulled.includes(key)) state.dirty.progress[`${uidKey}|${langId}|${key}`] = true;
      }
      state.progress[uidKey][langId] = merged;
    }
    delete state.progress.local;
  }
  const ls = state.settings.local;
  if (ls) {
    if (!state.settings[uidKey] || ls.updatedAt > state.settings[uidKey].updatedAt) {
      state.settings[uidKey] = ls;
      state.dirty.settings[uidKey] = true;
    }
    delete state.settings.local;
  }
}

export const getLastPull = (uidKey) => state.meta.sync[uidKey]?.lastPullAt ?? 0;
export function setLastPull(uidKey, ms) {
  state.meta.sync[uidKey] = { ...state.meta.sync[uidKey], lastPullAt: ms };
  save('quiet');
}

// ---- settings -------------------------------------------------------------------------
export function settings() {
  const o = owner();
  state.settings[o] ??= { activeLanguageId: null, muted: false, perLanguage: {}, updatedAt: 0 };
  return state.settings[o];
}

function touchSettings() {
  stamp(settings());
  state.dirty.settings[owner()] = true;
  save();
}

export function langSettings(langId) {
  const s = settings().perLanguage[langId] ?? {};
  return { category: 'all', direction: 't2n', ...s };
}
export function setLangSettings(langId, patch) {
  const s = settings();
  s.perLanguage[langId] = { ...langSettings(langId), ...patch };
  touchSettings();
}
export const isMuted = () => !!settings().muted;
export function setMuted(m) { settings().muted = !!m; touchSettings(); }

// ---- languages ------------------------------------------------------------------------
export const languages = () => Object.values(state.languages)
  .filter((l) => !l.deleted).sort((a, b) => a.name.localeCompare(b.name));
export const getLanguage = (id) => state.languages[id];

export function activeLanguage() {
  const list = languages();
  return list.find((l) => l.id === settings().activeLanguageId) ?? list[0] ?? null;
}
export function setActiveLanguage(id) { settings().activeLanguageId = id; touchSettings(); }

export function saveLanguage(lang) {
  const id = lang.id ?? `${slugify(lang.name)}-${uid().slice(-4)}`;
  const rec = stamp({
    nativeName: 'English', flag: '', speechCode: '', ...state.languages[id], ...lang, id, deleted: false,
  });
  state.languages[id] = rec;
  state.dirty.languages[id] = true;
  save();
  return rec;
}

export function deleteLanguage(id) {
  if (languages().length <= 1) throw new Error('You need at least one language.');
  const lang = state.languages[id];
  if (!lang) return;
  stamp(lang).deleted = true;
  state.dirty.languages[id] = true;
  for (const it of Object.values(state.items)) {
    if (it.languageId === id && !it.deleted) { it.deleted = true; stamp(it); state.dirty.items[it.id] = true; }
  }
  save();
}

// ---- items ----------------------------------------------------------------------------
const norm = (s) => String(s ?? '').trim().toLowerCase();
const itemKey = (target, native) => `${norm(target)}|${norm(native)}`;

export const itemsOf = (langId) => Object.values(state.items)
  .filter((i) => i.languageId === langId && !i.deleted)
  .sort((a, b) => a.category.localeCompare(b.category) || a.target.localeCompare(b.target));
export const getItem = (id) => state.items[id];
export const categories = (langId) => [...new Set(itemsOf(langId).map((i) => i.category))]
  .sort((a, b) => a.localeCompare(b));

function putItem(rec) {
  state.items[rec.id] = stamp(rec);
  state.dirty.items[rec.id] = true;
}

function newItem(langId, { category, target, native, pron = '' }) {
  return {
    id: uid(), languageId: langId, category: (category ?? '').trim() || 'General',
    target: target.trim(), native: native.trim(), pron: (pron ?? '').trim(), updatedAt: 0, deleted: false,
  };
}

export function addItem(langId, fields) {
  const rec = newItem(langId, fields);
  putItem(rec);
  save();
  return rec;
}

export function updateItem(id, patch) {
  const it = state.items[id];
  if (!it) return;
  for (const k of ['category', 'target', 'native', 'pron']) if (k in patch) it[k] = String(patch[k]).trim();
  putItem(it);
  save();
}

export function deleteItem(id) {
  const it = state.items[id];
  if (!it) return;
  it.deleted = true;
  putItem(it);
  save();
}

export function renameCategory(langId, from, to) {
  const name = to.trim();
  if (!name) return 0;
  let n = 0;
  for (const it of itemsOf(langId)) if (it.category === from) { it.category = name; putItem(it); n++; }
  save();
  return n;
}

// mode 'merge': add new rows, update matching ones. 'replace': also delete items not in `rows`.
// Matching rows keep their id, so progress survives a re-import.
export function importRows(langId, rows, mode = 'merge') {
  const existing = new Map(itemsOf(langId).map((i) => [itemKey(i.target, i.native), i]));
  const seen = new Set();
  const res = { added: 0, updated: 0, skipped: 0, removed: 0 };
  for (const row of rows) {
    const key = itemKey(row.target, row.native);
    if (seen.has(key)) { res.skipped++; continue; }
    seen.add(key);
    const cur = existing.get(key);
    if (!cur) { putItem(newItem(langId, row)); res.added++; continue; }
    const category = (row.category ?? '').trim() || 'General';
    const pron = (row.pron ?? '').trim() || cur.pron;
    if (cur.category !== category || cur.pron !== pron) {
      cur.category = category; cur.pron = pron; putItem(cur); res.updated++;
    } else res.skipped++;
  }
  if (mode === 'replace') {
    for (const [key, it] of existing) if (!seen.has(key)) { it.deleted = true; putItem(it); res.removed++; }
  }
  save();
  return res;
}

// ---- progress -------------------------------------------------------------------------
export const progressMap = (langId) => state.progress[owner()]?.[langId] ?? {};

export function saveProgress(langId, key, rec) {
  const o = owner();
  ((state.progress[o] ??= {})[langId] ??= {})[key] = stamp(rec);
  state.dirty.progress[`${o}|${langId}|${key}`] = true;
  state.meta.answered += 1;
  save();
}
export const answeredCount = () => state.meta.answered;

// ---- applying remote data (called by sync.js) -----------------------------------------
function applyMap(local, remote, full, bucket, keyFn) {
  const { merged, pulled, toPush } = mergeMaps(local, remote, { full });
  for (const k of toPush) bucket[keyFn(k)] = true;
  return { merged, changed: pulled.length };
}

const toMap = (list, keyOf) => Object.fromEntries(list.map((r) => [keyOf(r), r]));

export function applyRemote(kind, records, { full = false, langId, uidKey } = {}) {
  let changed = 0;
  if (kind === 'languages') {
    const r = applyMap(state.languages, toMap(records, (x) => x.id), full, state.dirty.languages, (k) => k);
    state.languages = r.merged; changed = r.changed;
  } else if (kind === 'items') {
    const local = Object.fromEntries(Object.entries(state.items).filter(([, i]) => i.languageId === langId));
    const r = applyMap(local, toMap(records, (x) => x.id), full, state.dirty.items, (k) => k);
    Object.assign(state.items, r.merged); changed = r.changed;
  } else if (kind === 'progress') {
    const local = ((state.progress[uidKey] ??= {})[langId] ??= {});
    const r = applyMap(local, toMap(records, (x) => x.id), full, state.dirty.progress, (k) => `${uidKey}|${langId}|${k}`);
    state.progress[uidKey][langId] = r.merged; changed = r.changed;
  } else if (kind === 'settings') {
    const remote = records[0];
    const local = state.settings[uidKey];
    if (remote && (!local || remote.updatedAt > local.updatedAt)) { state.settings[uidKey] = remote; changed = 1; }
    else if (local && (!remote || local.updatedAt > remote.updatedAt)) state.dirty.settings[uidKey] = true;
  }
  save(changed ? 'remote' : 'quiet');
  return changed;
}

export const allLanguageIds = () => Object.keys(state.languages);

// ---- pending uploads ------------------------------------------------------------------
const mine = (k, uidKey) => k.startsWith(`${uidKey}|`);

export function pendingCount(uidKey, admin) {
  const d = state.dirty;
  let n = Object.keys(d.progress).filter((k) => mine(k, uidKey)).length + (d.settings[uidKey] ? 1 : 0);
  if (admin) n += Object.keys(d.languages).length + Object.keys(d.items).length;
  return n;
}

// Returns {writes: [{kind, dirtyKey, rec, langId?, key?}], skipped}. Learners cannot write the
// shared deck, so their deck edits are dropped and counted in `skipped`.
export function takeDirty(uidKey, admin) {
  const d = state.dirty;
  const writes = [];
  let skipped = 0;
  if (admin) {
    for (const id of Object.keys(d.languages)) {
      const rec = state.languages[id];
      if (!rec) { delete d.languages[id]; continue; }
      if (rec.updatedAt === 0) stamp(rec); // the built-in default language
      writes.push({ kind: 'languages', dirtyKey: id, rec: { ...rec } });
    }
    for (const id of Object.keys(d.items)) {
      const rec = state.items[id];
      if (!rec) { delete d.items[id]; continue; }
      writes.push({ kind: 'items', dirtyKey: id, rec: { ...rec }, langId: rec.languageId });
    }
  } else {
    skipped = Object.keys(d.languages).length + Object.keys(d.items).length;
    d.languages = {}; d.items = {};
  }
  for (const dirtyKey of Object.keys(d.progress).filter((k) => mine(k, uidKey))) {
    const [o, langId, key] = dirtyKey.split('|');
    const rec = state.progress[o]?.[langId]?.[key];
    if (!rec) { delete d.progress[dirtyKey]; continue; }
    writes.push({ kind: 'progress', dirtyKey, rec: { ...rec }, langId, key });
  }
  if (d.settings[uidKey] && state.settings[uidKey]) {
    writes.push({ kind: 'settings', dirtyKey: uidKey, rec: { ...state.settings[uidKey] } });
  }
  if (skipped) save('quiet');
  return { writes, skipped };
}

// Only clear the flag if the record has not been edited again since it was uploaded.
export function clearDirty(write) {
  const { kind, dirtyKey, rec } = write;
  const now = kind === 'languages' ? state.languages[dirtyKey]
    : kind === 'items' ? state.items[dirtyKey]
    : kind === 'settings' ? state.settings[dirtyKey]
    : state.progress[dirtyKey.split('|')[0]]?.[write.langId]?.[write.key];
  if (!now || now.updatedAt === rec.updatedAt) delete state.dirty[kind][dirtyKey];
}
export const flushDirtyClears = () => save('quiet');

// ---- backup ---------------------------------------------------------------------------
export function exportBackup() {
  state.meta.lastBackupAt = Date.now();
  save('quiet');
  return JSON.stringify({
    app: 'lingo', version: 1, exportedAt: Date.now(),
    languages: state.languages, items: state.items, progress: state.progress, settings: state.settings,
  }, null, 1);
}
export const lastBackupAt = () => state.meta.lastBackupAt;

export function importBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (data?.app !== 'lingo' || typeof data.languages !== 'object' || typeof data.items !== 'object') {
    throw new Error('That does not look like a Lingo backup file.');
  }
  const o = owner();
  const L = mergeMaps(state.languages, data.languages);
  state.languages = L.merged; L.pulled.forEach((k) => { state.dirty.languages[k] = true; });
  const I = mergeMaps(state.items, data.items);
  state.items = I.merged; I.pulled.forEach((k) => { state.dirty.items[k] = true; });
  let changed = L.pulled.length + I.pulled.length;
  for (const byLang of Object.values(data.progress ?? {})) {
    for (const [langId, map] of Object.entries(byLang)) {
      const local = ((state.progress[o] ??= {})[langId] ??= {});
      const P = mergeMaps(local, map);
      state.progress[o][langId] = P.merged;
      P.pulled.forEach((k) => { state.dirty.progress[`${o}|${langId}|${k}`] = true; });
      changed += P.pulled.length;
    }
  }
  save('remote');
  return changed;
}
