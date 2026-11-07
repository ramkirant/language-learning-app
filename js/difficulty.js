// Difficulty tracking, question picking and proficiency. Pure logic, no DOM / storage.
import { clamp, round1 } from './util.js';

export const DEFAULT_DIFFICULTY = 5;
export const NEW_ANSWER_WEIGHT = 0.6; // share of the newest answer in the recomputed difficulty
export const RECENT_AVOID = 3;        // don't repeat the last N cards
export const EASY_SHARE = 0.15;       // chance of a confidence-boosting easy card
export const HISTORY_LEN = 10;
export const DIRECTIONS = ['t2n', 'n2t']; // target->native, native->target

export const progressKey = (itemId, dir) => `${itemId}_${dir}`;

export function nextDifficulty(old, score) {
  const d = (1 - NEW_ANSWER_WEIGHT) * old + NEW_ANSWER_WEIGHT * score;
  return clamp(round1(d), 1, 10);
}

export function applyAnswer(rec, score, answer, now) {
  const old = rec?.difficulty ?? DEFAULT_DIFFICULTY;
  return {
    difficulty: nextDifficulty(old, score),
    lastScore: score,
    lastAnswer: answer ?? '',
    history: [...(rec?.history ?? []), score].slice(-HISTORY_LEN),
    attempts: (rec?.attempts ?? 0) + 1,
    correct: (rec?.correct ?? 0) + (score <= 2 ? 1 : 0),
    last: now,
    updatedAt: now,
  };
}

export const weightFor = (d) => 1 + Math.pow(clamp(d, 1, 10) - 1, 1.5);

// cards: [{key, ...}]; getD(card) -> difficulty; recent: keys of recently shown cards (oldest first)
export function pickCard(cards, getD, recent = [], rng = Math.random) {
  if (!cards.length) return null;
  let pool = [];
  for (const n of [RECENT_AVOID, 1, 0]) {
    const avoid = new Set(n ? recent.slice(-n) : []);
    pool = cards.filter((c) => !avoid.has(c.key));
    if (pool.length) break;
  }
  if (pool.length >= 6 && rng() < EASY_SHARE) {
    const easiest = [...pool].sort((a, b) => getD(a) - getD(b))
      .slice(0, Math.max(1, Math.ceil(pool.length / 3)));
    return easiest[Math.floor(rng() * easiest.length)];
  }
  const weights = pool.map((c) => weightFor(getD(c)));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Mastery of one item: mean of (10-d)/9 over the directions that have been answered.
export function itemMastery(progress, itemId) {
  const seen = DIRECTIONS.map((d) => progress[progressKey(itemId, d)]).filter((r) => r && r.attempts > 0);
  if (!seen.length) return 0;
  return seen.reduce((s, r) => s + (10 - r.difficulty) / 9, 0) / seen.length;
}

export function levelFor(pct) {
  if (pct < 20) return 'Beginner';
  if (pct < 40) return 'Elementary';
  if (pct < 60) return 'Intermediate';
  if (pct < 80) return 'Upper-Intermediate';
  return 'Advanced';
}

export function proficiency(items, progress) {
  const total = items.length;
  const seen = items.filter((it) => DIRECTIONS.some((d) => progress[progressKey(it.id, d)]?.attempts > 0)).length;
  const sum = items.reduce((s, it) => s + itemMastery(progress, it.id), 0);
  const percent = total ? round1((sum / total) * 100) : 0;
  return { percent, seen, total, level: levelFor(percent) };
}

export function byCategory(items, progress) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({ category, ...proficiency(list, progress) }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
