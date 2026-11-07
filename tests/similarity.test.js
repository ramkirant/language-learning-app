import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, normalize, stripAccents, levenshtein } from '../js/similarity.js';

test('exact match scores 1, ignoring case, spacing and punctuation', () => {
  assert.equal(scoreAnswer('bonjour', 'Bonjour').score, 1);
  assert.equal(scoreAnswer('  Comment   allez-vous  ', 'Comment allez-vous ?').score, 1);
  assert.equal(scoreAnswer("S\u2019il vous pla\u00EEt", "S'il vous pla\u00EEt!").score, 1);
});

test('accent-only difference scores 2', () => {
  assert.equal(scoreAnswer('a bientot', '\u00C0 bient\u00F4t').score, 2);
  assert.equal(scoreAnswer('ca va', '\u00C7a va').score, 2);
  assert.equal(scoreAnswer('coeur', 'c\u0153ur').score, 2);
});

test('empty answer scores 10', () => {
  assert.equal(scoreAnswer('', 'Hello').score, 10);
  assert.equal(scoreAnswer('   ', 'Hello').score, 10);
});

test('completely different text scores 10', () => {
  assert.equal(scoreAnswer('xyz', 'abc').score, 10);
});

test('a typo is worse than accents but better than unrelated', () => {
  const typo = scoreAnswer('bonjor', 'bonjour').score;
  assert.ok(typo >= 3 && typo <= 4, `typo score ${typo}`);
  const wrong = scoreAnswer('merci', 'bonjour').score;
  assert.ok(wrong > typo);
});

test('a one-letter typo in a long sentence is never scored as exact', () => {
  const s = scoreAnswer('je voudrais un cafe avec du lait s il vous plait', 'Je voudrais un caf\u00E9 avec du lait, s\u2019il vous pla\u00EEt');
  assert.ok(s.score >= 2);
  assert.ok(scoreAnswer('je voudrais un cafx avec du lait sil vous plait', 'Je voudrais un cafe avec du lait s il vous plait').score >= 3);
});

test('alternatives separated by / or ; are all accepted', () => {
  assert.equal(scoreAnswer('hi', 'Hello / Hi').score, 1);
  assert.equal(scoreAnswer('good morning', 'Hello; Good morning').score, 1);
  assert.equal(scoreAnswer('hello hi', 'Hello / Hi').score, 1);
});

test('helpers', () => {
  assert.equal(normalize('  L\u2019EAU,  s\u2019il-vous  '), "l'eau s'il vous");
  assert.equal(stripAccents('\u00E9\u00E8\u00EA\u00E7\u00E0'), 'eeeca');
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});
