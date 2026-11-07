// Admin shell: Deck / Languages / Users tabs (only reachable by admins).
import * as store from '../storage.js';
import * as sync from '../sync.js';
import * as deck from './admin-deck.js';
import * as languages from './admin-languages.js';
import * as users from './admin-users.js';

const TABS = { deck: ['Deck', deck], languages: ['Languages', languages], users: ['Users', users] };
let active = 'deck';

export function mount(root) {
  let cleanup = null;
  const tabs = Object.entries(TABS).filter(([k]) => k !== 'users' || (store.isSignedIn() && sync.configured));

  function draw() {
    cleanup?.();
    if (!tabs.some(([k]) => k === active)) active = 'deck';
    root.innerHTML = `<div class="tabs">${tabs.map(([k, [label]]) =>
      `<button data-tab="${k}" class="${k === active ? 'active' : ''}">${label}</button>`).join('')}</div><div id="adminBody"></div>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { active = b.dataset.tab; draw(); }));
    cleanup = TABS[active][1].mount(root.querySelector('#adminBody')) ?? null;
  }
  draw();
  return () => cleanup?.();
}
