// Revise My Chess — "the cabin". Flow orchestrator: boots straight into the
// candlelit 3D scene, the pawn host asks for a chess.com name, slides a paper
// of recent losses, then quizzes the player's blunders on the real 3D board.
// Reuses chesscom.js / engine.js / analysis.js / chess.js / stockfish unchanged.

import { Chess } from '../lib/chess.js';
import { Engine, formatEval } from './engine.js';
import { fetchPlayer, fetchLostGames } from './chesscom.js';
import { analyzeGame, uciToSan } from './analysis.js';
import { initScene, scene, camera, onFrame, flareCandles } from './scene.js';
import { Board3D } from './board3d.js';
import { Host } from './host.js';
import { Paper } from './paper.js';
import { FAST, wait } from './tween.js';
import { sounds, toggleMute, isMuted } from './sound.js';
import { floatLabel, sparkle, speak, hush, toast, askPromotion } from './ui.js';

const $ = (id) => document.getElementById(id);

const ANALYSIS_DEPTH = 12, JUDGE_DEPTH = 13;
const BEST_TOL = 25, GREAT_TOL = 80, GOOD_TOL = 160;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const state = {
  engine: new Engine(),
  phase: 'BOOT',
  username: null, games: [], game: null,
  moments: [], idx: 0,
  quiz: null, locked: true, attempts: 0, hintUsed: false, replaying: false,
  session: 0, stats: null, results: [],
  gaze: null,
};

let board, host, paper;

/* ───────────────────────── boot ───────────────────────── */

const headless = navigator.webdriver === true || new URLSearchParams(location.search).has('headless');
const canvas = $('webgl');
initScene(canvas, { headless });
board = new Board3D(scene, camera, {
  canMove: () => state.phase === 'QUIZ' && !state.locked,
  getLegalMoves: (sq) => {
    if (!state.quiz) return [];
    return state.quiz.moves({ square: sq, verbose: true });
  },
  onUserMove: handleUserMove,
});
board.setOrientation('w');
board.setPosition(START_FEN);
host = new Host(scene);
paper = new Paper(scene, camera);
board.bindPointer(canvas);

onFrame((t, dt) => {
  host.update(t, dt);
  host.lookAt(state.gaze);
  board.pulse(t);
});

// pick games / advance summary by clicking the parchment
canvas.addEventListener('click', (e) => {
  if (state.phase === 'PICK_GAME') {
    const i = paper.pick(e.clientX, e.clientY);
    if (i >= 0) pickGame(i);
  }
});

async function boot() {
  state.engine.init().catch(() => {}); // warm the engine
  await wait(400);
  $('boot').classList.add('gone');
  setPhase('ASK_USERNAME');
  speak(`You look <span class="q">lost</span>. Sit. Whisper me thy <span class="q">chess.com</span> name… and I shall show thee where the games <span class="q">slipped away</span>.`);
  $('username-panel').hidden = false;
  $('username-input').focus?.();
}
boot();

function setPhase(p) { state.phase = p; }

/* ─────────────────── username → fetch ──────────────────── */

$('username-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('username-input').value.trim();
  if (name) doFetch(name);
});
$('btn-rename').addEventListener('click', () => {
  if (state.phase === 'FETCHING') return;
  paper.slideOut();
  setPhase('ASK_USERNAME');
  $('btn-rename').hidden = true;
  $('quiz-hud').hidden = true;
  $('username-panel').hidden = false;
  $('username-error').hidden = true;
  speak('Another name, then? Whisper it.');
  $('username-input').focus?.();
});

async function doFetch(name) {
  setPhase('FETCHING');
  const err = $('username-error'); err.hidden = true;
  const go = $('username-go'); go.disabled = true; go.textContent = 'he listens…';
  speak('Hmm. Let me <span class="q">remember</span> thy defeats…');
  try {
    await fetchPlayer(name);
    const games = await fetchLostGames(name);
    if (!games.length) throw new Error('No losses? Either thou art unbeatable, or thou art a liar.');
    state.username = name; state.games = games;
    $('username-panel').hidden = true;
    $('btn-rename').hidden = false;
    setPhase('PICK_GAME');
    speak(`So many, ${escapeText(name)}. <span class="q">Choose</span> one to relive.`, { });
    paper.drawGameList(games);
    host.leanIn();
    await paper.slideIn();
    await host.leanBack();
  } catch (ex) {
    setPhase('ASK_USERNAME');
    err.textContent = ex.code === 404 ? `I know no soul named "${name}".` : (ex.message || 'The candle guttered — try again.');
    err.hidden = false;
    speak('That name means nothing to me.');
  } finally {
    go.disabled = false; go.textContent = 'tell him →';
  }
}

/* ─────────────────── pick game → analyze ───────────────── */

async function pickGame(i) {
  const game = state.games[i];
  if (!game) return;
  state.game = game;
  setPhase('ANALYZING');
  sounds.tick();
  await paper.slideOut();
  speak('Let us see how it <span class="q">unravelled</span>…');
  flareCandles();
  try {
    await state.engine.init();
    const { moments } = await analyzeGame(game, state.engine, { depth: ANALYSIS_DEPTH });
    if (!moments.length) {
      speak('No grand blunder here — thou wert simply <span class="q">outplayed</span>. Choose another.');
      backToGames();
      return;
    }
    startQuiz(moments);
  } catch (ex) {
    toast('The reading failed: ' + (ex.message || ex));
    backToGames();
  }
}

async function backToGames(line) {
  setPhase('PICK_GAME');
  $('quiz-hud').hidden = true;
  hush();
  speak(line || `<span class="q">Choose</span> one to relive.`);
  paper.drawGameList(state.games);
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

/* ────────────────────────── quiz ───────────────────────── */

function startQuiz(moments) {
  state.moments = moments;
  state.idx = 0;
  state.results = new Array(moments.length).fill(null);
  state.stats = { first: 0, solved: 0, accepted: 0, revealed: 0, hints: 0, retries: 0 };
  loadPuzzle(0);
}

async function loadPuzzle(i) {
  state.idx = i;
  const session = ++state.session;
  const m = state.moments[i];
  state.quiz = new Chess(m.fen);
  state.locked = true;
  state.attempts = 0;
  state.hintUsed = false;
  state.replaying = false;
  setPhase('QUIZ');

  $('quiz-hud').hidden = false;
  board.setOrientation(m.userColor);
  renderCounter();
  $('hud-turn').textContent = (m.userColor === 'w' ? 'WHITE' : 'BLACK') + ' TO MOVE';
  setFeedback('', '');
  showBestEval(m);
  setButtons({ hint: true, idk: true });
  speak(`Move ${m.moveNumber}. Here thou <span class="q">faltered</span>. Find the move thou should’st have played.`);

  // replay the opponent's previous move so the moment reads
  if (m.prevMove) {
    board.setPosition(m.prevMove.before);
    state.gaze = board.squareWorld(m.prevMove.to, 0.4);
    await wait(500);
    if (session !== state.session) return;
    sounds.move();
    await board.move(m.prevMove.from, m.prevMove.to, m.prevMove.promotion);
    if (session !== state.session) return;
  } else {
    board.setPosition(m.fen);
  }
  restoreHighlights(m);
  state.gaze = null;
  state.locked = false;
}

function restoreHighlights(m) {
  board.clearHighlights();
  if (m.prevMove) { board.highlight(m.prevMove.from, 'last-from'); board.highlight(m.prevMove.to, 'last-to'); }
  if (state.quiz.inCheck()) { const k = findKing(state.quiz, m.userColor); if (k) board.highlight(k, 'check'); }
  if (state.hintUsed) board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
}

function findKing(chess, color) {
  for (const row of chess.board()) for (const c of row) if (c && c.type === 'k' && c.color === color) return c.square;
  return null;
}

/* ─────────────────── answering & judging ───────────────── */

async function handleUserMove({ from, to, promotion }) {
  if (state.locked || !state.quiz) return;
  const m = state.moments[state.idx];
  const legal = state.quiz.moves({ square: from, verbose: true }).filter((mv) => mv.to === to);
  if (!legal.length) return;
  if (legal[0].promotion && !promotion) {
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
  if (uci === m.bestUci) { judge('best', m, uci, { score: m.evalBest, mateIn: m.mateBest }); return; }

  setFeedback('<span class="dim">he ponders…</span>', 'info');
  let after;
  try { after = await state.engine.evaluate(state.quiz.fen(), { depth: JUDGE_DEPTH }); }
  catch { after = { score: -9999 * userPersp, mateIn: null }; }
  if (session !== state.session) return;
  const diff = (m.evalBest - after.score) * userPersp;
  const kind = diff <= BEST_TOL ? 'best' : diff <= GREAT_TOL ? 'great' : diff <= GOOD_TOL ? 'good' : 'bad';
  judge(kind, m, uci, after);
}

function judge(kind, m, uci, after) {
  const to = uci.slice(2, 4);
  const { x, y } = board.squareCenter(to);
  const you = formatEval(after.score, after.mateIn, m.userColor);
  const sameAsGame = uci === m.playedUci;
  const san = escapeText(uciToSan(m.fen, uci));
  const replay = state.replaying;
  state.gaze = board.squareWorld(to, 0.4);
  showEval(m, you, kind);

  if (kind === 'best') {
    sparkle(x, y, 'ok', { power: 1.3 }); floatLabel(x, y, 'BEST', 'ok'); sounds.correct(); host.react('best');
    if (!replay) {
      state.results[state.idx] = state.attempts === 1 ? 'first' : 'solved';
      state.attempts === 1 ? state.stats.first++ : state.stats.solved++;
      renderCounter();
    }
    speak(state.attempts === 1 && !replay ? 'The very move. <span class="q">Clever</span> little thing.' : 'There it is.');
    setFeedback(`<b>${san}</b>: BEST <span class="dim">${replay ? 'again' : state.attempts === 1 ? 'first try' : 'in ' + state.attempts + ' tries'}</span>`, 'ok');
    setButtons({ next: true });
    return;
  }
  if (kind === 'great') {
    sparkle(x, y, 'great'); floatLabel(x, y, 'GREAT', 'great'); sounds.great(); host.react('great');
    speak('Strong… but not the <span class="q">strongest</span>. Look again, or keep it.');
    setFeedback(`<b>${san}</b>: GREAT <span class="dim">not the best</span>`, 'great');
    setButtons(replay ? { retry: true, next: true } : { retry: true, accept: true, idk: true });
    return;
  }
  if (kind === 'good') {
    sparkle(x, y, 'warn', { count: 14, power: 0.7 }); floatLabel(x, y, 'INACCURATE', 'warn'); sounds.wrong(); host.react('good');
    speak('It slips through thy fingers. <span class="q">Again</span>.');
    setFeedback(`<b>${san}</b>: INACCURATE`, 'warn');
  } else {
    sparkle(x, y, 'bad'); floatLabel(x, y, sameAsGame ? 'AS BEFORE' : 'WORSE', 'bad'); sounds.wrong(); host.react('bad');
    speak(sameAsGame ? 'The same <span class="q">mistake</span>. We are here because of it.' : 'No. Thou makest it <span class="q">worse</span>.');
    setFeedback(sameAsGame ? `<b>${san}</b>: YOUR GAME MOVE` : `<b>${san}</b>: WORSE`, 'bad');
  }
  if (replay) { setButtons({ retry: true, next: true }); return; }
  state.stats.retries++;
  const session = state.session;
  setTimeout(() => { if (session === state.session) resetPuzzlePosition(); }, FAST.on ? 0 : 1300);
}

function resetPuzzlePosition() {
  state.session++;
  const m = state.moments[state.idx];
  state.quiz = new Chess(m.fen);
  board.setPosition(m.fen);
  restoreHighlights(m);
  showBestEval(m);
  state.gaze = null;
  setButtons({ hint: !state.hintUsed, idk: true });
  state.locked = false;
}

function retryCurrent() {
  if (state.results[state.idx] != null) state.replaying = true;
  resetPuzzlePosition();
}

function nextPuzzle() {
  if (state.idx + 1 < state.moments.length) loadPuzzle(state.idx + 1);
  else completeSession();
}

// No verdict screen — when the game is finished, return to the games paper.
async function completeSession() {
  state.idx = state.moments.length;
  setFeedback('', '');
  await backToGames('That game is wrung dry. <span class="q">Choose</span> another.');
}

/* ─────────────────────── reveal / hint ─────────────────── */

async function doReveal() {
  if (!state.quiz) return;
  const m = state.moments[state.idx];
  state.locked = true;
  const session = state.session;
  state.quiz = new Chess(m.fen);
  board.setPosition(m.fen);
  restoreHighlights(m);
  setButtons({});
  await wait(350);
  if (session !== state.session) return;
  const from = m.bestUci.slice(0, 2), to = m.bestUci.slice(2, 4);
  sounds.reveal();
  state.gaze = board.squareWorld(to, 0.4);
  await board.move(from, to, m.bestUci[4]);
  if (session !== state.session) return;
  const { x, y } = board.squareCenter(to);
  sparkle(x, y, 'info'); floatLabel(x, y, m.bestSan, 'info');
  if (state.results[state.idx] == null) { state.results[state.idx] = 'revealed'; state.stats.revealed++; renderCounter(); }
  speak(`I would play <span class="q">${escapeText(m.bestSan)}</span>. Remember it.`);
  setFeedback(`BEST <b>${escapeText(m.bestSan)}</b> ${formatEval(m.evalBest, m.mateBest, m.userColor)} <span class="dim">· you played ${escapeText(m.playedSan)}</span>`, 'info');
  setButtons({ next: true });
}

/* ─────────────────────── HUD helpers ───────────────────── */

function renderCounter() {
  const pips = state.moments.map((_, j) => {
    const r = state.results[j];
    const cls = j === state.idx && !r ? 'current' : r === 'revealed' ? 'failed' : r ? 'done' : '';
    return `<span class="pip ${cls}"></span>`;
  }).join('');
  $('hud-counter').innerHTML = `MOVE ${state.moments[state.idx].moveNumber} <span class="pips">${pips}</span>`;
}

function showBestEval(m) {
  $('hud-eval').innerHTML = `the best move holds <span class="best">${formatEval(m.evalBest, m.mateBest, m.userColor)}</span>`;
}
function showEval(m, you, kind) {
  const cls = kind === 'best' ? 'best' : 'you';
  $('hud-eval').innerHTML = `best <span class="best">${formatEval(m.evalBest, m.mateBest, m.userColor)}</span> · yours <span class="${cls}">${you}</span>`;
}

function setFeedback(html, cls) { const f = $('hud-feedback'); f.innerHTML = html; f.className = 'hud-feedback ' + (cls || ''); }

function setButtons({ hint = false, idk = false, retry = false, accept = false, next = false } = {}) {
  $('btn-hint').hidden = !hint; $('btn-idk').hidden = !idk; $('btn-retry').hidden = !retry;
  $('btn-accept').hidden = !accept; $('btn-next').hidden = !next;
}

function escapeText(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ─────────────────────── HUD buttons ───────────────────── */

$('btn-hint').addEventListener('click', () => {
  const m = state.moments[state.idx];
  state.hintUsed = true; state.stats.hints++; sounds.tick();
  board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
  speak('That one. It <span class="q">wants</span> to move.');
  $('btn-hint').hidden = true;
});
$('btn-idk').addEventListener('click', doReveal);
$('btn-retry').addEventListener('click', () => { sounds.tick(); setFeedback('', ''); retryCurrent(); });
$('btn-accept').addEventListener('click', () => {
  state.results[state.idx] = 'accepted'; state.stats.accepted++; renderCounter(); sounds.great(); nextPuzzle();
});
$('btn-next').addEventListener('click', () => { state.session++; nextPuzzle(); });

document.addEventListener('keydown', (e) => {
  if (state.phase !== 'QUIZ' || !state.quiz) return;
  if (e.key === 'ArrowLeft') { sounds.tick(); setFeedback('', ''); retryCurrent(); }
  else if (e.key === 'ArrowRight') { if (!$('btn-next').hidden) $('btn-next').click(); }
});

/* ─────────────────────── sound toggle ──────────────────── */

const soundBtn = $('btn-sound');
soundBtn.classList.toggle('muted', isMuted());
soundBtn.addEventListener('click', () => soundBtn.classList.toggle('muted', toggleMute()));

/* ─────────────────── test hook (window.__rmc) ──────────── */

window.__rmc = {
  get state() { return state.phase; },
  get puzzleIndex() { return state.idx; },
  get results() { return state.results; },
  get stats() { return state.stats; },
  get fastForward() { return FAST.on; },
  set fastForward(v) { FAST.on = !!v; },
  get hintActive() { return board.hasHighlight('hint-glow'); },
  submitUsername(name) { return doFetch(name); },
  pickGame(i) { return pickGame(i); },
  squareToClient(sq) { return board.squareCenter(sq, 0); },
  playMove(from, to, promo) { return handleUserMove({ from, to, promotion: promo }); },
  reveal() { return doReveal(); },
  hint() { $('btn-hint').click(); },
  retry() { retryCurrent(); },
  next() { return nextPuzzle(); },
};

// deep link ?user=name
const pUser = new URLSearchParams(location.search).get('user');
if (pUser) $('username-input').value = pUser;
