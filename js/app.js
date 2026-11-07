// App shell: header (language switcher + sync status), bottom navigation and a tiny hash router.
import * as store from './storage.js';
import * as sync from './sync.js';
import { esc } from './util.js';
import { timeAgo } from './ui.js';
import * as practice from './views/practice.js';
import * as progress from './views/progress.js';
import * as admin from './views/admin.js';
import * as profile from './views/profile.js';

store.init();

const ROUTES = {
  practice: { label: 'Practice', icon: '\u{1F3AF}', view: practice },
  progress: { label: 'Progress', icon: '\u{1F4C8}', view: progress },
  admin: { label: 'Admin', icon: '\u2699\uFE0F', view: admin, adminOnly: true },
  profile: { label: 'Profile', icon: '\u{1F464}', view: profile },
};
const $ = (id) => document.getElementById(id);
let cleanup = null;

function currentRoute() {
  const name = (location.hash.replace(/^#\/?/, '') || 'practice').split('/')[0];
  const r = ROUTES[name];
  if (!r || (r.adminOnly && !store.isAdmin())) return 'practice';
  return name;
}

function syncPill() {
  const s = sync.status;
  if (!sync.configured) return { text: '\u2601\uFE0F Local only', cls: '' };
  if (!store.isSignedIn()) return { text: '\u2601\uFE0F Sign in to sync', cls: '' };
  const n = sync.pending();
  const queued = n ? ` \u00B7 ${n} pending` : '';
  if (s.state === 'syncing') return { text: '\u21BB Syncing\u2026', cls: '' };
  if (s.state === 'offline' || !navigator.onLine) return { text: `\u26A1 Offline${queued}`, cls: '' };
  if (s.state === 'error') return { text: `\u26A0\uFE0F Sync error${queued}`, cls: 'err' };
  return { text: `\u2601\uFE0F Synced ${timeAgo(sync.lastSyncAt())}${queued}`, cls: '' };
}

function updatePill() {
  const el = $('syncPill');
  if (!el) return;
  const pill = syncPill();
  el.textContent = pill.text;
  el.className = `pill ${pill.cls}`;
}

function renderChrome() {
  const langs = store.languages();
  const active = store.activeLanguage();
  const pill = syncPill();
  $('header').innerHTML = `
    <div class="brand">Lingo</div>
    ${langs.length > 1 ? `<select id="langSwitch" aria-label="Language">${langs.map((l) =>
      `<option value="${esc(l.id)}" ${l.id === active?.id ? 'selected' : ''}>${esc(l.flag)} ${esc(l.name)}</option>`).join('')}</select>` : ''}
    <button class="pill ${pill.cls}" id="syncPill">${esc(pill.text)}</button>`;
  const name = currentRoute();
  $('nav').innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => !r.adminOnly || store.isAdmin())
    .map(([k, r]) => `<a href="#/${k}" class="${k === name ? 'active' : ''}"><span>${r.icon}</span>${r.label}</a>`).join('');
  $('langSwitch')?.addEventListener('change', (e) => { store.setActiveLanguage(e.target.value); renderView(); });
  $('syncPill').addEventListener('click', () => {
    if (store.isSignedIn() && sync.configured) sync.syncNow(); else location.hash = '#/profile';
  });
}

function renderView() {
  cleanup?.();
  const name = currentRoute();
  const view = $('view');
  view.innerHTML = '';
  cleanup = ROUTES[name].view.mount(view) ?? null;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => { renderChrome(); renderView(); });
store.subscribe((evt) => {
  if (evt === 'quiet') return;
  if (ROUTES[(location.hash.replace(/^#\/?/, '') || 'practice').split('/')[0]]?.adminOnly && !store.isAdmin()) {
    location.hash = '#/practice';
    return;
  }
  renderChrome();
  if (evt === 'remote' && currentRoute() !== 'practice') renderView();
});
sync.subscribe(updatePill);
setInterval(updatePill, 60000); // keeps "synced 3 min ago" fresh

renderChrome();
renderView();
navigator.storage?.persist?.();
sync.init().then(() => sync.requestSync('open', true));
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
