// Procedural chess pieces from core THREE geometry (LatheGeometry profiles +
// primitive decor). Two material sets: warm bone/ivory and dark walnut.

import * as THREE from '../lib/three/three.module.js';

export const matBone = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.62, metalness: 0.0 });
export const matDark = new THREE.MeshStandardMaterial({ color: 0x2a201a, roughness: 0.5, metalness: 0.06 });

const V = (r, y) => new THREE.Vector2(r, y);
const PROFILES = {
  p: [V(0.30, 0), V(0.31, 0.05), V(0.20, 0.11), V(0.13, 0.24), V(0.19, 0.32), V(0.10, 0.42), V(0.075, 0.54), V(0.17, 0.62), V(0.165, 0.72), V(0.0, 0.74)],
  r: [V(0.33, 0), V(0.34, 0.06), V(0.22, 0.13), V(0.205, 0.55), V(0.27, 0.60), V(0.31, 0.66), V(0.31, 0.82), V(0.0, 0.82)],
  b: [V(0.32, 0), V(0.33, 0.06), V(0.20, 0.13), V(0.14, 0.46), V(0.10, 0.62), V(0.18, 0.68), V(0.12, 0.78), V(0.07, 0.95), V(0.11, 1.02), V(0.0, 1.10)],
  q: [V(0.37, 0), V(0.38, 0.07), V(0.24, 0.15), V(0.15, 0.56), V(0.11, 0.76), V(0.21, 0.84), V(0.14, 0.92), V(0.23, 1.04), V(0.0, 1.10)],
  k: [V(0.38, 0), V(0.39, 0.07), V(0.25, 0.15), V(0.16, 0.62), V(0.12, 0.84), V(0.23, 0.92), V(0.16, 1.00), V(0.21, 1.14), V(0.21, 1.22), V(0.0, 1.24)],
};

const latheCache = {};
function lathe(type) {
  if (!latheCache[type]) latheCache[type] = new THREE.LatheGeometry(PROFILES[type], 28);
  return latheCache[type];
}

function addDecor(type, group, mat) {
  if (type === 'r') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.1), mat);
      c.position.set(Math.cos(a) * 0.22, 0.86, Math.sin(a) * 0.22);
      group.add(c);
    }
  } else if (type === 'q') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), mat);
      sp.position.set(Math.cos(a) * 0.19, 1.08, Math.sin(a) * 0.19);
      group.add(sp);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat);
      ball.position.set(Math.cos(a) * 0.19, 1.16, Math.sin(a) * 0.19);
      group.add(ball);
    }
  } else if (type === 'k') {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), mat); v.position.y = 1.34; group.add(v);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.07, 0.07), mat); h.position.y = 1.34; group.add(h);
  }
}

function buildKnight(group, mat) {
  // base (reuse the pawn lower rings)
  const baseProfile = PROFILES.p.slice(0, 5).concat([V(0.16, 0.34), V(0.0, 0.35)]);
  group.add(new THREE.Mesh(new THREE.LatheGeometry(baseProfile, 24), mat));
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.18), mat);
  neck.position.set(0, 0.5, -0.02); neck.rotation.x = 0.18; group.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.42), mat);
  head.position.set(0, 0.72, 0.1); head.rotation.x = -0.35; group.add(head);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.2), mat);
  muzzle.position.set(0, 0.66, 0.32); muzzle.rotation.x = -0.5; group.add(muzzle);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), mat);
    ear.position.set(s * 0.06, 0.9, -0.04); group.add(ear);
  }
}

// makePiece('q','w') → THREE.Group standing with base at y=0.
export function makePiece(type, color) {
  const mat = color === 'w' ? matBone : matDark;
  const g = new THREE.Group();
  if (type === 'n') {
    buildKnight(g, mat);
    if (color === 'b') g.rotation.y = Math.PI; // face the white side
  } else {
    g.add(new THREE.Mesh(lathe(type), mat));
    addDecor(type, g, mat);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { type, color };
  return g;
}
