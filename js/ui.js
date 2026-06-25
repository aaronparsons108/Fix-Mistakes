// Thin HTML-overlay helpers that dress the WebGL world: host speech, floating
// verdict labels, ember sparkles, promotion picker, toast.

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

let speechTimer = null;
export function speak(html, { hold = 0 } = {}) {
  const box = $('host-speech');
  $('speech-text').innerHTML = html;
  box.hidden = false;
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  clearTimeout(speechTimer);
  if (hold > 0) speechTimer = setTimeout(() => { box.hidden = true; }, hold);
}
export function hush() { $('host-speech').hidden = true; }

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
