// Parse / serialize the app's CSV format: category ~|~ target ~|~ native ~|~ pronunciation
export const SEP = '~|~';

export function parseCsv(text) {
  const rows = [];
  const errors = [];
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let seenFirst = false;

  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cols = raw.split(SEP).map((c) => c.trim());
    const first = !seenFirst;
    seenFirst = true;
    if (first && cols[0].toLowerCase() === 'category') return; // optional header row

    if (cols.length < 3) {
      errors.push({ line: i + 1, reason: 'Expected 3 or 4 columns separated by ~|~', text: raw });
      return;
    }
    if (cols.length > 4) {
      errors.push({ line: i + 1, reason: 'Too many columns (max 4)', text: raw });
      return;
    }
    const [category, target, native, pron = ''] = cols;
    if (!target || !native) {
      errors.push({ line: i + 1, reason: 'Missing text in column 2 or 3', text: raw });
      return;
    }
    rows.push({ category: category || 'General', target, native, pron });
  });

  return { rows, errors };
}

const clean = (s) => String(s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').split(SEP).join(' ').trim();

export function toCsv(items) {
  return items
    .map((it) => [it.category, it.target, it.native, it.pron].map(clean).join(SEP))
    .join('\n') + (items.length ? '\n' : '');
}
