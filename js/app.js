// Revise My Chess — "the cabin". Flow orchestrator: boots straight into the
// candlelit 3D scene, the pawn host asks for a chess.com name, slides a paper
// of recent losses, then quizzes the player's blunders on the real 3D board.
// Reuses chesscom.js / engine.js / analysis.js / chess.js / stockfish unchanged.

import * as THREE from '../lib/three/three.module.js';
import { Chess } from '../lib/chess.js';
import { Engine, formatEval } from './engine.js';
import { fetchPlayer, openGameFeed } from './chesscom.js';
import { analyzeGame, parseGame, uciToSan, ANALYSIS_NODES } from './analysis.js';
import { lastUser, rememberUser, sealedCount, addSealed, shakerLevel, setShakerLevel } from './store.js';
import { initScene, scene, camera, onFrame, flareCandles, introLight, setLampControl, getLampControl, getRopeKnob } from './scene.js';
import { Board3D } from './board3d.js';
import { Host, HOST_COLOR } from './host.js';
import { Paper } from './paper.js';
import { CardDeck } from './cards.js';
import { FlipButton } from './flipbutton.js';
import { loadPieces } from './pieces.js';
import { FAST, wait, tween } from './tween.js';
import { sounds, toggleMute, isMuted, startAmbience } from './sound.js';
import { nameOpening } from './openings.js';
import { floatLabel, sparkle, speak, hush, toast, askPromotion, tickSpeech, openModal } from './ui.js';

const $ = (id) => document.getElementById(id);

const BEST_TOL = 25, GREAT_TOL = 80, GOOD_TOL = 160;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The host's voice — grounded and direct, with a touch of the cabin. Not corny.
const LINES = {
  greetFirst: `Give me your <span class="q">chess.com</span> name. I'll pull your recent games.`,
  greetReturn: (u) => `Welcome back, <span class="q">${escapeText(u)}</span>.`,
  greetReturnSealed: (u, n) => `Welcome back, <span class="q">${escapeText(u)}</span>. <span class="q">${n}</span> sealed in the chest so far.`,
  remembering: `One moment — pulling your games.`,
  pickGame: (u) => `Here are your games, <span class="q">${escapeText(u)}</span>. Pick one.`,
  studying: `Let me look it over.`,
  critical: (n) => `Move ${n}. This is where it went wrong. Find the better move.`,
  best: `That's it.`,
  bestFirst: `That's the move.`,
  great: `Close — there's better. Try again, or keep it.`,
  inaccurate: `Not quite. Again.`,
  worse: `That loses more.`,
  same: `That's the move you played in the game. Try something else.`,
  reveal: (san) => `The move was <span class="q">${escapeText(san)}</span>.`,
  gameDone: `That's all of them — sealed away. Pick another game.`,
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
  track: null,                      // 'study' | 'mental'
  blind: null, blindColor: 'w', blindTurn: false, blindLocked: false, blindSkill: 8, blindOver: false,
  shaker: null, lastChallenge: null,
};

let board, host, paper, deck;

/* ───────────────────────── boot ───────────────────────── */

const headless = navigator.webdriver === true || new URLSearchParams(location.search).has('headless');
const canvas = $('webgl');
initScene(canvas, { headless });
board = new Board3D(scene, camera, {
  canMove: () => (state.phase === 'QUIZ' && !state.locked) || state.phase === 'REVIEW'
    || (state.phase === 'BLIND' && state.blindTurn && !state.blindLocked),
  getLegalMoves: (sq) => {
    const c = state.phase === 'REVIEW' ? state.rev?.chess : state.phase === 'BLIND' ? state.blind : state.quiz;
    return c ? c.moves({ square: sq, verbose: true }) : [];
  },
  onUserMove: (m) => {
    if (state.phase === 'REVIEW') return reviewPlayMove(m);
    if (state.phase === 'BLIND') return blindUserMove(m);
    return handleUserMove(m);
  },
});
board.setOrientation('w');
host = new Host(scene);
paper = new Paper(scene, camera);
deck = new CardDeck(scene, camera, sounds);
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

// when nothing on the board demands his attention, the host watches your hand
const pointerGaze = new THREE.Vector3(0, 3.5, 7.5);
const gazePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -7);
const gazeRay = new THREE.Raycaster();
canvas.addEventListener('pointermove', (e) => {
  gazeRay.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  const hit = new THREE.Vector3();
  if (gazeRay.ray.intersectPlane(gazePlane, hit)) pointerGaze.lerp(hit, 0.5);
});

onFrame((t, dt) => {
  tickSpeech(dt);
  deck.update();
  host.update(t, dt);
  host.lookAt(state.gaze || (cinematic ? pointerGaze : null));
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

// the hearth wakes on the first touch (browser autoplay rules)
window.addEventListener('pointerdown', () => { try { startAmbience(); } catch {} }, { once: true });
window.addEventListener('keydown', () => { try { startAmbience(); } catch {} }, { once: true });

// a slow, breathing camera drift — the cabin never sits perfectly still.
// Off in tests (webdriver) so pointer→square projections stay exact.
const cinematic = !headless;
onFrame((t) => {
  if (!cinematic || FAST.on) return;
  camera.position.x = Math.sin(t * 0.13) * 0.2;
  camera.position.y = 9.4 + Math.sin(t * 0.09) * 0.07;
  camera.lookAt(0, 0, -1);
});

// pick games / page through the parchment
canvas.addEventListener('click', (e) => {
  if (state.phase === 'PICK_GAME') {
    const hit = paper.pick(e.clientX, e.clientY);
    if (hit) {
      if (hit.type === 'game') return pickGame(hit.index);
      if (hit.type === 'next') return changePage(1);
      if (hit.type === 'prev') return changePage(-1);
    }
  } else if (state.phase === 'SHAKER_PLACE') {
    const sq = board.squareFromClient(e.clientX, e.clientY);
    if (sq) return placeShakerPiece(sq);
  }
  // tap the chest → the host tallies what you've sealed inside it
  if (!state.playing && state.username && widgetRay(e).intersectObject(deck.chest.group, true).length) {
    const n = sealedCount(state.username);
    sounds.tick();
    speak(n > 0
      ? `<span class="q">${n}</span> sealed in there. Keep them there.`
      : `Empty, for now. It fills as you <span class="q">fix</span> things.`, { hold: 3500 });
  }
});

async function boot() {
  state.engine.init().catch(() => {}); // warm the engine
  try { await loadPieces(); host.attachPawnModel(); } catch (e) { console.error('piece models failed to load', e); }
  board.setPosition(START_FEN);
  await wait(1100);            // let the title breathe on the black
  if (cinematic) introLight(); // arm the cold open before the veil lifts
  $('boot').classList.add('gone');
  await wait(1400);            // the veil fades as the torches catch…
  setPhase('START');
  await speak('Welcome to the cabin. Shall we <span class="q">study</span> your games, or test your <span class="q">mind</span>?');
  openModal($('start-overlay'));
}
boot();

// pick a track from the start menu, then ask for the name.
function chooseTrack(track) {
  state.track = track;
  $('start-overlay').hidden = true;
  askUsername();
}
function askUsername() {
  setPhase('ASK_USERNAME');
  greetOnBoot();
  $('username-panel').hidden = false;
  $('username-input').focus?.();
}
$('btn-track-study').addEventListener('click', () => { sounds.tick(); chooseTrack('study'); });
$('btn-track-mental').addEventListener('click', () => { sounds.tick(); chooseTrack('mental'); });

// If the cabin remembers you, greet by name and pre-fill it.
function greetOnBoot() {
  const lu = lastUser();
  if (lu) {
    if (!$('username-input').value) $('username-input').value = lu;   // ?user= wins
    const n = sealedCount(lu);
    return speak(n > 0 ? LINES.greetReturnSealed(lu, n) : LINES.greetReturn(lu));
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
// Tear down whatever mode is in progress so nothing is left hanging on the board.
function teardownCurrent() {
  state.session++;
  state.rev = null; state.blind = null; state.shaker = null;
  state.blindOver = false; state.blindPeeking = false;
  deck.reset();
  board.showHints = true; board.setPiecesVisible(true); board.removeFloating();
  board.clearHighlights(); board.clearArrows();
  $('quiz-hud').hidden = true; $('quiz-notation').hidden = true;
  $('review-hud').hidden = true; $('evalbar').hidden = true;
  $('mode-overlay').hidden = true; $('mental-overlay').hidden = true;
  $('blindfold').hidden = true; $('challenge-hud').hidden = true;
  $('analyze-bar').hidden = true;
  hush();
}

function openRename() {
  if (state.phase === 'FETCHING') return;
  teardownCurrent();
  paper.slideOut();
  setPhase('ASK_USERNAME');
  $('btn-rename').hidden = true; $('btn-modes').hidden = true;
  $('username-panel').hidden = false;
  $('username-error').hidden = true;
  speak('Another name? Go on.');
  $('username-input').focus?.();
}
$('btn-rename').addEventListener('click', openRename);

/* ── mode switcher (jump between all four modes) ── */

$('btn-modes').addEventListener('click', () => {
  if (!state.username) return;
  $('nav-name-label').textContent = state.username;
  openModal($('nav-overlay'));   // hushes first — whatever the host was mid-saying won't blur behind it
});
$('nav-close').addEventListener('click', () => { $('nav-overlay').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('nav-overlay').hidden = true; });
$('nav-name').addEventListener('click', () => { $('nav-overlay').hidden = true; openRename(); });
$('nav-games').addEventListener('click', () => navTo('games'));
$('nav-fix').addEventListener('click', () => navTo('fix'));
$('nav-review').addEventListener('click', () => navTo('review'));
$('nav-shaker').addEventListener('click', () => navTo('shaker'));
$('nav-blind').addEventListener('click', () => navTo('blind'));

async function navTo(mode) {
  $('nav-overlay').hidden = true;
  if (!state.username) return;
  teardownCurrent();
  if (mode === 'shaker') return startShaker();
  if (mode === 'blind') return startBlindfold();
  if (mode === 'games') return backToGames();
  // Fix / Review act on the most recently chosen game; without one, pick first.
  if (!state.game) { await backToGames(mode === 'fix' ? 'Pick a game to fix.' : 'Pick a game to step through.'); return; }
  if (mode === 'fix') return startFixMistakes();
  if (mode === 'review') return startReview();
}

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
    rememberUser(name);
    state.blindSkill = eloToSkill(userElo());   // needed by the mental modes from any track
    $('username-panel').hidden = true;
    $('btn-rename').hidden = false; $('btn-modes').hidden = false;
    if (state.track === 'mental') await showMentalPicker();
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
  await speak(`A game against <span class="q">${escapeText(game.opponent)}</span>. How shall we look at it?`);
  if (state.phase !== 'CHOOSE_MODE') return;   // a fast click elsewhere moved us on already
  openModal($('mode-overlay'));
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
  speak(LINES.studying);
  flareCandles();
  // a silent burning-wick progress strip — no chatty updates, just the wick
  const bar = $('analyze-bar'), fill = $('analyze-fill'), flame = $('analyze-bar').querySelector('.ab-flame');
  fill.style.width = '0%'; flame.style.left = '0%';
  bar.hidden = false;
  const onProgress = (done, total) => {
    const pct = Math.min(100, Math.round((done / Math.max(total, 1)) * 100));
    fill.style.width = pct + '%'; flame.style.left = pct + '%';
  };
  const session = ++state.session;   // switching modes mid-analysis abandons this read
  try {
    await state.engine.init();
    const { moments } = await analyzeGame(game, state.engine, { onProgress });
    bar.hidden = true;
    if (session !== state.session || state.phase !== 'ANALYZING') return;
    if (!moments.length) {
      speak('No real mistakes in this one. Pick another.');
      backToGames();
      return;
    }
    startQuiz(moments);
  } catch (ex) {
    bar.hidden = true;
    if (session !== state.session || state.phase !== 'ANALYZING') return;
    toast('The reading failed: ' + (ex.message || ex));
    backToGames();
  }
}

async function backToGames(line) {
  setPhase('PICK_GAME');
  deck.reset();
  board.showHints = true; board.setPiecesVisible(true); board.removeFloating();
  $('quiz-hud').hidden = true;
  $('quiz-notation').hidden = true;
  $('review-hud').hidden = true;
  $('evalbar').hidden = true;
  $('mode-overlay').hidden = true;
  $('blindfold').hidden = true;
  $('challenge-hud').hidden = true;
  board.clearHighlights(); board.clearArrows();
  hush();
  speak(line || `<span class="q">Pick</span> one.`);
  paper.drawGameList(state.games, { page: state.page, hasMore: state.feed ? state.feed.hasMore(state.page) : false });
  host.leanIn(); await paper.slideIn(); await host.leanBack();
}

/* ─────────────────── mental challenges ─────────────────── */

function userElo() { const g = state.games && state.games[0]; return (g && g.userRating) || 800; }
function eloToSkill(elo) { return Math.max(0, Math.min(20, Math.round((elo - 500) / 95))); }

async function showMentalPicker() {
  setPhase('MENTAL_MODE');
  await speak(`I'll play to your level — around <span class="q">${userElo()}</span>. Now, choose your torment.`);
  if (state.phase !== 'MENTAL_MODE') return;   // rename/back happened while he was still talking
  openModal($('mental-overlay'));
}
$('btn-mental-shaker').addEventListener('click', () => { $('mental-overlay').hidden = true; startShaker(); });
$('btn-mental-blind').addEventListener('click', () => { $('mental-overlay').hidden = true; startBlindfold(); });
$('btn-mental-back').addEventListener('click', async () => {
  $('mental-overlay').hidden = true; setPhase('START');
  await speak('Very well. <span class="q">Study</span>, or your <span class="q">mind</span>?');
  if (state.phase !== 'START') return;
  openModal($('start-overlay'));
});

function showChallenge(html, { retry = false, peek = false } = {}) {
  $('challenge-msg').innerHTML = html;
  $('challenge-hud').hidden = false;
  $('btn-challenge-retry').hidden = !retry;
  $('btn-peek').hidden = !peek;
}

function hideChallengeHuds() {
  $('quiz-hud').hidden = true; $('quiz-notation').hidden = true; $('review-hud').hidden = true;
  $('evalbar').hidden = true; $('mode-overlay').hidden = true;
}

$('btn-challenge-exit').addEventListener('click', () => exitChallenge());
$('btn-challenge-retry').addEventListener('click', () => {
  $('challenge-hud').hidden = true; state.session++;
  board.removeFloating(); board.clearHighlights(); board.clearArrows();
  if (state.lastChallenge === 'blind') startBlindfold(); else startShaker();
});

function exitChallenge() {
  state.session++;
  board.showHints = true; board.setPiecesVisible(true); board.removeFloating();
  board.clearHighlights(); board.clearArrows();
  $('blindfold').hidden = true; $('challenge-hud').hidden = true;
  state.blind = null; state.shaker = null; state.blindOver = false;
  board.setPosition(START_FEN);
  showMentalPicker();
}

/* ── Blindfolded Mode ── */

// A black mask sweeping across the whole view; `atCover` fires at full black.
async function maskWipe(atCover) {
  const m = $('blindfold');
  m.hidden = false; m.style.opacity = '0';
  await tween({ ms: FAST.on ? 0 : 230, ease: 'easeInQuad', onUpdate: (v) => { m.style.opacity = String(v); } });
  atCover && atCover();
  await wait(FAST.on ? 0 : 110);
  await tween({ ms: FAST.on ? 0 : 340, ease: 'easeOutQuad', onUpdate: (v) => { m.style.opacity = String(1 - v); } });
  m.style.opacity = '0'; m.hidden = true;
}

async function startBlindfold() {
  state.lastChallenge = 'blind';
  setPhase('BLIND');
  deck.reset(); hideChallengeHuds();
  await paper.slideOut();
  state.blind = new Chess();
  state.blindColor = 'w'; state.blindTurn = true; state.blindLocked = false; state.blindOver = false; state.blindPeeking = false; state.blindPeeks = 0;
  board.showHints = false;
  board.setPiecesVisible(true);
  board.setOrientation(state.blindColor);
  board.setPosition(START_FEN);
  board.clearHighlights();
  speak('Hold still.');
  await host.leanIn();                                    // the pawn reaches forward…
  await maskWipe(() => board.setPiecesVisible(false));    // …the mask passes, the pieces vanish
  if (state.phase !== 'BLIND') return;
  host.leanBack();
  const side = state.blindColor === 'w' ? 'white' : 'black';
  showChallenge(`You are now <span class="q">blindfolded</span> from the pieces. You are playing <span class="q">${side}</span>.`, { peek: true });
}

// Take the blindfold off for one second — but the pawn is not pleased.
// He escalates by repetition: a word, a shorter word, then only the look.
function blindPeek() {
  if (state.phase !== 'BLIND' || state.blindPeeking) return;
  state.blindPeeking = true;
  state.blindPeeks = (state.blindPeeks || 0) + 1;
  board.setPiecesVisible(true);          // a glimpse of the truth
  host.react('bad');                     // furrowed brow + a shake
  sounds.wrong();
  if (state.blindPeeks === 1) speak('<span class="q">Cheater.</span>', { hold: 1300, mood: -1 });
  else if (state.blindPeeks === 2) speak('<span class="q">Again.</span>', { hold: 1100, mood: -1 });
  // third time and after: silence — just the look.
  setTimeout(() => {
    if (state.phase === 'BLIND') board.setPiecesVisible(false);
    state.blindPeeking = false;
  }, FAST.on ? 0 : 1000);
}
$('btn-peek').addEventListener('click', blindPeek);

function blindLast(mv) {
  board.clearHighlights('last-from'); board.clearHighlights('last-to'); board.clearHighlights('check');
  board.highlight(mv.from, 'last-from'); board.highlight(mv.to, 'last-to');
  if (state.blind.inCheck()) { const k = findKing(state.blind, state.blind.turn()); if (k) board.highlight(k, 'check'); }
}

async function blindUserMove({ from, to, promotion }) {
  if (state.phase !== 'BLIND' || state.blindLocked || !state.blindTurn) return;
  const legal = state.blind.moves({ square: from, verbose: true }).filter((mv) => mv.to === to);
  if (!legal.length) return;
  if (legal[0].promotion && !promotion) {
    promotion = await askPromotion(state.blindColor);
    if (!promotion) { board.clearSelection(); return; }
  }
  state.blindLocked = true; state.blindTurn = false;
  const session = state.session;
  const mv = state.blind.move({ from, to, promotion });
  mv.captured ? sounds.capture() : sounds.move();
  await board.move(from, to, promotion);
  board.setPiecesVisible(false);
  blindLast(mv);
  if (blindCheckEnd()) return;
  await wait(FAST.on ? 0 : 350);
  if (state.phase !== 'BLIND' || session !== state.session) return;
  await blindEngineMove(session);
}

async function blindEngineMove(session) {
  let res;
  try { res = await state.engine.evaluate(state.blind.fen(), { depth: 10, movetime: 900, skill: state.blindSkill }); }
  catch { res = null; }
  if (state.phase !== 'BLIND' || session !== state.session) return;
  const uci = res && res.bestMove;
  if (uci) {
    const mv = state.blind.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    mv.captured ? sounds.capture() : sounds.move();
    await board.move(mv.from, mv.to, uci[4]);
    board.setPiecesVisible(false);
    blindLast(mv);
  }
  state.blindLocked = false; state.blindTurn = true;
  blindCheckEnd();
}

function blindCheckEnd() {
  if (!state.blind.isGameOver()) return false;
  state.blindOver = true; state.blindLocked = true; state.blindTurn = false;
  board.setPiecesVisible(true);
  $('blindfold').hidden = true;
  let msg;
  if (state.blind.isCheckmate()) {
    const userWon = state.blind.turn() !== state.blindColor;   // the side to move is the one mated
    msg = userWon ? 'Checkmate — and you never <span class="q">saw</span> it. Remarkable.' : 'Checkmate. I saw what you <span class="q">could not</span>.';
  } else msg = 'A <span class="q">draw</span>, played blind. Respectable.';
  speak(msg);
  showChallenge(msg, { retry: true });
  return true;
}

/* ── Board Shaker ── */

function rndInt(n) { return Math.floor(Math.random() * n); }

const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function randomShakerPosition(extras = 5) {
  const used = new Set(); const pieces = [];
  const adjacent = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) <= 1 && Math.abs(+a[1] - +b[1]) <= 1;
  const pick = (type, avoid) => {
    let sq, tries = 0;
    do { sq = 'abcdefgh'[rndInt(8)] + (1 + rndInt(8)); tries++; }
    while ((used.has(sq) || (type === 'p' && (sq[1] === '1' || sq[1] === '8')) || (avoid && adjacent(sq, avoid))) && tries < 80);
    used.add(sq); return sq;
  };
  const wk = pick('k'); pieces.push({ color: 'w', type: 'k', sq: wk });
  const bk = pick('k', wk); pieces.push({ color: 'b', type: 'k', sq: bk });   // kings can't be adjacent
  const types = ['q', 'r', 'r', 'b', 'b', 'n', 'n', 'p', 'p'];
  for (let i = 0; i < extras; i++) { const type = types[rndInt(types.length)]; pieces.push({ color: rndInt(2) ? 'w' : 'b', type, sq: pick(type) }); }
  return { pieces, fen: shakerFen(pieces) };
}

function shakerFen(pieces) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of pieces) {
    const f = p.sq.charCodeAt(0) - 97, r = 8 - parseInt(p.sq[1], 10);
    grid[r][f] = p.color === 'w' ? p.type.toUpperCase() : p.type;
  }
  return grid.map((row) => {
    let s = '', empty = 0;
    for (const c of row) { if (!c) empty++; else { if (empty) { s += empty; empty = 0; } s += c; } }
    return s + (empty || '');
  }).join('/') + ' w - - 0 1';
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rndInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function startShaker() {
  state.lastChallenge = 'shaker';
  setPhase('SHAKER');
  deck.reset(); hideChallengeHuds();
  board.showHints = true; board.setPiecesVisible(true);
  $('blindfold').hidden = true;
  await paper.slideOut();
  const level = shakerLevel(state.username);
  const setup = randomShakerPosition(Math.min(4 + level, 12));   // level 1 = 7 pieces, +1 per win
  // `remaining` are the pieces still to place, in a random asking order
  state.shaker = { setup, level, remaining: shuffle(setup.pieces.slice()), current: null, lost: false, done: false };
  board.setOrientation('w');
  board.setPosition(setup.fen);
  board.clearHighlights();
  showChallenge(`<span class="q">Level ${level}</span> — ${setup.pieces.length} pieces this time. Don't blink…`);
  await wait(FAST.on ? 0 : 3400);          // memorise
  if (state.phase !== 'SHAKER') return;
  speak('<span class="q">Hah!</span>');
  sounds.capture();
  await board.shakeOff();
  if (state.phase !== 'SHAKER') return;
  setPhase('SHAKER_PLACE');
  nextShakerPiece();
}

// Squares that would be a correct home for the currently-floating kind — every
// not-yet-placed piece of the same colour & type (so duplicate bishops/rooks/etc.
// each accept either of their squares).
function shakerValidSquares() {
  const c = state.shaker.current;
  return state.shaker.remaining.filter((p) => p.color === c.color && p.type === c.type).map((p) => p.sq);
}

function nextShakerPiece() {
  const s = state.shaker;
  if (!s || s.remaining.length === 0) return shakerWin();
  s.current = s.remaining[0];
  board.floatPiece(s.current.color, s.current.type);
  showChallenge(`Where did the <span class="q">${s.current.color === 'w' ? 'white' : 'black'} ${PIECE_NAME[s.current.type]}</span> stand? <span class="dim">${s.remaining.length} left</span>`);
}

function placeShakerPiece(sq) {
  const s = state.shaker;
  if (!s || !s.current || state.phase !== 'SHAKER_PLACE') return;
  if (board.pieceAt.has(sq)) return;              // square taken — just ignore
  const c = s.current;
  const i = s.remaining.findIndex((p) => p.color === c.color && p.type === c.type && p.sq === sq);
  if (i >= 0) {
    board.dropFloatingTo(sq); sounds.correct();
    s.remaining.splice(i, 1);                      // that piece is placed
    if (s.remaining.length === 0) shakerWin();
    else nextShakerPiece();
  } else {
    shakerLose();
  }
}

function shakerWin() {
  state.shaker.done = true;
  setPhase('SHAKER_DONE');
  sounds.fanfare();
  const next = state.shaker.level + 1;
  setShakerLevel(state.username, next);
  speak(`<span class="q">Flawless.</span> Every piece, exactly. Level <span class="q">${next}</span> adds one more.`);
  showChallenge(`Flawless — the whole board, from memory. <span class="q">Level ${next}</span> awaits.`, { retry: true });
}

function shakerLose() {
  const c = state.shaker.current;
  const spots = shakerValidSquares();
  state.shaker.lost = true;
  setPhase('SHAKER_DONE');
  sounds.wrong();
  board.removeFloating();
  board.setPosition(state.shaker.setup.fen);      // reveal the truth
  spots.forEach((sq) => board.highlight(sq, 'hint-glow'));
  const where = spots.join(' or ');
  speak(`<span class="q">Wrong.</span> It belonged on <span class="q">${where}</span>.`);
  showChallenge(`Wrong — that ${PIECE_NAME[c.type]} belonged on <span class="q">${where}</span>.`, { retry: true });
}

/* ──────────────────── simple review mode ───────────────── */
// Step through a game move-by-move with the arrow keys; branch off at any point
// by dragging a piece. The eval bar always reflects the position on the board.

// atPly lets us jump straight in at a given move — used when switching over from
// a Fix-Mistakes position.
async function startReview({ atPly = 0 } = {}) {
  const game = state.game;
  setPhase('REVIEW');
  deck.reset();                    // clear any Fix-Mistakes cards
  $('quiz-hud').hidden = true;
  $('quiz-notation').hidden = true;
  await paper.slideOut();
  flareCandles();
  const moves = parseGame(game.pgn).map((m) => ({ ...m, uci: m.from + m.to + (m.promotion || '') }));
  state.rev = {
    moves, line: [], ply: 0, chess: new Chess(START_FEN), branched: false,
    userColor: game.userColor, opening: nameOpening(moves.map((mv) => mv.san)),
  };
  for (let p = 0; p < atPly && p < moves.length; p++) {   // seek to the handed-over position
    const made = state.rev.chess.move({ from: moves[p].from, to: moves[p].to, promotion: moves[p].promotion });
    state.rev.line.push(recordMove(made, state.rev.chess.fen()));
    state.rev.ply++;
  }
  board.setOrientation(game.userColor);
  $('review-hud').hidden = false;
  $('evalbar').hidden = false;
  host.leanBack();
  speak(atPly ? 'Step through from here.' : 'Step through with the <span class="q">arrows</span>. Or move a piece to try your own line.');
  applyReviewPly();
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
  if (!last) moveEl.innerHTML = `<span class="dim">starting position${r.opening ? ' · ' + escapeText(r.opening) : ''}</span>`;
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
  state.openingName = nameOpening(state.allMoves.map((mv) => mv.san));
  state.idx = 0;
  state.results = new Array(moments.length).fill(null);
  state.stats = { first: 0, solved: 0, accepted: 0, revealed: 0, hints: 0, retries: 0 };
  deck.build(moments);   // a card per mistake, stacked to the side of the board
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
  state.hintStage = 0; $('btn-hint').textContent = '✦ hint';
  state.replaying = false;
  setPhase('QUIZ');

  $('quiz-hud').hidden = false;
  $('evalbar').hidden = false;
  $('quiz-notation').hidden = false;
  board.setOrientation(m.userColor);
  renderCounter();
  $('hud-turn').textContent = '';
  showEvalGraph(m);
  setEvalBar(m.evalBest, m.mateBest);   // the position's eval, chess.com-style bar
  updateQuizNotation(m);
  clearEngineLine();
  setButtons({});
  speak(i === 0
    ? (state.openingName ? `A <span class="q">${escapeText(state.openingName)}</span>. Watch what you do to it.` : 'Watch how it went.')
    : 'It keeps going.');
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
  speak(LINES.critical(m.moveNumber));
  deck.activate(i);   // draw this position's card up beside the board
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
  // Same fixed-node search the analysis used, so the verdict is reproducible and
  // compares like-for-like against the stored best-move eval.
  try { after = await state.engine.evaluate(state.quiz.fen(), { nodes: ANALYSIS_NODES, fresh: true }); }
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
  setEvalBar(after.score, after.mateIn);   // the bar follows the move you made

  if (kind === 'best') {
    revealBestSan(m);
    deck.markSolved(state.idx);   // green arrow appears on the card
    showEngineLine('the idea:', m.fen, m.bestLine);
    sparkle(x, y, 'ok', { power: 1.3 }); floatLabel(x, y, 'BEST', 'ok'); sounds.correct(); host.react('best');
    if (!replay) {
      state.results[state.idx] = state.attempts === 1 ? 'first' : 'solved';
      state.attempts === 1 ? state.stats.first++ : state.stats.solved++;
      renderCounter();
    }
    speak(state.attempts === 1 && !replay ? LINES.bestFirst : LINES.best, { mood: 1 });
    setFeedback(`<b>${san}</b>: BEST <span class="dim">${replay ? 'again' : state.attempts === 1 ? 'first try' : 'in ' + state.attempts + ' tries'}</span>`, 'ok');
    setButtons({ next: true });
    return;
  }
  if (kind === 'great') {
    sparkle(x, y, 'great'); floatLabel(x, y, 'GREAT', 'great'); sounds.great(); host.react('great');
    speak(LINES.great);
    showEngineLine('best reply:', state.quiz.fen(), after.pv);
    setFeedback(`<b>${san}</b>: GREAT <span class="dim">not the best</span>`, 'great');
    setButtons(replay ? { retry: true, next: true } : { retry: true, accept: true, idk: true });
    return;
  }
  if (kind === 'good') {
    sparkle(x, y, 'warn', { count: 14, power: 0.7 }); floatLabel(x, y, 'INACCURATE', 'warn'); sounds.wrong(); host.react('good');
    speak(LINES.inaccurate);
    showEngineLine('punished by:', state.quiz.fen(), after.pv);
    setFeedback(`<b>${san}</b>: INACCURATE`, 'warn');
  } else {
    sparkle(x, y, 'bad'); floatLabel(x, y, sameAsGame ? 'AS BEFORE' : 'WORSE', 'bad'); sounds.wrong(); host.react('bad');
    speak(sameAsGame ? LINES.same : LINES.worse, { mood: -1 });
    showEngineLine('punished by:', state.quiz.fen(), sameAsGame && m.punishLine?.length ? m.punishLine : after.pv);
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
  setEvalBar(m.evalBest, m.mateBest);
  clearEngineLine();
  state.gaze = null;
  setButtons({ hint: !state.hintUsed, idk: true });
  state.locked = false;
}

function retryCurrent() {
  if (state.results[state.idx] != null) state.replaying = true;
  resetPuzzlePosition();
}

async function nextPuzzle() {
  const cur = state.idx;
  await deck.sendToChest(cur);            // the card flies into the chest at the back
  addSealed(state.username, 1);
  if (state.idx + 1 < state.moments.length) loadPuzzle(state.idx + 1);
  else completeSession();
}

// Set up puzzle i on the board with no playback (used when stepping back).
function renderPuzzleAt(i) {
  const m = state.moments[i];
  state.idx = i;
  state.attempts = 0; state.hintUsed = false; state.playing = false; state.skipPlayback = false;
  state.hintStage = 0; $('btn-hint').textContent = '✦ hint';
  state.replaying = state.results[i] != null;   // revisiting a solved one shouldn't re-score it
  board.setOrientation(m.userColor);
  board.setPosition(m.fen);
  state.quiz = new Chess(m.fen);
  restoreHighlights(m);
  renderCounter();
  $('hud-turn').textContent = (m.userColor === 'w' ? 'WHITE' : 'BLACK') + ' TO MOVE';
  showEvalGraph(m);
  setEvalBar(m.evalBest, m.mateBest);
  updateQuizNotation(m);
  setFeedback('', '');
  clearEngineLine();
  // if this one was already dealt with, let the player move on again as well
  setButtons(state.results[i] != null ? { hint: true, idk: true, next: true } : { hint: true, idk: true });
  state.gaze = null;
  state.locked = false;
}

// Rewind the board move-by-move from moment `fromIdx` back to `toIdx`.
async function rewindBoard(fromIdx, toIdx, session) {
  const startPly = state.moments[toIdx].ply, endPly = state.moments[fromIdx].ply;
  const chess = new Chess(state.moments[toIdx].fen);
  const fens = [chess.fen()];
  for (let p = startPly; p < endPly; p++) {
    const mv = state.allMoves[p];
    chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    fens.push(chess.fen());
  }
  for (let k = fens.length - 2; k >= 0; k--) {
    if (session !== state.session) return;
    board.setPosition(fens[k]);
    const mv = state.allMoves[startPly + k];      // the move we just took back
    board.clearHighlights('last-from'); board.clearHighlights('last-to');
    if (mv) { board.highlight(mv.from, 'last-from'); board.highlight(mv.to, 'last-to'); }
    sounds.move();
    await wait(170);
  }
}

// Back arrow: step to the previous quizzed position; its card comes back out of
// the chest and the board rewinds to it.
async function prevPuzzle() {
  if (state.phase !== 'QUIZ' || state.playing || state.idx <= 0) return;
  const from = state.idx, to = from - 1;
  const session = ++state.session;
  state.locked = true;
  setButtons({});
  setFeedback('<span class="dim">back a step…</span>', 'info');
  hush();
  deck.deactivateToStack(from);              // the current card returns to the pile
  await deck.retrieveFromChest(to);          // the previous card lifts out of the chest
  if (session !== state.session) return;
  await rewindBoard(from, to, session);
  if (session !== state.session) return;
  renderPuzzleAt(to);
  speak(`Back to move ${state.moments[to].moveNumber}.`);
}

// Jump from the current Fix-Mistakes position straight into Simple Review.
function switchToReview() {
  if (state.phase !== 'QUIZ') return;
  const atPly = state.moments[state.idx] ? state.moments[state.idx].ply : 0;
  startReview({ atPly });
}

// No verdict screen — the host sums the session up in one line and the games
// paper returns.
async function completeSession() {
  state.idx = state.moments.length;
  setFeedback('', '');
  const n = state.results.length;
  const clean = state.results.filter((r) => r === 'first').length;
  const solved = state.results.filter((r) => r === 'solved' || r === 'accepted').length;
  const shown = n - clean - solved;
  // the single costliest moment — concrete beats a grade
  const worst = state.moments.reduce((a, b) => ((b.winLoss || 0) > (a?.winLoss || 0) ? b : a), null);
  const costly = worst && n > 1 ? ` Move <span class="q">${worst.moveNumber}</span> was the expensive one.` : '';
  let line;
  if (shown === 0 && solved === 0) line = `All <span class="q">${n}</span>, first try. I have nothing to teach you tonight.`;
  else if (shown === 0) line = `All <span class="q">${n}</span> mended and sealed.${costly} Pick another.`;
  else if (clean + solved > 0) line = `<span class="q">${clean + solved}</span> mended, <span class="q">${shown}</span> I had to show you.${costly} Pick another.`;
  else line = `I showed you all <span class="q">${n}</span>. Next time you show me.${costly} Pick another.`;
  await backToGames(line);
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
  setEvalBar(m.evalBest, m.mateBest);   // the bar shows where the best move lands
  showEngineLine('the idea:', m.fen, m.bestLine);
  deck.markSolved(state.idx);   // green arrow for the right move on the card
  if (state.results[state.idx] == null) { state.results[state.idx] = 'revealed'; state.stats.revealed++; renderCounter(); }
  speak(LINES.reveal(m.bestSan));
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

// The game's moves up to the critical position, shown along the bottom.
function updateQuizNotation(m) {
  const el = $('quiz-notation'); if (!el) return;
  const parts = [];
  for (let p = 0; p < m.ply; p++) {
    if (p % 2 === 0) parts.push(`<span class="ml-no">${p / 2 + 1}.</span>`);
    parts.push(`<span class="${p === m.ply - 1 ? 'ml-cur' : ''}">${escapeText(state.allMoves[p].san)}</span>`);
  }
  parts.push(`<span class="ml-turn">${m.userColor === 'w' ? 'white' : 'black'} to move</span>`);
  el.innerHTML = parts.join(' ');
  el.scrollLeft = el.scrollWidth;
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

// Replay a UCI list from a FEN into readable SAN ("Bxf7+ Kxf7 Ng5+ …").
function sanLine(fen, ucis, max = 5) {
  if (!ucis || !ucis.length) return '';
  let c;
  try { c = new Chess(fen); } catch { return ''; }
  const out = [];
  for (const u of ucis.slice(0, max)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!mv) break;
      out.push(mv.san);
    } catch { break; }   // keep whatever legal prefix we already collected
  }
  return out.join(' ');
}

// The little engine-line readout under the feedback: the *why* behind a verdict.
function showEngineLine(label, fen, ucis) {
  const el = $('hud-engine-line');
  const line = sanLine(fen, ucis, 5);
  el.innerHTML = line ? `<span class="el-label">${label}</span>${escapeText(line)}${(ucis || []).length > 5 ? ' …' : ''}` : '';
}
function clearEngineLine() { $('hud-engine-line').innerHTML = ''; }

function setButtons({ hint = false, idk = false, retry = false, accept = false, next = false } = {}) {
  $('btn-hint').hidden = !hint; $('btn-idk').hidden = !idk; $('btn-retry').hidden = !retry;
  $('btn-accept').hidden = !accept; $('btn-next').hidden = !next;
}

function escapeText(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ─────────────────────── HUD buttons ───────────────────── */

// A two-stage hint ladder: first name the *shape* of the answer (the
// checks-captures-threats scan players should be running), only then point.
$('btn-hint').addEventListener('click', () => {
  if (state.locked) return;
  const m = state.moments[state.idx];
  sounds.tick();
  if (!state.hintStage) {
    state.hintStage = 1; state.stats.hints++;
    let cue = 'A <span class="q">quiet</span> move. Improve something.';
    try {
      const mv = new Chess(m.fen).move({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), promotion: m.bestUci[4] });
      const userSign = m.userColor === 'w' ? 1 : -1;
      if (m.mateBest != null && m.mateBest * userSign > 0) cue = 'There\'s a <span class="q">mate</span> in this. Force it.';
      else if (mv && mv.captured) cue = 'Something can be <span class="q">taken</span>.';
      else if (mv && mv.san.includes('+')) cue = 'It starts with a <span class="q">check</span>.';
    } catch {}
    speak(cue);
    $('btn-hint').textContent = '✦ where?';
    return;
  }
  state.hintUsed = true;
  board.highlight(m.bestUci.slice(0, 2), 'hint-glow');
  speak('That one. It <span class="q">wants</span> to move.');
  $('btn-hint').hidden = true;
});
$('btn-idk').addEventListener('click', () => { if (state.locked) return; doReveal(); });
$('btn-retry').addEventListener('click', () => { sounds.tick(); setFeedback('', ''); retryCurrent(); });
$('btn-accept').addEventListener('click', () => {
  state.results[state.idx] = 'accepted'; state.stats.accepted++; renderCounter();
  deck.markSolved(state.idx); sounds.great(); nextPuzzle();
});
$('btn-next').addEventListener('click', () => { state.session++; nextPuzzle(); });
$('btn-to-review').addEventListener('click', () => { sounds.tick(); switchToReview(); });

document.addEventListener('keydown', (e) => {
  if (state.phase === 'REVIEW') {
    if (e.key === 'ArrowLeft') { e.preventDefault(); reviewBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); reviewForward(); }
    return;
  }
  if (state.phase !== 'QUIZ') return;
  if (state.playing) { state.skipPlayback = true; return; }
  if (!state.quiz) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevPuzzle(); }
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
    return m ? { bestUci: m.bestUci, bestSan: m.bestSan, playedUci: m.playedUci, severity: m.severity, bestLine: m.bestLine, punishLine: m.punishLine } : null;
  },
  get lamp() { return getLampControl(); },
  setLamp(t) { setLampControl(t); },
  evalFen(fen, opts) { return state.engine.evaluate(fen, opts); },
  get orientation() { return board.orientation; },
  flip() { board.flip(); },
  submitUsername(name) { return doFetch(name); },
  changePage(d) { return changePage(d); },
  get deckSize() { return deck.cards.length; },
  get activeCard() { return deck.active; },
  get cardSolved() { const c = deck.cards[deck.active]; return c ? c.solved : false; },
  sealedCount(user) { return sealedCount(user || state.username); },
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
  hint() { $('btn-hint').click(); $('btn-hint').click(); },   // both hint stages
  retry() { retryCurrent(); },
  next() { return nextPuzzle(); },
  prev() { return prevPuzzle(); },
  toReview() { return switchToReview(); },
  get evalBarShown() { return !$('evalbar').hidden; },
  get notation() { return $('quiz-notation').textContent; },
  // start menu + mental challenges
  chooseTrack(t) { return chooseTrack(t); },
  chooseMental(m) { $('mental-overlay').hidden = true; return m === 'blind' ? startBlindfold() : startShaker(); },
  get blindHidden() { return board._piecesHidden === true; },
  get blindShown() { return !$('blindfold').hidden; },
  get blindTurn() { return state.blindTurn; },
  get blindOver() { return state.blindOver; },
  blindMove(from, to, promo) { return blindUserMove({ from, to, promotion: promo }); },
  blindPeek() { return blindPeek(); },
  get canSwitchModes() { return !$('btn-modes').hidden; },
  navTo(m) { return navTo(m); },
  get shakerCurrent() { const c = state.shaker && state.shaker.current; return c ? { sq: c.sq, color: c.color, type: c.type } : null; },
  shakerPlace(sq) { return placeShakerPiece(sq); },
  get shakerLost() { return !!(state.shaker && state.shaker.lost); },
  get shakerDone() { return !!(state.shaker && state.shaker.done); },
};

// deep link ?user=name
const pUser = new URLSearchParams(location.search).get('user');
if (pUser) $('username-input').value = pUser;
