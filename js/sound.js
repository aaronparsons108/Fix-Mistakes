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
  // by letter so a sentence sounds like speech, not a metronome; `mood` (-1..1)
  // shifts the register — a touch lower when displeased, brighter when pleased.
  blip(ch, mood = 0) {
    if (muted) return;
    const code = (typeof ch === 'string' && ch ? ch.toLowerCase().charCodeAt(0) : 110);
    const semis = (code % 5) - 2;                 // -2..+2 semitones
    const base = 150 * (1 + 0.1 * Math.max(-1, Math.min(1, mood)));
    const f = base * Math.pow(2, semis / 12);     // ~130-170 Hz, a growly baritone
    tone(f, { dur: 0.05, type: 'square', vol: 0.05 });
    tone(f * 2.01, { dur: 0.035, type: 'square', vol: 0.02 }); // faint upper harmonic
  },
};

/* ── ambience: synthesized wind + fire crackle (no assets) ──
   A looped noise buffer feeds two chains: a slow LFO-swept lowpass (wind
   breathing around the tower) and a warm low rumble (the hearth). Crackle is
   short bandpassed bursts on a random timer. Starts on the first user gesture
   (autoplay policy) and ducks to silence when muted. */

let amb = null;

function noiseBuffer(ac, seconds = 2) {
  const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {           // pinkish noise via leaky integrator
    const white = Math.random() * 2 - 1;
    last = last * 0.97 + white * 0.03;
    d[i] = last * 3.5;
  }
  return buf;
}

export function startAmbience() {
  if (amb) return;
  const ac = audio();
  const master = ac.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ac.destination);

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac); src.loop = true;

  // wind: lowpass swept slowly by an LFO
  const windFilter = ac.createBiquadFilter();
  windFilter.type = 'lowpass'; windFilter.frequency.value = 220; windFilter.Q.value = 0.6;
  const windGain = ac.createGain(); windGain.gain.value = 0.020;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
  const lfoAmp = ac.createGain(); lfoAmp.gain.value = 130;
  lfo.connect(lfoAmp).connect(windFilter.frequency);
  const lfo2 = ac.createOscillator(); lfo2.frequency.value = 0.043;   // slow swell
  const lfo2Amp = ac.createGain(); lfo2Amp.gain.value = 0.008;
  lfo2.connect(lfo2Amp).connect(windGain.gain);
  src.connect(windFilter).connect(windGain).connect(master);

  // hearth: a faint warm rumble under everything
  const embersFilter = ac.createBiquadFilter();
  embersFilter.type = 'lowpass'; embersFilter.frequency.value = 90;
  const embersGain = ac.createGain(); embersGain.gain.value = 0.012;
  src.connect(embersFilter).connect(embersGain).connect(master);

  src.start(); lfo.start(); lfo2.start();
  amb = { master, timer: null };

  // fire crackle: short random pops through a bandpass
  const crackle = () => {
    if (!amb) return;
    const t0 = ac.currentTime;
    const pop = ac.createBufferSource(); pop.buffer = noiseBuffer(ac, 0.06);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 2600; bp.Q.value = 2.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.010 + Math.random() * 0.028, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05 + Math.random() * 0.07);
    pop.connect(bp).connect(g).connect(master);
    pop.start(t0);
    amb.timer = setTimeout(crackle, 90 + Math.random() * 700);
  };
  crackle();
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('revisemychess-muted', muted ? '1' : '0');
  if (amb) amb.master.gain.setTargetAtTime(muted ? 0 : 1, audio().currentTime, 0.15);
  return muted;
}

export function isMuted() { return muted; }
