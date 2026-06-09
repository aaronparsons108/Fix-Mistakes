// Blunder Lab — main controller. Wires together: chess.com fetch → Stockfish
// analysis → critical-moment quiz loop → session summary.

import { Chess } from '../lib/chess.js';
import { Engine, formatEval } from './engine.js';
import { fetchPlayer, fetchLostGames } from './chesscom.js';
import { analyzeGame, uciToSan } from './analysis.js';
import { Board } from './board.js';
import { burst, floatLabel, shake, sweep, confetti } from './effects.js';
import { sounds, toggleMute, isMuted } from './sound.js';

const $ = (id) => document.getElementById(id);

const ANALYSIS_DEPTH = 12;
const JUDGE_DEPTH = 13;

// thresholds (centipawns lost vs the engine's best move)
const BEST_TOLERANCE = 25;
const GREAT_TOLERANCE = 80;
const GOOD_TOLERANCE = 160;

const QUIPS = [
  'Stockfish never misses. You, on the other hand…',
  'Scanning for moments of regret…',
  'Your pieces remember everything.',
  'Calculating 3 million positions per second. No pressure.',
  'Somewhere in this game, a queen cried.',
  'Hindsight is 20/20. Stockfish is 3500.',
  'Finding the moves that haunt you…',
  'Every blunder is a lesson wearing a disguise.',
];

const state = {
  engine: new Engine(),
  username: null,
  games: [],
  game: null,
  moments: [],
  idx: 0,
  quiz: null,           // Chess instance at the current puzzle position
  locked: true,
  attempts: 0,
  hintUsed: false,
  session: 0,           // token to cancel stale timers when user skips ahead
  stats: null,
  results: [],          // per-puzzle: 'first' | 'solved' | 'accepted' | 'revealed'
};

/* ───────────────────────── screens ───────────────────────── */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = $(id);
  el.classList.remove('active');
  void el.offsetWidth;
  el.classList.add('active');
}

function toast(msg, ms = 4200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ───────────────────────── landing ───────────────────────── */

$('username-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('username-input').value.trim();
  if (!username) return;
  const err = $('landing-error');
  err.hidden = true;
  const btn = $('btn-analyze');
  btn.disabled = true;
  btn.textContent = 'FETCHING…';
  state.engine.init().catch(() => {}); // warm up the engine in parallel

  try {
    await fetchPlayer(username);
    const games = await fetchLostGames(username);
    if (games.length === 0) {
      throw new Error(`No recent losses found for "${username}". Either you're unbeatable or you haven't played lately.`);
    }
    state.username = username;
    state.games = games;
    renderGames();
    await sweep('YOUR LOSSES, EXAMINED');
    showScreen('screen-games');
  } catch (ex) {
    err.textContent = ex.code === 404
      ? `Player "${username}" not found on chess.com.`
      : ex.message || 'Could not reach chess.com. Check your connection.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'ANALYZE MY GAMES <span class="btn-arrow">→</span>';
  }
});

$('btn-back-landing').addEventListener('click', () => showScreen('screen-landing'));
$('brand-home').addEventListener('click', () => showScreen('screen-landing'));

/* ─────────────────────── game picker ─────────────────────── */

function renderGames() {
  const grid = $('games-grid');
  grid.innerHTML = '';
  $('games-sub').textContent =
    `${state.username} — ${state.games.length} recent losses. Pick one to dissect.`;
  state.games.forEach((g, i) => {
    const card = document.createElement('button');
    card.className = 'game-card';
    card.style.animationDelay = `${Math.min(i * 60, 600)}ms`;
    const date = g.endTime
      ? g.endTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    card.innerHTML = `
      <div class="gc-top">
        <span class="gc-opp">vs ${escapeHtml(g.opponent)}</span>
        <span class="gc-rating">${g.opponentRating ?? '?'}</span>
      </div>
      <div class="gc-tags">
        <span class="tag loss">${escapeHtml(g.resultReason)}</span>
        <span class="tag">${escapeHtml(g.timeClass)}</span>
        <span class="tag color-${g.userColor}">${g.userColor === 'w' ? '♔ white' : '♚ black'}</span>
        ${g.rated ? '<span class="tag">rated</span>' : ''}
      </div>
      <div class="gc-date">${date}</div>`;
    card.addEventListener('click', () => startAnalysis(g));
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ─────────────────────── analysis phase ───────────────────── */

const LOADER_GLYPHS = ['♟', '♞', '♝', '♜', '♛'];
let loaderTimer = null;
let quipTimer = null;

function startLoader() {
  const piece = $('promo-piece');
  piece.classList.add('morphing');
  let gi = 0;
  piece.textContent = LOADER_GLYPHS[0];
  loaderTimer = setInterval(() => {
    gi = (gi + 1) % LOADER_GLYPHS.length;
    // swap the glyph mid-bounce, when the morph flash whites it out
    setTimeout(() => { piece.textContent = LOADER_GLYPHS[gi]; }, 450);
  }, 900);

  const quip = $('loading-quip');
  let qi = Math.floor(Math.random() * QUIPS.length);
  quip.textContent = QUIPS[qi];
  quipTimer = setInterval(() => {
    quip.style.opacity = 0;
    setTimeout(() => {
      qi = (qi + 1) % QUIPS.length;
      quip.textContent = QUIPS[qi];
      quip.style.opacity = 1;
    }, 400);
  }, 3400);
}

function stopLoader() {
  clearInterval(loaderTimer);
  clearInterval(quipTimer);
  $('promo-piece').classList.remove('morphing');
}

async function startAnalysis(game) {
  state.game = game;
  $('progress-fill').style.width = '0%';
  $('loading-status').textContent = 'Waking up Stockfish…';
  await sweep('ENTERING THE LAB');
  showScreen('screen-loading');
  startLoader();

  try {
    await state.engine.init();
    const { moments } = await analyzeGame(game, state.engine, {
      depth: ANALYSIS_DEPTH,
      onProgress: (done, total) => {
        $('progress-fill').style.width = `${Math.round((done / total) * 100)}%`;
        $('loading-status').textContent = `Evaluating position ${done} of ${total}`;
      },
    });
    stopLoader();
    if (moments.length === 0) {
      toast('No significant mistakes found in that game — your opponent simply outplayed you. Try another!', 6000);
      showScreen('screen-games');
      return;
    }
    startQuiz(moments);
  } catch (ex) {
    stopLoader();
    console.error(ex);
    toast('Analysis failed: ' + (ex.message || ex), 6000);
    showScreen('screen-games');
  }
}

/* ────────────────────────── quiz ──────────────────────────── */

const board = new Board($('board'), {
  canMove: () => !state.locked,
  getLegalMoves: (sq) => {
    if (!state.quiz) return [];
    const seen = new Set();
    return state.quiz.moves({ square: sq, verbose: true }).filter((m) => {
      if (seen.has(m.to)) return false;
      seen.add(m.to);
      return true;
    });
  },
  onUserMove: handleUserMove,
});

function startQuiz(moments) {
  state.moments = moments;
  state.idx = 0;
  state.results = new Array(moments.length).fill(null);
  state.stats = { first: 0, solved: 0, accepted: 0, revealed: 0, hints: 0, retries: 0 };
  loadPuzzle(0, `CRITICAL MOMENT 1 / ${moments.length}`);
}

async function loadPuzzle(i, sweepText) {
  state.idx = i;
  const session = ++state.session;
  const m = state.moments[i];
  const g = state.game;

  state.quiz = new Chess(m.fen);
  state.locked = true;
  state.attempts = 0;
  state.hintUsed = false;

  await sweep(sweepText);
  showScreen('screen-quiz');

  board.setOrientation(m.userColor);
  $('board-meta-top').textContent = `${g.opponent} (${g.opponentRating ?? '?'})`;
  $('board-meta-bottom').textContent = `${state.username} (${g.userRating ?? '?'}) — you`;

  renderCounter();
  $('puzzle-context').innerHTML =
    `Move <strong>${m.moveNumber}</strong> vs <strong>${escapeHtml(g.opponent)}</strong>. ` +
    `In the game you played <span class="played-move">${escapeHtml(m.playedSan)}</span> — a ` +
    `${m.severity} that cost you <strong>${(m.drop / 100).toFixed(1)}</strong> pawns of evaluation. ` +
    `Find the move you should have played.`;
  $('turn-banner').textContent =
    `${m.userColor === 'w' ? 'WHITE' : 'BLACK'} TO MOVE — find the best move`;
  setFeedback('', '');
  $('eval-readout').textContent = '';
  setButtons({ hint: true, idk: true });
  $('mini-thinking').hidden = true;

  // Replay the opponent's previous move so the player sees what just happened.
  if (m.prevMove) {
    board.setPosition(m.prevMove.before);
    await delay(550);
    if (session !== state.session) return;
    sounds.move();
    await board.move(m.prevMove.from, m.prevMove.to, m.prevMove.promotion);
    if (session !== state.session) return;
  } else {
    board.setPosition(m.fen);
  }
  restoreHighlights(m);
  state.locked = false;
}

function restoreHighlights(m) {
  board.clearHighlights();
  if (m.prevMove) {
    board.highlight(m.prevMove.from, 'last-from');
    board.highlight(m.prevMove.to, 'last-to');
  }
  if (state.quiz.inCheck()) {
    const king = findKing(state.quiz, m.userColor);
    if (king) board.highlight(king, 'check');
  }
}

function findKing(chess, color) {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square;
    }
  }
  return null;
}

function renderCounter() {
  const pips = state.moments.map((_, j) => {
    const r = state.results[j];
    const cls = j === state.idx && !r ? 'current'
      : r === 'revealed' ? 'failed'
      : r ? 'done' : '';
    return `<span class="pip ${cls}"></span>`;
  }).join('');
  $('puzzle-counter').innerHTML =
    `CRITICAL MOMENT ${state.idx + 1} / ${state.moments.length} <span class="pips">${pips}</span>`;
}

function setFeedback(html, cls) {
  const f = $('feedback');
  f.innerHTML = html;
  f.className = 'feedback ' + cls;
}

function setButtons({ hint = false, idk = false, retry = false, accept = false, next = false } = {}) {
  $('btn-hint').hidden = !hint;
  $('btn-idk').hidden = !idk;
  $('btn-retry').hidden = !retry;
  $('btn-accept').hidden = !accept;
  $('btn-next').hidden = !next;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────── answering & judging ──────────────────── */

async function handleUserMove({ from, to }) {
  if (state.locked) return;
  const m = state.moments[state.idx];
  const legal = state.quiz.moves({ square: from, verbose: true }).filter((mv) => mv.to === to);
  if (legal.length === 0) return;

  let promotion;
  if (legal[0].promotion) {
    promotion = await askPromotion(m.userColor);
    if (!promotion) { board.clearSelection(); return; }
  }

  state.locked = true;
  state.attempts++;
  const session = state.session;

  const mv = state.quiz.move({ from, to, promotion });
  board.clearHighlights('hint-glow');
  mv.captured ? sounds.capture() : sounds.move();
  await board.move(from, to, promotion);
  if (session !== state.session) return;

  const uci = from + to + (promotion || '');
  const userPersp = m.userColor === 'w' ? 1 : -1;

  if (uci === m.bestUci) {
    judge('best', m, uci, { score: m.evalBest, mateIn: m.mateBest });
    return;
  }

  // Ask Stockfish how much this move keeps compared to the best one.
  $('mini-thinking').hidden = false;
  let evalAfter;
  try {
    evalAfter = await state.engine.evaluate(state.quiz.fen(), { depth: JUDGE_DEPTH });
  } catch {
    evalAfter = { score: -9999 * userPersp, mateIn: null };
  }
  if (session !== state.session) return;
  $('mini-thinking').hidden = true;

  const diff = (m.evalBest - evalAfter.score) * userPersp;
  const kind = diff <= BEST_TOLERANCE ? 'best'
    : diff <= GREAT_TOLERANCE ? 'great'
    : diff <= GOOD_TOLERANCE ? 'good' : 'bad';
  judge(kind, m, uci, evalAfter);
}

function judge(kind, m, uci, evalAfter) {
  const { x, y } = board.squareCenter(uci.slice(2, 4));
  const you = formatEval(evalAfter.score, evalAfter.mateIn, m.userColor);
  const best = formatEval(m.evalBest, m.mateBest, m.userColor);
  const sameAsGame = uci === m.playedUci;

  if (kind === 'best') {
    burst(x, y, 'ok', { power: 1.3 });
    floatLabel(x, y, 'BEST MOVE!', 'ok');
    sounds.correct();
    state.results[state.idx] = state.attempts === 1 ? 'first' : 'solved';
    state.attempts === 1 ? state.stats.first++ : state.stats.solved++;
    renderCounter();
    setFeedback(
      `<b>${escapeHtml(uciToSan(m.fen, uci))}</b> — exactly what Stockfish would play.` +
      (state.attempts === 1 ? ' First try! 🔥' : ` Got there in ${state.attempts} tries.`),
      'ok'
    );
    $('eval-readout').innerHTML = `Position eval: <b>${best}</b> — edge preserved.`;
    setButtons({ next: true });
    autoAdvance(2400);
    return;
  }

  if (kind === 'great') {
    burst(x, y, 'great');
    floatLabel(x, y, 'GREAT MOVE!', 'great');
    sounds.great();
    setFeedback(
      `Great move! It keeps your position strong… but Stockfish found something even <b>stronger</b>. Can you spot it?`,
      'great'
    );
    $('eval-readout').innerHTML = `Your move: <b>${you}</b> &nbsp;·&nbsp; Best move: <b>${best}</b>`;
    setButtons({ retry: true, accept: true, idk: true });
    return;
  }

  if (kind === 'good') {
    burst(x, y, 'info', { particles: 14, power: 0.7 });
    sounds.wrong();
    setFeedback(`Reasonable — but it lets the advantage slip. There's a better move here.`, 'bad');
  } else {
    burst(x, y, 'bad');
    floatLabel(x, y, sameAsGame ? 'DÉJÀ VU…' : 'NOT THIS', 'bad');
    shake($('board-frame'));
    sounds.wrong();
    setFeedback(
      sameAsGame
        ? `That's <b>exactly</b> what you played in the game — and it's why we're here. Find the better path!`
        : `That makes things worse. Reset and look deeper.`,
      'bad'
    );
  }
  $('eval-readout').innerHTML = `Your move: <b>${you}</b> &nbsp;·&nbsp; Best move: <b>${best}</b>`;
  state.stats.retries++;
  // brief pause so the player sees the consequence, then reset for the retry
  const session = state.session;
  setTimeout(() => { if (session === state.session) resetPuzzlePosition(); }, 1300);
}

function resetPuzzlePosition() {
  const m = state.moments[state.idx];
  state.quiz = new Chess(m.fen);
  board.setPosition(m.fen);
  restoreHighlights(m);
  setButtons({ hint: !state.hintUsed, idk: true });
  state.locked = false;
}

function autoAdvance(ms) {
  const session = state.session;
  setTimeout(() => { if (session === state.session) nextPuzzle(); }, ms);
}

function nextPuzzle() {
  if (state.idx + 1 < state.moments.length) {
    loadPuzzle(state.idx + 1, `CRITICAL MOMENT ${state.idx + 2} / ${state.moments.length}`);
  } else {
    showSummary();
  }
}

/* ───────────────────── quiz buttons ───────────────────────── */

$('btn-hint').addEventListener('click', () => {
  const m = state.moments[state.idx];
  state.hintUsed = true;
  state.stats.hints++;
  sounds.tick();
  board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
  setFeedback('This piece wants to move…', 'info');
  $('btn-hint').hidden = true;
});

$('btn-idk').addEventListener('click', async () => {
  if (!state.quiz) return;
  const m = state.moments[state.idx];
  state.locked = true;
  const session = state.session;

  // make sure we reveal from the clean puzzle position
  state.quiz = new Chess(m.fen);
  board.setPosition(m.fen);
  restoreHighlights(m);
  setButtons({});
  await delay(350);
  if (session !== state.session) return;

  const from = m.bestUci.slice(0, 2);
  const to = m.bestUci.slice(2, 4);
  sounds.reveal();
  await board.move(from, to, m.bestUci[4]);
  if (session !== state.session) return;
  const { x, y } = board.squareCenter(to);
  burst(x, y, 'info');
  floatLabel(x, y, m.bestSan, 'info');

  state.results[state.idx] = 'revealed';
  state.stats.revealed++;
  renderCounter();
  setFeedback(
    `Stockfish plays <b>${escapeHtml(m.bestSan)}</b> (${formatEval(m.evalBest, m.mateBest, m.userColor)}). ` +
    `In the game you played <b>${escapeHtml(m.playedSan)}</b>. Burn this pattern in.`,
    'info'
  );
  setButtons({ next: true });
  autoAdvance(3400);
});

$('btn-retry').addEventListener('click', () => { sounds.tick(); resetPuzzlePosition(); });

$('btn-accept').addEventListener('click', () => {
  state.results[state.idx] = 'accepted';
  state.stats.accepted++;
  renderCounter();
  sounds.great();
  nextPuzzle();
});

$('btn-next').addEventListener('click', () => { state.session++; nextPuzzle(); });

/* ─────────────────────── promotion ────────────────────────── */

function askPromotion(color) {
  return new Promise((resolve) => {
    const modal = $('promo-modal');
    const box = $('promo-choices');
    box.innerHTML = '';
    const glyphs = { q: '♛', r: '♜', n: '♞', b: '♝' };
    for (const [type, glyph] of Object.entries(glyphs)) {
      const b = document.createElement('button');
      b.textContent = glyph;
      b.style.color = color === 'w' ? '#f8f4ff' : '#2a2440';
      b.addEventListener('click', () => { modal.hidden = true; resolve(type); });
      box.appendChild(b);
    }
    modal.hidden = false;
    modal.onclick = (e) => { if (e.target === modal) { modal.hidden = true; resolve(null); } };
  });
}

/* ─────────────────────── summary ──────────────────────────── */

async function showSummary() {
  const s = state.stats;
  const n = state.moments.length;
  const score = (s.first * 2 + s.solved * 1.25 + s.accepted) / (n * 2);

  const rank = score >= 0.9 ? '⚡ SILICON GRANDMASTER ⚡'
    : score >= 0.65 ? '🔪 TACTICAL SURGEON'
    : score >= 0.4 ? '📈 RISING TACTICIAN'
    : score >= 0.15 ? '🧩 PATTERN BUILDER'
    : '🥚 BLUNDER APPRENTICE — the lab awaits';

  $('summary-rank').textContent = rank;
  $('stats-row').innerHTML = `
    <div class="stat-box"><div class="stat-num green">${s.first}</div><div class="stat-label">first try</div></div>
    <div class="stat-box"><div class="stat-num gold">${s.solved + s.accepted}</div><div class="stat-label">eventually</div></div>
    <div class="stat-box"><div class="stat-num cyan">${s.revealed}</div><div class="stat-label">revealed</div></div>
  `;
  $('summary-detail').textContent =
    `${n} critical moments vs ${state.game.opponent} · ${s.retries} retries · ${s.hints} hints. ` +
    (score >= 0.65
      ? 'Those mistakes won\'t fool you twice.'
      : 'Run it again — repetition turns blunders into instincts.');

  await sweep('SESSION COMPLETE');
  showScreen('screen-summary');
  sounds.fanfare();
  confetti();
}

$('btn-another').addEventListener('click', async () => {
  await sweep('BACK TO THE LAB');
  showScreen('screen-games');
});
$('btn-new-player').addEventListener('click', () => showScreen('screen-landing'));

/* ─────────────────────── misc wiring ──────────────────────── */

const soundBtn = $('btn-sound');
soundBtn.classList.toggle('muted', isMuted());
soundBtn.textContent = isMuted() ? '🔇' : '🔊';
soundBtn.addEventListener('click', () => {
  const muted = toggleMute();
  soundBtn.classList.toggle('muted', muted);
  soundBtn.textContent = muted ? '🔇' : '🔊';
});

// allow ?user=name deep link
const params = new URLSearchParams(location.search);
if (params.get('user')) {
  $('username-input').value = params.get('user');
}
