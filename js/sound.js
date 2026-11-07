// Correct / wrong sounds synthesized with WebAudio (no audio files to download or cache).
import * as store from './storage.js';

let ctx = null;

// Must be called from a user gesture at least once (iOS requirement).
export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio not available */ }
}

function tone(freq, start, dur, type = 'sine', gain = 0.25) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playCorrect() {
  if (store.isMuted()) return;
  unlock();
  if (!ctx) return;
  tone(659.25, 0, 0.14, 'sine');     // E5
  tone(880, 0.12, 0.14, 'sine');     // A5
  tone(1318.5, 0.24, 0.28, 'sine', 0.2); // E6
}

export function playWrong() {
  if (store.isMuted()) return;
  unlock();
  if (!ctx) return;
  tone(196, 0, 0.22, 'sawtooth', 0.18);
  tone(147, 0.18, 0.34, 'sawtooth', 0.18);
}
