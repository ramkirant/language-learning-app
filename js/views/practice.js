// Practice screen: question tile on top, answer tile below.
import * as store from '../storage.js';
import * as sync from '../sync.js';
import * as sound from '../sound.js';
import { speak, canSpeak } from '../speech.js';
import { scoreAnswer } from '../similarity.js';
import { applyAnswer, pickCard, progressKey, proficiency, DEFAULT_DIFFICULTY } from '../difficulty.js';
import { esc } from '../util.js';

const recent = [];                       // keys of the last cards shown (kept across re-mounts)
const session = { answered: 0, correct: 0 };
const WEEK = 7 * 24 * 3600 * 1000;

const verdict = (r) => {
  if (r.kind === 'unknown') return 'No problem - now you know it!';
  if (r.score === 1) return 'Perfect! \u{1F389}';
  if (r.score === 2) return 'Almost perfect - check the accents \u2728';
  if (r.score <= 5) return 'Close!';
  if (r.score <= 9) return 'Not quite';
  return 'Not this time';
};
const tone = (score) => (score <= 2 ? 'ok' : score <= 5 ? 'near' : 'bad');

function banners() {
  let html = '';
  if (!store.isSignedIn() && store.answeredCount() >= 20 && Date.now() - store.lastBackupAt() > WEEK) {
    html += '<div class="banner">\u{1F4BE} Your progress is saved only on this device. <a href="#/profile">Back it up</a> or sign in to sync.</div>';
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  if (ios && !localStorage.getItem('lla:iostip')) {
    html += '<div class="banner" id="iosTip">\u{1F4F1} Tap Share \u2192 <b>Add to Home Screen</b> so iPhone keeps your progress safe. <a href="#" id="iosTipX">Dismiss</a></div>';
  }
  return html;
}

export function mount(root) {
  const lang = store.activeLanguage();
  const allItems = store.itemsOf(lang.id);
  if (!allItems.length) {
    root.innerHTML = `<div class="tile empty"><h2>Your ${esc(lang.name)} deck is empty</h2>
      <p>${store.isAdmin() ? 'Add words in <a href="#/admin">Admin</a>, or load the starter set there.' : 'Ask an admin to add some words.'}</p></div>`;
    return null;
  }
  const settings = store.langSettings(lang.id);
  const cats = store.categories(lang.id);
  const category = cats.includes(settings.category) ? settings.category : 'all';
  const items = category === 'all' ? allItems : allItems.filter((i) => i.category === category);
  const dirs = settings.direction === 'mixed' ? ['t2n', 'n2t'] : [settings.direction];
  const cards = items.flatMap((item) => dirs.map((dir) => ({ key: progressKey(item.id, dir), item, dir })));
  const bannerHtml = banners();

  let card = null;
  let result = null;
  let hintShown = false;

  function nextCard() {
    const prog = store.progressMap(lang.id);
    card = pickCard(cards, (c) => prog[c.key]?.difficulty ?? DEFAULT_DIFFICULTY, recent);
    recent.push(card.key);
    if (recent.length > 12) recent.shift();
    result = null;
    hintShown = false;
    draw(true);
  }

  function submit(text, dontKnow) {
    sound.unlock();
    const expected = card.dir === 't2n' ? card.item.native : card.item.target;
    const r = dontKnow ? { score: 10, kind: 'unknown' } : scoreAnswer(text, expected);
    const prog = store.progressMap(lang.id);
    const oldD = prog[card.key]?.difficulty ?? DEFAULT_DIFFICULTY;
    const rec = applyAnswer(prog[card.key], r.score, dontKnow ? '' : text, Date.now());
    store.saveProgress(lang.id, card.key, rec);
    sync.requestSync('answer');
    session.answered++;
    if (r.score <= 2) { session.correct++; sound.playCorrect(); } else sound.playWrong();
    result = { ...r, oldD, newD: rec.difficulty, typed: text };
    draw();
  }

  function draw(animate = false) {
    const t2n = card.dir === 't2n';
    const question = t2n ? card.item.target : card.item.native;
    const expected = t2n ? card.item.native : card.item.target;
    const answerLang = t2n ? lang.nativeName : lang.name;
    const prof = proficiency(allItems, store.progressMap(lang.id));
    const pron = card.item.pron || '(no pronunciation saved)';
    const speakOk = canSpeak(lang.speechCode) && (t2n || result);
    const showHint = hintShown || result;
    const dirOpt = (v, label) => `<option value="${v}" ${settings.direction === v ? 'selected' : ''}>${label}</option>`;

    root.innerHTML = `${bannerHtml}
      <div class="toolbar">
        <select id="cat" aria-label="Category"><option value="all">All categories</option>${cats.map((c) =>
          `<option value="${esc(c)}" ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="dir" aria-label="Direction">
          ${dirOpt('t2n', `${esc(lang.name)} \u2192 ${esc(lang.nativeName)}`)}
          ${dirOpt('n2t', `${esc(lang.nativeName)} \u2192 ${esc(lang.name)}`)}
          ${dirOpt('mixed', 'Mixed')}</select>
        <button class="chip" id="mute" aria-label="Sound">${store.isMuted() ? '\u{1F507}' : '\u{1F50A}'}</button>
      </div>
      <div class="toolbar"><span class="chip">\u{1F3C5} ${esc(prof.level)} \u00B7 ${prof.percent}%</span>
        <span class="chip">Session ${session.correct}/${session.answered}</span></div>
      <section class="tile tile-q ${animate ? 'enter' : ''}">
        <span class="cat">${esc(card.item.category)}</span>
        <div class="label">Translate to ${esc(answerLang)}</div>
        <div class="question" lang="${t2n ? esc(lang.speechCode) : 'en'}">${esc(question)}</div>
        <div class="hint" id="hint">${showHint ? esc(pron) : ''}</div>
        <div class="icon-row">
          <button class="icon-btn" id="pronBtn" title="Show pronunciation" aria-label="Show pronunciation">\u{1F4A1}</button>
          ${speakOk ? '<button class="icon-btn" id="speakBtn" title="Listen" aria-label="Listen">\u{1F509}</button>' : ''}
        </div>
      </section>
      <section class="tile ${animate ? 'enter ' : ''}${result ? tone(result.score) : ''}">${result ? resultHtml(expected) : formHtml(t2n, answerLang)}</section>`;
    wire();
  }

  function formHtml(t2n, answerLang) {
    return `<form id="answerForm" autocomplete="off">
      <label>Your answer in ${esc(answerLang)}
        <input type="text" id="answer" lang="${t2n ? 'en' : esc(lang.speechCode)}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></label>
      <div class="btns"><button class="btn primary" type="submit">Check</button>
        <button class="btn" type="button" id="idk">I do not know</button></div>
    </form>`;
  }

  function resultHtml(expected) {
    const typed = result.kind === 'unknown' || result.kind === 'empty' ? '' :
      `<div class="muted small">You wrote: ${esc(result.typed)}</div>`;
    return `<div class="result ${tone(result.score)}">
        <div class="verdict">${verdict(result)}</div>${typed}
        <div class="muted small">Correct answer</div><div class="answer-text">${esc(expected)}</div>
        <div class="muted small">Score ${result.score}/10 \u00B7 difficulty ${result.oldD.toFixed(1)} \u2192 ${result.newD.toFixed(1)}</div>
      </div><div class="btns"><button class="btn primary" id="next">Next \u2192</button></div>`;
  }

  function wire() {
    const $ = (id) => root.querySelector(`#${id}`);
    $('cat').addEventListener('change', (e) => { store.setLangSettings(lang.id, { category: e.target.value }); mount(root); });
    $('dir').addEventListener('change', (e) => { store.setLangSettings(lang.id, { direction: e.target.value }); mount(root); });
    $('mute').addEventListener('click', () => { store.setMuted(!store.isMuted()); sound.unlock(); draw(); });
    $('pronBtn').addEventListener('click', () => {
      hintShown = true;
      $('hint').textContent = card.item.pron || '(no pronunciation saved)';
    });
    $('speakBtn')?.addEventListener('click', () => speak(card.item.target, lang.speechCode));
    $('iosTipX')?.addEventListener('click', (e) => {
      e.preventDefault(); localStorage.setItem('lla:iostip', '1'); $('iosTip').remove();
    });
    if (result) { $('next').addEventListener('click', nextCard); $('next').focus(); return; }
    $('answerForm').addEventListener('submit', (e) => { e.preventDefault(); submit($('answer').value, false); });
    $('idk').addEventListener('click', () => submit('', true));
    $('answer').focus({ preventScroll: true });
  }

  nextCard();
  return () => window.speechSynthesis?.cancel();
}
