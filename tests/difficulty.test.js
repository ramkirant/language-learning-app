import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAnswer, nextDifficulty, pickCard, weightFor, proficiency, byCategory, levelFor, progressKey,
  DEFAULT_DIFFICULTY,
} from '../js/difficulty.js';

// deterministic RNG so the statistical tests are repeatable
function lcg(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('unseen items start at the default difficulty 5', () => {
  assert.equal(DEFAULT_DIFFICULTY, 5);
});

test('difficulty moves toward the latest score and stays within 1..10', () => {
  assert.equal(nextDifficulty(5, 1), 2.6);
  assert.equal(nextDifficulty(5, 10), 8);
  assert.equal(nextDifficulty(10, 10), 10);
  assert.equal(nextDifficulty(1, 1), 1);
  assert.ok(nextDifficulty(10, 1) < nextDifficulty(10, 5));
});

test('applyAnswer records score, history, attempts and correctness', () => {
  let rec = applyAnswer(undefined, 1, 'bonjour', 1000);
  assert.equal(rec.difficulty, 2.6);
  assert.equal(rec.attempts, 1);
  assert.equal(rec.correct, 1);
  assert.equal(rec.lastScore, 1);
  assert.equal(rec.lastAnswer, 'bonjour');
  rec = applyAnswer(rec, 10, '', 2000);
  assert.equal(rec.attempts, 2);
  assert.equal(rec.correct, 1);
  assert.deepEqual(rec.history, [1, 10]);
  assert.equal(rec.updatedAt, 2000);
});

test('history keeps only the last 10 scores', () => {
  let rec;
  for (let i = 1; i <= 15; i++) rec = applyAnswer(rec, (i % 10) + 1, '', i);
  assert.equal(rec.history.length, 10);
  assert.equal(rec.attempts, 15);
});

test('weights grow with difficulty', () => {
  assert.equal(weightFor(1), 1);
  assert.ok(weightFor(10) > weightFor(5));
  assert.ok(weightFor(5) > weightFor(2));
});

test('picker favours hard cards but still shows easy ones', () => {
  const cards = [
    ...Array.from({ length: 10 }, (_, i) => ({ key: `easy${i}`, d: 1 })),
    ...Array.from({ length: 10 }, (_, i) => ({ key: `hard${i}`, d: 10 })),
  ];
  const rng = lcg();
  let hard = 0, easy = 0;
  const recent = [];
  for (let i = 0; i < 4000; i++) {
    const c = pickCard(cards, (x) => x.d, recent, rng);
    recent.push(c.key);
    if (c.d === 10) hard++; else easy++;
  }
  assert.ok(hard > easy * 2, `hard=${hard} easy=${easy}`);
  assert.ok(easy > 200, `easy cards should still appear (easy=${easy})`);
});

test('picker does not repeat the last 3 cards when it can avoid it', () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, d: 5 }));
  const rng = lcg(7);
  const recent = [];
  for (let i = 0; i < 500; i++) {
    const c = pickCard(cards, (x) => x.d, recent, rng);
    assert.ok(!recent.slice(-3).includes(c.key));
    recent.push(c.key);
  }
});

test('picker copes with tiny pools and empty pools', () => {
  assert.equal(pickCard([], () => 5), null);
  const one = [{ key: 'a' }];
  assert.equal(pickCard(one, () => 5, ['a', 'a', 'a']).key, 'a');
  const two = [{ key: 'a' }, { key: 'b' }];
  assert.equal(pickCard(two, () => 5, ['a']).key, 'b');
});

test('proficiency rises with accuracy and coverage; unseen items count as 0', () => {
  const items = [1, 2, 3, 4].map((n) => ({ id: `i${n}`, category: n <= 2 ? 'A' : 'B' }));
  assert.equal(proficiency(items, {}).percent, 0);
  const prog = {
    [progressKey('i1', 't2n')]: { difficulty: 1, attempts: 3 },
    [progressKey('i2', 't2n')]: { difficulty: 10, attempts: 1 },
  };
  const p = proficiency(items, prog);
  assert.equal(p.seen, 2);
  assert.equal(p.percent, 25); // (1 + 0 + 0 + 0) / 4
  assert.equal(p.level, 'Elementary');
  const cats = byCategory(items, prog);
  assert.deepEqual(cats.map((c) => [c.category, c.percent]), [['A', 50], ['B', 0]]);
  assert.equal(proficiency([], {}).percent, 0);
});

test('levels', () => {
  assert.deepEqual([0, 20, 40, 60, 80, 100].map(levelFor),
    ['Beginner', 'Elementary', 'Intermediate', 'Upper-Intermediate', 'Advanced', 'Advanced']);
});
