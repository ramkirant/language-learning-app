import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../js/csv.js';

test('parses ~|~ rows with 4 columns', () => {
  const { rows, errors } = parseCsv('General Salutations~|~Bonjour~|~Hello~|~bon-ZHOOR\nNumbers~|~un~|~one~|~uhn');
  assert.equal(errors.length, 0);
  assert.deepEqual(rows[0], { category: 'General Salutations', target: 'Bonjour', native: 'Hello', pron: 'bon-ZHOOR' });
  assert.equal(rows.length, 2);
});

test('handles BOM, CRLF, blank lines, spaces and optional header', () => {
  const text = '\uFEFFCategory ~|~ French ~|~ English ~|~ Pronunciation\r\n\r\nA ~|~ b ~|~ c ~|~ d\r\n';
  const { rows, errors } = parseCsv(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(rows, [{ category: 'A', target: 'b', native: 'c', pron: 'd' }]);
});

test('pronunciation column is optional; empty category becomes General', () => {
  const { rows } = parseCsv('~|~Merci~|~Thanks');
  assert.deepEqual(rows, [{ category: 'General', target: 'Merci', native: 'Thanks', pron: '' }]);
});

test('reports bad rows without dropping good ones', () => {
  const { rows, errors } = parseCsv('A~|~b~|~c~|~d\nonly one column\nA~|~~|~c\nA~|~b~|~c~|~d~|~e');
  assert.equal(rows.length, 1);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4]);
});

test('round-trips through toCsv', () => {
  const items = [{ category: 'A', target: 'x', native: 'y', pron: 'z' }, { category: 'B', target: 'p', native: 'q', pron: '' }];
  assert.deepEqual(parseCsv(toCsv(items)).rows, items);
});

test('toCsv strips separators and newlines from values', () => {
  const out = toCsv([{ category: 'A', target: 'a~|~b', native: 'c\nd', pron: '' }]);
  assert.equal(out, 'A~|~a b~|~c d~|~\n');
});
