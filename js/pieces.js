// Chess pieces loaded from real GLB models (assets/models/*.glb) via GLTFLoader.
// Each model is normalised (scaled to a target height, recentred, based at y=0)
// into a template; makePiece() clones the template and paints it ivory or dark.
//
// Models: github.com/ordamari/3d-chess (see assets/models/SOURCE.txt).

import * as THREE from '../lib/three/three.module.js';
import { GLTFLoader } from '../lib/three/addons/loaders/GLTFLoader.js';

// warm polished ivory and a richer walnut that still reads in the dark
export const matBone = new THREE.MeshStandardMaterial({ color: 0xece1c8, roughness: 0.38, metalness: 0.04, emissive: 0x140f06, emissiveIntensity: 0.15 });
export const matDark = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.4, metalness: 0.12, emissive: 0x0c0805, emissiveIntensity: 0.3 });

const FILE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const TARGET_H = { p: 0.80, n: 0.86, b: 1.0, r: 0.84, q: 1.12, k: 1.28 };

const templates = {};
let loaded = false;

export async function loadPieces() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(FILE).map(async ([type, name]) => {
    const gltf = await loader.loadAsync(`assets/models/${name}.glb`);
    templates[type] = normalize(gltf.scene, TARGET_H[type]);
  }));
  loaded = true;
}

export function piecesReady() { return loaded; }

// A clone of the normalised pawn model (for the host body), unpainted.
export function pawnModel() { return templates.p ? templates.p.clone(true) : null; }

// Scale to a target height, recentre on x/z, sit the base on y = 0.
function normalize(scene, targetH) {
  let box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  scene.scale.setScalar(targetH / (size.y || 1));
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= box.min.y;
  const wrap = new THREE.Group();
  wrap.add(scene);
  return wrap;
}

// makePiece('q','w') → THREE.Group standing with base at y = 0.
export function makePiece(type, color) {
  const t = templates[type];
  const g = t ? t.clone(true) : new THREE.Group();
  const mat = color === 'w' ? matBone : matDark;
  g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
  // the model's knight faces along X; turn it down the board so each side
  // faces the enemy (white toward −z, black toward +z)
  if (type === 'n') g.rotation.y = color === 'w' ? -Math.PI / 2 : Math.PI / 2;
  g.userData = { type, color };
  return g;
}
