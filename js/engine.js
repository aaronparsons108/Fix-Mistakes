// Stockfish UCI wrapper. Runs the engine in a Web Worker (WASM build,
// falling back to the pure-JS asm.js build) and exposes a promise-based
// evaluate(fen) that returns the best move and a white-perspective score.

const MATE_CP = 10000; // mate scores are mapped near ±MATE_CP so they dominate any cp eval

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this._queue = Promise.resolve();
  }

  init() {
    if (!this.ready) {
      const wasm = new URL('../lib/stockfish.js', import.meta.url).href;
      const asm = new URL('../lib/stockfish.asm.js', import.meta.url).href;
      this.ready = this._boot(wasm).catch(() => this._boot(asm));
    }
    return this.ready;
  }

  _boot(script) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(script);
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`engine at ${script} did not respond`));
      }, 15000);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(e);
      };
      worker.onmessage = (e) => {
        if (String(e.data).startsWith('uciok')) {
          clearTimeout(timer);
          worker.onerror = null;
          this.worker = worker;
          // NB: this build is already single-threaded; sending a Threads
          // setoption wedges it (no readyok), so we don't. Reproducibility comes
          // from the fixed node budget + Clear Hash on each search instead.
          worker.postMessage('isready');
          resolve();
        }
      };
      worker.postMessage('uci');
    });
  }

  // Evaluate a FEN. Resolves with:
  //   { bestMove: 'e2e4', score: <cp, white perspective>, mateIn: <moves or null, white perspective sign>, raw }
  // Searches are serialized through a queue since UCI is stateful.
  //
  // Options:
  //   nodes   — search a FIXED number of nodes instead of a wall-clock budget.
  //             A time budget makes the result depend on how far the search got
  //             before the clock ran out, so the same position scores
  //             differently every run; a node budget is fully reproducible.
  //   fresh   — clear the hash first, so a repeat search of the same position
  //             can't be nudged by leftover state from earlier searches.
  //   skill   — Stockfish Skill Level (0..20). Defaults to 20 (full strength),
  //             and it is set before every search, so a weakened Blindfold game
  //             can never leave the analysis engine dumbed down.
  evaluate(fen, { depth = 12, movetime = 2500, nodes = null, fresh = false, skill = 20 } = {}) {
    const job = this._queue.then(() => this._search(fen, { depth, movetime, nodes, fresh, skill }));
    // keep the queue alive even if a job rejects
    this._queue = job.catch(() => {});
    return job;
  }

  _search(fen, { depth, movetime, nodes, fresh, skill }) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const whiteToMove = fen.split(' ')[1] === 'w';
      let last = null; // last full info line parsed
      const ceiling = nodes ? 60000 : movetime + 20000; // hard timeout so a hang can't wedge the queue
      const timer = setTimeout(() => reject(new Error('engine search timed out')), ceiling);

      this.worker.onmessage = (e) => {
        const line = String(e.data);
        if (line.startsWith('info ') && line.includes(' score ') && !line.includes('lowerbound') && !line.includes('upperbound')) {
          const cp = line.match(/ score cp (-?\d+)/);
          const mate = line.match(/ score mate (-?\d+)/);
          const pv = line.match(/ pv (.+)$/);
          last = {
            cp: cp ? parseInt(cp[1], 10) : null,
            mate: mate ? parseInt(mate[1], 10) : null,
            // this build appends "bmc <n>" after the pv — keep only real UCI moves
            pv: pv ? pv[1].split(' ').filter((u) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) : [],
          };
        } else if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          this.worker.onmessage = null;
          const bestMove = line.split(' ')[1];
          if (bestMove === '(none)' || !last) {
            // terminal position (mate/stalemate) or nothing searched
            resolve({ bestMove: null, score: 0, mateIn: null, terminal: true });
            return;
          }
          // UCI scores are from the side to move; normalize to white's perspective.
          const sign = whiteToMove ? 1 : -1;
          let score, mateIn = null;
          if (last.mate !== null) {
            mateIn = last.mate * sign;
            score = sign * Math.sign(last.mate) * (MATE_CP - Math.min(Math.abs(last.mate), 100) * 10);
          } else {
            score = last.cp * sign;
          }
          resolve({ bestMove, score, mateIn, pv: last.pv, terminal: false });
        }
      };

      if (skill != null) this.worker.postMessage(`setoption name Skill Level value ${skill}`);
      if (fresh) this.worker.postMessage('setoption name Clear Hash');
      this.worker.postMessage('position fen ' + fen);
      this.worker.postMessage(nodes ? `go nodes ${nodes}` : `go depth ${depth} movetime ${movetime}`);
    });
  }

  destroy() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
  }
}

export { MATE_CP };

// Format a white-perspective score for display, from the given color's point of view.
export function formatEval(score, mateIn, color = 'w') {
  const sign = color === 'w' ? 1 : -1;
  if (mateIn !== null && mateIn !== undefined) {
    const m = mateIn * sign;
    return m > 0 ? `M${m}` : `-M${-m}`;
  }
  const v = (score * sign) / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
