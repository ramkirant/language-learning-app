// Small pure helpers shared by the app and the unit tests (no DOM access here).

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const round1 = (n) => Math.round(n * 10) / 10;

export const USERNAME_RE = /^[a-z0-9._-]{2,30}$/;
export const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();

// Firebase password auth needs an email, so a user id maps to a made-up address.
// The domain never receives mail; the user never sees it.
export const usernameToEmail = (u) => `${normalizeUsername(u)}@lla.app`;
export const emailToUsername = (e) => String(e ?? '').split('@')[0];

export function slugify(name) {
  const base = String(name ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'lang';
}
