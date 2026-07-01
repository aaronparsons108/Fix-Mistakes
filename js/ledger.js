// The Ledger — the cabin remembers the mistakes you couldn't fix and brings
// them back to you on a spaced-repetition schedule until you can actually play
// the right move. Everything lives in localStorage, keyed per chess.com name.
//
// A "card" is a single position you got wrong. It rides a small Leitner ladder:
// each clean solve pushes it further out; any miss drops it back to "tomorrow".
// A card that survives the top box is learned and leaves the deck for good.

import { Chess } from '../lib/chess.js';

const KEY = (user) => `rmc.ledger.${user.toLowerCase()}`;
const LAST_USER = 'rmc.lastUser';
const CAP = 40;
const DAY = 86400000;
const BOX_DELAY_DAYS = [0, 1, 3, 7, 21]; // days until due after reaching box i
const TOP_BOX = 4;

const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function lastUser() { return localStorage.getItem(LAST_USER) || ''; }
export function rememberUser(u) { try { localStorage.setItem(LAST_USER, u); } catch {} }

export class Ledger {
  constructor(user) {
    this.user = user;
    this.cards = load(user);
  }

  save() { try { localStorage.setItem(KEY(this.user), JSON.stringify({ v: 1, cards: this.cards })); } catch {} }

  find(fen) { return this.cards.find((c) => c.fen === fen); }

  // The cards owed *right now*, soonest-due first, capped for one sitting.
  due(now = Date.now(), max = 5) {
    return this.cards.filter((c) => c.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt).slice(0, max);
  }

  // Fold a finished Fix-Mistakes game into the ledger. A moment the player
  // botched (revealed/accepted/failed) becomes or refreshes a debt; a moment
  // they nailed cleanly settles a debt if one was already owed for it.
  recordGame(moments, results, game, now = Date.now()) {
    moments.forEach((m, i) => {
      const clean = results[i] === 'first' || results[i] === 'solved';
      const card = this.find(m.fen);
      if (clean) { if (card) this._advance(card, now); }
      else if (card) this._fail(card, now);
      else this.cards.push(this._card(m, game, now));
    });
    this._evict();
    this.save();
  }

  // Grade a card the player just faced on the ledger board. Returns true if the
  // card was learned and laid to rest.
  grade(card, cleanFirstTry, now = Date.now()) {
    let laidToRest = false;
    if (cleanFirstTry) {
      if (card.box >= TOP_BOX) { this.cards = this.cards.filter((c) => c !== card); laidToRest = true; }
      else this._advance(card, now);
    } else {
      this._fail(card, now);
    }
    this._evict();
    this.save();
    return laidToRest;
  }

  _card(m, game, now) {
    return {
      fen: m.fen, fenAfterPlayed: m.fenAfterPlayed,
      bestUci: m.bestUci, bestSan: m.bestSan, playedUci: m.playedUci, playedSan: m.playedSan,
      evalBest: m.evalBest, mateBest: m.mateBest, evalAfterPlayed: m.evalAfterPlayed, mateAfterPlayed: m.mateAfterPlayed,
      userColor: m.userColor, moveNumber: m.moveNumber, severity: m.severity,
      opponent: game?.opponent || '?', gameUrl: game?.url || '',
      theme: classifyTheme(m),
      createdAt: now, box: 0, dueAt: now, returnCount: 0, lastResult: 'new',
    };
  }

  _advance(card, now) {
    card.box = Math.min(card.box + 1, TOP_BOX);
    card.dueAt = now + BOX_DELAY_DAYS[card.box] * DAY;
    card.lastResult = 'solved';
  }

  _fail(card, now) {
    card.returnCount++;
    card.box = 0;
    card.dueAt = now + DAY;
    card.lastResult = 'failed';
  }

  // Keep the deck bounded. Evict the closest-to-learned (highest box), oldest
  // first; never throw away a fresh box-0 debt.
  _evict() {
    if (this.cards.length <= CAP) return;
    const spillable = this.cards.filter((c) => c.box > 0).sort((a, b) => b.box - a.box || a.createdAt - b.createdAt);
    while (this.cards.length > CAP && spillable.length) {
      const drop = spillable.shift();
      this.cards = this.cards.filter((c) => c !== drop);
    }
  }
}

function load(user) {
  try { const raw = JSON.parse(localStorage.getItem(KEY(user))); if (raw && Array.isArray(raw.cards)) return raw.cards; } catch {}
  return [];
}

// A dominant recurring weakness across the whole deck (>= 3 of the same theme),
// or null. Used for the host's one earned "you keep doing this" line.
export function recurringTheme(cards) {
  const by = {};
  for (const c of cards) { const t = c.theme || 'let it slip'; (by[t] ||= []).push(c); }
  let best = null;
  for (const t of Object.keys(by)) if (by[t].length >= 3 && (!best || by[t].length > best.count)) best = { theme: t, count: by[t].length };
  return best;
}

// Honest, deliberately-coarse tagging of *why* a move was a mistake, from data
// already computed. Never claims a tactic it can't verify — falls back to the
// non-committal "let it slip" so the host is never confidently wrong.
export function classifyTheme(m) {
  try {
    const userSign = m.userColor === 'w' ? 1 : -1;
    // a forced mate was on the board and you didn't play it
    if (m.mateBest != null && m.mateBest * userSign > 0 && m.playedUci !== m.bestUci) return 'the mate you left';

    if (m.fenAfterPlayed) {
      const after = new Chess(m.fenAfterPlayed);
      // your move left your own king in check-danger
      if (after.inCheck()) return 'walked into check';
      // the piece you just moved sits attacked and undefended
      const to = m.playedUci.slice(2, 4);
      const opp = m.userColor === 'w' ? 'b' : 'w';
      const pc = after.get(to);
      if (pc && pc.color === m.userColor && after.isAttacked(to, opp) && after.attackers(to, m.userColor).length === 0) {
        return `the hanging ${PIECE[pc.type] || 'piece'}`;
      }
    }

    // the best move grabbed material and yours didn't
    const b = new Chess(m.fen).move({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), promotion: m.bestUci[4] });
    const p = new Chess(m.fen).move({ from: m.playedUci.slice(0, 2), to: m.playedUci.slice(2, 4), promotion: m.playedUci[4] });
    if (b && b.captured && !(p && p.captured)) return 'the missed capture';

    if (m.moveNumber <= 8) return 'the opening slip';
  } catch {}
  return 'let it slip';
}
