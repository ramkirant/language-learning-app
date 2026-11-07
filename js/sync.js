// Firebase (Spark plan) auth + two-way sync. The Firebase SDK is loaded lazily from the CDN, so
// the app starts and works offline (and with no config at all) even if it cannot be reached.
import { firebaseConfig } from './firebase-config.js';
import * as store from './storage.js';
import { usernameToEmail, emailToUsername, normalizeUsername, USERNAME_RE } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.10.0';
const PULL_OVERLAP_MS = 5 * 60 * 1000; // re-read a little history to tolerate clock skew
const BATCH = 400;

export const configured = !!firebaseConfig;
export const status = { state: configured ? 'idle' : 'disabled', lastSyncAt: 0, error: '', skipped: 0 };
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(patch) { Object.assign(status, patch); listeners.forEach((f) => f(status)); }

class AccountError extends Error {}

let fb = null;
let loading = null;
export async function getFirebase() {
  if (!configured) throw new Error('Cloud sync is not configured yet (see README).');
  if (fb) return fb;
  loading ??= (async () => {
    const [appM, authM, fsM] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appM.initializeApp(firebaseConfig);
    fb = { appM, authM, fsM, app, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
    return fb;
  })();
  try { return await loading; } catch (e) { loading = null; throw e; }
}

export function friendlyError(e) {
  const code = e?.code ?? '';
  if (e instanceof AccountError) return e.message;
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(code)) return 'Wrong user ID or password.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code.includes('network') || code === 'unavailable' || /Failed to fetch|dynamically imported/.test(e?.message ?? '')) {
    return 'Cannot reach the server. Check your internet connection.';
  }
  if (code.includes('email-already-in-use')) return 'That user ID already exists. If it was deactivated, reactivate it in the list.';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (code.includes('requires-recent-login')) return 'Please sign in again and retry.';
  if (code.includes('permission-denied')) return 'Not allowed. Your account may not be active or lacks admin rights.';
  return e?.message || 'Something went wrong.';
}

// ---- auth -----------------------------------------------------------------------------
let establishing = null;

async function establishSession(user) {
  if (establishing?.uid === user.uid) return establishing.promise;
  const promise = (async () => {
    const { fsM, db, authM, auth } = await getFirebase();
    let data = null;
    try {
      const snap = await fsM.getDoc(fsM.doc(db, 'users', user.uid));
      data = snap.exists() ? snap.data() : null;
      if (!data) throw new AccountError('This account has not been set up by an admin yet.');
    } catch (e) {
      if (e instanceof AccountError || e.code === 'permission-denied') {
        await authM.signOut(auth);
        store.setSession(null);
        throw e instanceof AccountError ? e : new AccountError('This account has no access.');
      }
      const cached = store.getSession(); // offline: trust the role cached at the last sign-in
      if (cached?.uid === user.uid) return cached;
      data = { username: emailToUsername(user.email), role: 'learner', active: true };
    }
    if (data.active === false) {
      await authM.signOut(auth);
      store.setSession(null);
      throw new AccountError('This account has been deactivated by an admin.');
    }
    const session = { uid: user.uid, username: data.username, role: data.role === 'admin' ? 'admin' : 'learner' };
    const cur = store.getSession();
    if (cur && cur.uid === session.uid && cur.role === session.role && cur.username === session.username) return cur;
    store.setSession(session);
    return session;
  })();
  establishing = { uid: user.uid, promise };
  try { return await promise; } finally { establishing = null; }
}

export async function signIn(username, password) {
  const name = normalizeUsername(username);
  if (!USERNAME_RE.test(name)) throw new AccountError('Enter your user ID (letters, numbers, . _ -).');
  const { authM, auth } = await getFirebase();
  const cred = await authM.signInWithEmailAndPassword(auth, usernameToEmail(name), password);
  await establishSession(cred.user);
  requestSync('signin', true);
}

export async function signOutUser() {
  if (fb) await fb.authM.signOut(fb.auth);
  store.setSession(null);
  setStatus({ state: 'idle', error: '' });
}

let authListening = false;
let wired = false;
async function onAuth(user) {
  if (!user) {
    if (store.getSession()) store.setSession(null);
    return;
  }
  if (store.getSession()?.uid !== user.uid) {
    try { await establishSession(user); } catch (e) { setStatus({ state: 'error', error: friendlyError(e) }); return; }
  }
  requestSync('auth', true);
}

export async function init() {
  if (!configured) return;
  if (!wired) {
    wired = true;
    window.addEventListener('online', () => { init(); requestSync('online', true); });
    window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  }
  if (authListening) return;
  try {
    const { authM, auth } = await getFirebase();
    authListening = true;
    authM.onAuthStateChanged(auth, onAuth);
  } catch {
    setStatus({ state: 'offline' });
  }
}

// ---- sync -----------------------------------------------------------------------------
let timer = null;
let running = false;
let again = false;

export const lastSyncAt = () => {
  const s = store.getSession();
  return status.lastSyncAt || (s ? store.getLastPull(s.uid) : 0);
};
export function pending() {
  const s = store.getSession();
  return s ? store.pendingCount(s.uid, s.role === 'admin') : 0;
}

export function requestSync(reason = 'auto', immediate = false) {
  if (!configured || !store.getSession()) return;
  clearTimeout(timer);
  timer = setTimeout(run, immediate ? 0 : 1500);
}
export function syncNow() { clearTimeout(timer); return run(); }

async function pull(session) {
  const { fsM, db } = fb;
  const uidKey = session.uid;
  const since = Math.max(0, store.getLastPull(uidKey) - PULL_OVERLAP_MS);
  const full = since === 0;
  const newer = (ref) => fsM.getDocs(fsM.query(ref, fsM.where('updatedAt', '>', since)));
  const withId = (d) => ({ ...d.data(), id: d.id });

  const langs = await newer(fsM.collection(db, 'languages'));
  store.applyRemote('languages', langs.docs.map(withId), { full });
  for (const langId of store.allLanguageIds().filter((id) => !store.getLanguage(id)?.deleted)) {
    const items = await newer(fsM.collection(db, 'languages', langId, 'items'));
    store.applyRemote('items', items.docs.map((d) => ({ ...withId(d), languageId: langId })), { full, langId });
    const prog = await newer(fsM.collection(db, 'users', uidKey, 'languages', langId, 'progress'));
    store.applyRemote('progress', prog.docs.map(withId), { full, langId, uidKey });
  }
  const snap = await fsM.getDoc(fsM.doc(db, 'users', uidKey, 'meta', 'settings'));
  store.applyRemote('settings', snap.exists() ? [snap.data()] : [], { uidKey });
}

async function push(session) {
  const { fsM, db } = fb;
  const uidKey = session.uid;
  const { writes, skipped } = store.takeDirty(uidKey, session.role === 'admin');
  const refFor = (w) => {
    if (w.kind === 'languages') return fsM.doc(db, 'languages', w.rec.id);
    if (w.kind === 'items') return fsM.doc(db, 'languages', w.langId, 'items', w.rec.id);
    if (w.kind === 'progress') return fsM.doc(db, 'users', uidKey, 'languages', w.langId, 'progress', w.key);
    return fsM.doc(db, 'users', uidKey, 'meta', 'settings');
  };
  for (let i = 0; i < writes.length; i += BATCH) {
    const chunk = writes.slice(i, i + BATCH);
    const batch = fsM.writeBatch(db);
    for (const w of chunk) batch.set(refFor(w), JSON.parse(JSON.stringify(w.rec))); // drops undefined
    await batch.commit();
    chunk.forEach((w) => store.clearDirty(w));
    store.flushDirtyClears();
  }
  return { skipped };
}

async function run() {
  const session = store.getSession();
  if (!configured || !session) return;
  if (running) { again = true; return; }
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
  running = true;
  setStatus({ state: 'syncing', error: '' });
  const startedAt = Date.now();
  try {
    await getFirebase();
    if (fb.auth.currentUser) await establishSession(fb.auth.currentUser); // picks up role / active changes
    const live = store.getSession();
    if (!live) { setStatus({ state: 'idle' }); return; }
    await pull(live);
    const { skipped } = await push(live);
    store.setLastPull(live.uid, startedAt);
    setStatus({ state: 'idle', lastSyncAt: Date.now(), skipped, error: '' });
  } catch (e) {
    let error = friendlyError(e);
    if (e?.code === 'permission-denied' && fb?.auth.currentUser) {
      try { await establishSession(fb.auth.currentUser); } catch (a) { error = friendlyError(a); }
    }
    setStatus({ state: 'error', error });
  } finally {
    running = false;
    if (again) { again = false; requestSync('again'); }
  }
}
