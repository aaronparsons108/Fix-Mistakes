// Visual effects: particle bursts under pieces, screen-sweep transitions,
// floating labels, confetti. All rendered into the fixed #fx-layer using the
// Web Animations API, so nothing here touches layout.

const fxLayer = () => document.getElementById('fx-layer');

const PALETTES = {
  ok:    ['#3dff8f', '#a8ffce', '#ffc83d', '#ffffff'],
  great: ['#ffc83d', '#ffe9a8', '#ff9d2e', '#ffffff'],
  warn:  ['#ff9d2e', '#ffbd6e', '#ff7a2e', '#ffe2c4'],
  bad:   ['#ff4d6a', '#ff8fa1', '#ff2e2e', '#ffb199'],
  info:  ['#00e5ff', '#8ff4ff', '#7c5cff', '#ffffff'],
};

// Radial burst shooting out from under a point (e.g. a just-moved piece).
export function burst(x, y, kind = 'ok', { particles = 26, power = 1 } = {}) {
  const layer = fxLayer();
  const colors = PALETTES[kind] || PALETTES.ok;

  const ring = document.createElement('div');
  ring.className = 'shockring';
  ring.style.borderColor = colors[0];
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  layer.appendChild(ring);
  ring.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: 1, width: '30px', height: '30px' },
      { transform: 'translate(-50%,-50%) scale(3)', opacity: 0, width: '60px', height: '60px' },
    ],
    { duration: 550, easing: 'cubic-bezier(.1,.8,.3,1)' }
  ).onfinish = () => ring.remove();

  for (let i = 0; i < particles; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 3 + Math.random() * 7;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = colors[i % colors.length];
    p.style.boxShadow = `0 0 ${size * 2}px ${colors[i % colors.length]}`;
    layer.appendChild(p);

    const angle = (i / particles) * Math.PI * 2 + Math.random() * 0.5;
    const dist = (50 + Math.random() * 90) * power;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30 * power; // bias upward
    const dur = 600 + Math.random() * 500;
    p.animate(
      [
        { transform: 'translate(-50%,-50%)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 40}px)) scale(.2)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.15,.6,.4,1)' }
    ).onfinish = () => p.remove();
  }
}

export function floatLabel(x, y, text, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `float-label ${kind}`;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  fxLayer().appendChild(el);
  setTimeout(() => el.remove(), 1450);
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // restart animation
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

// Full-screen diagonal neon sweep. Resolves at the midpoint (screen fully
// covered) so the caller can swap content behind it.
export function sweep(label = '') {
  return new Promise((resolve) => {
    const el = document.getElementById('sweep');
    document.getElementById('sweep-label').textContent = label;
    el.classList.remove('run');
    void el.offsetWidth;
    el.classList.add('run');
    setTimeout(resolve, 600); // covered point of the 2s animation
    setTimeout(() => el.classList.remove('run'), 2050);
  });
}

export function confetti({ count = 120 } = {}) {
  const layer = fxLayer();
  const colors = ['#00e5ff', '#ff2ec4', '#ffc83d', '#3dff8f', '#7c5cff', '#ffffff'];
  const w = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-bit';
    c.style.left = Math.random() * w + 'px';
    c.style.top = '-20px';
    c.style.background = colors[i % colors.length];
    layer.appendChild(c);
    const drift = (Math.random() - 0.5) * 240;
    const fall = window.innerHeight + 60;
    const dur = 2200 + Math.random() * 2200;
    c.animate(
      [
        { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${drift}px, ${fall}px) rotate(${540 + Math.random() * 540}deg)`, opacity: 0.9 },
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.4,.6,1)', delay: Math.random() * 900 }
    ).onfinish = () => c.remove();
  }
}
