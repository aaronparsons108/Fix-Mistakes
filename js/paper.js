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

  // games: the 5 (or fewer) games on this page; opts: { page, hasMore }
  drawGameList(games, { page = 0, hasMore = false } = {}) {
    this._bg(); this._title('Your recent games');
    const x = this.ctx; this.lineBoxes = [];
    const items = games.slice(0, 5);   // 5 per page; bottom margin holds nav + hand
    const RESULT_COLOR = { won: '#3f6a2a', lost: '#7a2618', draw: '#6a5638' };
    items.forEach((g, i) => {
      const y = 142 + i * 68;
      this.lineBoxes.push({ y0: y - 30, y1: y + 34, type: 'game', index: i });
      x.fillStyle = i % 2 ? 'rgba(120,90,50,0.08)' : 'rgba(120,90,50,0.03)';
      x.fillRect(34, y - 30, CW - 68, 62);
      x.fillStyle = '#2c2114'; x.font = "29px 'IM Fell English', Georgia, serif";
      x.fillText(`vs ${g.opponent}`, 50, y);
      x.fillStyle = RESULT_COLOR[g.result] || '#7a2618'; x.font = "19px 'Special Elite', monospace";
      x.fillText(`${g.result} · ${g.resultReason}`, 50, y + 24);
      x.fillStyle = '#6a5638'; x.textAlign = 'right';
      x.font = "19px 'Special Elite', monospace";
      x.fillText(`${g.opponentRating ?? '?'} · ${g.timeClass}`, CW - 50, y);
      x.fillText(g.userColor === 'w' ? 'you: white' : 'you: black', CW - 50, y + 24);
      x.textAlign = 'left';
    });

    // pager row: ‹ newer    page N    older ›
    const ny = 142 + 5 * 68 + 14;
    x.font = "22px 'Special Elite', monospace"; x.textBaseline = 'middle';
    if (page > 0) {
      this.lineBoxes.push({ y0: ny - 22, y1: ny + 22, x0: 34, x1: 200, type: 'prev' });
      x.fillStyle = '#3a2c1d'; x.textAlign = 'left'; x.fillText('‹ newer', 50, ny);
    }
    if (hasMore) {
      this.lineBoxes.push({ y0: ny - 22, y1: ny + 22, x0: CW - 200, x1: CW - 34, type: 'next' });
      x.fillStyle = '#3a2c1d'; x.textAlign = 'right'; x.fillText('older ›', CW - 50, ny);
    }
    x.fillStyle = '#6a5638'; x.font = "italic 18px 'IM Fell English', serif"; x.textAlign = 'center';
    x.fillText(`— click a game · page ${page + 1} —`, CW / 2, ny + 36);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    this.tex.needsUpdate = true;
  }

  // The ledger of owed positions — the ones you couldn't fix, come back to haunt.
  drawLedgerList(cards) {
    this._bg(); this._title('The ledger');
    const x = this.ctx; this.lineBoxes = [];
    const items = cards.slice(0, 5);
    items.forEach((c, i) => {
      const y = 142 + i * 74;
      this.lineBoxes.push({ y0: y - 32, y1: y + 38, type: 'ledger', index: i });
      x.fillStyle = i % 2 ? 'rgba(90,50,40,0.10)' : 'rgba(90,50,40,0.05)';
      x.fillRect(34, y - 32, CW - 68, 68);
      x.fillStyle = '#2c1814'; x.font = "27px 'IM Fell English', Georgia, serif";
      x.fillText(`vs ${c.opponent} · move ${c.moveNumber}`, 50, y - 2);
      x.fillStyle = '#7a2618'; x.font = "20px 'Special Elite', monospace";
      x.fillText(c.theme || 'a mistake', 50, y + 24);
      if (c.returnCount >= 2) {
        x.fillStyle = '#5a4632'; x.textAlign = 'right'; x.font = "italic 18px 'IM Fell English', serif";
        x.fillText(`×${c.returnCount}`, CW - 52, y + 24);
        x.textAlign = 'left';
      }
    });
    // the always-available way out
    const ny = 142 + items.length * 74 + 18;
    this.lineBoxes.push({ y0: ny - 22, y1: ny + 22, type: 'skip' });
    x.fillStyle = '#3a2c1d'; x.font = "22px 'Special Elite', monospace"; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('go on to new games ›', CW / 2, ny);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
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

  // Returns the picked region: { type:'game', index } | { type:'next' } |
  // { type:'prev' }, or null if nothing was hit.
  pick(clientX, clientY) {
    if (this.hidden) return null;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.mesh)[0];
    if (!hit || !hit.uv) return null;
    const px = hit.uv.x * CW, py = (1 - hit.uv.y) * CH;
    const box = this.lineBoxes.find((b) =>
      py >= b.y0 && py <= b.y1 && (b.x0 === undefined || (px >= b.x0 && px <= b.x1)));
    if (!box) return null;
    return (box.type === 'game' || box.type === 'ledger') ? { type: box.type, index: box.index } : { type: box.type };
  }
}
