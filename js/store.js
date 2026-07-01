// Small localStorage helpers: remember the last chess.com name (so we can
// pre-fill it) and tally how many positions the player has sealed in the chest.
// Also a coarse, honest tag for what a blunder was, used on the card captions.

import { Chess } from '../lib/chess.js';

const LAST_USER = 'rmc.lastUser';
const SEALED = (u) => `rmc.sealed.${u.toLowerCase()}`;

const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function lastUser() { return localStorage.getItem(LAST_USER) || ''; }
export function rememberUser(u) { try { localStorage.setItem(LAST_USER, u); } catch {} }

export function sealedCount(u) { return u ? parseInt(localStorage.getItem(SEALED(u)) || '0', 10) || 0 : 0; }
export function addSealed(u, n = 1) {
  if (!u) return;
  try { localStorage.setItem(SEALED(u), String(sealedCount(u) + n)); } catch {}
}

// A short, plain label for a blunder, derived from data we already have. Kept
// deliberately coarse so it is never confidently wrong.
export function classifyMistake(m) {
  try {
    const userSign = m.userColor === 'w' ? 1 : -1;
    if (m.mateBest != null && m.mateBest * userSign > 0 && m.playedUci !== m.bestUci) return 'missed a mate';
    if (m.fenAfterPlayed) {
      const after = new Chess(m.fenAfterPlayed);
      if (after.inCheck()) return 'walked into check';
      const to = m.playedUci.slice(2, 4);
      const opp = m.userColor === 'w' ? 'b' : 'w';
      const pc = after.get(to);
      if (pc && pc.color === m.userColor && after.isAttacked(to, opp) && after.attackers(to, m.userColor).length === 0) {
        return `hung a ${PIECE[pc.type] || 'piece'}`;
      }
    }
    const b = new Chess(m.fen).move({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), promotion: m.bestUci[4] });
    const p = new Chess(m.fen).move({ from: m.playedUci.slice(0, 2), to: m.playedUci.slice(2, 4), promotion: m.playedUci[4] });
    if (b && b.captured && !(p && p.captured)) return 'missed a capture';
    if (m.moveNumber <= 8) return 'an opening slip';
  } catch {}
  return null;
}
