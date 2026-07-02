// The card deck + the chest. Each blunder we quiz is a collectible-style card
// showing a 2D (chess.com-like) diagram of the position with a RED arrow for the
// move you actually played. When you solve it, a GREEN arrow for the right move
// is added and the card flies into a chest at the back of the room.

import * as THREE from '../lib/three/three.module.js';
import { tween, tweenVec, FAST } from './tween.js';
import { classifyMistake } from './store.js';

const CW = 512, CH = 632;                 // card canvas
const BOARD = 448, BX = 32, BY = 34;      // 2D board inset within the card
const LIGHT = '#e9edcc', DARK = '#6f9350';
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// where cards live in the world (left of the board, clear of the eval bar,
// the rope, and the flip button)
const STACK = new THREE.Vector3(-6.5, -1.2, 2.2);
const ACTIVE = new THREE.Vector3(-6.3, 2.5, -0.4);
const CHEST = new THREE.Vector3(-6.1, -4.5, -3.8);

function sqToRC(sq, orient) {
  const f = sq.charCodeAt(0) - 97;        // 0..7 for a..h
  const rd = 8 - parseInt(sq[1], 10);     // 0 = rank8 … 7 = rank1
  return orient === 'w' ? { row: rd, col: f } : { row: 7 - rd, col: 7 - f };
}

// Draw a chess.com-style board with pieces and any arrows onto a card canvas.
function drawDiagram(ctx, fen, orient, arrows) {
  const sq = BOARD / 8;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
    ctx.fillRect(BX + c * sq, BY + r * sq, sq, sq);
  }
  // pieces
  const rows = fen.split(' ')[0].split('/');   // rank8 … rank1
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${sq * 0.8}px "DejaVu Sans", "Segoe UI Symbol", "Noto Sans Symbols", serif`;
  for (let ri = 0; ri < 8; ri++) {
    let c = 0;
    for (const ch of rows[ri]) {
      if (/\d/.test(ch)) { c += +ch; continue; }
      const rank = 8 - ri;                      // 8 … 1
      const sqName = String.fromCharCode(97 + c) + rank;
      const { row, col } = sqToRC(sqName, orient);
      const x = BX + col * sq + sq / 2, y = BY + row * sq + sq / 2 + sq * 0.02;
      const white = ch === ch.toUpperCase();
      ctx.lineWidth = sq * 0.06;
      ctx.strokeStyle = white ? '#2a2a2a' : '#050505';
      ctx.fillStyle = white ? '#fafafa' : '#2c2c2c';
      const g = GLYPH[ch.toLowerCase()];
      ctx.strokeText(g, x, y); ctx.fillText(g, x, y);
      c++;
    }
  }
  // arrows
  const sc = (name) => { const { row, col } = sqToRC(name, orient); return { x: BX + col * sq + sq / 2, y: BY + row * sq + sq / 2 }; };
  for (const a of arrows) {
    const p0 = sc(a.from), p1 = sc(a.to);
    ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
    ctx.lineWidth = sq * 0.2; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const head = sq * 0.42, back = sq * 0.34;
    const ex = p1.x - Math.cos(ang) * back, ey = p1.y - Math.sin(ang) * back;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x - Math.cos(ang - 0.42) * head, p1.y - Math.sin(ang - 0.42) * head);
    ctx.lineTo(p1.x - Math.cos(ang + 0.42) * head, p1.y - Math.sin(ang + 0.42) * head);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class PositionCard {
  constructor(scene, moment, idx) {
    this.m = moment; this.idx = idx; this.solved = false;
    this.canvas = document.createElement('canvas'); this.canvas.width = CW; this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;

    this.group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(2.34, 2.86),
      new THREE.MeshStandardMaterial({ color: 0x0f0e0c, roughness: 0.8, metalness: 0.1 })
    );
    frame.position.z = -0.02; this.group.add(frame);
    this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.72),
      new THREE.MeshStandardMaterial({ map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.92, roughness: 0.9 })
    );
    this.group.add(this.face);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.render();
    scene.add(this.group);
  }

  render() {
    const m = this.m, x = this.ctx;
    x.fillStyle = '#1b1815'; x.fillRect(0, 0, CW, CH);
    x.strokeStyle = '#c9a24b'; x.lineWidth = 5; x.strokeRect(9, 9, CW - 18, CH - 18);
    // board
    drawDiagram(x, m.fen, m.userColor, this.arrows());
    // caption
    const cy = BY + BOARD + 34;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#e7dcc2'; x.font = "26px 'Special Elite', Georgia, serif";
    const tag = this._tag || (this._tag = classifyMistake(m));
    x.fillText(`Move ${m.moveNumber}${tag ? ' · ' + tag : ''}`, 34, cy);
    x.fillStyle = '#e0655a'; x.font = "22px 'Special Elite', monospace";
    x.fillText(`you played  ${m.playedSan}`, 34, cy + 34);
    if (this.solved) { x.fillStyle = '#5cc06a'; x.fillText(`better:  ${m.bestSan}`, 34, cy + 66); }
    this.tex.needsUpdate = true;
  }

  arrows() {
    const a = [{ from: this.m.playedUci.slice(0, 2), to: this.m.playedUci.slice(2, 4), color: '#e0453a' }];
    if (this.solved) a.push({ from: this.m.bestUci.slice(0, 2), to: this.m.bestUci.slice(2, 4), color: '#46b357' });
    return a;
  }

  markSolved() { if (!this.solved) { this.solved = true; this.render(); } }

  faceCamera(camera) { this.group.lookAt(camera.position); }

  place(v, scale, camera) {
    this.group.position.copy(v); this.group.scale.setScalar(scale); this.faceCamera(camera);
  }
}

class Chest {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.copy(CHEST);
    this.group.rotation.y = -0.5;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a301c, roughness: 0.72, metalness: 0.08 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.5, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.8), wood);
    base.position.y = 0.65; this.group.add(base);
    for (const bx of [-0.9, 0.9]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.34, 1.86), iron);
      band.position.set(bx, 0.65, 0); this.group.add(band);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.12), iron);
    lock.position.set(0, 0.62, 0.92); this.group.add(lock);
    // hinged lid
    this.lid = new THREE.Group(); this.lid.position.set(0, 1.3, -0.9); this.group.add(this.lid);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.8), wood);
    cap.position.set(0, 0.12, 0.9); this.lid.add(cap);
    for (const bx of [-0.9, 0.9]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.54, 1.84), iron);
      band.position.set(bx, 0.12, 0.9); this.lid.add(band);
    }
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // a faint warm glow so the chest reads in the dark back corner
    const glow = new THREE.PointLight(0xffb267, 5.5, 8, 2);
    glow.position.set(0, 1.7, 0.6); this.group.add(glow);
    scene.add(this.group);
  }
  open() { return tween({ ms: 260, ease: 'easeOutCubic', onUpdate: (v) => { this.lid.rotation.x = -1.5 * v; } }); }
  close() { return tween({ ms: 320, ease: 'easeOutCubic', onUpdate: (v) => { this.lid.rotation.x = -1.5 * (1 - v); } }); }
  // world position just inside the open chest
  mouth() { return this.group.localToWorld(new THREE.Vector3(0, 1.0, 0.1)); }
}

export class CardDeck {
  constructor(scene, camera, sounds) {
    this.scene = scene; this.camera = camera; this.sounds = sounds;
    this.chest = new Chest(scene);
    this.cards = [];
    this.active = -1;
  }

  // Re-face the stack + active card at the camera each frame (cheap).
  update() {
    for (const c of this.cards) if (c.group.visible) c.faceCamera(this.camera);
  }

  build(moments) {
    this.reset();
    this.cards = moments.map((m, i) => {
      const card = new PositionCard(this.scene, m, i);
      this._toStack(card, i);
      return card;
    });
  }

  _stackVec(i) {
    const v = STACK.clone();
    v.x += i * 0.05; v.y += i * 0.06; v.z += i * 0.03;
    return v;
  }

  _toStack(card, i) {
    card.place(this._stackVec(i), 0.82, this.camera);
    card.group.rotation.z += (i % 2 ? -1 : 1) * 0.03;
    card.group.renderOrder = i;
  }

  // Return the active card to its slot in the stack (reverse of activate).
  async deactivateToStack(i) {
    const card = this.cards[i]; if (!card) return;
    if (this.active === i) this.active = -1;
    card.group.renderOrder = i;
    await Promise.all([
      tweenVec(card.group.position, this._stackVec(i), 460, 'easeInOutQuad'),
      tween({ ms: 460, ease: 'easeInOutQuad', onUpdate: (v) => card.group.scale.setScalar(1.2 - 0.38 * v) }),
    ]);
    card.faceCamera(this.camera);
  }

  // Pull a previously-sealed card back out of the chest to the active spot.
  async retrieveFromChest(i) {
    const card = this.cards[i]; if (!card) return;
    this.active = i; card._gone = false; card.group.visible = true; card.group.renderOrder = 100;
    card.group.position.copy(this.chest.mouth());
    card.group.scale.setScalar(0.12);
    await this.chest.open();
    await Promise.all([
      tweenVec(card.group.position, ACTIVE, 660, 'easeOutCubic'),
      tween({ ms: 660, ease: 'easeOutCubic', onUpdate: (v) => { card.group.scale.setScalar(0.12 + 1.08 * v); card.group.rotation.x = -1.4 * (1 - v); } }),
    ]);
    card.group.rotation.x = 0; card.faceCamera(this.camera);
    await this.chest.close();
  }

  // Draw card i up beside the board.
  async activate(i) {
    const card = this.cards[i]; if (!card) return;
    this.active = i;
    card.group.renderOrder = 100;
    this.sounds?.tick?.();
    await Promise.all([
      tweenVec(card.group.position, ACTIVE, 620, 'easeOutCubic'),
      tween({ ms: 620, ease: 'easeOutCubic', onUpdate: (v) => { const s = 0.82 + 0.38 * v; card.group.scale.setScalar(s); } }),
    ]);
    card.faceCamera(this.camera);
  }

  // Reveal the right move on the active card (green arrow).
  markSolved(i) { this.cards[i]?.markSolved(); }

  // Send the active/target card into the chest.
  async sendToChest(i) {
    const card = this.cards[i]; if (!card || card._gone) return;
    card._gone = true;
    card.markSolved();
    if (!FAST.on) await this._wait(280);
    await this.chest.open();
    const dest = this.chest.mouth();
    await Promise.all([
      tweenVec(card.group.position, dest, 720, 'easeInOutQuad'),
      tween({ ms: 720, ease: 'easeInOutQuad', onUpdate: (v) => { card.group.scale.setScalar(0.4 - 0.28 * v); card.group.rotation.x = -1.4 * v; } }),
    ]);
    card.group.visible = false;
    this.sounds?.tick?.();
    await this.chest.close();
    if (i === this.active) this.active = -1;
  }

  _wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  reset() {
    for (const c of this.cards) this.scene.remove(c.group);
    this.cards = []; this.active = -1;
  }
}
