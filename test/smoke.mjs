// Node smoke test for the analysis pipeline (no browser needed):
//   node test/smoke.mjs
// Runs a short game with two known white blunders through the real Stockfish
// build and checks that analyzeGame flags them.

import { createRequire } from 'module';
import { analyzeGame, parseGame } from '../js/analysis.js';

const require = createRequire(import.meta.url);
const sf = require('../lib/stockfish.js')();
sf.print = () => {}; // silence the default stdout echo

// Minimal node adapter matching the browser Engine interface (white-perspective scores).
const engine = {
  evaluate(fen, { depth = 10 } = {}) {
    return new Promise((resolve) => {
      const whiteToMove = fen.split(' ')[1] === 'w';
      let last = null;
      sf.onmessage = (line) => {
        if (line.startsWith('info ') && line.includes(' score ') && !/bound/.test(line)) {
          const cp = line.match(/ score cp (-?\d+)/);
          const mate = line.match(/ score mate (-?\d+)/);
          last = { cp: cp ? +cp[1] : null, mate: mate ? +mate[1] : null };
        } else if (line.startsWith('bestmove')) {
          const bestMove = line.split(' ')[1];
          if (bestMove === '(none)' || !last) return resolve({ bestMove: null, score: 0, mateIn: null, terminal: true });
          const sign = whiteToMove ? 1 : -1;
          let score, mateIn = null;
          if (last.mate !== null) {
            mateIn = last.mate * sign;
            score = sign * Math.sign(last.mate) * (10000 - Math.min(Math.abs(last.mate), 100) * 10);
          } else {
            score = last.cp * sign;
          }
          resolve({ bestMove, score, mateIn, terminal: false });
        }
      };
      sf.postMessage('position fen ' + fen);
      sf.postMessage(`go depth ${depth}`);
    });
  },
};

// Blackburne Shilling Gambit: white blunders with 4.Nxe5 and 5.Nxf7, gets mated.
const game = {
  userColor: 'w',
  pgn: `[Event "Live Chess"]
[Site "Chess.com"]
[White "victim"]
[Black "trickster"]
[Result "0-1"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5
5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`,
};

const moves = parseGame(game.pgn);
console.log(`parsed ${moves.length} plies, last move: ${moves.at(-1).san}`);

const t0 = Date.now();
const { moments } = await analyzeGame(game, engine, {
  depth: 11,
  onProgress: (d, t) => process.stdout.write(`\r  evaluating ${d}/${t} `),
});
console.log(`\nanalysis took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`found ${moments.length} critical moment(s):`);
for (const m of moments) {
  console.log(
    `  move ${m.moveNumber} (${m.severity}): played ${m.playedSan}, ` +
    `best ${m.bestSan} [${m.bestUci}], drop ${m.drop}cp, evalBest ${m.evalBest}`
  );
}

const flaggedNxf7 = moments.some((m) => m.playedSan === 'Nxf7');
if (moments.length >= 1 && flaggedNxf7) {
  console.log('PASS: blunders detected as expected');
  process.exit(0);
} else {
  console.log('FAIL: expected Nxf7 to be flagged');
  process.exit(1);
}
