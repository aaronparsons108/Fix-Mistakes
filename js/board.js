// Interactive chess board: renders a FEN, supports click-to-move and drag &
// drop, legal-move dots, highlights, and animated moves. The board itself is
// rules-agnostic — the app supplies legal moves via callbacks.

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

export class Board {
  // opts: { getLegalMoves(square) -> verbose moves[], onUserMove({from,to}), canMove() -> bool }
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.orientation = 'w';
    this.pieces = new Map(); // square -> piece element
    this.selected = null;
    this._buildSquares();
    this._bindPointer();
  }

  _buildSquares() {
    this.squares = new Map();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + (8 - r);
        const div = document.createElement('div');
        div.className = 'square ' + ((f + r) % 2 === 0 ? 'light' : 'dark');
        div.dataset.square = sq;
        this.el.appendChild(div);
        this.squares.set(sq, div);
      }
    }
    this._layoutSquares();
  }

  _layoutSquares() {
    for (const [sq, div] of this.squares) {
      const { x, y } = this._coords(sq);
      div.style.left = x * 12.5 + '%';
      div.style.top = y * 12.5 + '%';
      div.querySelectorAll('.coord').forEach((c) => c.remove());
      if (y === 7) {
        const lbl = document.createElement('span');
        lbl.className = 'coord file';
        lbl.textContent = sq[0];
        div.appendChild(lbl);
      }
      if (x === 0) {
        const lbl = document.createElement('span');
        lbl.className = 'coord rank';
        lbl.textContent = sq[1];
        div.appendChild(lbl);
      }
    }
  }

  _coords(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = 8 - parseInt(sq[1], 10);
    return this.orientation === 'w' ? { x: f, y: r } : { x: 7 - f, y: 7 - r };
  }

  setOrientation(color) {
    if (this.orientation === color) return;
    this.orientation = color;
    this._layoutSquares();
    for (const [sq, piece] of this.pieces) this._place(piece, sq, false);
  }

  // fen board field only is enough; full FEN accepted
  setPosition(fen) {
    this.clearSelection();
    this.clearHighlights();
    for (const piece of this.pieces.values()) piece.remove();
    this.pieces.clear();
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const sq = FILES[f] + (8 - r);
        this._spawnPiece(sq, color, ch.toLowerCase());
        f++;
      }
    }
  }

  _spawnPiece(sq, color, type) {
    const div = document.createElement('div');
    div.className = `piece ${color}`;
    div.dataset.color = color;
    div.dataset.type = type;
    div.textContent = GLYPHS[type];
    this.el.appendChild(div);
    this.pieces.set(sq, div);
    this._place(div, sq, false);
    return div;
  }

  _place(piece, sq, animate = true) {
    const { x, y } = this._coords(sq);
    if (!animate) piece.classList.add('no-anim');
    piece.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
    if (!animate) requestAnimationFrame(() => piece.classList.remove('no-anim'));
  }

  // Animate a move (capture handled). promotion: piece type or undefined.
  // Resolves when the slide animation finishes.
  move(from, to, promotion) {
    return new Promise((resolve) => {
      const piece = this.pieces.get(from);
      if (!piece) { resolve(); return; }
      const victim = this.pieces.get(to);
      this.pieces.delete(from);

      // en passant: pawn moves diagonally to an empty square
      if (!victim && piece.dataset.type === 'p' && from[0] !== to[0]) {
        const epSq = to[0] + from[1];
        const epVictim = this.pieces.get(epSq);
        if (epVictim) { epVictim.remove(); this.pieces.delete(epSq); }
      }
      // castling: move the rook too
      if (piece.dataset.type === 'k' && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
        const rank = from[1];
        const [rFrom, rTo] = to[0] === 'g' ? ['h' + rank, 'f' + rank] : ['a' + rank, 'd' + rank];
        const rook = this.pieces.get(rFrom);
        if (rook) { this.pieces.delete(rFrom); this.pieces.set(rTo, rook); this._place(rook, rTo); }
      }

      this.pieces.set(to, piece);
      this._place(piece, to);
      setTimeout(() => {
        if (victim) victim.remove();
        if (promotion) { piece.dataset.type = promotion; piece.textContent = GLYPHS[promotion]; }
        resolve();
      }, 240);
    });
  }

  squareCenter(sq) {
    const div = this.squares.get(sq);
    const r = div.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  highlight(sqs, cls) { for (const sq of [].concat(sqs)) this.squares.get(sq)?.classList.add(cls); }
  clearHighlights(cls) {
    const classes = cls ? [cls] : ['last-from', 'last-to', 'check', 'hint-glow', 'sel'];
    for (const div of this.squares.values()) div.classList.remove(...classes);
  }

  clearSelection() {
    this.selected = null;
    for (const div of this.squares.values()) {
      div.classList.remove('sel');
      div.querySelectorAll('.dot').forEach((d) => d.remove());
    }
  }

  _select(sq) {
    this.clearSelection();
    this.selected = sq;
    this.squares.get(sq).classList.add('sel');
    for (const mv of this.opts.getLegalMoves?.(sq) || []) {
      const dot = document.createElement('div');
      dot.className = 'dot' + (mv.captured ? ' capture' : '');
      this.squares.get(mv.to).appendChild(dot);
    }
  }

  _squareFromPoint(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    let x = Math.floor(((clientX - r.left) / r.width) * 8);
    let y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    if (this.orientation === 'b') { x = 7 - x; y = 7 - y; }
    return FILES[x] + (8 - y);
  }

  _bindPointer() {
    let drag = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (!this.opts.canMove?.()) return;
      const sq = this._squareFromPoint(e.clientX, e.clientY);
      if (!sq) return;
      const piece = this.pieces.get(sq);
      const movable = piece && (this.opts.getLegalMoves?.(sq) || []).length > 0;

      if (this.selected && sq !== this.selected) {
        const legal = (this.opts.getLegalMoves?.(this.selected) || []).some((m) => m.to === sq);
        if (legal) {
          const from = this.selected;
          this.clearSelection();
          this.opts.onUserMove?.({ from, to: sq });
          return;
        }
      }
      if (!movable) { this.clearSelection(); return; }

      this._select(sq);
      const rect = this.el.getBoundingClientRect();
      drag = { sq, piece, startX: e.clientX, startY: e.clientY, moved: false, cell: rect.width / 8 };
      this.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    this.el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      drag.piece.classList.add('dragging');
      const { x, y } = this._coords(drag.sq);
      drag.piece.style.transform =
        `translate(${x * 100 + (dx / drag.cell) * 100}%, ${y * 100 + (dy / drag.cell) * 100}%) scale(1.15)`;
    });

    const endDrag = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.piece.classList.remove('dragging');
      if (d.moved) {
        const target = this._squareFromPoint(e.clientX, e.clientY);
        const legal = target && (this.opts.getLegalMoves?.(d.sq) || []).some((m) => m.to === target);
        this._place(d.piece, d.sq, false); // snap back; a real move re-animates via move()
        if (legal && target !== d.sq) {
          this.clearSelection();
          this.opts.onUserMove?.({ from: d.sq, to: target });
        }
      }
      // plain click keeps the selection for click-to-move
    };
    this.el.addEventListener('pointerup', endDrag);
    this.el.addEventListener('pointercancel', endDrag);
  }
}
