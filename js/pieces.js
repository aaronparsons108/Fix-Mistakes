// Procedural Staunton chess set from core THREE geometry. The turned pieces
// (pawn/rook/bishop/queen/king) are LatheGeometry of a refined silhouette; the
// knight is an extruded horse-head on a turned base. Two finishes: warm ivory
// and dark walnut. Built to read as a real turned set, not blobs.

import * as THREE from '../lib/three/three.module.js';

export const matBone = new THREE.MeshStandardMaterial({ color: 0xeaddc2, roughness: 0.42, metalness: 0.0 });
export const matDark = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 0.4, metalness: 0.05 });

const V = (r, y) => new THREE.Vector2(r, y);

// Silhouettes, base→top, radius in square units. Bases share a foot+collar so
// the set looks consistent; heights tuned for a slim, elegant Staunton.
const PROFILES = {
  p: [V(0.00,0), V(0.30,0), V(0.34,0.03), V(0.34,0.07), V(0.27,0.11), V(0.18,0.15),
      V(0.135,0.20), V(0.125,0.34), V(0.155,0.40), V(0.12,0.44), V(0.115,0.47),
      V(0.205,0.55), V(0.215,0.63), V(0.175,0.71), V(0.085,0.78), V(0.0,0.80)],
  r: [V(0.00,0), V(0.34,0), V(0.38,0.035), V(0.38,0.085), V(0.30,0.12), V(0.225,0.16),
      V(0.205,0.20), V(0.20,0.55), V(0.225,0.60), V(0.31,0.66), V(0.31,0.70),
      V(0.265,0.74), V(0.265,0.92), V(0.30,0.92), V(0.30,0.98), V(0.0,0.98)],
  b: [V(0.00,0), V(0.33,0), V(0.37,0.035), V(0.37,0.085), V(0.29,0.12), V(0.20,0.16),
      V(0.155,0.22), V(0.135,0.52), V(0.115,0.62), V(0.20,0.68), V(0.155,0.74),
      V(0.10,0.80), V(0.075,0.92), V(0.13,1.00), V(0.155,1.05), V(0.115,1.10),
      V(0.06,1.15), V(0.075,1.20), V(0.0,1.22)],
  q: [V(0.00,0), V(0.37,0), V(0.41,0.04), V(0.41,0.095), V(0.32,0.13), V(0.225,0.18),
      V(0.175,0.26), V(0.135,0.60), V(0.115,0.74), V(0.22,0.80), V(0.165,0.88),
      V(0.135,0.96), V(0.255,1.06), V(0.255,1.12), V(0.10,1.16), V(0.135,1.24),
      V(0.0,1.28)],
  k: [V(0.00,0), V(0.39,0), V(0.43,0.04), V(0.43,0.10), V(0.33,0.14), V(0.235,0.19),
      V(0.185,0.28), V(0.145,0.64), V(0.12,0.80), V(0.23,0.86), V(0.175,0.94),
      V(0.145,1.02), V(0.255,1.12), V(0.255,1.18), V(0.155,1.24), V(0.165,1.32),
      V(0.0,1.34)],
};

const latheCache = {};
function lathe(type) {
  if (!latheCache[type]) {
    const g = new THREE.LatheGeometry(PROFILES[type], 40);
    g.computeVertexNormals();
    latheCache[type] = g;
  }
  return latheCache[type];
}

function addDecor(type, group, mat) {
  if (type === 'r') {
    // four square crenellations cut into the top platform
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.13), mat);
      tooth.position.set(Math.cos(a) * 0.205, 0.97, Math.sin(a) * 0.205);
      tooth.rotation.y = a;
      group.add(tooth);
    }
  } else if (type === 'b') {
    // the bishop's slit
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.34), matDark);
    slit.position.set(0, 1.02, 0); group.add(slit);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), mat);
    ball.position.y = 1.27; group.add(ball);
  } else if (type === 'q') {
    // coronet of points
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pt = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 8), mat);
      pt.position.set(Math.cos(a) * 0.2, 1.18, Math.sin(a) * 0.2);
      group.add(pt);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat);
      b.position.set(Math.cos(a) * 0.2, 1.26, Math.sin(a) * 0.2);
      group.add(b);
    }
    const crownBall = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat);
    crownBall.position.y = 1.3; group.add(crownBall);
  } else if (type === 'k') {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), mat); v.position.y = 1.46; group.add(v);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.07), mat); h.position.y = 1.42; group.add(h);
  }
}

// Horse-head silhouette, extruded — a recognizable knight.
const HEAD_SHAPE = (() => {
  const s = new THREE.Shape();
  const pts = [
    [-0.20, -0.34], [-0.24, -0.05], [-0.255, 0.18], [-0.215, 0.30], [-0.13, 0.345],
    [-0.16, 0.265], [-0.05, 0.34], [0.06, 0.355], [0.05, 0.27], [0.16, 0.30],
    [0.275, 0.165], [0.305, 0.045], [0.235, 0.0], [0.255, -0.07], [0.13, -0.085],
    [0.06, -0.075], [0.045, -0.17], [-0.04, -0.18], [-0.075, -0.34],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
})();

function knightHeadGeo() {
  if (!latheCache._knhead) {
    const g = new THREE.ExtrudeGeometry(HEAD_SHAPE, {
      depth: 0.26, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, steps: 1,
    });
    g.translate(0, 0, -0.17); // centre the extrusion on z
    g.computeVertexNormals();
    latheCache._knhead = g;
  }
  return latheCache._knhead;
}

function buildKnight(group, mat) {
  // turned base (reuse the pawn foot/collar, capped lower)
  const baseProfile = [V(0.00,0), V(0.32,0), V(0.36,0.035), V(0.36,0.08), V(0.28,0.12),
    V(0.20,0.16), V(0.165,0.22), V(0.155,0.34), V(0.20,0.40), V(0.18,0.44), V(0.0,0.45)];
  const base = new THREE.Mesh(new THREE.LatheGeometry(baseProfile, 36), mat);
  base.computeVertexNormals?.();
  group.add(base);
  const head = new THREE.Mesh(knightHeadGeo(), mat);
  head.scale.setScalar(1.18);
  head.position.set(0.02, 0.74, 0);
  head.rotation.y = -Math.PI / 2;   // snout faces +z by default (toward white)
  group.add(head);
}

const TYPES = { p: 'p', r: 'r', n: 'n', b: 'b', q: 'q', k: 'k' };

// makePiece('q','w') → THREE.Group standing with base at y=0.
export function makePiece(type, color) {
  const mat = color === 'w' ? matBone : matDark;
  const g = new THREE.Group();
  if (TYPES[type] === 'n') {
    buildKnight(g, mat);
    // knights face the enemy: white toward the black side (board −z), black toward white
    if (color === 'w') g.rotation.y = Math.PI;
  } else {
    g.add(new THREE.Mesh(lathe(type), mat));
    addDecor(type, g, mat);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { type, color };
  return g;
}
