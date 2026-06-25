// Revise My Chess — "the cabin". Flow orchestrator: boots straight into the
// candlelit 3D scene, the pawn host asks for a chess.com name, slides a paper
// of recent losses, then quizzes the player's blunders on the real 3D board.
// Reuses chesscom.js / engine.js / analysis.js / chess.js / stockfish unchanged.

import * as THREE from '../lib/three/three.module.js';
import { Chess } from '../lib/chess.js';
import { Engine, formatEval } from './engine.js';
import { fetchPlayer, fetchLostGames } from './chesscom.js';
import { analyzeGame, parseGame, uciToSan } from './analysis.js';
import { initScene, scene, camera, onFrame, flareCandles, setLampControl, getLampControl, getRopeKnob } from './scene.js';
import { Board3D } from './board3d.js';
import { Host, HOST_COLOR } from './host.js';
import { Paper } from './paper.js';
import { loadPieces } from './pieces.js';
import { FAST, wait } from './tween.js';
import { sounds, toggleMute, isMuted } from './sound.js';
import { floatLabel, sparkle, speak, hush, toast, askPromotion } from './ui.js';

const $ = (id) => document.getElementById(id);

const JUDGE_DEPTH = 15;   // match the deep analysis pass when scoring attempts
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
  allMoves: [], playing: false, skipPlayback: false,
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
host = new Host(scene);
paper = new Paper(scene, camera);
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
canvas.addEventListener('pointerdown', (e) => {
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

// pick games / advance summary by clicking the parchment
canvas.addEventListener('click', (e) => {
  if (state.phase === 'PICK_GAME') {
    const i = paper.pick(e.clientX, e.clientY);
    if (i >= 0) pickGame(i);
  }
});

async function boot() {
  state.engine.init().catch(() => {}); // warm the engine
  try { await loadPieces(); host.attachPawnModel(); } catch (e) { console.error('piece models failed to load', e); }
  board.setPosition(START_FEN);
  await wait(300);
  $('boot').classList.add('gone');
  setPhase('ASK_USERNAME');
  speak(`You look <span class="q">lost</span>. Sit. Tell me your <span class="q">chess.com</span> name… and I'll show you where the games <span class="q">slipped away</span>.`);
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
  speak('Another name? Go on.');
  $('username-input').focus?.();
});

async function doFetch(name) {
  setPhase('FETCHING');
  const err = $('username-error'); err.hidden = true;
  const go = $('username-go'); go.disabled = true; go.textContent = 'he listens…';
  speak('Hmm. Let me <span class="q">remember</span> your defeats…');
  try {
    await fetchPlayer(name);
    const games = await fetchLostGames(name);
    if (!games.length) throw new Error("No losses? Either you're unbeatable, or you're lying.");
    state.username = name; state.games = games;
    $('username-panel').hidden = true;
    $('btn-rename').hidden = false;
    setPhase('PICK_GAME');
    speak(`So many, ${escapeText(name)}. <span class="q">Pick</span> one to relive.`);
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
  speak("Let me <span class=\"q\">study</span> it…");
  flareCandles();
  try {
    await state.engine.init();
    const { moments } = await analyzeGame(game, state.engine, {
      onProgress: (d, t) => { if (state.phase === 'ANALYZING') speak(`Let me <span class="q">study</span> it… ${Math.round((d / t) * 100)}%`); },
    });
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
  $('quiz-hud').hidden = true;
  hush();
  speak(line || `<span class="q">Pick</span> one to relive.`);
  paper.drawGameList(state.games);
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

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
  speak(`Move ${m.moveNumber}. Here's where it <span class="q">went wrong</span>. Find the move you should have played.`);
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
  if (state.idx + 1 < state.moments.length) loadPuzzle(state.idx + 1);
  else completeSession();
}

// No verdict screen — when the game is finished, return to the games paper.
async function completeSession() {
  state.idx = state.moments.length;
  setFeedback('', '');
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
  if (state.results[state.idx] == null) { state.results[state.idx] = 'revealed'; state.stats.revealed++; renderCounter(); }
  speak(`I'd play <span class="q">${escapeText(m.bestSan)}</span>. Remember it.`);
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
    row('game', 'GAME', escapeText(m.playedSan), formatEval(m.evalAfterPlayed, m.mateAfterPlayed, m.userColor), 'bad') +
    row('best', 'BEST', '?', formatEval(m.evalBest, m.mateBest, m.userColor), 'ok') +
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
  if (state.phase !== 'QUIZ') return;
  if (state.playing) { state.skipPlayback = true; return; }
  if (!state.quiz) return;
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
  get busy() { return state.locked || state.playing; },
  get puzzle() {
    const m = state.moments[state.idx];
    return m ? { bestUci: m.bestUci, bestSan: m.bestSan, playedUci: m.playedUci, severity: m.severity } : null;
  },
  get lamp() { return getLampControl(); },
  setLamp(t) { setLampControl(t); },
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
