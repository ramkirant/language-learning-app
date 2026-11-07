// Progress screen: overall proficiency, per-category bars and the hardest items.
import * as store from '../storage.js';
import { proficiency, byCategory, progressKey, DIRECTIONS } from '../difficulty.js';
import { esc } from '../util.js';

const diffColor = (d) => `hsl(${Math.round(130 - (d - 1) * (130 / 9))} 65% 42%)`; // green (easy) -> red (hard)

export function mount(root) {
  const lang = store.activeLanguage();
  const items = store.itemsOf(lang.id);
  if (!items.length) {
    root.innerHTML = `<div class="tile empty"><h2>No ${esc(lang.name)} items yet</h2><p>Add some words in Admin, then practise to see your progress.</p></div>`;
    return null;
  }
  const prog = store.progressMap(lang.id);
  const overall = proficiency(items, prog);
  const mastered = items.filter((it) => DIRECTIONS.some((d) => (prog[progressKey(it.id, d)]?.difficulty ?? 10) <= 3)).length;

  const hardest = [];
  for (const it of items) {
    for (const dir of DIRECTIONS) {
      const r = prog[progressKey(it.id, dir)];
      if (r?.attempts > 0) hardest.push({ it, dir, r });
    }
  }
  hardest.sort((a, b) => b.r.difficulty - a.r.difficulty || b.r.attempts - a.r.attempts);

  root.innerHTML = `
    <section class="tile" style="text-align:center">
      <h2>${esc(lang.flag)} ${esc(lang.name)} proficiency</h2>
      <div class="ring" style="--p:${overall.percent}"><div><span>${overall.percent}%<small>${esc(overall.level)}</small></span></div></div>
      <div class="stats">
        <div><b>${overall.total}</b><span class="muted small">items</span></div>
        <div><b>${overall.seen}</b><span class="muted small">practised</span></div>
        <div><b>${mastered}</b><span class="muted small">mastered</span></div>
      </div>
    </section>
    <section class="tile"><h2>By category</h2>
      ${byCategory(items, prog).map((c) => `
        <div class="cat-row"><span>${esc(c.category)}</span><span>${c.percent}% \u00B7 ${c.seen}/${c.total}</span></div>
        <div class="bar"><i style="width:${c.percent}%"></i></div>`).join('')}
    </section>
    <section class="tile"><h2>Hardest items</h2>
      ${hardest.length ? hardest.slice(0, 10).map(({ it, dir, r }) => `
        <div class="list-item"><span class="diff" style="background:${diffColor(r.difficulty)}">${r.difficulty.toFixed(1)}</span>
          <div class="main"><b>${esc(dir === 't2n' ? it.target : it.native)}</b>
          <span class="muted small">${esc(dir === 't2n' ? it.native : it.target)} \u00B7 ${r.correct}/${r.attempts} correct</span></div></div>`).join('')
        : '<p class="muted">Answer a few questions and your trickiest items will show up here.</p>'}
    </section>`;
  return null;
}
