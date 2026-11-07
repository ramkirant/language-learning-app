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
        ${loading ? '<p class="muted">Loading...</p>' : `<div class="utable">
          <div class="urow uhead"><span>User</span><span>Role</span><span>Status</span><span class="uact"></span></div>
          ${users.map((u) => `<div class="urow">
            <b class="uname">${esc(u.username)}${u.uid === me.uid ? ' (you)' : ''}</b>
            <span class="badge">${esc(u.role)}</span>
            <span class="badge ${u.active === false ? 'off' : ''}">${u.active === false ? 'inactive' : 'active'}</span>
            <span class="uact">
              <button class="btn small" data-role="${esc(u.uid)}">${u.role === 'admin' ? 'Make learner' : 'Make admin'}</button>
              <button class="btn small ${u.active === false ? '' : 'danger'}" data-active="${esc(u.uid)}">${u.active === false ? 'Reactivate' : 'Deactivate'}</button>
            </span></div>`).join('')}</div>`}
      </section>
      <section class="tile"><h2>Add a user</h2>
        <form id="addUser" autocomplete="off">
          <label>User ID<input type="text" name="username" required autocapitalize="off" placeholder="e.g. priya"></label>
          <label>Password (min 6 characters)<input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Enter a User ID first" disabled></label>
          <label>Confirm password<input type="password" name="confirm" required minlength="6" autocomplete="new-password" placeholder="Enter a User ID first" disabled></label>
          <div id="pwMatch" class="small" aria-live="polite" style="min-height:1.2rem;margin:-.2rem 0 .5rem"></div>
          <label class="check"><input type="checkbox" id="showPw" disabled> Show password</label>
          <label>Role<select name="role"><option value="learner">Learner (practice only)</option>
            <option value="admin">Admin (can manage deck, languages and users)</option></select></label>
          <div class="btns"><button class="btn primary" type="submit">Create user</button></div>
        </form>
        <p class="muted small">Passwords cannot be reset from the app. If someone forgets theirs, reset it in the Firebase console
          (Authentication) or deactivate them and create a new user ID.</p>
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

  // Live feedback while typing: green when both passwords match, red when they differ.
  root.addEventListener('input', (e) => {
    const f = e.target.form;
    if (!f) return;
    if (e.target.name === 'username') { // password fields unlock once a User ID is entered
      const has = e.target.value.trim() !== '';
      const { password, confirm } = f.elements;
      for (const el of [password, confirm, f.querySelector('#showPw')]) el.disabled = !has;
      for (const el of [password, confirm]) el.placeholder = has ? '' : 'Enter a User ID first';
      if (!has) {
        password.value = confirm.value = '';
        f.querySelector('#pwMatch').textContent = '';
      }
      return;
    }
    if (!['password', 'confirm'].includes(e.target.name)) return;
    const { password, confirm } = f.elements;
    const note = f.querySelector('#pwMatch');
    if (!confirm.value) { note.textContent = ''; note.className = 'small'; return; }
    const same = password.value === confirm.value;
    note.textContent = same ? 'Passwords match' : 'Passwords do not match';
    note.className = `small ${same ? 'ok-text' : 'err-text'}`;
  });

  root.addEventListener('change', (e) => {
    if (e.target.id !== 'showPw') return;
    const type = e.target.checked ? 'text' : 'password';
    e.target.form.elements.password.type = type;
    e.target.form.elements.confirm.type = type;
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.elements.password.value !== f.elements.confirm.value) {
      toast('The two passwords do not match.', 'error');
      f.elements.confirm.focus();
      return;
    }
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
