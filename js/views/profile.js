// Profile: sign in / out, sync status, change password, backup and install tips.
import * as store from '../storage.js';
import * as sync from '../sync.js';
import { changeOwnPassword } from '../users.js';
import { esc } from '../util.js';
import { toast, download, readFile, timeAgo } from '../ui.js';

export function mount(root) {
  let session = store.getSession();
  let busy = false;
  let message = '';

  function syncBlock() {
    const s = sync.status;
    const label = { idle: 'Up to date', syncing: 'Syncing...', offline: 'Offline', error: 'Error', disabled: 'Off' }[s.state] ?? s.state;
    return `<p><b>${label}</b> - last synced ${timeAgo(sync.lastSyncAt())}, ${sync.pending()} change(s) waiting to upload.</p>
      ${s.error ? `<p class="err-text">${esc(s.error)}</p>` : ''}
      ${s.skipped ? `<p class="muted small">${s.skipped} local deck edit(s) were not uploaded because only admins can change the shared deck.</p>` : ''}
      <div class="btns"><button class="btn primary" id="syncNow" ${busy ? 'disabled' : ''}>Sync now</button></div>`;
  }

  function accountHtml() {
    if (!sync.configured) {
      return `<h2>Cloud sync is off</h2><p class="muted">The app works fully on this device. To keep your progress safe across devices,
        set up a free Firebase project and paste its config into <code>js/firebase-config.js</code> (steps in the README).</p>`;
    }
    if (!session) {
      return `<h2>Sign in to sync</h2>
        <form id="signIn" autocomplete="on">
          <label>User id<input type="text" name="username" autocomplete="username" autocapitalize="off" required></label>
          <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
          ${message ? `<p class="err-text">${esc(message)}</p>` : ''}
          <div class="btns"><button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Signing in...' : 'Sign in'}</button></div>
        </form>
        <p class="muted small">You can keep using the app without signing in. Your progress will be merged into your account when you do.</p>`;
    }
    return `<h2>${esc(session.username)} <span class="badge">${esc(session.role)}</span></h2>
      <div id="syncBlock">${syncBlock()}</div>
      <details><summary>Change password</summary>
        <form id="pwForm" autocomplete="off">
          <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
          <label>New password (min 6)<input type="password" name="next" required minlength="6" autocomplete="new-password"></label>
          <div class="btns"><button class="btn" type="submit">Change password</button></div></form></details>
      <div class="btns"><button class="btn danger" id="signOut">Sign out</button></div>`;
  }

  function draw() {
    const persisted = store.persistFailed ? '<p class="err-text">This browser is blocking storage (private mode?). Progress will not be kept.</p>' : '';
    root.innerHTML = `${persisted}
      <section class="tile">${accountHtml()}</section>
      <section class="tile"><h2>Backup</h2>
        <p class="muted small">Last backup: ${timeAgo(store.lastBackupAt())}. A backup file holds your decks and progress.</p>
        <div class="btns"><button class="btn" id="export">Export backup</button>
          <label class="btn" style="margin:0;text-align:center">Import backup<input type="file" id="import" accept=".json,application/json" hidden></label></div>
      </section>
      <section class="tile"><h2>Install on your phone</h2>
        <p class="muted small"><b>iPhone:</b> open in Safari, tap Share, then Add to Home Screen. <b>Android:</b> Chrome menu, then Install app.
        The installed app keeps working offline and keeps your data safe.</p></section>`;
    wire();
  }

  function wire() {
    const $ = (id) => root.querySelector(`#${id}`);
    $('export').addEventListener('click', () => {
      download(`lingo-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportBackup(), 'application/json');
      toast('Backup downloaded', 'success');
      draw();
    });
    $('import').addEventListener('change', async (e) => {
      try {
        const n = store.importBackup(await readFile(e.target.files[0]));
        sync.requestSync('import');
        toast(`Backup merged (${n} newer record(s))`, 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
    $('signIn')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      busy = true; message = ''; draw();
      try { await sync.signIn(f.elements.username.value, f.elements.password.value); toast('Signed in', 'success'); }
      catch (err) { message = sync.friendlyError(err); }
      busy = false;
      draw();
    });
    $('signOut')?.addEventListener('click', async () => { await sync.signOutUser(); toast('Signed out'); });
    $('syncNow')?.addEventListener('click', async () => {
      await sync.syncNow();
      if (sync.status.state === 'error') toast(sync.status.error, 'error'); else toast('Synced', 'success');
    });
    $('pwForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await changeOwnPassword(f.elements.current.value, f.elements.next.value);
        toast('Password changed', 'success');
        f.reset();
      } catch (err) { toast(sync.friendlyError(err), 'error'); }
    });
  }

  draw();
  const off = sync.subscribe(() => {
    const block = root.querySelector('#syncBlock');
    if (!block) return;
    block.innerHTML = syncBlock();
    block.querySelector('#syncNow')?.addEventListener('click', () => sync.syncNow());
  });
  const offStore = store.subscribe(() => {
    if (store.getSession()?.uid === session?.uid) return;
    session = store.getSession();
    draw();
  });
  return () => { off(); offStore(); };
}
