// The candlelit cabin: renderer, camera, room, table, candle lights (with
// flicker), vignette, embers, and the render loop. Inscryption / Leshy's-house
// mood — deep brown-black room, two trembling amber pools on the table.

import * as THREE from '../lib/three/three.module.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070504);
scene.fog = new THREE.FogExp2(0x0a0705, 0.045);

export const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 4.2, 7.2);
camera.lookAt(0, 0.2, -1.0);

export let renderer = null;
const clock = new THREE.Clock();
const tickers = []; // per-frame callbacks: (t, dt) => void

export function onFrame(fn) { tickers.push(fn); }

let candleA, candleB;

export function initScene(canvas, { headless = false } = {}) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, headless ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  buildRoom();
  buildLights();
  buildVignette();
  resize();
  window.addEventListener('resize', resize);

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    flicker(t);
    for (const fn of tickers) fn(t, dt);
    renderer.render(scene, camera);
  });
  return renderer;
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  scaleVignette();
}

/* ── room & table ─────────────────────────────────────── */
function buildRoom() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 0.9, metalness: 0 });
  const wallWood = new THREE.MeshStandardMaterial({ color: 0x1d130b, roughness: 0.96, metalness: 0 });
  const tableWood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.72, metalness: 0, map: plankTexture() });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), wood);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -4.5; floor.receiveShadow = true;
  scene.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(28, 20), wallWood);
  back.position.set(0, 5.5, -15); scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), wallWood);
  left.rotation.y = Math.PI / 2; left.position.set(-15, 5.5, -1); scene.add(left);
  const right = left.clone(); right.rotation.y = -Math.PI / 2; right.position.set(15, 5.5, -1); scene.add(right);

  const top = new THREE.Mesh(new THREE.BoxGeometry(17, 0.6, 15), tableWood);
  top.position.set(0, -0.3, -1.0); top.receiveShadow = true; top.castShadow = true;
  scene.add(top);

  const legGeo = new THREE.BoxGeometry(0.7, 4.2, 0.7);
  for (const [lx, lz] of [[-6.8, 3], [6.8, 3], [-6.8, -5], [6.8, -5]]) {
    const leg = new THREE.Mesh(legGeo, tableWood);
    leg.position.set(lx, -2.5, lz); leg.castShadow = true; scene.add(leg);
  }
}

// Subtle vertical plank streaks for the tabletop.
function plankTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#4a2f1a'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9; i++) { x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(i * 57, 0); x.lineTo(i * 57, 512); x.stroke(); }
  for (let i = 0; i < 600; i++) { x.globalAlpha = 0.05; x.fillStyle = Math.random() > 0.5 ? '#2a1a0e' : '#6a4326'; x.fillRect(Math.random() * 512, Math.random() * 512, 18, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  return t;
}

/* ── candlelight ──────────────────────────────────────── */
function buildLights() {
  candleA = new THREE.PointLight(0xff8a3c, 22, 16, 2.0);
  candleA.position.set(-3.4, 2.0, 2.2);
  candleA.castShadow = true;
  candleA.shadow.mapSize.set(1024, 1024);
  candleA.shadow.camera.near = 0.2; candleA.shadow.camera.far = 18; candleA.shadow.bias = -0.0025;
  scene.add(candleA);

  candleB = new THREE.PointLight(0xffb060, 11, 14, 2.0);
  candleB.position.set(3.2, 1.9, -3.2);
  scene.add(candleB);

  scene.add(new THREE.HemisphereLight(0x2a3346, 0x0a0705, 0.22));

  makeCandle(-3.4, 2.2);
  makeCandle(3.2, -3.2);
}

const flames = [];
function makeCandle(x, z) {
  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.7, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8d8b0, roughness: 0.6, emissive: 0x3a2408, emissiveIntensity: 0.4 })
  );
  wax.position.set(x, 0.35, z); wax.castShadow = true; scene.add(wax);
  const flame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.46),
    new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  flame.position.set(x, 0.95, z); scene.add(flame);
  flames.push(flame);
}

const flick = (a) => 1 + 0.12 * Math.sin(a * 11.3) + 0.07 * Math.sin(a * 23.7);
function flicker(t) {
  if (!candleA) return;
  const fa = flick(t), fb = flick(t * 1.3 + 2.1);
  candleA.intensity = 22 * fa;
  candleB.intensity = 11 * fb;
  candleA.position.x = -3.4 + 0.05 * Math.sin(t * 17);
  candleA.position.z = 2.2 + 0.05 * Math.cos(t * 19);
  for (const f of flames) { f.lookAt(camera.position); f.scale.set(0.9 + 0.2 * Math.sin(t * 20), fa, 1); }
}

// Briefly brighten the candles (used at dramatic beats).
export function flareCandles() {
  if (!candleA) return;
  import('./tween.js').then(({ tween }) => {
    tween({ ms: 700, ease: 'easeOutCubic', onUpdate: (v) => { renderer.toneMappingExposure = 0.92 + 0.5 * Math.sin(v * Math.PI); } });
  });
}

/* ── vignette (camera-parented) ───────────────────────── */
let vignette;
function buildVignette() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 60, 128, 128, 150);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.92)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  vignette = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  );
  vignette.renderOrder = 999;
  vignette.position.set(0, 0, -0.5);
  camera.add(vignette);
  scene.add(camera);
}
function scaleVignette() {
  if (!vignette) return;
  const h = 2 * 0.5 * Math.tan((camera.fov * Math.PI / 180) / 2);
  vignette.scale.set(h * camera.aspect, h, 1);
}
