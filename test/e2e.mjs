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
  await page.waitForFunction(() => window.__rmc && window.__rmc.state === 'ASK_USERNAME', { timeout: 15000 });
  await page.evaluate(() => { window.__rmc.fastForward = true; });
  check(true, 'boots straight into the cabin (ASK_USERNAME)');
  await page.screenshot({ path: SHOTS + 'cabin-1-boot.png' });

  // username -> paper of games
  await page.evaluate(() => window.__rmc.submitUsername('testuser'));
  await page.waitForFunction(() => window.__rmc.state === 'PICK_GAME', { timeout: 15000 });
  check(true, 'host fetches games and offers the paper (PICK_GAME)');
  await page.screenshot({ path: SHOTS + 'cabin-2-games.png' });

  // pick the game -> Stockfish analysis -> quiz
  await page.evaluate(() => window.__rmc.pickGame(0));
  await page.waitForFunction(() => window.__rmc.state === 'QUIZ', { timeout: 120000 });
  check(true, 'analysis completes and the quiz begins (QUIZ)');
  const total = await page.evaluate(() => window.__rmc.results.length);
  console.log(`     (analysis found ${total} critical moments)`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'cabin-3-quiz.png' });

  // REAL raycast move: best move on puzzle 1 is Nxd4 (f3 -> d4)
  const from = await page.evaluate(() => window.__rmc.squareToClient('f3'));
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(120);
  const to = await page.evaluate(() => window.__rmc.squareToClient('d4'));
  await page.mouse.click(to.x, to.y);
  await page.waitForFunction(() => window.__rmc.results[0] != null, { timeout: 30000 });
  check(await page.evaluate(() => window.__rmc.results[0] === 'first'), 'raycast click-to-move solves puzzle 1 (best, first try)');
  await page.screenshot({ path: SHOTS + 'cabin-4-correct.png' });

  // ← retries even after solving, without re-scoring
  await page.evaluate(() => window.__rmc.retry());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__rmc.playMove('f3', 'd4'));
  await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__rmc.results[0] === 'first'), 'replaying a solved puzzle does not re-score it');

  // advance to puzzle 2
  await page.evaluate(() => window.__rmc.next());
  await page.waitForFunction(() => window.__rmc.puzzleIndex === 1, { timeout: 15000 });
  await page.waitForTimeout(200);

  // hint persists through a wrong move
  await page.evaluate(() => window.__rmc.hint());
  await page.evaluate(() => window.__rmc.playMove('a2', 'a3'));
  await page.waitForTimeout(250);
  check(await page.evaluate(() => window.__rmc.hintActive), 'hint highlight persists through a wrong move');

  // give up -> reveal the best move (Bxf7+)
  await page.evaluate(() => window.__rmc.reveal());
  await page.waitForFunction(() => /Bxf7\+/.test(document.getElementById('hud-feedback').textContent), { timeout: 15000 });
  check(true, 'I-don\'t-know reveals the best move (Bxf7+)');
  await page.screenshot({ path: SHOTS + 'cabin-5-reveal.png' });

  // burn through the rest -> summary
  for (let p = 2; p < total; p++) {
    await page.evaluate(() => window.__rmc.next());
    await page.waitForFunction((n) => window.__rmc.puzzleIndex === n, p, { timeout: 15000 });
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__rmc.reveal());
    await page.waitForFunction(() => !document.getElementById('btn-next').hidden, { timeout: 15000 });
  }
  await page.evaluate(() => window.__rmc.next());
  await page.waitForFunction(() => window.__rmc.state === 'SUMMARY', { timeout: 15000 });
  check(true, 'reaches the verdict (SUMMARY)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'cabin-6-summary.png' });

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
