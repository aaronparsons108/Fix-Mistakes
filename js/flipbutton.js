// A small 3D red push-button wired up beside the board. Click it to flip the
// board to the other side's view.

import * as THREE from '../lib/three/three.module.js';
import { tween } from './tween.js';

export class FlipButton {
  constructor(scene, onPress) {
    this.onPress = onPress;
    this.group = new THREE.Group();
    this.group.position.set(5.5, 0.1, 4.4); // to the right of the board, near the player
    this.group.rotation.x = -0.3;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.74, 0.32, 28),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.55, metalness: 0.6 })
    );
    base.castShadow = true; base.receiveShadow = true; this.group.add(base);

    this.cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.52, 0.36, 28),
      new THREE.MeshStandardMaterial({ color: 0xd61f1f, roughness: 0.38, metalness: 0.1, emissive: 0x3a0606, emissiveIntensity: 0.55 })
    );
    this.cap.position.y = 0.3; this.cap.castShadow = true; this.group.add(this.cap);
    this._capY = 0.3;

    const label = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 28),
      new THREE.MeshBasicMaterial({ map: this._labelTexture(), transparent: true, toneMapped: false, depthWrite: false })
    );
    label.rotation.x = -Math.PI / 2; label.position.y = 0.481; this.cap.add(label);

    // a wire trailing from the base off toward the floor
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.5, -0.12, 0.1), new THREE.Vector3(1.4, -1.4, 0.7),
      new THREE.Vector3(2.4, -3.0, 1.4), new THREE.Vector3(2.7, -4.5, 2.0),
    ]);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 28, 0.055, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 })
    );
    this.group.add(wire);

    scene.add(this.group);
  }

  _labelTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = '#fff'; x.font = 'bold 36px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('FLIP', 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  press() {
    tween({ ms: 100, ease: 'easeOutCubic', onUpdate: (v) => { this.cap.position.y = this._capY - 0.13 * v; } })
      .then(() => tween({ ms: 170, ease: 'easeOutCubic', onUpdate: (v) => { this.cap.position.y = this._capY - 0.13 * (1 - v); } }));
    this.onPress?.();
  }

  hitTest(raycaster) { return raycaster.intersectObject(this.cap, true).length > 0; }
}
