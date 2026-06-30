// The cabin: renderer, camera, room, table, a single hanging lamp over the
// board, vignette, and the render loop. Inscryption / Leshy's-house mood — a
// dark room with one warm pool of light on the table.

import * as THREE from '../lib/three/three.module.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x09090b);
scene.fog = new THREE.FogExp2(0x0c0c0f, 0.028);

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

/* ── room: the fully-enclosed inside of a grey brick tower ── */
function buildRoom() {
  const brick = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.97, metalness: 0, side: THREE.BackSide });
  // round tower wall (inside-facing), tall enough to seal floor→ceiling
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 34, 56, 1, true), brick);
  wall.position.set(0, 8, -1); wall.receiveShadow = true;
  scene.add(wall);

  // solid stone floor that runs under the wall (no gap, no grid showing void)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(17, 56),
    new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -4.5, -1); floor.receiveShadow = true;
  scene.add(floor);

  // ceiling cap so nothing opens to the sky overhead
  const ceil = new THREE.Mesh(
    new THREE.CircleGeometry(17, 56),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 1, side: THREE.DoubleSide })
  );
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 24.5, -1);
  scene.add(ceil);

  // the board floats; the host stands behind it on the floor
  buildWindow();
  buildGodRay();
  buildTorches();
}

// a soft shaft of moonlight slanting in from the window
function buildGodRay() {
  const W = new THREE.Vector3(-8.6, 2.4, -12.2), F = new THREE.Vector3(-2.5, -4.4, -3.5);
  const len = W.distanceTo(F);
  const ray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 2.6, len, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xbed2ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  ray.position.copy(W.clone().add(F).multiplyScalar(0.5));
  ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), W.clone().sub(F).normalize());
  ray.renderOrder = 2;
  scene.add(ray);
}

// flickering wall torches for tower atmosphere
const torchFlames = [], torchLights = [];
function buildTorches() {
  const flameMat = () => new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7, metalness: 0.5 });
  for (const x of [-12.5, 12.5]) {
    const z = -3, y = 2.2;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), bracketMat);
    stick.position.set(x, y, z); stick.rotation.z = x < 0 ? -0.5 : 0.5; scene.add(stick);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.0), flameMat());
    flame.position.set(x + (x < 0 ? 0.5 : -0.5), y + 0.7, z); scene.add(flame); torchFlames.push(flame);
    const light = new THREE.PointLight(0xff9a3c, 14, 12, 2.0);
    light.position.set(x + (x < 0 ? 0.9 : -0.9), y + 0.7, z); scene.add(light); torchLights.push(light);
  }
}

// slow dust motes drifting through the lamplight
let motes;
function buildMotes() {
  const N = 150;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 13;
    pos[i * 3 + 1] = Math.random() * 6.5;
    pos[i * 3 + 2] = -1 + (Math.random() - 0.5) * 11;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffe6c0, size: 0.055, transparent: true, opacity: 0.32,
    depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  scene.add(motes);
}
function driftMotes(t) {
  if (!motes) return;
  const p = motes.geometry.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    p[i] += Math.sin(t * 0.25 + i) * 0.0006;
    p[i + 1] += 0.0035;
    if (p[i + 1] > 6.5) p[i + 1] = 0;
  }
  motes.geometry.attributes.position.needsUpdate = true;
}

// a tall arched window with a full moon in a dark sky, off to the left
function buildWindow() {
  const wy = 2.4, wx = -8.6, wz = -12.2;
  const g = new THREE.Group();
  g.position.set(wx, wy, wz);
  g.lookAt(2, 1.2, 9.2);   // face the camera so the moon reads
  // the brick wall sits right behind the window, so just a thin stone frame
  // around the opening — no big surround plane (that read as a black box)
  const stone = new THREE.MeshStandardMaterial({ color: 0x55555c, roughness: 0.95 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.8), stone);
  frame.position.z = -0.1; g.add(frame);
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 4.3),
    new THREE.MeshBasicMaterial({ map: nightSkyTexture(), toneMapped: false })
  );
  g.add(sky);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.9 });
  const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 4.3, 0.16), barMat); vbar.position.z = 0.06; g.add(vbar);
  const hbar = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.13, 0.16), barMat); hbar.position.z = 0.06; g.add(hbar);
  scene.add(g);

  // cold moonlight spilling in from the window (softer, less blue wash)
  const moon = new THREE.PointLight(0xb8cdff, 36, 40, 2.0);
  moon.position.set(-6.0, 4.5, -7.5);
  scene.add(moon);
  scene.add(new THREE.HemisphereLight(0x24262c, 0x0c0c0f, 0.18)); // faint neutral fill
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
  // plain mottled dark stone — no grid lines
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#2f2f34'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    x.globalAlpha = 0.05 + Math.random() * 0.06;
    const v = 30 + Math.floor(Math.random() * 36);
    x.fillStyle = `rgb(${v},${v},${v + 3})`;
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 9, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5);
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
  // torches flicker + face the camera
  for (let i = 0; i < torchFlames.length; i++) {
    const f = 1 + 0.18 * Math.sin(t * 13 + i * 2) + 0.1 * Math.sin(t * 27 + i);
    torchFlames[i].lookAt(camera.position);
    torchFlames[i].scale.set(0.9 + 0.15 * Math.sin(t * 19 + i), f, 1);
    torchLights[i].intensity = 14 * f;
  }
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
