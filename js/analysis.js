// Game analysis: walk every position of a game through Stockfish and find the
// moves by the user that threw away the most evaluation — the "critical moments".

import { Chess } from '../lib/chess.js';

const SKIP_OPENING_PLIES = 6;   // don't flag book-move territory
const BLUNDER_CP = 250;
const MISTAKE_CP = 130;
const FALLBACK_CP = 70;         // if a game has no real mistakes, surface inaccuracies
const HOPELESS_CP = -850;       // already dead lost — finding the "best" move is noise
const MAX_MOMENTS = 8;

export function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn); // throws on malformed PGN
  return chess.history({ verbose: true }); // each move: {color, from, to, san, lan, before, after, ...}
}

// engine: anything with evaluate(fen, {depth}) -> {bestMove, score, mateIn, terminal}
// Returns { moments, evaluatedPlies }. onProgress(done, total) is called per position.
export async function analyzeGame(game, engine, { depth = 12, onProgress = () => {} } = {}) {
  const moves = parseGame(game.pgn);
  const userColor = game.userColor;

  // Positions to evaluate: before-position of every ply from the opening cutoff
  // on, plus the final position (= `after` of the last move).
  const total = Math.max(moves.length - SKIP_OPENING_PLIES, 0) + 1;
  let done = 0;
  const evals = new Array(moves.length + 1).fill(null); // evals[i] = eval of position before move i

  for (let i = SKIP_OPENING_PLIES; i <= moves.length; i++) {
    const fen = i < moves.length ? moves[i].before : moves[moves.length - 1].after;
    evals[i] = await evaluatePosition(fen, engine, depth);
    onProgress(++done, total);
  }

  // Score every user move by how much eval it gave away.
  const candidates = [];
  for (let i = SKIP_OPENING_PLIES; i < moves.length; i++) {
    const mv = moves[i];
    if (mv.color !== userColor) continue;
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after || !before.bestMove) continue;

    const sign = userColor === 'w' ? 1 : -1;
    const evalBefore = before.score * sign; // user perspective
    const evalAfter = after.score * sign;
    if (evalBefore <= HOPELESS_CP) continue;

    const drop = evalBefore - evalAfter;
    const playedUci = mv.from + mv.to + (mv.promotion || '');
    if (playedUci === before.bestMove) continue; // played the best move; any "drop" is search noise

    candidates.push({
      ply: i,
      moveNumber: Math.floor(i / 2) + 1,
      userColor,
      fen: mv.before,
      fenAfterPlayed: mv.after,
      playedSan: mv.san,
      playedUci,
      bestUci: before.bestMove,
      bestSan: uciToSan(mv.before, before.bestMove),
      evalBest: before.score,        // white perspective; eval if best move is played
      mateBest: before.mateIn,
      evalAfterPlayed: after.score,
      mateAfterPlayed: after.mateIn,
      drop,
      prevMove: i > 0 ? moves[i - 1] : null,
      severity: drop >= BLUNDER_CP ? 'blunder' : drop >= MISTAKE_CP ? 'mistake' : 'inaccuracy',
    });
  }

  let moments = candidates.filter((c) => c.drop >= MISTAKE_CP);
  if (moments.length === 0) moments = candidates.filter((c) => c.drop >= FALLBACK_CP);
  moments.sort((a, b) => b.drop - a.drop);
  moments = moments.slice(0, MAX_MOMENTS);
  moments.sort((a, b) => a.ply - b.ply);
  return { moments, totalMoves: moves.length };
}

async function evaluatePosition(fen, engine, depth) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    // side to move is mated
    const score = fen.split(' ')[1] === 'w' ? -9990 : 9990;
    return { bestMove: null, score, mateIn: null, terminal: true };
  }
  if (chess.isDraw() || chess.isStalemate()) {
    return { bestMove: null, score: 0, mateIn: null, terminal: true };
  }
  return engine.evaluate(fen, { depth });
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
