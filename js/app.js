// Revise My Chess — "the cabin". Flow orchestrator: boots straight into the
// candlelit 3D scene, the pawn host asks for a chess.com name, slides a paper
// of recent losses, then quizzes the player's blunders on the real 3D board.
// Reuses chesscom.js / engine.js / analysis.js / chess.js / stockfish unchanged.

import * as THREE from '../lib/three/three.module.js';
import { Chess } from '../lib/chess.js';
import { Engine, formatEval } from './engine.js';
import { fetchPlayer, openGameFeed } from './chesscom.js';
import { analyzeGame, parseGame, uciToSan } from './analysis.js';
import { Ledger, lastUser, rememberUser, recurringTheme } from './ledger.js';
import { initScene, scene, camera, onFrame, flareCandles, setLampControl, getLampControl, getRopeKnob } from './scene.js';
import { Board3D } from './board3d.js';
import { Host, HOST_COLOR } from './host.js';
import { Paper } from './paper.js';
import { FlipButton } from './flipbutton.js';
import { loadPieces } from './pieces.js';
import { FAST, wait } from './tween.js';
import { sounds, toggleMute, isMuted } from './sound.js';
import { floatLabel, sparkle, speak, hush, toast, askPromotion, tickSpeech } from './ui.js';

const $ = (id) => document.getElementById(id);

const JUDGE_DEPTH = 15;   // match the deep analysis pass when scoring attempts
const BEST_TOL = 25, GREAT_TOL = 80, GOOD_TOL = 160;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The host's voice — intimate, eerie, a little wry; never a scoreboard.
const LINES = {
  greetFirst: `You look <span class="q">lost</span>. Sit. Tell me your <span class="q">chess.com</span> name… and I'll <span class="q">keep</span> what we find.`,
  greetReturn: (u, n) => `You came back, <span class="q">${escapeText(u)}</span>. Good. I kept <span class="q">${n}</span> you couldn't answer — still warm. We <span class="q">settle</span> those first.`,
  greetReturnClean: (u) => `You came back, <span class="q">${escapeText(u)}</span>. Nothing owed tonight. Let's find something new to <span class="q">regret</span>.`,
  remembering: `Hmm. Let me <span class="q">remember</span>…`,
  pickGame: (u) => `Here they are, <span class="q">${escapeText(u)}</span>. <span class="q">Pick</span> one.`,
  pickAnother: `<span class="q">Pick</span> another.`,
  settle: `These <span class="q">first</span>. The ones you looked away from.`,
  studying: (n, theme) => `<span class="q">${n}</span> times now — ${escapeText(theme)}. <span class="q">Watch</span> for it.`,
  cardPick: `This one. You <span class="q">looked away</span> from it last time. Look at it now.`,
  cardBest: `<span class="q">There.</span> Struck from the ledger. That one won't follow you home again.`,
  cardLearned: `That one's <span class="q">learned</span>. I'll trouble you with it no longer.`,
  cardClose: `Close. But close still leaves it <span class="q">owed</span>. Back it goes — I'll ask again.`,
  cardWorse: `No. It slips through your fingers <span class="q">again</span>. I don't forget these.`,
  cardSame: `The same <span class="q">mistake</span>, in the same chair. That's why I keep them.`,
  cardReveal: (san) => `I'd play <span class="q">${escapeText(san)}</span>. Sit with it. I'll bring it <span class="q">back</span> to you.`,
  ledgerDone: `The ledger's <span class="q">quiet</span> now. On to the living games.`,
};

const state = {
  engine: new Engine(),
  phase: 'BOOT',
  username: null, games: [], game: null,
  moments: [], idx: 0,
  quiz: null, locked: true, attempts: 0, hintUsed: false, replaying: false,
  session: 0, stats: null, results: [],
  gaze: null,
  allMoves: [], playing: false, skipPlayback: false,
  feed: null, page: 0,              // paginated game feed
  rev: null, evalSession: 0,        // simple-review state
  ledger: null, dueQueue: [], facingLedger: false, currentCard: null,
};

let board, host, paper;

/* ───────────────────────── boot ───────────────────────── */

const headless = navigator.webdriver === true || new URLSearchParams(location.search).has('headless');
const canvas = $('webgl');
initScene(canvas, { headless });
board = new Board3D(scene, camera, {
  canMove: () => (state.phase === 'QUIZ' && !state.locked) || state.phase === 'REVIEW',
  getLegalMoves: (sq) => {
    const c = state.phase === 'REVIEW' ? state.rev?.chess : state.quiz;
    return c ? c.moves({ square: sq, verbose: true }) : [];
  },
  onUserMove: (m) => (state.phase === 'REVIEW' ? reviewPlayMove(m) : handleUserMove(m)),
});
board.setOrientation('w');
host = new Host(scene);
paper = new Paper(scene, camera);
const flipBtn = new FlipButton(scene, () => { sounds.tick(); board.flip(); });
board.bindPointer(canvas);

// the host's long arm, stretched from its body to the hand holding the paper
const arm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.34, 1, 16),
  new THREE.MeshStandardMaterial({ color: HOST_COLOR, roughness: 0.6, metalness: 0.05, emissive: 0x0c1404, emissiveIntensity: 0.35 })
);
arm.castShadow = true; arm.visible = false;
scene.add(arm);
const _UP = new THREE.Vector3(0, 1, 0), _mid = new THREE.Vector3(), _dir = new THREE.Vector3();
function stretchArm(a, b) {
  _mid.addVectors(a, b).multiplyScalar(0.5); arm.position.copy(_mid);
  _dir.subVectors(b, a); arm.scale.set(1, _dir.length(), 1);
  arm.quaternion.setFromUnitVectors(_UP, _dir.normalize());
}

onFrame((t, dt) => {
  tickSpeech(dt);
  host.update(t, dt);
  host.lookAt(state.gaze);
  board.pulse(t);
  if (!paper.hidden) { arm.visible = true; stretchArm(host.shoulderWorld(), paper.handWorld()); }
  else arm.visible = false;
});

// the pull-rope: drag it to raise/lower the lamp (down = closer + brighter).
// Registered in the capture phase so grabbing the rope pre-empts board input.
const ropeRay = new THREE.Raycaster();
let ropeDrag = null;
function ropeHit(e) {
  const knob = getRopeKnob(); if (!knob) return false;
  ropeRay.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  return ropeRay.intersectObject(knob).length > 0;
}
function widgetRay(e) {
  ropeRay.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  return ropeRay;
}
canvas.addEventListener('pointerdown', (e) => {
  // the FLIP button takes priority over board/rope
  if (flipBtn.hitTest(widgetRay(e))) { flipBtn.press(); e.stopImmediatePropagation(); return; }
  if (!ropeHit(e)) return;
  ropeDrag = { startY: e.clientY, startT: getLampControl() };
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  e.stopImmediatePropagation();
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (ropeDrag) { setLampControl(ropeDrag.startT + ((e.clientY - ropeDrag.startY) / window.innerHeight) * 1.8); e.stopImmediatePropagation(); return; }
  canvas.style.cursor = ropeHit(e) ? 'grab' : '';
}, true);
const ropeEnd = () => { if (ropeDrag) { ropeDrag = null; canvas.style.cursor = ''; } };
canvas.addEventListener('pointerup', ropeEnd, true);
canvas.addEventListener('pointercancel', ropeEnd, true);

// click anywhere on the board to skip the move-by-move playback
canvas.addEventListener('pointerdown', () => { if (state.playing) state.skipPlayback = true; });

// pick games / page through the parchment / face ledger cards
canvas.addEventListener('click', (e) => {
  const hit = paper.pick(e.clientX, e.clientY);
  if (!hit) return;
  if (state.phase === 'PICK_GAME') {
    if (hit.type === 'game') pickGame(hit.index);
    else if (hit.type === 'next') changePage(1);
    else if (hit.type === 'prev') changePage(-1);
  } else if (state.phase === 'LEDGER') {
    if (hit.type === 'ledger') faceLedgerCard(state.dueQueue[hit.index]);
    else if (hit.type === 'skip') backToGames();
  }
});

async function boot() {
  state.engine.init().catch(() => {}); // warm the engine
  try { await loadPieces(); host.attachPawnModel(); } catch (e) { console.error('piece models failed to load', e); }
  board.setPosition(START_FEN);
  await wait(300);
  $('boot').classList.add('gone');
  setPhase('ASK_USERNAME');
  greetOnBoot();
  $('username-panel').hidden = false;
  $('username-input').focus?.();
}
boot();

// The "last candle" — if the cabin remembers you, the very first line is a
// specific memory (how many debts wait), not a generic welcome.
function greetOnBoot() {
  const lu = lastUser();
  if (lu) {
    if (!$('username-input').value) $('username-input').value = lu;   // ?user= wins
    const due = new Ledger(lu).due();
    if (due.length) return speak(LINES.greetReturn(lu, due.length));
    return speak(LINES.greetReturnClean(lu));
  }
  speak(LINES.greetFirst);
}

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
  speak('Another name? Go on.');
  $('username-input').focus?.();
});

async function doFetch(name) {
  setPhase('FETCHING');
  const err = $('username-error'); err.hidden = true;
  const go = $('username-go'); go.disabled = true; go.textContent = 'he listens…';
  speak(LINES.remembering);
  try {
    await fetchPlayer(name);
    const feed = await openGameFeed(name, { size: 5 });
    const games = await feed.page(0);
    if (!games.length) throw new Error("No games here. Are you sure that's the name?");
    state.username = name; state.feed = feed; state.page = 0; state.games = games;
    state.ledger = new Ledger(name); rememberUser(name);
    $('username-panel').hidden = true;
    $('btn-rename').hidden = false;
    const due = state.ledger.due();
    if (due.length) await enterLedger(due);
    else await showGames(LINES.pickGame(name));
  } catch (ex) {
    setPhase('ASK_USERNAME');
    err.textContent = ex.code === 404 ? `I know no soul named "${name}".` : (ex.message || 'The candle guttered — try again.');
    err.hidden = false;
    speak('That name means nothing to me.');
  } finally {
    go.disabled = false; go.textContent = 'tell him →';
  }
}

async function showGames(line) {
  setPhase('PICK_GAME');
  speak(line);
  paper.drawGameList(state.games, { page: state.page, hasMore: state.feed ? state.feed.hasMore(state.page) : false });
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

/* ─────────────────────── the ledger ────────────────────── */

async function enterLedger(due) {
  setPhase('LEDGER');
  state.dueQueue = due.slice();
  const rec = recurringTheme(state.ledger.cards);
  speak(rec ? LINES.studying(rec.count, rec.theme) : LINES.settle);
  paper.drawLedgerList(state.dueQueue);
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

async function faceLedgerCard(card) {
  if (!card || state.facingLedger) return;   // ignore a second click during the slide-out
  state.facingLedger = true; state.currentCard = card;
  sounds.tick();
  await paper.slideOut();
  loadLedgerPosition(card);
}

function loadLedgerPosition(card) {
  const session = ++state.session;
  const m = ledgerMoment(card);
  state.moments = [m]; state.results = [null]; state.idx = 0;
  state.stats = { first: 0, solved: 0, accepted: 0, revealed: 0, hints: 0, retries: 0 };
  state.locked = true; state.playing = false; state.attempts = 0; state.hintUsed = false; state.replaying = false;
  setPhase('QUIZ');
  $('quiz-hud').hidden = false;
  board.setOrientation(card.userColor);
  $('hud-counter').innerHTML = `THE LEDGER <span class="pips"></span> move ${card.moveNumber}`;
  $('hud-turn').textContent = (card.userColor === 'w' ? 'WHITE' : 'BLACK') + ' TO MOVE';
  showEvalGraph(m);
  board.setPosition(card.fen);
  state.quiz = new Chess(card.fen);
  restoreHighlights(m);
  setButtons({ hint: true, idk: true });
  speak(LINES.cardPick);
  state.gaze = null;
  state.locked = false;
  if (session !== state.session) return;
}

// A ledger card wears the same shape as an analysis "moment", so the whole
// quiz/judge machinery works on it unchanged.
function ledgerMoment(card) {
  return {
    fen: card.fen, fenAfterPlayed: card.fenAfterPlayed,
    bestUci: card.bestUci, bestSan: card.bestSan, playedUci: card.playedUci, playedSan: card.playedSan,
    evalBest: card.evalBest, mateBest: card.mateBest, evalAfterPlayed: card.evalAfterPlayed, mateAfterPlayed: card.mateAfterPlayed,
    userColor: card.userColor, moveNumber: card.moveNumber, severity: card.severity, prevMove: null,
  };
}

// Grade the card the player just faced, then move to the next debt or the games.
function judgeLedger(kind, m, uci, after) {
  const to = uci.slice(2, 4);
  const { x, y } = board.squareCenter(to);
  const san = escapeText(uciToSan(m.fen, uci));
  const clean = kind === 'best' && state.attempts === 1 && !state.hintUsed;
  state.gaze = board.squareWorld(to, 0.4);
  fillYours(m, after.score, after.mateIn, kind, san);
  revealBestSan(m);

  const laidToRest = state.ledger.grade(state.currentCard, clean);
  if (kind === 'best') {
    sparkle(x, y, 'ok', { power: 1.3 }); floatLabel(x, y, 'BEST', 'ok'); sounds.correct(); host.react('best');
    speak(clean ? (laidToRest ? LINES.cardLearned : LINES.cardBest) : LINES.cardBest);
    setFeedback(`<b>${san}</b>: BEST <span class="dim">${clean ? 'debt paid' : 'but not clean'}</span>`, 'ok');
  } else {
    const worse = kind === 'bad';
    sparkle(x, y, worse ? 'bad' : 'warn', worse ? {} : { count: 14, power: 0.7 });
    floatLabel(x, y, worse ? 'STILL OWED' : 'NOT CLEAN', worse ? 'bad' : 'warn');
    sounds.wrong(); host.react(worse ? 'bad' : 'good');
    const sameAsGame = uci === m.playedUci;
    speak(sameAsGame ? LINES.cardSame : worse ? LINES.cardWorse : LINES.cardClose);
    setFeedback(`<b>${san}</b>: ${sameAsGame ? 'THE SAME MOVE' : 'STILL OWED'} <span class="dim">back to tomorrow</span>`, worse ? 'bad' : 'warn');
  }
  setButtons({ next: true });
}

async function nextLedgerCard() {
  state.dueQueue = state.dueQueue.filter((c) => c !== state.currentCard);
  state.facingLedger = false; state.currentCard = null;
  $('quiz-hud').hidden = true; hush();
  if (state.dueQueue.length) {
    setPhase('LEDGER');
    paper.drawLedgerList(state.dueQueue);
    host.leanIn(); await paper.slideIn(); await host.leanBack();
  } else {
    await showGames(LINES.ledgerDone);
  }
}

// Page forward (older) / backward (newer) through the game feed.
async function changePage(delta) {
  if (!state.feed || state.phase !== 'PICK_GAME') return;
  const next = state.page + delta;
  if (next < 0) return;
  sounds.tick();
  const games = await state.feed.page(next);
  if (!games.length) return;        // nothing older to show
  state.page = next; state.games = games;
  paper.drawGameList(games, { page: next, hasMore: state.feed.hasMore(next) });
}

/* ─────────────────── pick game → analyze ───────────────── */

async function pickGame(i) {
  const game = state.games[i];
  if (!game) return;
  state.game = game;
  sounds.tick();
  setPhase('CHOOSE_MODE');
  speak(`A game against <span class="q">${escapeText(game.opponent)}</span>. How shall we look at it?`);
  $('mode-overlay').hidden = false;
}

$('btn-mode-back').addEventListener('click', () => {
  $('mode-overlay').hidden = true;
  setPhase('PICK_GAME');
  speak('<span class="q">Pick</span> one, then.');
});
$('btn-mode-fix').addEventListener('click', () => { $('mode-overlay').hidden = true; startFixMistakes(); });
$('btn-mode-review').addEventListener('click', () => { $('mode-overlay').hidden = true; startReview(); });

async function startFixMistakes() {
  const game = state.game;
  setPhase('ANALYZING');
  await paper.slideOut();
  speak("Let me <span class=\"q\">study</span> it…");
  flareCandles();
  try {
    await state.engine.init();
    const { moments } = await analyzeGame(game, state.engine);
    if (!moments.length) {
      speak('No real blunders here — you were just <span class="q">outplayed</span>. Pick another.');
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
  state.facingLedger = false; state.currentCard = null;
  $('quiz-hud').hidden = true;
  $('review-hud').hidden = true;
  $('evalbar').hidden = true;
  $('mode-overlay').hidden = true;
  board.clearHighlights(); board.clearArrows();
  hush();
  speak(line || `<span class="q">Pick</span> one.`);
  paper.drawGameList(state.games, { page: state.page, hasMore: state.feed ? state.feed.hasMore(state.page) : false });
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

/* ──────────────────── simple review mode ───────────────── */
// Step through a game move-by-move with the arrow keys; branch off at any point
// by dragging a piece. The eval bar always reflects the position on the board.

async function startReview() {
  const game = state.game;
  setPhase('REVIEW');
  await paper.slideOut();
  flareCandles();
  const moves = parseGame(game.pgn).map((m) => ({ ...m, uci: m.from + m.to + (m.promotion || '') }));
  state.rev = { moves, line: [], ply: 0, chess: new Chess(START_FEN), branched: false, userColor: game.userColor };
  board.setOrientation(game.userColor);
  board.setPosition(START_FEN);
  board.clearHighlights(); board.clearArrows();
  $('review-hud').hidden = false;
  $('evalbar').hidden = false;
  host.leanBack();
  speak('Step through with the <span class="q">arrows</span>. Or move a piece to try your own line.');
  updateReviewHud();
  evalCurrent();
}

function recordMove(made, fen) {
  return {
    san: made.san, from: made.from, to: made.to,
    promotion: made.promotion, uci: made.from + made.to + (made.promotion || ''),
    fen, captured: made.captured,
  };
}

// Is the current path (line[0..ply-1]) still exactly the game's main line?
function isOnMainLine(ply) {
  const r = state.rev;
  for (let i = 0; i < ply; i++) if (!r.moves[i] || r.moves[i].uci !== r.line[i].uci) return false;
  return true;
}

function reviewForward() {
  const r = state.rev; if (!r || r.busy) return;
  // If we're standing on the main line, forward always continues the *game* —
  // even if we'd earlier branched from here (that stored variation is dropped),
  // so backing up to a game move and going forward re-enters the real game.
  const mainMv = isOnMainLine(r.ply) ? r.moves[r.ply] : null;
  if (mainMv && !(r.ply < r.line.length && r.line[r.ply].uci === mainMv.uci)) {
    r.line.length = r.ply;                       // discard any divergent future
    const made = r.chess.move({ from: mainMv.from, to: mainMv.to, promotion: mainMv.promotion });
    r.line.push(recordMove(made, r.chess.fen()));
    r.ply++;
  } else if (r.ply < r.line.length) {
    const rec = r.line[r.ply];                   // redo a recorded move (main or branch)
    r.chess.move({ from: rec.from, to: rec.to, promotion: rec.promotion });
    r.ply++;
  } else {
    return;                                      // nothing ahead
  }
  sounds.move();
  applyReviewPly();
}

function reviewBack() {
  const r = state.rev; if (!r || r.busy || r.ply === 0) return;
  r.chess.undo(); r.ply--;
  sounds.tick();
  applyReviewPly();
}

// Async because of promotion + the move animation; a busy lock keeps the arrow
// keys (reviewForward/Back) from mutating r.chess/r.line/r.ply mid-flight.
async function reviewPlayMove({ from, to, promotion }) {
  const r = state.rev; if (!r || r.busy) return;
  const legal = r.chess.moves({ square: from, verbose: true }).filter((mv) => mv.to === to);
  if (!legal.length) return;
  r.busy = true;
  try {
    if (legal[0].promotion && !promotion) {
      promotion = await askPromotion(r.userColor);
      if (!promotion) { board.clearSelection(); return; }
    }
    if (r.ply < r.line.length) r.line.length = r.ply;   // overwrite any "redo" future
    const made = r.chess.move({ from, to, promotion });
    made.captured ? sounds.capture() : sounds.move();
    await board.move(from, to, promotion);
    r.line.push(recordMove(made, r.chess.fen()));
    r.ply++;
    applyReviewPly();
  } finally { r.busy = false; }
}

function applyReviewPly() {
  const r = state.rev;
  const last = r.ply > 0 ? r.line[r.ply - 1] : null;
  board.setPosition(last ? last.fen : START_FEN);
  board.clearHighlights(); board.clearArrows();
  if (last) { board.highlight(last.from, 'last-from'); board.highlight(last.to, 'last-to'); }
  if (r.chess.inCheck()) { const k = findKing(r.chess, r.chess.turn()); if (k) board.highlight(k, 'check'); }
  r.branched = !isOnMainLine(r.ply);   // are we currently off the game's line?
  updateReviewHud();
  evalCurrent();
}

function updateReviewHud() {
  const r = state.rev;
  const last = r.ply > 0 ? r.line[r.ply - 1] : null;
  const moveEl = $('rev-move');
  if (!last) moveEl.innerHTML = '<span class="dim">starting position</span>';
  else {
    const n = Math.floor((r.ply - 1) / 2) + 1;
    const sep = (r.ply % 2 === 1) ? '.' : '…';
    moveEl.innerHTML = `<b>${n}${sep} ${escapeText(last.san)}</b>` +
      (r.branched ? ' <span class="branch-tag">your line</span>' : '');
  }
  // a compact running move list with the current half-move marked
  const parts = [];
  for (let i = 0; i < r.line.length; i++) {
    if (i % 2 === 0) parts.push(`<span class="ml-no">${i / 2 + 1}.</span>`);
    const onMain = r.moves[i] && r.moves[i].uci === r.line[i].uci;
    const cls = (i === r.ply - 1 ? 'ml-cur ' : '') + (onMain ? '' : 'ml-branch');
    parts.push(`<span class="${cls}">${escapeText(r.line[i].san)}</span>`);
  }
  $('rev-line').innerHTML = parts.join(' ') || '<span class="dim">— no moves yet —</span>';
}

function winProb(scoreCp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * scoreCp)) - 1);
}

function setEvalBar(score, mateIn) {
  const whiteWin = Math.max(0, Math.min(100, winProb(score)));
  $('eb-fill').style.height = whiteWin + '%';
  const num = $('eb-num');
  num.textContent = formatEval(score, mateIn, 'w');
  // keep the readout next to whichever side is winning
  num.classList.toggle('low', whiteWin < 50);
}

async function evalCurrent() {
  const r = state.rev; if (!r) return;
  const my = ++state.evalSession;
  if (r.chess.isGameOver()) {
    if (r.chess.isCheckmate()) setEvalBar(r.chess.turn() === 'b' ? 9999 : -9999, null);
    else setEvalBar(0, null);
    return;
  }
  $('eb-num').textContent = '…';
  let ev;
  try { await state.engine.init(); ev = await state.engine.evaluate(r.chess.fen(), { depth: 12, movetime: 700 }); }
  catch { return; }
  if (my !== state.evalSession || state.phase !== 'REVIEW') return;   // superseded
  setEvalBar(ev.score, ev.mateIn);
}

$('btn-rev-exit').addEventListener('click', () => { state.rev = null; state.evalSession++; backToGames(); });

/* ────────────────────────── quiz ───────────────────────── */

function startQuiz(moments) {
  state.moments = moments;
  state.allMoves = parseGame(state.game.pgn);
  state.idx = 0;
  state.results = new Array(moments.length).fill(null);
  state.stats = { first: 0, solved: 0, accepted: 0, revealed: 0, hints: 0, retries: 0 };
  loadPuzzle(0);
}

async function loadPuzzle(i) {
  state.idx = i;
  const session = ++state.session;
  const m = state.moments[i];
  state.locked = true;
  state.playing = true;
  state.skipPlayback = false;
  state.attempts = 0;
  state.hintUsed = false;
  state.replaying = false;
  setPhase('QUIZ');

  $('quiz-hud').hidden = false;
  board.setOrientation(m.userColor);
  renderCounter();
  $('hud-turn').textContent = '';
  showEvalGraph(m);
  setButtons({});
  speak(i === 0 ? "Watch how it happened…" : 'And it continues…');
  setFeedback('<span class="dim">click the board to skip ahead</span>', 'info');

  // play the game's actual moves, one by one, up to this critical position
  const startPly = i === 0 ? 0 : state.moments[i - 1].ply;
  const startFen = i === 0 ? START_FEN : state.moments[i - 1].fen;
  board.clearHighlights();
  board.setPosition(startFen);
  await wait(450);
  if (session !== state.session) return;
  for (let p = startPly; p < m.ply; p++) {
    if (state.skipPlayback) break;
    const mv = state.allMoves[p];
    board.clearHighlights('last-from'); board.clearHighlights('last-to');
    board.highlight(mv.from, 'last-from');
    state.gaze = board.squareWorld(mv.to, 0.4);
    mv.captured ? sounds.capture() : sounds.move();
    await board.move(mv.from, mv.to, mv.promotion);
    if (session !== state.session) return;
    board.highlight(mv.to, 'last-to');
    await wait(360);
    if (session !== state.session) return;
  }

  // settle exactly on the critical position and hand over to the player
  board.setPosition(m.fen);
  state.quiz = new Chess(m.fen);
  restoreHighlights(m);
  state.playing = false;
  state.gaze = null;
  $('hud-turn').textContent = (m.userColor === 'w' ? 'WHITE' : 'BLACK') + ' TO MOVE';
  setFeedback('', '');
  setButtons({ hint: true, idk: true });
  speak(`Move ${m.moveNumber}. Here is where it <span class="q">turned</span>. Show me the move you owed the position.`);
  state.locked = false;
}

function restoreHighlights(m) {
  board.clearHighlights();
  if (m.prevMove) { board.highlight(m.prevMove.from, 'last-from'); board.highlight(m.prevMove.to, 'last-to'); }
  if (state.quiz.inCheck()) { const k = findKing(state.quiz, m.userColor); if (k) board.highlight(k, 'check'); }
  if (state.hintUsed) board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
  // the loopy red arrow to the move actually played in the game
  board.drawArrow(m.playedUci.slice(0, 2), m.playedUci.slice(2, 4), 'played');
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
  setButtons({});   // no hint/idk/etc while the move is being judged (prevents double-grade)
  board.clearHighlights('hint-glow');
  board.clearArrows();
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
  if (state.facingLedger) return judgeLedger(kind, m, uci, after);
  const to = uci.slice(2, 4);
  const { x, y } = board.squareCenter(to);
  const sameAsGame = uci === m.playedUci;
  const san = escapeText(uciToSan(m.fen, uci));
  const replay = state.replaying;
  state.gaze = board.squareWorld(to, 0.4);
  fillYours(m, after.score, after.mateIn, kind, san);

  if (kind === 'best') {
    revealBestSan(m);
    sparkle(x, y, 'ok', { power: 1.3 }); floatLabel(x, y, 'BEST', 'ok'); sounds.correct(); host.react('best');
    if (!replay) {
      state.results[state.idx] = state.attempts === 1 ? 'first' : 'solved';
      state.attempts === 1 ? state.stats.first++ : state.stats.solved++;
      renderCounter();
    }
    speak(state.attempts === 1 && !replay ? "That's the one. <span class=\"q\">Clever</span>." : 'There it is.');
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
    speak('It slips away. <span class="q">Again</span>.');
    setFeedback(`<b>${san}</b>: INACCURATE`, 'warn');
  } else {
    sparkle(x, y, 'bad'); floatLabel(x, y, sameAsGame ? 'AS BEFORE' : 'WORSE', 'bad'); sounds.wrong(); host.react('bad');
    speak(sameAsGame ? "The same <span class=\"q\">mistake</span>. That's why we're here." : 'No — that makes it <span class="q">worse</span>.');
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
  showEvalGraph(m);
  state.gaze = null;
  setButtons({ hint: !state.hintUsed, idk: true });
  state.locked = false;
}

function retryCurrent() {
  if (state.results[state.idx] != null) state.replaying = true;
  resetPuzzlePosition();
}

function nextPuzzle() {
  if (state.facingLedger) return nextLedgerCard();
  if (state.idx + 1 < state.moments.length) loadPuzzle(state.idx + 1);
  else completeSession();
}

// No verdict screen — when the game is finished, fold what you missed into the
// ledger (so it comes back to you later) and return to the games paper.
async function completeSession() {
  state.idx = state.moments.length;
  setFeedback('', '');
  if (state.ledger && !state.facingLedger) {
    try { state.ledger.recordGame(state.moments, state.results, state.game); } catch (e) { console.error('ledger write failed', e); }
  }
  await backToGames("That game's done. <span class=\"q\">Pick</span> another.");
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
  board.clearArrows();   // the reveal shows the best move, not the played one
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
  revealBestSan(m);
  if (state.facingLedger) { state.ledger.grade(state.currentCard, false); }   // asked-for reveal = still owed
  else if (state.results[state.idx] == null) { state.results[state.idx] = 'revealed'; state.stats.revealed++; renderCounter(); }
  speak(state.facingLedger ? LINES.cardReveal(m.bestSan) : `I'd play <span class="q">${escapeText(m.bestSan)}</span>. Remember it.`);
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

/* eval bars — GAME (the move you actually played), BEST, YOURS.
   Evals are shown from the player's perspective (right = good for you). */

function userCp(m, score) {
  const sign = m.userColor === 'w' ? 1 : -1;
  return Math.max(-1000, Math.min(1000, score * sign));
}

function showEvalGraph(m) {
  const gameCp = userCp(m, m.evalAfterPlayed), bestCp = userCp(m, m.evalBest);
  state.graphLimit = Math.max(Math.abs(gameCp), Math.abs(bestCp), 250) * 1.15;
  const row = (key, label, sub, val, cls) => `
    <div class="hg-row">
      <span class="hg-id"><span class="hg-label">${label}</span><span class="hg-sub" data-sub="${key}">${sub}</span></span>
      <span class="hg-track"><i class="hg-zero"></i><i class="hg-bar ${cls}" data-bar="${key}" style="left:50%;width:0"></i></span>
      <span class="hg-val ${cls}" data-val="${key}">${val}</span>
    </div>`;
  $('hud-graph').innerHTML =
    '<div class="hg-head">the reckoning</div>' +
    row('game', 'PLAYED', escapeText(m.playedSan), formatEval(m.evalAfterPlayed, m.mateAfterPlayed, m.userColor), 'bad') +
    row('best', 'BEST', '…', formatEval(m.evalBest, m.mateBest, m.userColor), 'ok') +
    row('you', 'YOURS', '—', '—', '');
  requestAnimationFrame(() => { setGraphBar('game', gameCp); setGraphBar('best', bestCp); });
}

function setGraphBar(key, cp, cls) {
  const bar = $('hud-graph').querySelector(`[data-bar="${key}"]`);
  if (!bar) return;
  const pct = Math.min(Math.abs(cp) / (state.graphLimit || 1), 1) * 50;
  bar.style.width = pct + '%';
  bar.style.left = (cp >= 0 ? 50 : 50 - pct) + '%';
  if (cls !== undefined) bar.className = `hg-bar ${cls}`;
}

// fill in YOURS after the player moves
function fillYours(m, score, mateIn, kind, san) {
  const cls = kind === 'best' ? 'ok' : kind === 'great' ? 'great' : kind === 'good' ? 'warn' : 'bad';
  const g = $('hud-graph');
  g.querySelector('[data-sub="you"]').textContent = san;
  const val = g.querySelector('[data-val="you"]');
  val.textContent = formatEval(score, mateIn, m.userColor); val.className = `hg-val ${cls}`;
  setGraphBar('you', userCp(m, score), cls);
}

function revealBestSan(m) {
  const el = $('hud-graph').querySelector('[data-sub="best"]');
  if (el) el.textContent = escapeText(m.bestSan);
}

function setFeedback(html, cls) { const f = $('hud-feedback'); f.innerHTML = html; f.className = 'hud-feedback ' + (cls || ''); }

function setButtons({ hint = false, idk = false, retry = false, accept = false, next = false } = {}) {
  $('btn-hint').hidden = !hint; $('btn-idk').hidden = !idk; $('btn-retry').hidden = !retry;
  $('btn-accept').hidden = !accept; $('btn-next').hidden = !next;
}

function escapeText(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ─────────────────────── HUD buttons ───────────────────── */

$('btn-hint').addEventListener('click', () => {
  if (state.locked) return;
  const m = state.moments[state.idx];
  state.hintUsed = true; state.stats.hints++; sounds.tick();
  board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
  speak('That one. It <span class="q">wants</span> to move.');
  $('btn-hint').hidden = true;
});
$('btn-idk').addEventListener('click', () => { if (state.locked) return; doReveal(); });
$('btn-retry').addEventListener('click', () => { sounds.tick(); setFeedback('', ''); retryCurrent(); });
$('btn-accept').addEventListener('click', () => {
  state.results[state.idx] = 'accepted'; state.stats.accepted++; renderCounter(); sounds.great(); nextPuzzle();
});
$('btn-next').addEventListener('click', () => { state.session++; nextPuzzle(); });

document.addEventListener('keydown', (e) => {
  if (state.phase === 'REVIEW') {
    if (e.key === 'ArrowLeft') { e.preventDefault(); reviewBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); reviewForward(); }
    return;
  }
  if (state.phase !== 'QUIZ') return;
  if (state.playing) { state.skipPlayback = true; return; }
  if (!state.quiz) return;
  if (e.key === 'ArrowLeft') { if (state.facingLedger) return; sounds.tick(); setFeedback('', ''); retryCurrent(); }
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
  get busy() { return state.locked || state.playing; },
  get puzzle() {
    const m = state.moments[state.idx];
    return m ? { bestUci: m.bestUci, bestSan: m.bestSan, playedUci: m.playedUci, severity: m.severity } : null;
  },
  get lamp() { return getLampControl(); },
  setLamp(t) { setLampControl(t); },
  get orientation() { return board.orientation; },
  flip() { board.flip(); },
  submitUsername(name) { return doFetch(name); },
  changePage(d) { return changePage(d); },
  get facingLedger() { return state.facingLedger; },
  get dueCount() { return state.dueQueue ? state.dueQueue.length : 0; },
  faceCard(i) { return faceLedgerCard(state.dueQueue[i]); },
  skipLedger() { return backToGames(); },
  ledgerCards(user) { return new Ledger(user || state.username).cards; },
  pickGame(i) { return pickGame(i); },
  chooseMode(mode) { $('mode-overlay').hidden = true; return mode === 'review' ? startReview() : startFixMistakes(); },
  reviewForward() { reviewForward(); },
  reviewBack() { reviewBack(); },
  reviewMove(from, to, promo) { return reviewPlayMove({ from, to, promotion: promo }); },
  get review() {
    const r = state.rev;
    return r ? { ply: r.ply, lineLen: r.line.length, branched: r.branched, san: r.ply > 0 ? r.line[r.ply - 1].san : null, fen: r.chess.fen() } : null;
  },
  get evalNum() { return $('eb-num').textContent; },
  get evalFill() { return $('eb-fill').style.height; },
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
