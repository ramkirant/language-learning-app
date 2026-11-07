// Read-aloud using the browser's built-in speech synthesis (free; voices depend on the device).

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function canSpeak(code) {
  if (!supported() || !code) return false;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return true; // some browsers load voices lazily; assume yes
  const base = code.slice(0, 2).toLowerCase();
  return voices.some((v) => v.lang.toLowerCase().startsWith(base));
}

export function speak(text, code) {
  if (!supported()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  u.rate = 0.9;
  const base = code.slice(0, 2).toLowerCase();
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(base));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
