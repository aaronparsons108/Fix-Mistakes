// The host: a giant pawn that sits across the table — Leshy-like, two big
// glowing eyes. Bobs, blinks, looks at the player/board, leans in to slide the
// paper, and reacts to the player's moves.

import * as THREE from '../lib/three/three.module.js';
import { tween } from './tween.js';
import { pawnModel } from './pieces.js';

export const HOST_COLOR = 0x3f5a2a;   // mossy green — the thing across the table

const V = (r, y) => new THREE.Vector2(r, y);
const PAWN = [V(0.30, 0), V(0.31, 0.05), V(0.20, 0.11), V(0.13, 0.24), V(0.19, 0.32), V(0.10, 0.42), V(0.075, 0.54), V(0.17, 0.62), V(0.165, 0.72), V(0.0, 0.74)];

export class Host {
  constructor(scene) {
    this.group = new THREE.Group();
    // human-sized giant standing behind the table — only the top half clears
    // the board's far edge, so he looms over the position
    this.group.position.set(0, -1.7, -6.0);
    this.group.scale.setScalar(2.4);
    this.baseY = -1.7;
    this.mood = 0;          // -1 droop … +1 perky
    this.lean = 0;
    this.blink = 0;         // 0 open, 1 shut
    this.nextBlink = 1.5;
    this.scene = scene;

    this.skin = new THREE.MeshStandardMaterial({ color: HOST_COLOR, roughness: 0.6, metalness: 0.05, emissive: 0x0c1404, emissiveIntensity: 0.4 });
    // fallback procedural body until the real pawn model is attached
    this.body = new THREE.Mesh(new THREE.LatheGeometry(PAWN, 36), this.skin);
    this.body.scale.set(2.7, 2.7, 2.7);
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.group.add(this.body);

    this.eyeL = this._eye(-1);
    this.eyeR = this._eye(1);
    this.group.add(this.eyeL.g, this.eyeR.g);

    // heavy brows for expression
    this.browL = this._brow(-1);
    this.browR = this._brow(1);
    this.group.add(this.browL, this.browR);

    scene.add(this.group);
  }

  // Swap the fallback body for the real board-pawn model (kept green), so the
  // host matches the pieces on the table.
  attachPawnModel() {
    const m = pawnModel();
    if (!m) return;
    m.traverse((o) => { if (o.isMesh) { o.material = this.skin; o.castShadow = true; o.receiveShadow = true; } });
    m.scale.setScalar(2.6);   // giant version of the on-board pawn
    this.group.remove(this.body);
    this.body = m;
    this.group.add(m);
  }

  _eye(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.26, 1.92, 0.42);   // smaller, higher, on top of the head
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.4, emissive: 0x4a3414, emissiveIntensity: 0.5 })
    );
    const irisGrp = new THREE.Group();
    const iris = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x0c0703, roughness: 0.25, emissive: 0x180a00, emissiveIntensity: 0.6 })
    );
    iris.position.z = 0.12;
    irisGrp.add(iris);
    // eyelid: a full dome that sweeps down over the eye only during a blink;
    // hidden when open so it never shows as a line across the eyeball
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0x2a3a1c, roughness: 0.55 })
    );
    lid.scale.y = 0.02;
    lid.visible = false;
    g.add(white, irisGrp, lid);
    return { g, iris: irisGrp, lid, side };
  }

  _brow(side) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.055, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1a2410, roughness: 0.7 })
    );
    b.position.set(side * 0.26, 2.12, 0.44);
    return b;
  }

  // World point on the body where the reaching arm attaches.
  shoulderWorld() { return this.group.localToWorld(new THREE.Vector3(0.5, 1.0, 0.55)); }

  // Aim both irises at a world point (e.g. a board square), or null for the player.
  lookAt(worldPoint) {
    const target = worldPoint || new THREE.Vector3(0, 3.5, 7.5); // the player
    for (const e of [this.eyeL, this.eyeR]) {
      const local = this.group.worldToLocal(target.clone()).sub(e.g.position).normalize();
      e.iris.position.set(local.x * 0.05, local.y * 0.035, 0.0);
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

    // blink: the dome lid grows over the full eye, then retracts; hidden when open
    if (t > this.nextBlink && this.blink === 0) { this.blink = 0.0001; this._blinkDir = 1; }
    if (this.blink > 0) {
      this.blink += (this._blinkDir || 1) * dt * 9;
      if (this.blink >= 1) { this.blink = 1; this._blinkDir = -1; }
      if (this.blink <= 0 && this._blinkDir < 0) { this.blink = 0; this.nextBlink = t + 2 + Math.random() * 4; }
      const s = 0.02 + 1.04 * Math.max(0, this.blink);
      for (const e of [this.eyeL, this.eyeR]) { e.lid.visible = this.blink > 0.03; e.lid.scale.y = s; }
    } else {
      this.eyeL.lid.visible = false; this.eyeR.lid.visible = false;
    }
  }
}
