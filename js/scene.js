// The cabin: renderer, camera, room, table, a single hanging lamp over the
// board, vignette, and the render loop. Inscryption / Leshy's-house mood — a
// dark room with one warm pool of light on the table.

import * as THREE from '../lib/three/three.module.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070d);
scene.fog = new THREE.FogExp2(0x0a0c14, 0.03);

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

/* ── room & table: the inside of a grey brick tower ──── */
function buildRoom() {
  // round tower wall (inside-facing)
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 18, 30, 56, 1, true),
    new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.97, metalness: 0, side: THREE.BackSide })
  );
  wall.position.set(0, 7, -1); wall.receiveShadow = true;
  scene.add(wall);

  // flagstone floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44),
    new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.y = -4.5; floor.receiveShadow = true;
  scene.add(floor);

  // wooden table the board rests on
  const tableWood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.72, metalness: 0, map: plankTexture() });
  const top = new THREE.Mesh(new THREE.BoxGeometry(17, 0.6, 15), tableWood);
  top.position.set(0, -0.3, -1.0); top.receiveShadow = true; top.castShadow = true;
  scene.add(top);
  const legGeo = new THREE.BoxGeometry(0.7, 4.2, 0.7);
  for (const [lx, lz] of [[-6.8, 3], [6.8, 3], [-6.8, -5], [6.8, -5]]) {
    const leg = new THREE.Mesh(legGeo, tableWood);
    leg.position.set(lx, -2.5, lz); leg.castShadow = true; scene.add(leg);
  }

  buildWindow();
}

// a tall arched window with a full moon in a dark sky, off to the left
function buildWindow() {
  const wy = 2.6, wx = -9.5, wz = -12.5;
  const g = new THREE.Group();
  g.position.set(wx, wy, wz);
  g.lookAt(2, 1.5, 9.2);   // face the camera so the moon reads
  const stone = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.95 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 11.4), stone);
  frame.position.z = -0.08; g.add(frame);
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(6.6, 10),
    new THREE.MeshBasicMaterial({ map: nightSkyTexture(), toneMapped: false })
  );
  g.add(sky);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9 });
  const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 10, 0.2), barMat); vbar.position.z = 0.08; g.add(vbar);
  const hbar = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 0.2), barMat); hbar.position.z = 0.08; g.add(hbar);
  scene.add(g);

  // cold moonlight spilling in from the window
  const moon = new THREE.PointLight(0xaecbff, 70, 46, 1.8);
  moon.position.set(-6.5, 5.5, -7.0);
  scene.add(moon);
  scene.add(new THREE.HemisphereLight(0x3a4a72, 0x0a0c14, 0.3)); // faint moonlit fill
}

function brickTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#34343a'; x.fillRect(0, 0, 512, 512); // mortar
  const bw = 66, bh = 30, gap = 4;
  for (let row = 0, y = 0; y < 512 + bh; row++, y += bh + gap) {
    const off = (row % 2) * (bw / 2);
    for (let bx = -bw; bx < 512; bx += bw + gap) {
      const s = 86 + Math.floor(Math.random() * 38);
      x.fillStyle = `rgb(${s},${s},${s + 7})`;
      x.fillRect(bx + off, y, bw, bh);
      x.globalAlpha = 0.08; x.fillStyle = '#000';
      for (let k = 0; k < 4; k++) x.fillRect(bx + off + Math.random() * bw, y + Math.random() * bh, 7, 1);
      x.globalAlpha = 1;
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 5);
  return t;
}

function stoneTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#3e3e44'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
  for (let i = 0; i < 400; i++) { x.globalAlpha = 0.05; x.fillStyle = Math.random() > 0.5 ? '#000' : '#fff'; x.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8);
  return t;
}

function nightSkyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 410;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 410);
  g.addColorStop(0, '#0b1838'); g.addColorStop(1, '#04060e');
  x.fillStyle = g; x.fillRect(0, 0, 256, 410);
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`; const s = Math.random() * 1.7; x.fillRect(Math.random() * 256, Math.random() * 410, s, s); }
  const mx = 168, my = 240, mr = 50;
  const halo = x.createRadialGradient(mx, my, mr, mx, my, mr * 2.4);
  halo.addColorStop(0, 'rgba(200,215,255,0.3)'); halo.addColorStop(1, 'rgba(200,215,255,0)');
  x.fillStyle = halo; x.fillRect(0, 0, 256, 410);
  const mg = x.createRadialGradient(mx - 12, my - 12, 4, mx, my, mr);
  mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.7, '#f3efdf'); mg.addColorStop(1, '#cdc6ae');
  x.fillStyle = mg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  x.globalAlpha = 0.14; x.fillStyle = '#8f8a76';
  for (let i = 0; i < 9; i++) { const a = Math.random() * 7, rr = Math.random() * mr * 0.72; x.beginPath(); x.arc(mx + Math.cos(a) * rr, my + Math.sin(a) * rr, 3 + Math.random() * 7, 0, 7); x.fill(); }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

/* ── the hanging lamp (height/brightness driven by the pull-rope) ─ */
let shadeMesh, lampCord, ropeCord, lampBaseIntensity = 150;
export let lampControl = 0.45;        // 0 = lamp high & dim, 1 = low & bright
export let ropeKnob = null;
const LZ = -0.6;                       // lamp x/z home
const CEIL = 13.5;
const LAMP_HI = 9.2, LAMP_LO = 3.8;    // lamp height range

function buildLights() {
  lamp = new THREE.SpotLight(0xffe8c4, 150, 32, Math.PI / 4.0, 0.5, 1.5);
  lamp.position.set(0, 7.5, LZ);
  lamp.target.position.set(0, 0, -1.0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 1; lamp.shadow.camera.far = 24; lamp.shadow.bias = -0.0015;
  scene.add(lamp); scene.add(lamp.target);

  scene.add(new THREE.HemisphereLight(0x6f5a3e, 0x140d08, 0.55));
  hostFill = new THREE.PointLight(0xffd49a, 32, 16, 2.0);
  hostFill.position.set(0, 4.2, -4.0);
  scene.add(hostFill);

  buildLamp();
  setLampControl(lampControl);
}

function buildLamp() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x18110a, roughness: 0.5, metalness: 0.45 });
  lampCord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), metal); scene.add(lampCord);
  shadeMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 1.7, 1.4, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x241710, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide, emissive: 0x4a2c12, emissiveIntensity: 0.6 })
  );
  scene.add(shadeMesh);
  bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe7b0, toneMapped: false }));
  scene.add(bulbMesh);

  // the pull-rope hanging at the right, toward the player — drag it to move the lamp
  ropeCord = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 6), new THREE.MeshStandardMaterial({ color: 0x7a6238, roughness: 0.95 }));
  scene.add(ropeCord);
  ropeKnob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), new THREE.MeshStandardMaterial({ color: 0x9a7038, roughness: 0.7, emissive: 0x2c1c0a, emissiveIntensity: 0.5 }));
  ropeKnob.position.set(4.6, 5, 2.2);
  scene.add(ropeKnob);
}

function setCord(mesh, x, bottomY, z, topY) {
  mesh.position.set(x, (bottomY + topY) / 2, z);
  mesh.scale.set(1, topY - bottomY, 1);
}

export function setLampControl(t) {
  lampControl = Math.max(0, Math.min(1, t));
  const y = LAMP_HI + (LAMP_LO - LAMP_HI) * lampControl;
  lamp.position.set(LZ * 0, y, LZ);
  bulbMesh.position.set(0, y + 0.1, LZ);
  shadeMesh.position.set(0, y + 0.7, LZ);
  setCord(lampCord, 0, y + 1.4, LZ, CEIL);
  lampBaseIntensity = 95 + 150 * lampControl;          // lower = brighter
  baseExposure = 0.86 + 0.42 * lampControl;
  if (renderer) renderer.toneMappingExposure = baseExposure;
  const knobY = 6.5 + (3.0 - 6.5) * lampControl;        // knob drops as the lamp drops
  ropeKnob.position.y = knobY;
  setCord(ropeCord, ropeKnob.position.x, knobY, ropeKnob.position.z, CEIL + 1);
}
export function getLampControl() { return lampControl; }
export function getRopeKnob() { return ropeKnob; }

// gentle sway + a faint living glow; brightness comes from the rope control
function flicker(t) {
  if (!lamp) return;
  const sx = Math.sin(t * 0.5) * 0.1, sz = Math.cos(t * 0.4) * 0.07;
  lamp.position.x = sx; lamp.position.z = LZ + sz;
  bulbMesh.position.x = sx; bulbMesh.position.z = LZ + sz;
  shadeMesh.position.x = sx; shadeMesh.position.z = LZ + sz;
  lamp.intensity = lampBaseIntensity * (1 + 0.025 * Math.sin(t * 5.0));
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
