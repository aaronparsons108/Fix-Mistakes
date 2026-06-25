// The sheet of parchment the host slides across the table — used to present the
// list of games and the end-of-session verdict. Canvas-textured plane; rows are
// picked by raycasting and mapping UV → canvas line.

import * as THREE from '../lib/three/three.module.js';
import { tween, tweenVec } from './tween.js';
import { HOST_COLOR } from './host.js';

const CW = 560, CH = 720;

export class Paper {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.canvas = document.createElement('canvas'); this.canvas.width = CW; this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.lineBoxes = [];
    this.hidden = true;

    // self-illuminated so the writing reads regardless of where the candles are
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.6,
      roughness: 0.9, transparent: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.34), mat);
    this.mesh.rotation.x = -0.74;   // reclined to face the high camera, held up close
    this.mesh.position.set(0, 2.9, 3.7);
    this.mesh.visible = false;
    this.mesh.castShadow = true;
    this.mesh.add(this._hand());      // the host's hand grips the bottom edge
    scene.add(this.mesh);
    this._bg();
  }

  // a big green hand gripping the bottom of the sheet — fingers wrap over the
  // front edge so it clearly reads as "held up for you"
  _hand() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: HOST_COLOR, roughness: 0.6, metalness: 0.08, emissive: 0x2c4a16, emissiveIntensity: 0.55 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.42), mat);
    palm.position.set(0, -0.34, -0.18); g.add(palm);
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.5, 18, 1, false, 0, Math.PI), mat);
    knuckle.rotation.z = Math.PI / 2; knuckle.position.set(0, -0.06, 0.0); g.add(knuckle);
    for (let i = 0; i < 4; i++) {
      const fx = -0.56 + i * 0.375;
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 5, 10), mat);
      finger.position.set(fx, 0.04, 0.2); finger.rotation.x = 1.36; g.add(finger);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
      tip.position.set(fx, 0.28, 0.22); g.add(tip);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 5, 10), mat);
    thumb.position.set(-0.82, -0.12, 0.12); thumb.rotation.z = 0.8; thumb.rotation.x = 0.85; g.add(thumb);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(0, -1.62, 0);   // grip the very bottom edge, below the list
    return g;
  }

  _bg() {
    const x = this.ctx;
    x.fillStyle = '#d8c69a'; x.fillRect(0, 0, CW, CH);
    for (let i = 0; i < 150; i++) { x.globalAlpha = 0.04; x.fillStyle = i % 2 ? '#7a6038' : '#b39a64'; x.beginPath(); x.arc(Math.random() * CW, Math.random() * CH, Math.random() * 46, 0, 7); x.fill(); }
    x.globalAlpha = 0.5; x.strokeStyle = '#6b5331'; x.lineWidth = 3;
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(10 + Math.random() * 4, 12 + i * 1); x.lineTo(CW - 10, 12); x.stroke(); }
    x.globalAlpha = 1; x.strokeStyle = '#5a4632'; x.lineWidth = 5; x.strokeRect(14, 14, CW - 28, CH - 28);
    x.fillStyle = 'rgba(60,40,20,0.10)'; // edge burn
    x.fillRect(0, 0, CW, 26); x.fillRect(0, CH - 26, CW, 26);
  }

  _title(text) {
    const x = this.ctx;
    x.fillStyle = '#3a2c1d'; x.textAlign = 'center';
    x.font = "italic 40px 'IM Fell English', Georgia, serif";
    x.fillText(text, CW / 2, 78);
    x.strokeStyle = '#6b5331'; x.lineWidth = 2; x.beginPath(); x.moveTo(70, 100); x.lineTo(CW - 70, 100); x.stroke();
    x.textAlign = 'left';
  }

  drawGameList(games) {
    this._bg(); this._title('Your recent defeats');
    const x = this.ctx; this.lineBoxes = [];
    const items = games.slice(0, 6);   // leave the bottom margin clear for the hand
    items.forEach((g, i) => {
      const y = 142 + i * 68;
      this.lineBoxes.push({ y0: y - 30, y1: y + 34, index: i });
      x.fillStyle = i % 2 ? 'rgba(120,90,50,0.08)' : 'rgba(120,90,50,0.03)';
      x.fillRect(34, y - 30, CW - 68, 62);
      x.fillStyle = '#2c2114'; x.font = "29px 'IM Fell English', Georgia, serif";
      x.fillText(`vs ${g.opponent}`, 50, y);
      x.fillStyle = '#7a2618'; x.font = "19px 'Special Elite', monospace";
      x.fillText(`${g.resultReason}`, 50, y + 24);
      x.fillStyle = '#6a5638'; x.textAlign = 'right';
      x.font = "19px 'Special Elite', monospace";
      x.fillText(`${g.opponentRating ?? '?'} · ${g.timeClass}`, CW - 50, y);
      x.fillText(g.userColor === 'w' ? 'you: white' : 'you: black', CW - 50, y + 24);
      x.textAlign = 'left';
    });
    x.fillStyle = '#6a5638'; x.font = "italic 18px 'IM Fell English', serif"; x.textAlign = 'center';
    x.fillText('— click one to relive it —', CW / 2, 142 + items.length * 68 + 8);
    x.textAlign = 'left';
    this.tex.needsUpdate = true;
  }

  async slideIn() {
    this.mesh.visible = true; this.hidden = false;
    this.mesh.position.set(0, 1.0, -4.0);   // start low near the host
    // he reaches out and holds it up close for you to read
    await tweenVec(this.mesh.position, { z: 3.7, y: 2.9 }, 850, 'easeInOutQuad');
  }
  async slideOut() {
    if (this.hidden) return;
    await tweenVec(this.mesh.position, { z: -4.2, y: 0.9 }, 600, 'easeInOutQuad');
    this.mesh.visible = false; this.hidden = true;
  }

  // World position of the gripping hand (for the host's reaching arm).
  handWorld() { return this.mesh.localToWorld(new THREE.Vector3(0, -1.62, -0.15)); }

  // Returns the picked game index, or -1.
  pick(clientX, clientY) {
    if (this.hidden) return -1;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.mesh)[0];
    if (!hit || !hit.uv) return -1;
    const py = (1 - hit.uv.y) * CH;
    const box = this.lineBoxes.find((b) => py >= b.y0 && py <= b.y1);
    return box ? box.index : -1;
  }
}
