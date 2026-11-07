// Admin -> Users: create accounts, change roles, deactivate / reactivate (needs cloud sync).
import * as store from '../storage.js';
import * as sync from '../sync.js';
import { listUsers, createUser, updateUser } from '../users.js';
import { esc } from '../util.js';
import { toast } from '../ui.js';

export function mount(root) {
  const me = store.getSession();
  let users = [];
  let error = '';
  let loading = true;

  async function load() {
    loading = true; error = '';
    draw();
    try { users = await listUsers(); } catch (e) { error = sync.friendlyError(e); }
    loading = false;
    draw();
  }

  const activeAdmins = () => users.filter((u) => u.role === 'admin' && u.active !== false);

  function draw() {
    root.innerHTML = `
      <section class="tile"><h2>Users</h2>
        ${error ? `<p class="err-text">${esc(error)}</p>` : ''}
        ${loading ? '<p class="muted">Loading...</p>' : users.map((u) => `
          <div class="list-item"><div class="main"><b>${esc(u.username)} ${u.uid === me.uid ? '(you)' : ''}</b>
            <span><span class="badge">${esc(u.role)}</span> <span class="badge ${u.active === false ? 'off' : ''}">${u.active === false ? 'inactive' : 'active'}</span></span></div>
            <button class="btn small" data-role="${esc(u.uid)}">${u.role === 'admin' ? 'Make learner' : 'Make admin'}</button>
            <button class="btn small ${u.active === false ? '' : 'danger'}" data-active="${esc(u.uid)}">${u.active === false ? 'Reactivate' : 'Deactivate'}</button></div>`).join('')}
      </section>
      <section class="tile"><h2>Add a user</h2>
        <form id="addUser" autocomplete="off">
          <label>User id<input type="text" name="username" required autocapitalize="off" placeholder="e.g. priya"></label>
          <label>Password (min 6 characters)<input type="text" name="password" required minlength="6" autocomplete="off"></label>
          <label>Role<select name="role"><option value="learner">Learner (practice only)</option>
            <option value="admin">Admin (can manage deck, languages and users)</option></select></label>
          <div class="btns"><button class="btn primary" type="submit">Create user</button></div>
        </form>
        <p class="muted small">Passwords cannot be reset from the app. If someone forgets theirs, reset it in the Firebase console
          (Authentication) or deactivate them and create a new user id.</p>
      </section>`;
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const uid = b.dataset.role || b.dataset.active;
    const u = users.find((x) => x.uid === uid);
    if (!u) return;
    try {
      if (b.dataset.role) {
        const next = u.role === 'admin' ? 'learner' : 'admin';
        if (next === 'learner' && u.active !== false && activeAdmins().length <= 1) throw new Error('There must be at least one active admin.');
        await updateUser(uid, { role: next });
      } else {
        const turnOff = u.active !== false;
        if (turnOff && uid === me.uid) throw new Error('You cannot deactivate yourself.');
        if (turnOff && u.role === 'admin' && activeAdmins().length <= 1) throw new Error('There must be at least one active admin.');
        await updateUser(uid, { active: !turnOff });
      }
      toast('Updated', 'success');
      await load();
    } catch (err) { toast(sync.friendlyError(err), 'error'); }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await createUser({ username: f.elements.username.value, password: f.elements.password.value, role: f.elements.role.value });
      toast(`User ${f.elements.username.value.trim().toLowerCase()} created`, 'success');
      await load();
    } catch (err) {
      toast(sync.friendlyError(err), 'error');
      btn.disabled = false;
    }
  });

  load();
  return null;
}
