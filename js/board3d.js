// The 3D chess board: mesh + frame, square↔world mapping, raycast pointer
// input, move/capture/promotion animation, and highlight tiles. Mirrors the
// method contract the app expects (setPosition, move, highlight, squareCenter…)
// so the quiz logic stays the same as the old 2D board.

import * as THREE from '../lib/three/three.module.js';
import { makePiece } from './pieces.js';
import { tween, tweenVec, FAST } from './tween.js';

const FILES = 'abcdefgh';
export const SQ = 1.0;
export const BOARD_TOP = 0;

const HL = {
  sel:        { color: 0xffb347, opacity: 0.5,  y: 0.014 },
  // the opponent's last move — clearly readable amber-yellow tiles
  'last-from':{ color: 0xe8c24a, opacity: 0.5,  y: 0.010 },
  'last-to':  { color: 0xe8c24a, opacity: 0.62, y: 0.011 },
  check:      { color: 0xff2a2a, opacity: 0.6,  y: 0.012, pulse: true },
  'hint-glow':{ color: 0xffd24a, opacity: 0.5,  y: 0.016, pulse: true },
};

export class Board3D {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.opts = opts;
    this.orientation = 'w';
    this.pieceAt = new Map();      // sq -> THREE.Group
    this.fx = [];                  // active highlight meshes {sq, cls, mesh}
    this.dots = [];                // legal-move markers
    this._arrows = [];             // the loopy played-move arrow meshes
    this.selected = null;
    this.locked = false;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildBoard();
  }

  /* ── geometry ───────────────────────────────────────── */
  _buildBoard() {
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 0.4, 9.2),
      new THREE.MeshStandardMaterial({ color: 0x35271c, roughness: 0.8 })
    );
    plinth.position.y = -0.2; plinth.receiveShadow = true; plinth.castShadow = true;
    this.group.add(plinth);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ map: this._boardTexture(), roughness: 0.82 })
    );
    surface.rotation.x = -Math.PI / 2; surface.position.y = 0.001; surface.receiveShadow = true;
    this.group.add(surface);
  }

  _boardTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d'); const cell = 128;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      x.fillStyle = (r + f) % 2 ? '#5a4632' : '#b29b73';
      x.fillRect(f * cell, r * cell, cell, cell);
      x.globalAlpha = 0.06;
      for (let i = 0; i < 50; i++) { x.fillStyle = (r + f) % 2 ? '#3a2c1d' : '#9a845e'; x.fillRect(f * cell + Math.random() * cell, r * cell + Math.random() * cell, 16, 1); }
      x.globalAlpha = 1;
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  /* ── coordinate mapping (white convention; group rotates for black) ─ */
  _localOf(file, rank) { return new THREE.Vector3(file - 3.5, BOARD_TOP, 3.5 - rank); }
  _sqLocal(sq) { return this._localOf(FILES.indexOf(sq[0]), parseInt(sq[1], 10) - 1); }
  _localToSquare(p) {
    const file = Math.round(p.x + 3.5), rank = Math.round(3.5 - p.z);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return FILES[file] + (rank + 1);
  }

  setOrientation(color) {
    this.orientation = color;
    this.group.rotation.y = color === 'w' ? 0 : Math.PI;
  }

  /* ── position ───────────────────────────────────────── */
  setPosition(fen) {
    this.clearSelection();
    this.clearHighlights();
    for (const g of this.pieceAt.values()) this.group.remove(g);
    this.pieceAt.clear();
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const sq = FILES[f] + (8 - r);
        this._spawn(sq, color, ch.toLowerCase());
        f++;
      }
    }
  }

  _spawn(sq, color, type) {
    const g = makePiece(type, color);
    g.position.copy(this._sqLocal(sq));
    this.group.add(g);
    this.pieceAt.set(sq, g);
    return g;
  }

  /* ── animated move ──────────────────────────────────── */
  move(from, to, promotion) {
    const piece = this.pieceAt.get(from);
    if (!piece) return Promise.resolve();
    const victim = this.pieceAt.get(to);
    this.pieceAt.delete(from);

    // en passant
    if (!victim && piece.userData.type === 'p' && from[0] !== to[0]) {
      const ep = to[0] + from[1]; const epv = this.pieceAt.get(ep);
      if (epv) { this._removePiece(epv); this.pieceAt.delete(ep); }
    }
    // castling: move the rook too
    if (piece.userData.type === 'k' && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
      const rank = from[1];
      const [rFrom, rTo] = to[0] === 'g' ? ['h' + rank, 'f' + rank] : ['a' + rank, 'd' + rank];
      const rook = this.pieceAt.get(rFrom);
      if (rook) { this.pieceAt.delete(rFrom); this.pieceAt.set(rTo, rook); this._glide(rook, rTo, 220); }
    }

    this.pieceAt.set(to, piece);
    const dest = this._sqLocal(to);
    const arc = piece.userData.type === 'n' ? 0.6 : 0.28;
    const from0 = piece.position.clone();
    const anim = tween({
      ms: 260, ease: 'easeInOutQuad',
      onUpdate: (v) => {
        piece.position.x = from0.x + (dest.x - from0.x) * v;
        piece.position.z = from0.z + (dest.z - from0.z) * v;
        piece.position.y = BOARD_TOP + Math.sin(v * Math.PI) * arc;
      },
    });
    return anim.then(() => {
      if (victim) this._removePiece(victim);
      if (promotion) this._promote(piece, promotion);
    });
  }

  _glide(piece, toSq, ms) {
    const dest = this._sqLocal(toSq);
    return tweenVec(piece.position, { x: dest.x, z: dest.z }, ms, 'easeInOutQuad');
  }

  _promote(piece, type) {
    const color = piece.userData.color;
    this.group.remove(piece);
    for (const [sq, g] of this.pieceAt) if (g === piece) { const np = this._spawn(sq, color, type); np.scale.set(0.1, 0.1, 0.1); tween({ ms: 220, ease: 'easeOutBack', onUpdate: (v) => np.scale.setScalar(0.1 + 0.9 * v) }); break; }
  }

  _removePiece(g) {
    // sink + shrink, as if swept off the board
    const y0 = g.position.y;
    tween({ ms: 260, ease: 'easeInOutQuad', onUpdate: (v) => { g.position.y = y0 - v * 0.6; g.scale.setScalar(1 - v); } })
      .then(() => this.group.remove(g));
  }

  // World position of a square centre (for the host's gaze, etc.)
  squareWorld(sq, lift = 0) {
    const w = this.group.localToWorld(this._sqLocal(sq).clone());
    w.y += lift; return w;
  }

  // Screen-space projection of a square. lift=0 gives the board-surface point
  // (use this for click targeting); a positive lift floats labels above pieces.
  squareCenter(sq, lift = 0.4) {
    const world = this.group.localToWorld(this._sqLocal(sq).clone());
    world.y += lift;
    const v = world.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /* ── highlights ─────────────────────────────────────── */
  highlight(sqs, cls) {
    const style = HL[cls] || HL.sel;
    for (const sq of [].concat(sqs)) {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.96),
        new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity, depthWrite: false, toneMapped: false })
      );
      tile.rotation.x = -Math.PI / 2;
      const p = this._sqLocal(sq); tile.position.set(p.x, style.y, p.z);
      tile.userData.pulse = style.pulse;
      this.group.add(tile);
      this.fx.push({ sq, cls, mesh: tile });
    }
  }

  clearHighlights(cls) {
    this.fx = this.fx.filter((h) => {
      if (cls && h.cls !== cls) return true;
      this.group.remove(h.mesh); return false;
    });
  }

  pulse(t) {
    for (const h of this.fx) if (h.mesh.userData.pulse) h.mesh.material.opacity = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t * 5));
  }

  hasHighlight(cls) { return this.fx.some((h) => h.cls === cls); }

  // A loopy, translucent red arrow arcing above the board from `from` to `to`
  // — used to show the move actually played in the game.
  drawArrow(from, to, cls = 'played') {
    this.clearArrows();
    const a = this._sqLocal(from).setY(0.12);
    const b = this._sqLocal(to).setY(0.12);
    const dist = a.distanceTo(b);
    // two raised control points, offset sideways, give a curling "loopy" arc
    const dir = b.clone().sub(a); const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const h = 0.7 + dist * 0.5;
    const c1 = a.clone().lerp(b, 0.30); c1.y = h; c1.add(side.clone().multiplyScalar(dist * 0.22));
    const c2 = a.clone().lerp(b, 0.70); c2.y = h; c2.add(side.clone().multiplyScalar(-dist * 0.22));
    const curve = new THREE.CubicBezierCurve3(a, c1, c2, b);

    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.055, 10, false), mat);
    this.group.add(tube);
    // arrowhead at the destination, aligned to the curve's end tangent
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 14), mat);
    head.position.copy(curve.getPoint(0.98));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    this.group.add(head);
    this._arrows = [tube, head];
  }

  clearArrows() {
    for (const m of this._arrows || []) { this.group.remove(m); m.geometry.dispose(); }
    this._arrows = [];
  }

  /* ── selection + legal dots ─────────────────────────── */
  clearSelection() {
    this.selected = null;
    this.clearHighlights('sel');
    for (const d of this.dots) this.group.remove(d);
    this.dots = [];
  }

  _select(sq) {
    this.clearSelection();
    this.selected = sq;
    this.highlight(sq, 'sel');
    const seen = new Set();
    for (const mv of this.opts.getLegalMoves?.(sq) || []) {
      if (seen.has(mv.to)) continue; seen.add(mv.to);
      const p = this._sqLocal(mv.to);
      let dot;
      if (mv.captured) {
        dot = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 24), new THREE.MeshBasicMaterial({ color: 0xe0573a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      } else {
        dot = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ color: 0x9bd6a0, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
      }
      dot.rotation.x = -Math.PI / 2; dot.position.set(p.x, 0.02, p.z);
      this.group.add(dot); this.dots.push(dot);
    }
  }

  /* ── pointer input (raycast) ────────────────────────── */
  _squareFromEvent(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const local = this.group.worldToLocal(hit.clone());
    return this._localToSquare(local);
  }

  bindPointer(dom) {
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.opts.canMove?.()) return;
      const sq = this._squareFromEvent(e.clientX, e.clientY);
      if (!sq) return;
      const piece = this.pieceAt.get(sq);
      const movable = piece && (this.opts.getLegalMoves?.(sq) || []).length > 0;

      if (this.selected && sq !== this.selected) {
        const legal = (this.opts.getLegalMoves?.(this.selected) || []).some((m) => m.to === sq);
        if (legal) { const from = this.selected; this.clearSelection(); this.opts.onUserMove?.({ from, to: sq }); return; }
      }
      if (!movable) { this.clearSelection(); return; }
      this._select(sq);
      drag = { sq, piece, moved: false, startX: e.clientX, startY: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.moved = true;
      const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.plane, hit)) {
        const local = this.group.worldToLocal(hit.clone());
        drag.piece.position.set(local.x, 0.6, local.z);
      }
    });

    const end = (e) => {
      if (!drag) return; const d = drag; drag = null;
      if (d.moved) {
        const to = this._squareFromEvent(e.clientX, e.clientY);
        const legal = to && (this.opts.getLegalMoves?.(d.sq) || []).some((m) => m.to === to);
        d.piece.position.copy(this._sqLocal(d.sq)); // snap back; real move re-animates
        if (legal && to !== d.sq) { this.clearSelection(); this.opts.onUserMove?.({ from: d.sq, to }); }
      }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
  }
}
