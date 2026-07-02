// Game analysis: find the user's moves that chess.com would flag as a blunder,
// mistake, or miss. Classification is by WIN PROBABILITY lost (not raw
// centipawns), matching how chess.com/lichess label moves — a 1-pawn swing in a
// balanced game is a mistake, the same swing when already winning/losing is not.
//
// Two passes for speed + accuracy: a fast shallow sweep of every position to
// find suspects, then a deep re-evaluation of just those to confirm.

import { Chess } from '../lib/chess.js';

const SKIP_OPENING_PLIES = 8;   // ignore book-move territory
const SHALLOW = 11;             // pass 1 depth (every position) — a fast filter
const DEEP_MAX = 10;            // re-check at most this many suspects
const SHALLOW_MS = 1500;

// Pass 2 (and move-grading) use a fixed NODE budget rather than a time budget so
// the "best move" and every eval are reproducible — the same position always
// scores the same, instead of drifting with CPU load. Bump this for more depth.
export const ANALYSIS_NODES = 2500000;

// win% loss thresholds (0..100), tuned to chess.com's labels
const BLUNDER_W = 20;
const MISTAKE_W = 11;
const INACCURACY_W = 6;
const MIN_WIN_BEFORE = 14;      // already lost → not a "critical decision"
const MAX_MOMENTS = 8;

export function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true });
}

// eval in centipawns (one side's perspective) → win% (0..100) for that side
function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export async function analyzeGame(game, engine, { onProgress = () => {} } = {}) {
  const moves = parseGame(game.pgn);
  const userColor = game.userColor;
  const sign = userColor === 'w' ? 1 : -1;

  // ── pass 1: shallow eval of every position from the opening cutoff on ──
  const evals = new Array(moves.length + 1).fill(null);
  const shallowCount = Math.max(moves.length - SKIP_OPENING_PLIES, 0) + 1;
  const estTotal = shallowCount + DEEP_MAX * 2;
  let done = 0;
  for (let i = SKIP_OPENING_PLIES; i <= moves.length; i++) {
    const fen = i < moves.length ? moves[i].before : moves[moves.length - 1].after;
    evals[i] = await evaluatePosition(fen, engine, { depth: SHALLOW, movetime: SHALLOW_MS });
    onProgress(++done, estTotal);
  }

  // suspects: user moves that shed win% at shallow depth
  let suspects = [];
  for (let i = SKIP_OPENING_PLIES; i < moves.length; i++) {
    const mv = moves[i];
    if (mv.color !== userColor) continue;
    const before = evals[i], after = evals[i + 1];
    if (!before || !after || !before.bestMove) continue;
    const playedUci = mv.from + mv.to + (mv.promotion || '');
    if (playedUci === before.bestMove) continue;
    const winBefore = winPct(before.score * sign);
    if (winBefore < MIN_WIN_BEFORE) continue;
    const shallowLoss = winBefore - winPct(after.score * sign);
    if (shallowLoss < INACCURACY_W - 1) continue;
    suspects.push({ i, mv, playedUci, shallowLoss });
  }
  suspects.sort((a, b) => b.shallowLoss - a.shallowLoss);
  suspects = suspects.slice(0, DEEP_MAX);

  // ── pass 2: deep re-eval of each suspect's before/after to confirm ──
  const deep = [];
  for (const s of suspects) {
    const before = await evaluatePosition(s.mv.before, engine, { nodes: ANALYSIS_NODES, fresh: true });
    onProgress(++done, estTotal);
    const after = await evaluatePosition(s.mv.after, engine, { nodes: ANALYSIS_NODES, fresh: true });
    onProgress(++done, estTotal);
    if (!before.bestMove) continue;
    if (s.playedUci === before.bestMove) continue; // deeper search agrees it was best
    const evalBefore = before.score * sign, evalAfter = after.score * sign;
    const winBefore = winPct(evalBefore), winAfter = winPct(evalAfter);
    if (winBefore < MIN_WIN_BEFORE) continue;
    const winLoss = winBefore - winAfter;
    if (winLoss < INACCURACY_W) continue;
    deep.push({
      ply: s.i,
      moveNumber: Math.floor(s.i / 2) + 1,
      userColor,
      fen: s.mv.before,
      fenAfterPlayed: s.mv.after,
      playedSan: s.mv.san,
      playedUci: s.playedUci,
      bestUci: before.bestMove,
      bestSan: uciToSan(s.mv.before, before.bestMove),
      bestLine: (before.pv || []).slice(0, 6),   // the idea behind the best move
      punishLine: (after.pv || []).slice(0, 4),  // how the played move gets punished
      evalBest: before.score,
      mateBest: before.mateIn,
      evalAfterPlayed: after.score,
      mateAfterPlayed: after.mateIn,
      drop: evalBefore - evalAfter,
      winLoss,
      prevMove: s.i > 0 ? moves[s.i - 1] : null,
      severity: winLoss >= BLUNDER_W ? 'blunder' : winLoss >= MISTAKE_W ? 'mistake' : 'inaccuracy',
    });
  }

  // prefer real mistakes/blunders/misses; fall back to the worst inaccuracy only
  // if the game had none.
  let moments = deep.filter((m) => m.winLoss >= MISTAKE_W);
  if (moments.length === 0) moments = deep.filter((m) => m.winLoss >= INACCURACY_W).slice(0, 3);
  moments.sort((a, b) => a.ply - b.ply);
  return { moments: moments.slice(0, MAX_MOMENTS), totalMoves: moves.length };
}

async function evaluatePosition(fen, engine, opts) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    const score = fen.split(' ')[1] === 'w' ? -9990 : 9990;
    return { bestMove: null, score, mateIn: null, terminal: true };
  }
  if (chess.isDraw() || chess.isStalemate()) {
    return { bestMove: null, score: 0, mateIn: null, terminal: true };
  }
  return engine.evaluate(fen, opts);
}

export function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return mv.san;
  } catch {
    return uci;
  }
}
