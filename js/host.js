// The host: a giant pawn that sits across the table — Leshy-like, two big
// glowing eyes. Bobs, blinks, looks at the player/board, leans in to slide the
// paper, and reacts to the player's moves.

import * as THREE from '../lib/three/three.module.js';
import { tween } from './tween.js';

const V = (r, y) => new THREE.Vector2(r, y);
const PAWN = [V(0.30, 0), V(0.31, 0.05), V(0.20, 0.11), V(0.13, 0.24), V(0.19, 0.32), V(0.10, 0.42), V(0.075, 0.54), V(0.17, 0.62), V(0.165, 0.72), V(0.0, 0.74)];

export class Host {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, -5.4);
    this.baseY = 0;
    this.mood = 0;          // -1 droop … +1 perky
    this.lean = 0;
    this.blink = 0;         // 0 open, 1 shut
    this.nextBlink = 1.5;
    this.scene = scene;

    const skin = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.55, metalness: 0.08, emissive: 0x0a0703, emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.LatheGeometry(PAWN, 36), skin);
    body.scale.set(2.7, 2.7, 2.7);
    body.castShadow = true; body.receiveShadow = true;
    this.group.add(body);

    this.eyeL = this._eye(-1);
    this.eyeR = this._eye(1);
    this.group.add(this.eyeL.g, this.eyeR.g);

    // heavy brows for expression
    this.browL = this._brow(-1);
    this.browR = this._brow(1);
    this.group.add(this.browL, this.browR);

    scene.add(this.group);
  }

  _eye(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.46, 1.62, 0.62);
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 22, 18),
      new THREE.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.4, emissive: 0x4a3414, emissiveIntensity: 0.5 })
    );
    const irisGrp = new THREE.Group();
    const iris = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0703, roughness: 0.25, emissive: 0x180a00, emissiveIntensity: 0.6 })
    );
    iris.position.z = 0.21;
    irisGrp.add(iris);
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.315, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.55 })
    );
    lid.scale.y = 0.02;
    g.add(white, irisGrp, lid);
    return { g, iris: irisGrp, lid, side };
  }

  _brow(side) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a130d, roughness: 0.7 })
    );
    b.position.set(side * 0.46, 1.96, 0.66);
    return b;
  }

  // Aim both irises at a world point (e.g. a board square), or null for the player.
  lookAt(worldPoint) {
    const target = worldPoint || new THREE.Vector3(0, 3.5, 7.5); // the player
    for (const e of [this.eyeL, this.eyeR]) {
      const local = this.group.worldToLocal(target.clone()).sub(e.g.position).normalize();
      e.iris.position.set(local.x * 0.09, local.y * 0.06, 0.0);
    }
  }

  react(kind) {
    if (kind === 'best') { this.mood = 1; this._pop(1.0); this._brows(0.25); }
    else if (kind === 'great') { this.mood = 0.6; this._pop(0.6); this._brows(0.15); }
    else if (kind === 'good') { this.mood = 0; this._brows(-0.1); }
    else if (kind === 'bad') { this.mood = -1; this._brows(-0.35); this._shake(); }
    else { this.mood = 0; this._brows(0); }
  }

  _brows(angle) {
    tween({ ms: 260, ease: 'easeOutCubic', onUpdate: (v) => {
      this.browL.rotation.z = -angle * v; this.browR.rotation.z = angle * v;
    } });
  }
  _pop(amp) {
    tween({ ms: 420, ease: 'easeOutCubic', onUpdate: (v) => { this._popY = Math.sin(v * Math.PI) * 0.18 * amp; }, onComplete: () => { this._popY = 0; } });
  }
  _shake() {
    tween({ ms: 380, onUpdate: (v) => { this._shakeX = Math.sin(v * Math.PI * 4) * 0.12 * (1 - v); }, onComplete: () => { this._shakeX = 0; } });
  }

  // Lean in toward the player (used while sliding the paper across).
  async leanIn() {
    await tween({ ms: 550, ease: 'easeInOutQuad', onUpdate: (v) => { this.lean = v * 0.2; } });
  }
  async leanBack() {
    await tween({ ms: 550, ease: 'easeInOutQuad', onUpdate: (v) => { this.lean = 0.2 * (1 - v); } });
  }

  update(t, dt) {
    // bob + sway, modulated by mood
    const amp = 0.045 + (this.mood > 0 ? 0.02 * this.mood : 0);
    this.group.position.y = this.baseY + Math.sin(t * 1.1) * amp + (this._popY || 0);
    this.group.position.x = (this._shakeX || 0);
    this.group.rotation.z = Math.sin(t * 0.7) * 0.02;
    this.group.rotation.x = this.lean + (this.mood < 0 ? 0.08 : 0);

    // blink
    if (t > this.nextBlink && this.blink === 0) { this.blink = 0.0001; this._blinkDir = 1; }
    if (this.blink > 0) {
      this.blink += (this._blinkDir || 1) * dt * 9;
      if (this.blink >= 1) { this.blink = 1; this._blinkDir = -1; }
      if (this.blink <= 0 && this._blinkDir < 0) { this.blink = 0; this.nextBlink = t + 2 + Math.random() * 4; }
      const s = 0.02 + 0.98 * Math.max(0, this.blink);
      this.eyeL.lid.scale.y = s; this.eyeR.lid.scale.y = s;
    }
  }
}
