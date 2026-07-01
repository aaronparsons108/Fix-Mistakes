// Tiny WebAudio synth — no audio assets needed. Everything is generated.

let ctx = null;
let muted = localStorage.getItem('revisemychess-muted') === '1';

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { time = 0, dur = 0.15, type = 'sine', vol = 0.18, slideTo = null } = {}) {
  const ac = audio();
  const t0 = ac.currentTime + time;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  move()    { if (!muted) tone(420, { dur: 0.06, type: 'triangle', vol: 0.14, slideTo: 220 }); },
  capture() { if (!muted) { tone(300, { dur: 0.08, type: 'square', vol: 0.1 }); tone(170, { time: 0.02, dur: 0.1, type: 'triangle', vol: 0.14 }); } },
  correct() { if (!muted) [523, 659, 784, 1047].forEach((f, i) => tone(f, { time: i * 0.09, dur: 0.22, type: 'triangle', vol: 0.16 })); },
  great()   { if (!muted) [523, 659].forEach((f, i) => tone(f, { time: i * 0.1, dur: 0.2, type: 'triangle', vol: 0.15 })); },
  wrong()   { if (!muted) { tone(220, { dur: 0.25, type: 'sawtooth', vol: 0.09, slideTo: 110 }); tone(233, { dur: 0.25, type: 'sawtooth', vol: 0.09, slideTo: 116 }); } },
  reveal()  { if (!muted) [880, 1175].forEach((f, i) => tone(f, { time: i * 0.12, dur: 0.3, type: 'sine', vol: 0.13 })); },
  fanfare() { if (!muted) [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, { time: i * 0.11, dur: 0.34, type: 'triangle', vol: 0.15 })); },
  tick()    { if (!muted) tone(900, { dur: 0.04, type: 'sine', vol: 0.06 }); },

  // one short chiptune "syllable" — the host's 8-bit voice, one blip per letter
  // as his words type out. Low + gravelly to suit a big green pawn. Pitch wanders
  // by letter so a sentence sounds like speech, not a metronome.
  blip(ch) {
    if (muted) return;
    const code = (typeof ch === 'string' && ch ? ch.toLowerCase().charCodeAt(0) : 110);
    const semis = (code % 5) - 2;                 // -2..+2 semitones
    const f = 150 * Math.pow(2, semis / 12);      // ~130-170 Hz, a growly baritone
    tone(f, { dur: 0.05, type: 'square', vol: 0.05 });
    tone(f * 2.01, { dur: 0.035, type: 'square', vol: 0.02 }); // faint upper harmonic
  },
};

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('revisemychess-muted', muted ? '1' : '0');
  return muted;
}

export function isMuted() { return muted; }
