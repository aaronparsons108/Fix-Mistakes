// The cabin: renderer, camera, room, table, a single hanging lamp over the
// board, vignette, and the render loop. Inscryption / Leshy's-house mood — a
// dark room with one warm pool of light on the table.

import * as THREE from '../lib/three/three.module.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070504);
scene.fog = new THREE.FogExp2(0x0a0705, 0.045);

export const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 9.4, 9.2);   // pulled back + up so the whole board fits, host still looms across it
camera.lookAt(0, 0.0, -1.0);

export let renderer = null;
const clock = new THREE.Clock();
const tickers = []; // per-frame callbacks: (t, dt) => void

export function onFrame(fn) { tickers.push(fn); }

let lamp, hostFill, bulbMesh;
let baseExposure = 1.12;

export function initScene(canvas, { headless = false } = {}) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, headless ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = baseExposure;
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
  // a single lamp hanging over the table, pooling warm light onto the board
  lamp = new THREE.SpotLight(0xffe8c4, 150, 28, Math.PI / 4.2, 0.5, 1.5);
  lamp.position.set(0, 7.6, -0.6);
  lamp.target.position.set(0, 0, -1.0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 1; lamp.shadow.camera.far = 18; lamp.shadow.bias = -0.0015;
  scene.add(lamp); scene.add(lamp.target);

  // warm fill so the room and the host aren't lost to black
  scene.add(new THREE.HemisphereLight(0x6f5a3e, 0x140d08, 0.6));
  hostFill = new THREE.PointLight(0xffd49a, 32, 16, 2.0);
  hostFill.position.set(0, 4.2, -4.0);   // close to the host, to catch his face + eyes
  scene.add(hostFill);

  buildLamp();
}

function buildLamp() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x18110a, roughness: 0.5, metalness: 0.45 });
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6, 8), metal);
  cord.position.set(0, 11.2, -0.6); scene.add(cord);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 1.7, 1.4, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x241710, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide, emissive: 0x4a2c12, emissiveIntensity: 0.6 })
  );
  shade.position.set(0, 8.3, -0.6); scene.add(shade);
  bulbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe7b0, toneMapped: false })
  );
  bulbMesh.position.set(0, 7.7, -0.6); scene.add(bulbMesh);
}

// gentle sway of the hanging lamp + a faint living glow
function flicker(t) {
  if (!lamp) return;
  const sx = Math.sin(t * 0.55) * 0.13, sz = Math.cos(t * 0.43) * 0.09;
  lamp.position.x = sx; lamp.position.z = -0.6 + sz;
  if (bulbMesh) { bulbMesh.position.x = sx; bulbMesh.position.z = -0.6 + sz; }
  lamp.intensity = 150 * (1 + 0.025 * Math.sin(t * 5.0));
}

// Briefly brighten the room (used at dramatic beats).
export function flareCandles() {
  if (!renderer) return;
  import('./tween.js').then(({ tween }) => {
    tween({ ms: 700, ease: 'easeOutCubic', onUpdate: (v) => { renderer.toneMappingExposure = baseExposure + 0.4 * Math.sin(v * Math.PI); } });
  });
}

/* ── vignette (camera-parented) ───────────────────────── */
let vignette;
function buildVignette() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 70, 128, 128, 160);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.72, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
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
