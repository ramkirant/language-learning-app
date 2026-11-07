import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage so the store can run under Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../js/storage.js');
const fresh = () => { mem.clear(); store.init(); };

test('a new store contains French as the only language', () => {
  fresh();
  assert.deepEqual(store.languages().map((l) => l.id), ['fr']);
  assert.equal(store.activeLanguage().speechCode, 'fr-FR');
  assert.ok(store.isAdmin(), 'local-only mode has admin tools');
});

test('add, edit, delete items and rename a category', () => {
  fresh();
  const a = store.addItem('fr', { category: 'Greetings', target: 'Bonjour', native: 'Hello', pron: 'bon-ZHOOR' });
  store.addItem('fr', { category: 'Greetings', target: 'Salut', native: 'Hi' });
  store.updateItem(a.id, { pron: 'bohn-zhoor' });
  assert.equal(store.getItem(a.id).pron, 'bohn-zhoor');
  assert.equal(store.renameCategory('fr', 'Greetings', 'Salutations'), 2);
  assert.deepEqual(store.categories('fr'), ['Salutations']);
  store.deleteItem(a.id);
  assert.equal(store.itemsOf('fr').length, 1);
  assert.ok(store.getItem(a.id).deleted, 'deletes leave a tombstone for sync');
});

test('data survives a reload (persistence)', () => {
  fresh();
  store.addItem('fr', { category: 'A', target: 'x', native: 'y' });
  store.saveProgress('fr', 'k_t2n', { difficulty: 3.2, attempts: 1 });
  store.init(); // simulate closing and reopening the app
  assert.equal(store.itemsOf('fr').length, 1);
  assert.equal(store.progressMap('fr').k_t2n.difficulty, 3.2);
});

test('importRows merge/replace keep ids of matching items', () => {
  fresh();
  const first = store.importRows('fr', [
    { category: 'A', target: 'un', native: 'one', pron: '' },
    { category: 'A', target: 'deux', native: 'two', pron: '' },
    { category: 'A', target: 'UN', native: 'One', pron: '' },
  ]);
  assert.deepEqual([first.added, first.skipped], [2, 1]);
  const idUn = store.itemsOf('fr').find((i) => i.target === 'un').id;
  const merge = store.importRows('fr', [{ category: 'B', target: 'un', native: 'one', pron: 'uhn' }]);
  assert.equal(merge.updated, 1);
  assert.equal(store.getItem(idUn).category, 'B');
  const rep = store.importRows('fr', [{ category: 'B', target: 'un', native: 'one', pron: 'uhn' }], 'replace');
  assert.equal(rep.removed, 1);
  assert.equal(store.itemsOf('fr').length, 1);
  assert.equal(store.itemsOf('fr')[0].id, idUn);
});

test('languages: add a second one, items are scoped, the last language cannot be deleted', () => {
  fresh();
  const es = store.saveLanguage({ name: 'Spanish', speechCode: 'es-ES', flag: 'ES' });
  store.addItem(es.id, { category: 'A', target: 'hola', native: 'hello' });
  assert.equal(store.itemsOf('fr').length, 0);
  assert.equal(store.itemsOf(es.id).length, 1);
  store.deleteLanguage(es.id);
  assert.equal(store.itemsOf(es.id).length, 0);
  assert.throws(() => store.deleteLanguage('fr'));
});

test('progress made while signed out is adopted by the account on sign-in', () => {
  fresh();
  store.saveProgress('fr', 'w_t2n', { difficulty: 2, attempts: 1, updatedAt: 1 });
  store.setSession({ uid: 'u1', username: 'ram', role: 'learner' });
  assert.equal(store.progressMap('fr').w_t2n.difficulty, 2);
  const { writes } = store.takeDirty('u1', false);
  assert.ok(writes.some((w) => w.kind === 'progress' && w.key === 'w_t2n'));
  store.setSession(null);
  assert.deepEqual(store.progressMap('fr'), {}, 'signed-out view has no account progress');
});

test('two accounts on one device keep separate progress', () => {
  fresh();
  store.setSession({ uid: 'a', username: 'a', role: 'learner' });
  store.saveProgress('fr', 'w_t2n', { difficulty: 1, attempts: 1 });
  store.setSession({ uid: 'b', username: 'b', role: 'learner' });
  assert.deepEqual(store.progressMap('fr'), {});
  store.setSession({ uid: 'a', username: 'a', role: 'learner' });
  assert.equal(store.progressMap('fr').w_t2n.difficulty, 1);
});

test('learners cannot upload deck edits; admins can; flags clear only if unchanged', () => {
  fresh();
  const it = store.addItem('fr', { category: 'A', target: 'x', native: 'y' });
  store.saveProgress('fr', 'w_t2n', { difficulty: 4, attempts: 1 });
  store.setSession({ uid: 'u', username: 'u', role: 'learner' });
  let t = store.takeDirty('u', false);
  assert.ok(t.skipped >= 1);
  assert.ok(t.writes.every((w) => w.kind === 'progress'));

  store.setSession({ uid: 'adm', username: 'adm', role: 'admin' });
  store.updateItem(it.id, { pron: 'p' });
  t = store.takeDirty('adm', true);
  const w = t.writes.find((x) => x.kind === 'items');
  assert.ok(w);
  store.updateItem(it.id, { pron: 'edited again while uploading' });
  store.clearDirty(w);
  assert.ok(store.pendingCount('adm', true) > 0, 'newer edit stays queued');
  const t2 = store.takeDirty('adm', true);
  store.clearDirty(t2.writes.find((x) => x.kind === 'items'));
  assert.equal(store.takeDirty('adm', true).writes.filter((x) => x.kind === 'items').length, 0);
});

test('applyRemote: remote newer wins, local-only data is queued on a full pull', () => {
  fresh();
  store.setSession({ uid: 'u', username: 'u', role: 'learner' });
  store.saveProgress('fr', 'mine_t2n', { difficulty: 3, attempts: 1 });
  const changed = store.applyRemote('progress', [
    { id: 'theirs_t2n', difficulty: 9, attempts: 2, updatedAt: 5 },
  ], { full: true, langId: 'fr', uidKey: 'u' });
  assert.equal(changed, 1);
  assert.equal(store.progressMap('fr').theirs_t2n.difficulty, 9);
  const { writes } = store.takeDirty('u', false);
  assert.ok(writes.some((w) => w.key === 'mine_t2n'));
  assert.ok(!writes.some((w) => w.key === 'theirs_t2n'), 'pulled records are not re-uploaded');
});

test('backup export and import round trip', () => {
  fresh();
  store.addItem('fr', { category: 'A', target: 'x', native: 'y' });
  store.saveProgress('fr', 'w_t2n', { difficulty: 2, attempts: 1 });
  const backup = store.exportBackup();
  fresh();
  assert.equal(store.itemsOf('fr').length, 0);
  assert.ok(store.importBackup(backup) > 0);
  assert.equal(store.itemsOf('fr').length, 1);
  assert.equal(store.progressMap('fr').w_t2n.difficulty, 2);
  assert.throws(() => store.importBackup('not json'));
  assert.throws(() => store.importBackup('{"a":1}'));
});
