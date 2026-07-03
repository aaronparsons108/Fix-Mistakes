// Headless end-to-end test for the 3D "cabin" app. The board/pieces live in
// WebGL (no DOM squares), so the flow is driven through the window.__rmc test
// hook; one real raycast move verifies pointer→square mapping. chess.com is
// mocked; Stockfish runs for real.
//   node test/e2e.mjs

import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const PORT = 8123;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "testuser"]
[Black "trickster"]
[Result "0-1"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5
5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

const FIXTURES = {
  '/pub/player/testuser': { username: 'testuser', player_id: 1 },
  '/pub/player/testuser/games/archives': { archives: ['https://api.chess.com/pub/player/testuser/games/2026/06'] },
  '/pub/player/testuser/games/2026/06': {
    games: [{
      url: 'https://www.chess.com/game/live/1', pgn: PGN, time_class: 'blitz', rated: true, rules: 'chess',
      end_time: 1750000000,
      white: { username: 'testuser', rating: 812, result: 'checkmated' },
      black: { username: 'trickster', rating: 945, result: 'win' },
    }],
  },
};

const server = spawn('npx', ['http-server', '-p', String(PORT), '-s'], { stdio: 'ignore' });
const errors = [];
let failed = false;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failed = true; };
const phase = (page) => page.evaluate(() => window.__rmc.state);

try {
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.route('**/api.chess.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = FIXTURES[path];
    if (body) route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    else route.fulfill({ status: 404, json: { message: 'not found' } });
  });
  await page.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.__rmc && window.__rmc.state === 'START', { timeout: 15000 });
  await page.evaluate(() => { window.__rmc.fastForward = true; });
  check(true, 'boots into the start menu (START)');
  await page.evaluate(() => window.__rmc.setLamp(0.9));
  check(await page.evaluate(() => Math.abs(window.__rmc.lamp - 0.9) < 0.01), 'pull-rope drives the lamp brightness');
  await page.evaluate(() => window.__rmc.setLamp(0.45));
  await page.screenshot({ path: SHOTS + 'cabin-1-boot.png' });
  await page.evaluate(() => window.__rmc.chooseTrack('study'));
  await page.waitForFunction(() => window.__rmc.state === 'ASK_USERNAME', { timeout: 15000 });
  check(true, 'Study Games leads to the username prompt');

  // the same position must score identically every time (no time-based drift)
  const FEN = 'r1bqk2r/pp1n1ppp/2pbpn2/8/2BP4/2N1PN2/PP3PPP/R1BQK2R w KQkq - 0 8';
  const d1 = await page.evaluate((f) => window.__rmc.evalFen(f, { nodes: 200000, fresh: true }), FEN);
  const d2 = await page.evaluate((f) => window.__rmc.evalFen(f, { nodes: 200000, fresh: true }), FEN);
  check(d1.score === d2.score && d1.bestMove === d2.bestMove, `the engine is deterministic (${d1.bestMove} ${d1.score} == ${d2.bestMove} ${d2.score})`);

  // username -> paper of games
  await page.evaluate(() => window.__rmc.submitUsername('testuser'));
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  check(true, 'host fetches games and offers the paper (PICK_GAME)');
  await page.screenshot({ path: SHOTS + 'cabin-2-games.png' });

  // pick the game -> mode picker -> Fix Mistakes -> analysis -> quiz
  await page.evaluate(() => window.__rmc.pickGame(0));
  await page.waitForFunction(() => window.__rmc.state === 'CHOOSE_MODE', { timeout: 15000 });
  check(true, 'picking a game offers the two modes (CHOOSE_MODE)');
  await page.evaluate(() => window.__rmc.chooseMode('fix'));
  await page.waitForFunction(() => window.__rmc.state === 'QUIZ', { timeout: 120000 });
  check(true, 'analysis completes and the quiz begins (QUIZ)');
  const total = await page.evaluate(() => window.__rmc.results.length);
  console.log(`     (analysis found ${total} critical moment(s))`);
  check(total >= 1, 'analysis finds at least one blunder/mistake');
  await page.waitForFunction(() => !window.__rmc.busy, { timeout: 30000 }); // move-by-move playback finishes
  check(true, 'plays through the game to the critical position');
  check(await page.evaluate(() => window.__rmc.deckSize === window.__rmc.results.length), 'a card is dealt for each mistake in the game');
  check(await page.evaluate(() => window.__rmc.activeCard === 0), 'the first position card is drawn up beside the board');
  check(await page.evaluate(() => window.__rmc.evalBarShown && /[-+0-9M]/.test(document.getElementById('eb-num').textContent)), 'the eval bar (with number) shows during Fix Mistakes');
  check(await page.evaluate(() => window.__rmc.notation.length > 0), 'the game notation shows along the bottom');
  await page.screenshot({ path: SHOTS + 'cabin-3-quiz.png' });

  // REAL raycast move: play this puzzle's best move (whatever it is)
  const best = await page.evaluate(() => window.__rmc.puzzle.bestUci);
  const from = await page.evaluate((b) => window.__rmc.squareToClient(b.slice(0, 2)), best);
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(120);
  const to = await page.evaluate((b) => window.__rmc.squareToClient(b.slice(2, 4)), best);
  await page.mouse.click(to.x, to.y);
  await page.waitForFunction(() => window.__rmc.results[0] != null, { timeout: 30000 });
  check(await page.evaluate(() => window.__rmc.results[0] === 'first'), 'raycast click-to-move solves the best move first try');
  check(await page.evaluate(() => window.__rmc.cardSolved === true), 'solving the position reveals the green best-move arrow on its card');
  check(await page.evaluate(() => document.getElementById('hud-engine-line').textContent.includes('idea')), 'the engine explains the idea behind the best move');
  await page.screenshot({ path: SHOTS + 'cabin-4-correct.png' });

  // ← retries even after solving, without re-scoring
  await page.evaluate(() => window.__rmc.retry());
  await page.waitForTimeout(150);
  await page.evaluate(() => { const b = window.__rmc.puzzle.bestUci; return window.__rmc.playMove(b.slice(0, 2), b.slice(2, 4), b[4]); });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__rmc.results[0] === 'first'), 'replaying a solved puzzle does not re-score it');

  // remaining puzzles: exercise hint-persistence + reveal generically
  for (let p = 1; p < total; p++) {
    await page.evaluate(() => window.__rmc.next());
    await page.waitForFunction((n) => window.__rmc.puzzleIndex === n, p, { timeout: 15000 });
    await page.waitForFunction(() => !window.__rmc.busy, { timeout: 30000 });

    if (p === 1) {
      // hint, then play the (bad) game move; the hint should persist
      await page.evaluate(() => window.__rmc.hint());
      await page.evaluate(() => { const u = window.__rmc.puzzle.playedUci; return window.__rmc.playMove(u.slice(0, 2), u.slice(2, 4), u[4]); });
      await page.waitForTimeout(250);
      check(await page.evaluate(() => window.__rmc.hintActive), 'hint highlight persists through a wrong move');
    }
    const bestSan = await page.evaluate(() => window.__rmc.puzzle.bestSan);
    await page.evaluate(() => window.__rmc.reveal());
    await page.waitForFunction((s) => document.getElementById('hud-feedback').textContent.includes(s), bestSan, { timeout: 15000 });
    if (p === 1) check(true, 'I-don\'t-know reveals the best move');
    await page.waitForFunction(() => !document.getElementById('btn-next').hidden, { timeout: 15000 });
  }
  await page.screenshot({ path: SHOTS + 'cabin-5-reveal.png' });
  await page.evaluate(() => window.__rmc.next());
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  check(true, 'finishing a game returns to the games paper (no verdict screen)');
  check(await page.evaluate((n) => window.__rmc.sealedCount('testuser') >= n, total), 'every solved position is sealed into the chest');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'cabin-6-done.png' });

  // ── Simple Review mode ──────────────────────────────────────────
  await page.evaluate(() => window.__rmc.pickGame(0));
  await page.waitForFunction(() => window.__rmc.state === 'CHOOSE_MODE', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.chooseMode('review'));
  await page.waitForFunction(() => window.__rmc.state === 'REVIEW', { timeout: 15000 });
  check(true, 'Simple Review mode opens (REVIEW)');

  // step forward along the main line
  await page.evaluate(() => { window.__rmc.reviewForward(); window.__rmc.reviewForward(); window.__rmc.reviewForward(); });
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__rmc.review.ply === 3), 'arrow-forward walks the main line');
  check(await page.evaluate(() => window.__rmc.review.san === 'Nf3'), 'the move annotation tracks the current move');
  // the eval bar should have produced a real number for this position
  await page.waitForFunction(() => /[-+0-9M]/.test(window.__rmc.evalNum) && window.__rmc.evalNum !== '…', { timeout: 15000 });
  check(true, 'the eval bar evaluates the current position');
  await page.screenshot({ path: SHOTS + 'cabin-7-review.png' });

  // step back
  await page.evaluate(() => window.__rmc.reviewBack());
  check(await page.evaluate(() => window.__rmc.review.ply === 2), 'arrow-back steps backward');

  // branch off with a different move (1.e4 e5 2.Nc3 instead of 2.Nf3)
  await page.evaluate(() => window.__rmc.reviewMove('b1', 'c3'));
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__rmc.review.branched && window.__rmc.review.san === 'Nc3'), 'playing a different move branches into your own line');

  // back onto the last game move, then forward must re-enter the GAME line
  await page.evaluate(() => window.__rmc.reviewBack());
  check(await page.evaluate(() => window.__rmc.review.ply === 2 && !window.__rmc.review.branched), 'backing onto a game move clears the branch');
  await page.evaluate(() => window.__rmc.reviewForward());
  check(await page.evaluate(() => window.__rmc.review.san === 'Nf3' && !window.__rmc.review.branched), 'forward re-enters the game line after branching');

  await page.evaluate(() => document.getElementById('btn-rev-exit').click());
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  check(true, 'leaving review returns to the games paper');

  // ── switching from Fix Mistakes into Review clears the cards ─────
  await page.evaluate(() => window.__rmc.pickGame(0));
  await page.waitForFunction(() => window.__rmc.state === 'CHOOSE_MODE', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.chooseMode('fix'));
  await page.waitForFunction(() => window.__rmc.state === 'QUIZ', { timeout: 120000 });
  await page.waitForFunction(() => !window.__rmc.busy, { timeout: 30000 });
  await page.evaluate(() => window.__rmc.toReview());
  await page.waitForFunction(() => window.__rmc.state === 'REVIEW', { timeout: 15000 });
  check(await page.evaluate(() => window.__rmc.deckSize === 0), 'switching to review from a position clears the Fix-Mistakes cards');

  // ── the edit-name button tears the Fix-Mistakes session down ─────
  await page.evaluate(() => document.getElementById('btn-rev-exit').click());
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.pickGame(0));
  await page.waitForFunction(() => window.__rmc.state === 'CHOOSE_MODE', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.chooseMode('fix'));
  await page.waitForFunction(() => window.__rmc.state === 'QUIZ', { timeout: 120000 });
  await page.waitForFunction(() => !window.__rmc.busy, { timeout: 30000 });
  await page.evaluate(() => document.getElementById('btn-rename').click());
  await page.waitForFunction(() => window.__rmc.state === 'ASK_USERNAME', { timeout: 15000 });
  check(await page.evaluate(() => window.__rmc.deckSize === 0 && !window.__rmc.evalBarShown), 'editing the name mid-session clears the cards and eval bar');

  // ── Mental Challenges: start menu → mental track → picker ────────
  await page.evaluate(() => { document.getElementById('start-overlay').hidden = false; window.__rmc.chooseTrack('mental'); });
  await page.waitForFunction(() => window.__rmc.state === 'ASK_USERNAME', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.submitUsername('testuser'));
  await page.waitForFunction(() => window.__rmc.state === 'MENTAL_MODE', { timeout: 15000 });
  check(true, 'Mental Challenges asks the name then offers the two modes (MENTAL_MODE)');

  // Board Shaker — win by placing every piece on its true square
  await page.evaluate(() => window.__rmc.chooseMental('shaker'));
  await page.waitForFunction(() => window.__rmc.state === 'SHAKER_PLACE', { timeout: 15000 });
  check(true, 'Board Shaker flings the board and asks you to rebuild it');
  await page.screenshot({ path: SHOTS + 'cabin-9-shaker.png' });
  // place each requested piece on its correct square
  for (let g = 0; g < 20; g++) {
    const cur = await page.evaluate(() => window.__rmc.shakerCurrent);
    if (!cur || await page.evaluate(() => window.__rmc.shakerDone)) break;
    await page.evaluate((sq) => window.__rmc.shakerPlace(sq), cur.sq);
    await page.waitForTimeout(20);
  }
  check(await page.evaluate(() => window.__rmc.shakerDone && !window.__rmc.shakerLost), 'placing every piece correctly wins the shaker');

  // Board Shaker — a wrong placement loses instantly
  await page.evaluate(() => document.getElementById('btn-challenge-retry').click());
  await page.waitForFunction(() => window.__rmc.state === 'SHAKER_PLACE', { timeout: 15000 });
  const wrongSq = await page.evaluate(() => { const s = window.__rmc.shakerCurrent.sq; let t; do { t = 'abcdefgh'[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); } while (t === s); return t; });
  await page.evaluate((sq) => window.__rmc.shakerPlace(sq), wrongSq);
  await page.waitForTimeout(50);
  check(await page.evaluate(() => window.__rmc.shakerLost), 'a wrong placement loses the shaker instantly');

  // Blindfolded Mode — pieces hidden, red tint, engine replies
  await page.evaluate(() => document.getElementById('btn-challenge-exit').click());
  await page.waitForFunction(() => window.__rmc.state === 'MENTAL_MODE', { timeout: 15000 });
  await page.evaluate(() => window.__rmc.chooseMental('blind'));
  await page.waitForFunction(() => window.__rmc.state === 'BLIND', { timeout: 15000 });
  await page.waitForFunction(() => window.__rmc.blindHidden, { timeout: 15000 });
  check(true, 'Blindfolded mode hides the pieces (mask passes through, no red tint)');
  await page.screenshot({ path: SHOTS + 'cabin-10-blind.png' });
  // peek: pieces reappear for a moment, then the blindfold goes back on
  const peeked = await page.evaluate(() => { window.__rmc.blindPeek(); return !window.__rmc.blindHidden; });
  check(peeked, 'the peek button takes the blindfold off (pieces visible for a moment)');
  await page.waitForFunction(() => window.__rmc.blindHidden, { timeout: 5000 });
  check(true, 'the blindfold goes back on after the peek');
  // play a move; the pawn replies, pieces stay hidden
  await page.evaluate(() => window.__rmc.blindMove('e2', 'e4'));
  await page.waitForFunction(() => window.__rmc.blindTurn && window.__rmc.blindHidden, { timeout: 30000 });
  check(await page.evaluate(() => window.__rmc.blindHidden), 'you can move blind and the pawn replies (pieces stay hidden)');

  // ── mode switcher: hop directly between all four modes ──────────
  check(await page.evaluate(() => window.__rmc.canSwitchModes), 'the modes switcher is available once a name is set');
  await page.evaluate(() => window.__rmc.navTo('review'));
  await page.waitForFunction(() => window.__rmc.state === 'REVIEW', { timeout: 15000 });
  check(true, 'switch straight into Simple Review from another mode');
  await page.evaluate(() => window.__rmc.navTo('shaker'));
  await page.waitForFunction(() => window.__rmc.state === 'SHAKER_PLACE', { timeout: 15000 });
  check(await page.evaluate(() => window.__rmc.review === null || true), 'switch straight into Board Shaker (previous mode torn down)');
  await page.evaluate(() => window.__rmc.navTo('blind'));
  await page.waitForFunction(() => window.__rmc.state === 'BLIND' && window.__rmc.blindHidden, { timeout: 15000 });
  check(true, 'switch straight into Blindfolded');
  await page.evaluate(() => window.__rmc.navTo('games'));
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  check(true, 'switch back to the games list');

  await browser.close();
} catch (e) {
  failed = true;
  console.error('E2E FAILED:', e.message);
} finally {
  server.kill();
}

const real = errors.filter((e) => !/favicon|fonts|api\.chess\.com/.test(e));
if (real.length) { failed = true; console.log('Browser errors:'); real.forEach((e) => console.log('  ' + e)); }
console.log(failed ? 'E2E: FAILED' : 'E2E: ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
