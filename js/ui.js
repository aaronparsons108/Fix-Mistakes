// Thin HTML-overlay helpers that dress the WebGL world: host speech, floating
// verdict labels, ember sparkles, promotion picker, toast.

import { sounds } from './sound.js';
import { FAST } from './tween.js';

const $ = (id) => document.getElementById(id);
const fxLayer = () => $('fx');

const SPARK = {
  ok: ['#8fe07a', '#cdeec0', '#ffd76a'],
  great: ['#ffd76a', '#ffe9a8', '#ff9d2e'],
  warn: ['#ffae5e', '#ffc890', '#ff7a2e'],
  bad: ['#ff7a64', '#ff5a4a', '#ffb199'],
  info: ['#bcd0ff', '#8fb0ff', '#ffffff'],
  ember: ['#ff8a3c', '#ffb060', '#ffcc66'],
};

export function floatLabel(x, y, text, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `float-label ${kind}`;
  el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  fxLayer().appendChild(el);
  setTimeout(() => el.remove(), 1550);
}

export function sparkle(x, y, kind = 'ember', { count = 22, power = 1 } = {}) {
  const colors = SPARK[kind] || SPARK.ember;
  const layer = fxLayer();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'spark';
    const size = 3 + Math.random() * 6;
    p.style.width = p.style.height = size + 'px';
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.background = colors[i % colors.length];
    p.style.boxShadow = `0 0 ${size * 2}px ${colors[i % colors.length]}`;
    layer.appendChild(p);
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist = (40 + Math.random() * 80) * power;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 36 * power;
    p.animate(
      [{ transform: 'translate(-50%,-50%)', opacity: 1 },
       { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 50}px)) scale(.2)`, opacity: 0 }],
      { duration: 650 + Math.random() * 500, easing: 'cubic-bezier(.15,.6,.4,1)' }
    ).onfinish = () => p.remove();
  }
}

// The host "speaks": his words type out one letter at a time with an 8-bit
// blip per letter (Undertale/Inscryption style). HTML tags & entities in `html`
// are emitted whole so highlight spans stay intact. The reveal is driven by the
// scene's rAF loop (via tickSpeech) rather than setInterval, so it isn't subject
// to background-timer throttling.
let speechTimer = null, speech = null;
const TYPE_MS = 26; // ms per revealed character

export function speak(html, { hold = 0 } = {}) {
  const box = $('host-speech'), el = $('speech-text');
  box.hidden = false;
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  clearTimeout(speechTimer); speech = null;

  if (FAST.on) { el.innerHTML = html; if (hold > 0) speechTimer = setTimeout(() => { box.hidden = true; }, hold); return; }

  el.innerHTML = '';
  speech = { html, i: 0, shown: '', blips: 0, acc: 0, hold, held: false };
}

// Advance the typewriter; call once per animation frame with the frame's dt (s).
export function tickSpeech(dtSeconds) {
  const s = speech; if (!s) return;
  if (s.i >= s.html.length) {
    if (s.hold > 0 && !s.held) { s.held = true; speechTimer = setTimeout(() => { $('host-speech').hidden = true; }, s.hold); }
    return;
  }
  s.acc += dtSeconds * 1000;
  let advanced = false;
  while (s.acc >= TYPE_MS && s.i < s.html.length) {
    s.acc -= TYPE_MS;
    const c = s.html[s.i];
    if (c === '<') { const j = s.html.indexOf('>', s.i); if (j < 0) { s.shown += c; s.i++; } else { s.shown += s.html.slice(s.i, j + 1); s.i = j + 1; } }
    else if (c === '&') { const j = s.html.indexOf(';', s.i), k = j < 0 ? s.i : j; s.shown += s.html.slice(s.i, k + 1); s.i = k + 1; }
    else { s.shown += c; s.i++; if (c !== ' ' && s.blips++ < 60) sounds.blip(c); }
    advanced = true;
  }
  if (advanced) $('speech-text').innerHTML = s.shown;
}
export function hush() { speech = null; $('host-speech').hidden = true; }

export function toast(msg, ms = 4200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms);
}

export function askPromotion(color) {
  return new Promise((resolve) => {
    const modal = $('promo-modal'), box = $('promo-choices');
    box.innerHTML = '';
    for (const [type, glyph] of Object.entries({ q: '♛', r: '♜', n: '♞', b: '♝' })) {
      const b = document.createElement('button');
      b.textContent = glyph;
      b.style.color = color === 'w' ? '#3a2c1d' : '#120a06';
      b.addEventListener('click', () => { modal.hidden = true; resolve(type); });
      box.appendChild(b);
    }
    modal.hidden = false;
    modal.onclick = (e) => { if (e.target === modal) { modal.hidden = true; resolve(null); } };
  });
}
