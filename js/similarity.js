// Scores a typed answer against the expected text on a 1 (exact) .. 10 (no match) scale.

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u00B4\u0060]/g, "'")
    .replace(/[-\u2013\u2014]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s) {
  return s.replace(/\u0153/g, 'oe').replace(/\u00E6/g, 'ae')
    .normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

// "Hello / Hi" accepts either alternative (or the whole string).
export function variants(expected) {
  const whole = String(expected ?? '');
  const parts = whole.split(/[\/;]/).map((p) => p.trim()).filter(Boolean);
  return [...new Set([whole, ...parts])];
}

function scoreOne(given, expected) {
  if (!expected) return { score: 10, kind: 'none' };
  if (given === expected) return { score: 1, kind: 'exact' };
  const g = stripAccents(given);
  const e = stripAccents(expected);
  if (g === e) return { score: 2, kind: 'accents' };
  const sim = 1 - levenshtein(g, e) / Math.max(g.length, e.length);
  // Anything that is not an exact / accent-only match is at least 3.
  return { score: Math.max(3, Math.round(1 + 9 * (1 - sim))), kind: 'partial' };
}

export function scoreAnswer(input, expected) {
  const given = normalize(input);
  if (!given) return { score: 10, kind: 'empty' };
  let best = { score: 11, kind: 'none' };
  for (const v of variants(expected)) {
    const r = scoreOne(given, normalize(v));
    if (r.score < best.score) best = r;
  }
  return best;
}
