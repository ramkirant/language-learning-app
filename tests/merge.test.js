import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMaps } from '../js/merge.js';

const r = (updatedAt, v = '') => ({ updatedAt, v });

test('newer remote wins, newer local is queued for upload', () => {
  const local = { a: r(1, 'local'), b: r(5, 'local'), c: r(3, 'same') };
  const remote = { a: r(2, 'remote'), b: r(4, 'remote'), c: r(3, 'same'), d: r(1, 'new') };
  const { merged, pulled, toPush } = mergeMaps(local, remote);
  assert.equal(merged.a.v, 'remote');
  assert.equal(merged.b.v, 'local');
  assert.equal(merged.d.v, 'new');
  assert.deepEqual(pulled.sort(), ['a', 'd']);
  assert.deepEqual(toPush, ['b']);
});

test('full pull uploads local-only records; partial pull does not', () => {
  const local = { a: r(1), mine: r(2) };
  assert.deepEqual(mergeMaps(local, { a: r(1) }, { full: true }).toPush, ['mine']);
  assert.deepEqual(mergeMaps(local, { a: r(1) }, { full: false }).toPush, []);
});

test('answer made offline on two devices: the later answer wins per item', () => {
  const phone = { w1_t2n: r(100, 'phone') };
  const pc = { w1_t2n: r(200, 'pc'), w2_t2n: r(150, 'pc2') };
  const onPhone = mergeMaps(phone, pc);
  assert.equal(onPhone.merged.w1_t2n.v, 'pc');
  assert.equal(onPhone.merged.w2_t2n.v, 'pc2');
});

test('tombstones propagate like normal updates', () => {
  const local = { x: { updatedAt: 1, deleted: false } };
  const remote = { x: { updatedAt: 2, deleted: true } };
  assert.equal(mergeMaps(local, remote).merged.x.deleted, true);
});
